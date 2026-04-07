import sqlite3
import os
import requests
from datetime import datetime, timezone

def now_iso():
    return datetime.now(timezone.utc).isoformat()

DB_PATH = 'truckai.db'

def run():
    db = sqlite3.connect(DB_PATH)
    print("Creating table transparking_cache if not exists...")
    db.execute(
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
    db.commit()
    
    print("Fetching data from Transparking...")
    url = "https://truckerapps.eu/transparking/points.php?action=list"
    try:
        r = requests.get(url, timeout=30)
        r.raise_for_status()
        data = r.json()
        features = data.get("features", [])
        print(f"Fetched {len(features)} features.")
        
        db.execute("DELETE FROM transparking_cache")
        now = now_iso()
        count = 0
        for f in features:
            props = f.get("properties", {})
            pid = props.get("id")
            name = props.get("title", "")
            
            geom = f.get("geometry", {})
            coords = geom.get("coordinates", [])
            
            if not pid or not coords or len(coords) < 2:
                continue
            
            lng, lat = coords[0], coords[1]
            db.execute(
                "INSERT INTO transparking_cache (pointid, name, lat, lng, refreshed_at) VALUES (?, ?, ?, ?, ?)",
                (str(pid), name, float(lat), float(lng), now)
            )
            count += 1
        db.commit()
        print(f"Inserted {count} points into cache.")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    run()
