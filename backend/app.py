"""
TruckAI Pro — Flask backend
Manages:
  • GPT-4o AI assistant  (POST /api/chat)
  • Saved POI database   (GET / POST / DELETE /api/pois)
  • Health check         (GET /api/health)

Run:
  cd backend
  pip install -r requirements.txt
  cp .env.example .env  # add your OPENAI_API_KEY
  python app.py
"""

import json
import math
import os
import sqlite3
from datetime import datetime, timezone

import requests
from flask import Flask, jsonify, request
from flask_cors import CORS
from dotenv import load_dotenv
from openai import OpenAI

# Always load from the directory where this file lives — safe with Flask debug
# reloader which spawns a child process that may have a different cwd.
load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"), override=True)

# ── OpenAI setup ───────────────────────────────────────────────────────────────
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
_gpt4o_ready = bool(os.getenv("OPENAI_API_KEY"))

_MAPBOX_TOKEN = (
    "pk.eyJ1IjoiYnJlaWthOTk5IiwiYSI6ImNtbHBob2xjMzE5Z3MzZ3F4Y3QybGpod3AifQ"
    ".hprmbhb8EVFSfF7cqc4lkw"
)

_SYSTEM_PROMPT = (
    "You are a Bulgarian truck GPS assistant. "
    "Always respond in Bulgarian. "
    "You help truck drivers with routes, parking, "
    "tachograph rules, and navigation. "
    "Be brief and practical. "
    "Use available tools for route planning, parking, cameras, fuel, and business search."
)

# ── GPT-4o tool definitions ────────────────────────────────────────────────────

_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "navigate_to",
            "description": "Start turn-by-turn navigation to a destination.",
            "parameters": {
                "type": "object",
                "properties": {
                    "destination": {
                        "type": "string",
                        "description": "City or address in Bulgaria",
                    }
                },
                "required": ["destination"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_truck_parking",
            "description": "Find truck parking near given coordinates.",
            "parameters": {
                "type": "object",
                "properties": {
                    "lat":      {"type": "number"},
                    "lng":      {"type": "number"},
                    "radius_m": {"type": "integer", "default": 5000},
                },
                "required": ["lat", "lng"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_speed_cameras",
            "description": "Find speed cameras near current position with distance to nearest.",
            "parameters": {
                "type": "object",
                "properties": {
                    "lat":      {"type": "number"},
                    "lng":      {"type": "number"},
                    "radius_m": {"type": "integer", "default": 10000},
                },
                "required": ["lat", "lng"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "calculate_hos_reach",
            "description": (
                "Calculate remaining drive time and distance before mandatory 45-min break "
                "(EU 4.5h rule)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "driven_seconds": {"type": "integer"},
                    "speed_kmh":      {"type": "number"},
                },
                "required": ["driven_seconds", "speed_kmh"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_business",
            "description": "Search for a business (warehouse, repair shop, customs, etc.) in a city.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "city":  {"type": "string"},
                    "lat":   {"type": "number"},
                    "lng":   {"type": "number"},
                },
                "required": ["query", "lat", "lng"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_traffic_route",
            "description": "Check current traffic on route. Suggests alternative if delay > 20 min.",
            "parameters": {
                "type": "object",
                "properties": {
                    "origin_lng": {"type": "number"},
                    "origin_lat": {"type": "number"},
                    "dest_lng":   {"type": "number"},
                    "dest_lat":   {"type": "number"},
                },
                "required": ["origin_lng", "origin_lat", "dest_lng", "dest_lat"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_fuel_stations",
            "description": "Find fuel stations within last 50km before destination.",
            "parameters": {
                "type": "object",
                "properties": {
                    "dest_lat": {"type": "number"},
                    "dest_lng": {"type": "number"},
                    "radius_m": {"type": "integer", "default": 50000},
                },
                "required": ["dest_lat", "dest_lng"],
            },
        },
    },
]

# ── Flask app ──────────────────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})  # allow RN Metro dev client

# ── SQLite database ────────────────────────────────────────────────────────────
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
        conn.commit()


init_db()


# ── Helpers ────────────────────────────────────────────────────────────────────

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def row_to_poi(row: sqlite3.Row) -> dict:
    return {
        "id":         row["id"],
        "name":       row["name"],
        "address":    row["address"],
        "category":   row["category"],
        "lat":        row["lat"],
        "lng":        row["lng"],
        "notes":      row["notes"],
        "created_at": row["created_at"],
    }


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Haversine distance in metres between two lat/lng points."""
    R = 6_371_000
    to_rad = math.radians
    d_lat = to_rad(lat2 - lat1)
    d_lng = to_rad(lng2 - lng1)
    a = math.sin(d_lat / 2) ** 2 + (
        math.cos(to_rad(lat1)) * math.cos(to_rad(lat2)) * math.sin(d_lng / 2) ** 2
    )
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _db_save_chat(user_msg: str, reply: str) -> None:
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


# ── Tool implementations ───────────────────────────────────────────────────────

def _tool_navigate_to(destination: str) -> dict:
    """Geocode destination via Mapbox Search Box v1."""
    try:
        # Step 1: suggest
        suggest_url = "https://api.mapbox.com/search/searchbox/v1/suggest"
        params = {
            "q": destination,
            "access_token": _MAPBOX_TOKEN,
            "language": "bg",
            "limit": 1,
            "session_token": "truckai-nav-session",
        }
        r = requests.get(suggest_url, params=params, timeout=8)
        r.raise_for_status()
        suggestions = r.json().get("suggestions", [])
        if not suggestions:
            return {"error": f"Не намерих '{destination}'"}

        mapbox_id = suggestions[0].get("mapbox_id")
        name = suggestions[0].get("name", destination)

        # Step 2: retrieve
        retrieve_url = f"https://api.mapbox.com/search/searchbox/v1/retrieve/{mapbox_id}"
        r2 = requests.get(
            retrieve_url,
            params={"access_token": _MAPBOX_TOKEN, "session_token": "truckai-nav-session"},
            timeout=8,
        )
        r2.raise_for_status()
        features = r2.json().get("features", [])
        if not features:
            return {"error": "Не намерих координати"}

        coords = features[0]["geometry"]["coordinates"]  # [lng, lat]
        return {"destination": name, "coords": coords}
    except Exception as exc:
        return {"error": str(exc)}


def _tool_find_truck_parking(lat: float, lng: float, radius_m: int = 5000) -> list:
    """Find truck parking via Overpass API."""
    overpass_url = "https://overpass-api.de/api/interpreter"
    query = f"""
[out:json][timeout:15];
(
  node["amenity"="parking"]["hgv"="yes"](around:{radius_m},{lat},{lng});
  node["amenity"="truck_stop"](around:{radius_m},{lat},{lng});
  way["amenity"="parking"]["hgv"="yes"](around:{radius_m},{lat},{lng});
);
out center 8;
"""
    try:
        r = requests.post(overpass_url, data={"data": query}, timeout=20)
        r.raise_for_status()
        elements = r.json().get("elements", [])
        results = []
        for el in elements[:8]:
            tags = el.get("tags", {})
            el_lat = el.get("lat") or el.get("center", {}).get("lat")
            el_lng = el.get("lon") or el.get("center", {}).get("lon")
            if el_lat is None or el_lng is None:
                continue
            results.append({
                "name":          tags.get("name", "Паркинг за камиони"),
                "lat":           el_lat,
                "lng":           el_lng,
                "paid":          tags.get("fee") == "yes",
                "showers":       tags.get("shower") == "yes",
                "distance_m":    round(_haversine_m(lat, lng, el_lat, el_lng)),
                "opening_hours": tags.get("opening_hours"),
                "phone":         tags.get("phone"),
            })
        results.sort(key=lambda x: x["distance_m"])
        return results
    except Exception as exc:
        return [{"error": str(exc)}]


def _tool_find_speed_cameras(lat: float, lng: float, radius_m: int = 10000) -> dict:
    """Find speed cameras via Overpass API."""
    overpass_url = "https://overpass-api.de/api/interpreter"
    query = f"""
[out:json][timeout:10];
node["highway"="speed_camera"](around:{radius_m},{lat},{lng});
out 15;
"""
    try:
        r = requests.post(overpass_url, data={"data": query}, timeout=15)
        r.raise_for_status()
        elements = r.json().get("elements", [])
        cameras = []
        for el in elements:
            tags = el.get("tags", {})
            el_lat = el["lat"]
            el_lng = el["lon"]
            dist = round(_haversine_m(lat, lng, el_lat, el_lng))
            cameras.append({
                "lat":       el_lat,
                "lng":       el_lng,
                "maxspeed":  tags.get("maxspeed"),
                "distance_m": dist,
            })
        cameras.sort(key=lambda x: x["distance_m"])
        nearest_m = cameras[0]["distance_m"] if cameras else -1
        return {"cameras": cameras, "nearest_m": nearest_m}
    except Exception as exc:
        return {"cameras": [], "nearest_m": -1, "error": str(exc)}


def _tool_calculate_hos_reach(driven_seconds: int, speed_kmh: float) -> dict:
    """Calculate EU HOS remaining drive time (4.5h = 16200s rule)."""
    HOS_LIMIT = 16200  # 4.5 h
    remaining_s = max(0, HOS_LIMIT - driven_seconds)
    remaining_km = (remaining_s / 3600) * speed_kmh
    h, rest = divmod(int(remaining_s), 3600)
    m = rest // 60
    return {
        "remaining_h":   h,
        "remaining_min": m,
        "remaining_km":  round(remaining_km),
        "break_needed":  remaining_s <= 0,
    }


def _tool_search_business(query: str, city: str, lat: float, lng: float) -> list:
    """Search POI via Mapbox Search Box."""
    try:
        suggest_url = "https://api.mapbox.com/search/searchbox/v1/suggest"
        q = f"{query} {city}".strip()
        params = {
            "q": q,
            "access_token": _MAPBOX_TOKEN,
            "language": "bg",
            "types": "poi",
            "limit": 5,
            "proximity": f"{lng},{lat}",
            "session_token": "truckai-biz-session",
        }
        r = requests.get(suggest_url, params=params, timeout=8)
        r.raise_for_status()
        suggestions = r.json().get("suggestions", [])
        results = []
        for s in suggestions:
            results.append({
                "name":     s.get("name", ""),
                "address":  s.get("full_address") or s.get("place_formatted", ""),
                "category": s.get("poi_category", []),
            })
        return results
    except Exception as exc:
        return [{"error": str(exc)}]


def _tool_check_traffic(
    origin_lng: float, origin_lat: float, dest_lng: float, dest_lat: float
) -> dict:
    """Check traffic on route via Mapbox Directions driving-traffic profile."""
    try:
        url = (
            f"https://api.mapbox.com/directions/v5/mapbox/driving-traffic"
            f"/{origin_lng},{origin_lat};{dest_lng},{dest_lat}"
        )
        params = {
            "access_token": _MAPBOX_TOKEN,
            "alternatives": "true",
            "overview":     "simplified",
        }
        r = requests.get(url, params=params, timeout=10)
        r.raise_for_status()
        routes = r.json().get("routes", [])
        if not routes:
            return {"error": "Няма маршрут"}

        primary = routes[0]
        duration = primary.get("duration", 0)
        typical = primary.get("duration_typical", duration)
        delay = max(0, duration - typical)
        delay_min = round(delay / 60)

        result: dict = {
            "has_delay":   delay > 1200,
            "delay_min":   delay_min,
            "duration_min": round(duration / 60),
        }

        if delay > 1200 and len(routes) > 1:
            alt = routes[1]
            alt_coords = alt.get("geometry", {})
            result["alternative_available"] = True
            result["alternative_duration_min"] = round(alt["duration"] / 60)
        else:
            result["alternative_available"] = False

        return result
    except Exception as exc:
        return {"error": str(exc)}


def _tool_find_fuel(dest_lat: float, dest_lng: float, radius_m: int = 50000) -> list:
    """Find fuel stations near destination via Overpass API."""
    overpass_url = "https://overpass-api.de/api/interpreter"
    query = f"""
[out:json][timeout:15];
(
  node["amenity"="fuel"]["hgv"="yes"](around:{radius_m},{dest_lat},{dest_lng});
  node["amenity"="fuel"](around:{radius_m},{dest_lat},{dest_lng});
);
out 10;
"""
    try:
        r = requests.post(overpass_url, data={"data": query}, timeout=20)
        r.raise_for_status()
        elements = r.json().get("elements", [])
        seen_ids: set = set()
        results = []
        for el in elements:
            if el["id"] in seen_ids:
                continue
            seen_ids.add(el["id"])
            tags = el.get("tags", {})
            el_lat = el.get("lat", dest_lat)
            el_lng = el.get("lon", dest_lng)
            results.append({
                "name":          tags.get("name", "Бензиностанция"),
                "brand":         tags.get("brand"),
                "lat":           el_lat,
                "lng":           el_lng,
                "distance_m":    round(_haversine_m(dest_lat, dest_lng, el_lat, el_lng)),
                "hgv":           tags.get("hgv") == "yes",
                "opening_hours": tags.get("opening_hours"),
                "phone":         tags.get("phone"),
            })
        results.sort(key=lambda x: x["distance_m"])
        return results[:10]
    except Exception as exc:
        return [{"error": str(exc)}]


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return jsonify({
        "status":      "ok",
        "gpt4o_ready": _gpt4o_ready,
        "db":          DB_PATH,
        "timestamp":   now_iso(),
    })


# ── GPT-4o chat ────────────────────────────────────────────────────────────────

@app.post("/api/chat")
def chat():
    """
    Body: {
      "message": "...",
      "history": [{"role":"user"|"model","text":"..."}],
      "context": {"lat":..., "lng":..., "driven_seconds":..., "speed_kmh":...}
    }
    Response: { "reply": "...", "ok": true, "action": {...} | null }
    """
    body = request.get_json(silent=True) or {}
    user_msg: str = (body.get("message") or "").strip()
    history: list = body.get("history") or []
    context: dict = body.get("context") or {}

    if not user_msg:
        return jsonify({"ok": False, "error": "message is required"}), 400

    if not _gpt4o_ready:
        return jsonify({
            "ok":    False,
            "error": "GPT-4o не е конфигуриран. Добави OPENAI_API_KEY в backend/.env",
        }), 503

    # System message enriched with driver context
    system_txt = _SYSTEM_PROMPT
    if context:
        driven_h = context.get("driven_seconds", 0) / 3600
        system_txt += (
            f"\n\nDriver context: lat={context.get('lat', '?')}, "
            f"lng={context.get('lng', '?')}, "
            f"driven={driven_h:.1f}h, speed={context.get('speed_kmh', 0):.0f}km/h"
        )

    messages = [{"role": "system", "content": system_txt}]
    for h in history:
        messages.append({
            "role": "assistant" if h.get("role") == "model" else "user",
            "content": h.get("text", ""),
        })
    messages.append({"role": "user", "content": user_msg})

    action = None
    last_msg = None

    try:
        for _ in range(3):  # max 3 tool calls per request
            resp = client.chat.completions.create(
                model="gpt-4o",
                messages=messages,
                tools=_TOOLS,
                tool_choice="auto",
                temperature=0.7,
            )
            last_msg = resp.choices[0].message

            if not last_msg.tool_calls:
                break  # plain text reply — done

            call = last_msg.tool_calls[0]
            fn   = call.function.name
            args = json.loads(call.function.arguments)

            # Inject context defaults when model omits them
            if "lat" not in args and context.get("lat") is not None:
                args["lat"] = context["lat"]
                args["lng"] = context["lng"]
            if "driven_seconds" not in args:
                args["driven_seconds"] = context.get("driven_seconds", 0)
            if "speed_kmh" not in args:
                args["speed_kmh"] = context.get("speed_kmh", 80)

            # Dispatch to tool implementations
            if fn == "navigate_to":
                result = _tool_navigate_to(args["destination"])
                if "coords" in result:
                    action = {
                        "type":        "navigate",
                        "destination": result["destination"],
                        "coords":      result["coords"],
                    }
            elif fn == "find_truck_parking":
                result = _tool_find_truck_parking(
                    args["lat"], args["lng"], args.get("radius_m", 5000)
                )
                action = {"type": "show_parking", "pois": result}
            elif fn == "find_speed_cameras":
                result = _tool_find_speed_cameras(
                    args["lat"], args["lng"], args.get("radius_m", 10000)
                )
                action = {"type": "show_cameras", **result}
            elif fn == "calculate_hos_reach":
                result = _tool_calculate_hos_reach(
                    args["driven_seconds"], args["speed_kmh"]
                )
            elif fn == "search_business":
                result = _tool_search_business(
                    args["query"], args.get("city", ""), args["lat"], args["lng"]
                )
                action = {"type": "show_pois", "pois": result}
            elif fn == "check_traffic_route":
                result = _tool_check_traffic(
                    args["origin_lng"], args["origin_lat"],
                    args["dest_lng"],   args["dest_lat"],
                )
            elif fn == "find_fuel_stations":
                result = _tool_find_fuel(
                    args["dest_lat"], args["dest_lng"], args.get("radius_m", 50000)
                )
                action = {"type": "show_fuel", "stations": result}
            else:
                result = {"error": "unknown tool"}

            # Append assistant tool call + tool result to continue the loop
            messages.append(last_msg)
            messages.append({
                "role":         "tool",
                "tool_call_id": call.id,
                "content":      json.dumps(result, ensure_ascii=False),
            })

    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500

    reply = (last_msg.content or "") if last_msg else ""
    _db_save_chat(user_msg, reply)
    return jsonify({"ok": True, "reply": reply, "action": action})


# ── POI endpoints ──────────────────────────────────────────────────────────────

@app.get("/api/pois")
def list_pois():
    """Returns all saved POIs, optionally filtered by ?category=gas_station"""
    category = request.args.get("category")
    with get_db() as conn:
        if category:
            rows = conn.execute(
                "SELECT * FROM pois WHERE category = ? ORDER BY created_at DESC",
                (category,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM pois ORDER BY created_at DESC"
            ).fetchall()
    return jsonify({"ok": True, "pois": [row_to_poi(r) for r in rows]})


@app.post("/api/pois")
def save_poi():
    """
    Body: { name, address?, category?, lat, lng, notes? }
    """
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    lat  = body.get("lat")
    lng  = body.get("lng")

    if not name or lat is None or lng is None:
        return jsonify({"ok": False, "error": "name, lat, lng are required"}), 400

    with get_db() as conn:
        cur = conn.execute(
            """
            INSERT INTO pois (name, address, category, lat, lng, notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                name,
                body.get("address", ""),
                body.get("category", "custom"),
                float(lat),
                float(lng),
                body.get("notes", ""),
                now_iso(),
            ),
        )
        conn.commit()
        poi_id = cur.lastrowid

    row = get_db().execute("SELECT * FROM pois WHERE id = ?", (poi_id,)).fetchone()
    return jsonify({"ok": True, "poi": row_to_poi(row)}), 201


@app.delete("/api/pois/<int:poi_id>")
def delete_poi(poi_id: int):
    with get_db() as conn:
        deleted = conn.execute(
            "DELETE FROM pois WHERE id = ?", (poi_id,)
        ).rowcount
        conn.commit()

    if deleted == 0:
        return jsonify({"ok": False, "error": "POI not found"}), 404
    return jsonify({"ok": True})


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.getenv("FLASK_PORT", 5050))
    debug = os.getenv("FLASK_DEBUG", "true").lower() == "true"
    print(f"TruckAI Pro backend @ http://0.0.0.0:{port}")
    print(f"GPT-4o ready: {_gpt4o_ready}")
    app.run(host="0.0.0.0", port=port, debug=debug)
