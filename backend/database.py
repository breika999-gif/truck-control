import sqlite3
import os
import re
import threading
import requests
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from config import DATABASE_URL

DB_PATH = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "truckai.db"))
USE_POSTGRES = DATABASE_URL.startswith("postgres")
_chat_write_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="chat-history")

# Ensure DB directory exists (critical for Railway volumes)
_db_dir = os.path.dirname(DB_PATH)
if _db_dir and not os.path.exists(_db_dir):
    os.makedirs(_db_dir, exist_ok=True)

class CursorAdapter:
    def __init__(self, cursor, lastrowid=None):
        self._cursor = cursor
        self._lastrowid = lastrowid

    @property
    def lastrowid(self):
        return self._lastrowid if self._lastrowid is not None else getattr(self._cursor, "lastrowid", None)

    @property
    def rowcount(self):
        return self._cursor.rowcount

    def fetchone(self):
        return self._cursor.fetchone()

    def fetchall(self):
        return self._cursor.fetchall()


class DatabaseConnection:
    def __init__(self):
        self.is_postgres = USE_POSTGRES
        if self.is_postgres:
            import psycopg2

            self._conn = psycopg2.connect(DATABASE_URL)
        else:
            self._conn = sqlite3.connect(DB_PATH)
            self._conn.row_factory = sqlite3.Row
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA busy_timeout=3000")

    def _cursor(self):
        if not self.is_postgres:
            return self._conn.cursor()
        from psycopg2.extras import RealDictCursor

        return self._conn.cursor(cursor_factory=RealDictCursor)

    def _sql(self, query: str) -> str:
        return query.replace("?", "%s") if self.is_postgres else query

    def execute(self, query: str, params=()):
        cursor = self._cursor()
        sql = self._sql(query)
        return_id = bool(
            self.is_postgres
            and "RETURNING" not in sql.upper()
            and re.match(r"\s*INSERT\s+INTO\s+(pois|routes)\b", sql, re.IGNORECASE)
        )
        if return_id:
            sql = f"{sql.rstrip().rstrip(';')} RETURNING id"
        cursor.execute(sql, params)
        lastrowid = None
        if return_id:
            row = cursor.fetchone()
            lastrowid = row["id"] if row else None
        return CursorAdapter(cursor, lastrowid)

    def executemany(self, query: str, params):
        cursor = self._cursor()
        cursor.executemany(self._sql(query), params)
        return CursorAdapter(cursor)

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        self._conn.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        try:
            if exc_type is None:
                self.commit()
            else:
                self.rollback()
        finally:
            self.close()
        return False


def get_db() -> DatabaseConnection:
    return DatabaseConnection()

def init_db() -> None:
    id_column = "SERIAL PRIMARY KEY" if USE_POSTGRES else "INTEGER PRIMARY KEY AUTOINCREMENT"
    with get_db() as conn:
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS pois (
                id        {id_column},
                name      TEXT    NOT NULL,
                address   TEXT,
                category  TEXT    NOT NULL DEFAULT 'custom',
                lat       REAL    NOT NULL,
                lng       REAL    NOT NULL,
                notes     TEXT,
                user_email TEXT   NOT NULL DEFAULT '',
                created_at TEXT   NOT NULL
            )
            """
        )
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS chat_history (
                id         {id_column},
                user_email TEXT NOT NULL DEFAULT '',
                role       TEXT NOT NULL,
                message    TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS tacho_sessions (
                id             {id_column},
                user_email     TEXT    NOT NULL DEFAULT '',
                date           TEXT    NOT NULL,
                start_time     TEXT    NOT NULL,
                end_time       TEXT,
                driven_seconds INTEGER NOT NULL DEFAULT 0,
                type           TEXT    NOT NULL DEFAULT 'driving'
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_settings (
                user_email     TEXT PRIMARY KEY,
                gemini_api_key TEXT,
                updated_at     TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS truck_bans_cache (
                date TEXT PRIMARY KEY,
                data TEXT,
                fetched_at TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS transparking_cache (
                pointid TEXT PRIMARY KEY,
                name TEXT,
                lat REAL,
                lng REAL,
                refreshed_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS routes (
                id               {id_column},
                user_email       TEXT,
                origin_name      TEXT,
                destination_name TEXT,
                origin_lat       REAL,
                origin_lng       REAL,
                dest_lat         REAL,
                dest_lng         REAL,
                waypoints_json   TEXT,
                distance_m       REAL,
                duration_s       REAL,
                started_at       TEXT,
                completed_at     TEXT,
                created_at       TEXT
            )
            """
        )
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS rest_log (
                id           {id_column},
                user_email   TEXT,
                lat          REAL,
                lng          REAL,
                rest_type    TEXT,
                duration_min INTEGER,
                started_at   TEXT,
                created_at   TEXT
            )
            """
        )
        # Indexes — idempotent, safe to run on existing DBs
        for idx_sql in (
            "CREATE INDEX IF NOT EXISTS idx_pois_user ON pois(user_email)",
            "CREATE INDEX IF NOT EXISTS idx_chat_user ON chat_history(user_email)",
            "CREATE INDEX IF NOT EXISTS idx_chat_ts   ON chat_history(created_at)",
            "CREATE INDEX IF NOT EXISTS idx_tacho_user ON tacho_sessions(user_email)",
            "CREATE INDEX IF NOT EXISTS idx_routes_user ON routes(user_email)",
            "CREATE INDEX IF NOT EXISTS idx_rest_log_user ON rest_log(user_email)",
        ):
            try:
                conn.execute(idx_sql)
            except Exception:
                pass
        conn.commit()

    migrations = (
        ("pois", "user_email", "TEXT NOT NULL DEFAULT ''"),
        ("tacho_sessions", "type", "TEXT NOT NULL DEFAULT 'driving'"),
        ("chat_history", "user_email", "TEXT NOT NULL DEFAULT ''"),
    )
    for table, column, definition in migrations:
        try:
            with get_db() as db:
                if USE_POSTGRES:
                    db.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {definition}")
                else:
                    db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
        except Exception:
            pass

def row_to_poi(row) -> dict:
    return {
        "id":         row["id"],
        "name":       row["name"],
        "address":    row["address"],
        "category":   row["category"],
        "lat":        row["lat"],
        "lng":        row["lng"],
        "notes":      row["notes"],
        "user_email": row["user_email"] if "user_email" in row.keys() else "",
        "created_at": row["created_at"],
    }

def _db_save_chat_sync(user_msg: str, reply: str, user_email: str = "") -> None:
    from utils.helpers import now_iso

    def insert_pair() -> None:
        with get_db() as conn:
            conn.execute(
                "INSERT INTO chat_history (user_email, role, message, created_at) VALUES (?, ?, ?, ?)",
                (user_email, "user", user_msg, now_iso()),
            )
            conn.execute(
                "INSERT INTO chat_history (user_email, role, message, created_at) VALUES (?, ?, ?, ?)",
                (user_email, "model", reply, now_iso()),
            )
            conn.commit()

    try:
        insert_pair()
    except Exception as exc:
        error = str(exc).lower()
        if "no such table" not in error and "does not exist" not in error:
            raise
        init_db()
        insert_pair()


def _db_save_chat(user_msg: str, reply: str, user_email: str = "") -> None:
    def run() -> None:
        try:
            _db_save_chat_sync(user_msg, reply, user_email)
        except Exception as exc:
            print(f"[CHAT_HISTORY] async save failed: {exc}", flush=True)

    _chat_write_executor.submit(run)

def _transparking_cache_refresh() -> None:
    from utils.helpers import now_iso
    try:
        with get_db() as db:
            row = db.execute("SELECT refreshed_at FROM transparking_cache LIMIT 1").fetchone()
            if row:
                stats = db.execute("SELECT MIN(lat) AS min_lat, MAX(lat) AS max_lat FROM transparking_cache").fetchone()
                cache_has_swapped_columns = bool(stats and (
                    abs(stats["min_lat"] or 0) > 90 or abs(stats["max_lat"] or 0) > 90
                ))
                last_refreshed = datetime.fromisoformat(row["refreshed_at"])
                if not cache_has_swapped_columns and (datetime.now(timezone.utc) - last_refreshed.replace(tzinfo=timezone.utc)).total_seconds() < 86400:
                    return

        url = "https://truckerapps.eu/transparking/points.php?action=list"
        r = requests.get(url, timeout=60)
        r.raise_for_status()
        data = r.json()

        features = data.get("features", [])
        if not features:
            return

        now = now_iso()
        rows = []
        for f in features:
            props = f.get("properties", {})
            pid = props.get("id")
            name = props.get("title", "")
            coords = f.get("geometry", {}).get("coordinates", [])
            if not pid or len(coords) < 2:
                continue
            # TransParking returns [lat, lng], unlike GeoJSON's usual [lng, lat].
            lat, lng = coords[0], coords[1]
            rows.append((str(pid), name, float(lat), float(lng), now))

        # Atomic swap: insert all new rows then delete old ones in one transaction.
        # This prevents a partial/empty cache if the process is interrupted mid-write.
        with get_db() as db:
            db.executemany(
                """
                INSERT INTO transparking_cache (pointid, name, lat, lng, refreshed_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(pointid) DO UPDATE SET
                    name=excluded.name,
                    lat=excluded.lat,
                    lng=excluded.lng,
                    refreshed_at=excluded.refreshed_at
                """,
                rows,
            )
            db.execute("DELETE FROM transparking_cache WHERE refreshed_at != ?", (now,))
            db.commit()
        inserted = len(rows)
    except Exception as e:
        print(f"[TRANSPARKING] cache refresh failed: {e}", flush=True)

def _transparking_match(lat: float, lng: float, radius_m: int = 150) -> dict | None:
    from utils.helpers import _haversine_m
    def _find(swapped: bool = False) -> str | None:
        with get_db() as db:
            if swapped:
                rows = db.execute(
                    "SELECT pointid, lat, lng FROM transparking_cache WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?",
                    (lng - 0.002, lng + 0.002, lat - 0.002, lat + 0.002)
                ).fetchall()
            else:
                rows = db.execute(
                    "SELECT pointid, lat, lng FROM transparking_cache WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?",
                    (lat - 0.002, lat + 0.002, lng - 0.002, lng + 0.002)
                ).fetchall()
            best_match = None
            min_dist = radius_m
            for r in rows:
                row_lat, row_lng = (r["lng"], r["lat"]) if swapped else (r["lat"], r["lng"])
                d = _haversine_m(lat, lng, row_lat, row_lng)
                if d < min_dist:
                    min_dist = d
                    best_match = r["pointid"]
            return best_match

    try:
        best_match = _find(False) or _find(True)
        if best_match:
            return {
                "pointid": best_match,
                "url": "https://truckerapps.eu/transparking/bg/map/"
            }
    except Exception as e:
        print(f"[TRANSPARKING] match lookup failed: {e}", flush=True)
    return None

def start_background_tasks():
    if os.environ.get("ENABLE_TRANSPARKING_DAEMON", "").lower() not in {"1", "true", "yes"}:
        return
    threading.Thread(target=_transparking_cache_refresh, daemon=True).start()

# ── POI in-memory cache ────────────────────────────────────────────────────────
import hashlib as _hashlib
import json as _json
import time as _cache_time
from utils.redis_client import get_redis as _get_redis

_poi_cache: dict = {}   # key → (result, expires_at)
_POI_CACHE_TTL = 600    # 10 minutes
_poi_lock = threading.Lock()

def _poi_cache_key(fn: str, lat: float, lng: float, radius_m: int = 0) -> str:
    return f"{fn}:{round(lat, 2)}:{round(lng, 2)}:{radius_m}"

def _poi_redis_key(key: str) -> str:
    return "poi:" + _hashlib.sha256(key.encode("utf-8")).hexdigest()

def _poi_cache_get(key: str):
    rc = _get_redis()
    if rc:
        try:
            raw = rc.get(_poi_redis_key(key))
            if raw:
                return _json.loads(raw)
        except Exception:
            pass
    with _poi_lock:
        entry = _poi_cache.get(key)
        if entry and _cache_time.time() < entry[1]:
            return entry[0]
        _poi_cache.pop(key, None)
    return None

def _poi_cache_set(key: str, result: list) -> None:
    rc = _get_redis()
    if rc:
        try:
            rc.setex(_poi_redis_key(key), _POI_CACHE_TTL, _json.dumps(result, default=str))
        except Exception:
            pass
    with _poi_lock:
        if len(_poi_cache) >= 200:
            oldest = min(_poi_cache, key=lambda k: _poi_cache[k][1])
            _poi_cache.pop(oldest, None)
        _poi_cache[key] = (result, _cache_time.time() + _POI_CACHE_TTL)
