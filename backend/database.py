import sqlite3
import os
import threading
import requests
from datetime import datetime, timezone
from config import FLASK_DEBUG

DB_PATH = os.path.join(os.path.dirname(__file__), "truckai.db")

def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
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

def _db_save_chat(user_msg: str, reply: str) -> None:
    from utils.helpers import now_iso
    with get_db() as conn:
        conn.execute(
            "INSERT INTO chat_history (role, message, created_at) VALUES (?, ?, ?)",
            ("user", user_msg, now_iso()),
        )
        conn.execute(
            "INSERT INTO chat_history (role, message, created_at) VALUES (?, ?, ?)",
            ("model", reply, now_iso()),
        )
        conn.commit()

def _transparking_cache_refresh() -> None:
    from utils.helpers import now_iso
    try:
        with get_db() as db:
            row = db.execute("SELECT refreshed_at FROM transparking_cache LIMIT 1").fetchone()
            if row:
                last_refreshed = datetime.fromisoformat(row["refreshed_at"])
                if (datetime.now(timezone.utc) - last_refreshed.replace(tzinfo=timezone.utc)).total_seconds() < 86400:
                    return

        url = "https://truckerapps.eu/transparking/points.php?action=list"
        r = requests.get(url, timeout=60)
        r.raise_for_status()
        data = r.json()

        features = data.get("features", [])
        if not features:
            return

        now = now_iso()
        inserted = 0
        with get_db() as db:
            db.execute("DELETE FROM transparking_cache")
            db.commit()
            for i, f in enumerate(features):
                props = f.get("properties", {})
                pid = props.get("id")
                name = props.get("title", "")
                coords = f.get("geometry", {}).get("coordinates", [])
                if not pid or len(coords) < 2:
                    continue
                lng, lat = coords[0], coords[1]
                db.execute(
                    "INSERT INTO transparking_cache (pointid, name, lat, lng, refreshed_at) VALUES (?, ?, ?, ?, ?)",
                    (str(pid), name, float(lat), float(lng), now)
                )
                inserted += 1
                if inserted % 5000 == 0:
                    db.commit()
            db.commit()
    except Exception:
        pass

def _transparking_match(lat: float, lng: float, radius_m: int = 150) -> dict | None:
    from utils.helpers import _haversine_m
    try:
        with get_db() as db:
            rows = db.execute(
                "SELECT pointid, lat, lng FROM transparking_cache WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?",
                (lat - 0.002, lat + 0.002, lng - 0.002, lng + 0.002)
            ).fetchall()
            
            best_match = None
            min_dist = radius_m
            
            for r in rows:
                d = _haversine_m(lat, lng, r["lat"], r["lng"])
                if d < min_dist:
                    min_dist = d
                    best_match = r["pointid"]
            
            if best_match:
                return {
                    "pointid": best_match,
                    "url": f"https://truckerapps.eu/transparking/en/poi/{best_match}"
                }
    except Exception:
        pass
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
