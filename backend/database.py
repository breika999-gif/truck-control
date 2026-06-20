import sqlite3
import os
import threading
import requests
from datetime import datetime, timezone
from config import FLASK_DEBUG

DB_PATH = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "truckai.db"))

# Ensure DB directory exists (critical for Railway volumes)
_db_dir = os.path.dirname(DB_PATH)
if _db_dir and not os.path.exists(_db_dir):
    os.makedirs(_db_dir, exist_ok=True)

class ClosingConnection(sqlite3.Connection):
    def __exit__(self, exc_type, exc_value, traceback):
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()

def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, factory=ClosingConnection)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=3000")
    return conn

def init_db() -> None:
    with get_db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS pois (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                name      TEXT    NOT NULL,
                address   TEXT,
                category  TEXT    NOT NULL DEFAULT 'custom',
                lat       REAL    NOT NULL,
                lng       REAL    NOT NULL,
                notes     TEXT,
                created_at TEXT   NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS chat_history (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_email TEXT NOT NULL DEFAULT '',
                role       TEXT NOT NULL,
                message    TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS tacho_sessions (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                user_email     TEXT    NOT NULL DEFAULT '',
                date           TEXT    NOT NULL,
                start_time     TEXT    NOT NULL,
                end_time       TEXT,
                driven_seconds INTEGER NOT NULL DEFAULT 0
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
            CREATE TABLE IF NOT EXISTS map_match_cache (
                route_hash TEXT PRIMARY KEY,
                coords_json TEXT NOT NULL,
                created_at TEXT NOT NULL
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
            """
            CREATE TABLE IF NOT EXISTS routes (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
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
            """
            CREATE TABLE IF NOT EXISTS rest_log (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
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
        conn.commit()
    
    # Migration
    try:
        with get_db() as db:
            db.execute("ALTER TABLE pois ADD COLUMN user_email TEXT NOT NULL DEFAULT ''")
            db.commit()
    except Exception:
        pass
    try:
        with get_db() as db:
            db.execute("ALTER TABLE tacho_sessions ADD COLUMN type TEXT NOT NULL DEFAULT 'driving'")
            db.commit()
    except Exception:
        pass
    try:
        with get_db() as db:
            db.execute("ALTER TABLE chat_history ADD COLUMN user_email TEXT NOT NULL DEFAULT ''")
            db.commit()
    except Exception:
        pass

def row_to_poi(row: sqlite3.Row) -> dict:
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

def _db_save_chat(user_msg: str, reply: str, user_email: str = "") -> None:
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
    except sqlite3.OperationalError as exc:
        if "no such table" not in str(exc).lower():
            raise
        init_db()
        insert_pair()

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
                "INSERT OR REPLACE INTO transparking_cache (pointid, name, lat, lng, refreshed_at) VALUES (?, ?, ?, ?, ?)",
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
    threading.Thread(target=_transparking_cache_refresh, daemon=True).start()

# ── POI in-memory cache ────────────────────────────────────────────────────────
import time as _cache_time

_poi_cache: dict = {}   # key → (result, expires_at)
_POI_CACHE_TTL = 600    # 10 minutes

def _poi_cache_key(fn: str, lat: float, lng: float, radius_m: int = 0) -> str:
    return f"{fn}:{round(lat, 2)}:{round(lng, 2)}:{radius_m}"

def _poi_cache_get(key: str):
    entry = _poi_cache.get(key)
    if entry and _cache_time.time() < entry[1]:
        return entry[0]
    _poi_cache.pop(key, None)
    return None

def _poi_cache_set(key: str, result: list) -> None:
    if len(_poi_cache) >= 200:
        oldest = min(_poi_cache, key=lambda k: _poi_cache[k][1])
        _poi_cache.pop(oldest, None)
    _poi_cache[key] = (result, _cache_time.time() + _POI_CACHE_TTL)
