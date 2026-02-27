"""
TruckAI Pro — Flask backend
Architecture: GPT-4o is the map brain. Every response is a JSON map action.
The frontend reads the action and executes it on Mapbox directly.

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
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import requests
from flask import Flask, jsonify, request
from flask_cors import CORS
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"), override=True)

# ── OpenAI setup ───────────────────────────────────────────────────────────────
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
_gpt4o_ready = bool(os.getenv("OPENAI_API_KEY"))

_MAPBOX_TOKEN = (
    "pk.eyJ1IjoiYnJlaWthOTk5IiwiYSI6ImNtbHBob2xjMzE5Z3MzZ3F4Y3QybGpod3AifQ"
    ".hprmbhb8EVFSfF7cqc4lkw"
)

# ── System prompt — GPT-4o responds ONLY with JSON map actions ─────────────────
_SYSTEM_PROMPT = (
    "You are an expert truck GPS assistant for Bulgarian drivers. "
    "ALWAYS respond in JSON only. Never plain text.\n\n"
    "CRITICAL RULES:\n"
    "1. ALWAYS respond with ONLY a single valid JSON object. NEVER plain text before or after.\n"
    "2. NEVER ask clarifying questions — act immediately with best guess.\n"
    "3. Always use Bulgarian in all message fields.\n"
    "4. ALWAYS avoid Serbia when routing from Bulgaria to Romania or any Western/Central European destination.\n"
    "5. For routes from Bulgaria to Western Europe (Germany, France, Spain, Italy, Austria, Netherlands, Belgium): "
    "ALWAYS add intermediate waypoints: Bucharest → Cluj → Budapest.\n"
    "6. Tachograph rules (EU Regulation 561/2006): max 4.5h continuous driving, then 45min mandatory break. "
    "Call calculate_hos_reach tool. Suggest parking stop 30min before the limit.\n"
    "7. DYNAMIC AVOIDANCE: When user says 'избягвай X', 'не минавай X', 'заобиколи X', 'avoid X': "
    "add avoid=['x'] to navigate_to or suggest_routes. "
    "Supported values: 'serbia', 'romania', 'greece', 'turkey', 'sofia_center', 'motorway', 'toll', 'ferry'. "
    "Example: 'маршрут до Виена, избягвай Румъния' → navigate_to(destination='Vienna', avoid=['romania']).\n"
    "8. SEARCH ANYTHING: For ANY location search — company names, warehouses, factories, "
    "repair shops, customs offices, stores, hotels, industrial zones, exact addresses, "
    "landmarks — use search_business. Examples: 'Panzani Marseille', 'DHL склад Пловдив', "
    "'Индустриална зона Илияне', 'митница Капитан Андреево'. "
    "Results appear as 🏢 pins on the map. User taps to navigate.\n"
    "9. FULL ADDRESS: navigate_to accepts any string — full address, company name, POI. "
    "Use search_business when user wants to SEE multiple options; "
    "use navigate_to when user clearly wants to GO to one specific destination.\n\n"
    "Available tools:\n"
    '  navigate_to          → {"action":"route", ...}  (accepts avoid=["serbia","toll",...])\n'
    '  suggest_routes       → {"action":"show_routes", "options":[...], ...}  (accepts avoid=[...])\n'
    '  search_business      → {"action":"show_pois","category":"business",...}  (ANYTHING: company/address/place)\n'
    '  find_truck_parking   → {"action":"show_pois", "category":"truck_stop", ...}\n'
    '  find_fuel_stations   → {"action":"show_pois", "category":"fuel", ...}\n'
    '  find_speed_cameras   → {"action":"show_pois", "category":"speed_camera", ...}\n'
    '  calculate_hos_reach  → {"action":"tachograph", ...}\n'
    '  check_traffic_route  → {"action":"show_routes", ...}\n'
    '  No tool (info/chat)  → {"action":"message", "text":"<Bulgarian>"}\n\n'
    "Known city coords: Sofia≈42.70,23.32; Plovdiv≈42.15,24.75; "
    "Varna≈43.20,27.91; Burgas≈42.50,27.47; Stara Zagora≈42.42,25.64; "
    "Ruse≈43.85,25.95; Blagoevgrad≈42.02,23.10; Vidin≈43.99,22.88; "
    "Berlin≈52.52,13.40; Hamburg≈53.55,10.00; Frankfurt≈50.11,8.68; "
    "Munich≈48.14,11.58; Dusseldorf≈51.22,6.77; Stuttgart≈48.78,9.18; "
    "Paris≈48.85,2.35; Lyon≈45.75,4.85; Marseille≈43.30,5.37; "
    "Vienna≈48.21,16.37; Graz≈47.07,15.44; Salzburg≈47.80,13.04; "
    "Bucharest≈44.43,26.10; Cluj≈46.77,23.59; Timisoara≈45.75,21.23; "
    "Budapest≈47.50,19.04; Debrecen≈47.53,21.63; "
    "Warsaw≈52.23,21.01; Prague≈50.08,14.44; Bratislava≈48.15,17.11; "
    "Barcelona≈41.39,2.15; Madrid≈40.42,-3.70; Valencia≈39.47,-0.37; "
    "Rome≈41.90,12.50; Milan≈45.46,9.19; Turin≈45.07,7.69; Bologna≈44.50,11.34; "
    "Amsterdam≈52.37,4.90; Rotterdam≈51.92,4.48; Antwerp≈51.22,4.40; "
    "Brussels≈50.85,4.35; Liege≈50.64,5.57; "
    "Istanbul≈41.01,28.95; Ankara≈39.93,32.86; "
    "Belgrade≈44.82,20.46; Zagreb≈45.81,15.98; Ljubljana≈46.05,14.51; "
    "Athens≈37.98,23.73; Thessaloniki≈40.64,22.94."
)

# ── GPT-4o tool definitions ────────────────────────────────────────────────────

_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "navigate_to",
            "description": (
                "Start turn-by-turn navigation to a destination. "
                "Accepts full addresses, company names, industrial zones, landmarks. "
                "Use avoid param when user requests country/area/road-type exclusion."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "destination": {
                        "type": "string",
                        "description": "City, full address, company name or landmark",
                    },
                    "avoid": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": (
                            "Regions/roads to avoid. Options: "
                            "'serbia', 'romania', 'greece', 'turkey', 'sofia_center', "
                            "'motorway', 'toll', 'ferry'"
                        ),
                    },
                },
                "required": ["destination"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "suggest_routes",
            "description": (
                "Show 2-3 route alternatives to a destination with different paths. "
                "Use when the user asks for route options, alternative routes, or wants to compare paths. "
                "Use avoid param when user requests country/area/road-type exclusion."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "destination": {"type": "string", "description": "City or address"},
                    "origin_lat":  {"type": "number"},
                    "origin_lng":  {"type": "number"},
                    "avoid": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": (
                            "Regions/roads to avoid: "
                            "'serbia', 'romania', 'greece', 'turkey', 'sofia_center', "
                            "'motorway', 'toll', 'ferry'"
                        ),
                    },
                },
                "required": ["destination", "origin_lat", "origin_lng"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_truck_parking",
            "description": (
                "Find truck stops and HGV parking near a location. "
                "Use driver GPS when near current position; use city coords from knowledge for named cities."
            ),
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
            "description": "Find speed cameras near a position.",
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
            "description": "Calculate remaining drive time before mandatory 45-min break (EU 4.5h rule).",
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
            "description": (
                "Search for a business (warehouse, repair shop, customs, etc.). "
                "Translate query to English before calling."
            ),
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
            "description": (
                "Find fuel/diesel stations near a destination city. "
                "Use destination city coords from knowledge, not driver GPS."
            ),
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
CORS(app, resources={r"/api/*": {"origins": "*"}})

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


# ── Avoidance bypass waypoints [lng, lat] ────────────────────────────────────
# Forced intermediate waypoints that route Mapbox through alternative corridors.

_BUCHAREST_WP = [26.1025, 44.4268]   # [lng, lat] — Mapbox coordinate order
_CLUJ_WP      = [23.5890, 46.7690]   # Cluj-Napoca, Romania
_BUDAPEST_WP  = [19.0402, 47.4979]   # Budapest, Hungary
_BELGRADE_WP  = [20.4568, 44.8176]   # Belgrade, Serbia
_ZAGREB_WP    = [15.9799, 45.8150]   # Zagreb, Croatia
# Sofia ring road (Okolovrasten Pat) bypass — west & east points
_SOFIA_BYPASS = [[23.2600, 42.7400], [23.4300, 42.7100]]


def _get_avoidance_waypoints(
    origin_lat, origin_lng, dest_lng: float, avoid: list = None
) -> list:
    """Return forced waypoints based on avoidance preferences.

    Handles:
      'serbia'       → Romania corridor  (auto for BG→W or explicit)
      'romania'      → Belgrade → Zagreb corridor (BG→W via Serbia/Croatia)
      'sofia_center' → Northern ring road bypass
      'greece'/'turkey' → no waypoints needed (Mapbox handles border routing)
    """
    avoid_set = {a.lower() for a in (avoid or [])}
    if origin_lat is None or origin_lng is None:
        return []

    in_bulgaria = (41.0 <= origin_lat <= 44.5) and (22.0 <= origin_lng <= 29.0)
    going_west  = dest_lng is not None and dest_lng < 17.0  # Austria lng ~17

    # Serbia avoidance: explicit OR automatic when driving BG → W Europe
    if "serbia" in avoid_set or (in_bulgaria and going_west and "romania" not in avoid_set):
        return [_BUCHAREST_WP, _CLUJ_WP, _BUDAPEST_WP]

    # Romania avoidance — route via Belgrade → Zagreb instead
    if "romania" in avoid_set and in_bulgaria and going_west:
        return [_BELGRADE_WP, _ZAGREB_WP]

    # Sofia center bypass — northern ring road
    if "sofia_center" in avoid_set:
        return _SOFIA_BYPASS

    return []


# ── Tool implementations ───────────────────────────────────────────────────────

def _tool_navigate_to(destination: str) -> dict:
    """Geocode destination via Mapbox Search Box v1."""
    try:
        suggest_url = "https://api.mapbox.com/search/searchbox/v1/suggest"
        params = {
            "q": destination,
            "access_token": _MAPBOX_TOKEN,
            "language": "bg,en",
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


def _tool_suggest_routes(
    destination: str, origin_lat: float, origin_lng: float, avoid: list = None
) -> dict:
    """Fetch 2-3 route alternatives via Mapbox Directions."""
    try:
        nav = _tool_navigate_to(destination)
        if "error" in nav:
            return {"error": nav["error"]}

        dest_lng, dest_lat = nav["coords"]

        # Build waypoints string if avoidance requires a corridor detour
        wps = _get_avoidance_waypoints(origin_lat, origin_lng, dest_lng, avoid)
        all_points = (
            [[origin_lng, origin_lat]] + wps + [[dest_lng, dest_lat]]
        )
        coords_str = ";".join(f"{p[0]},{p[1]}" for p in all_points)

        url = (
            f"https://api.mapbox.com/directions/v5/mapbox/driving-traffic"
            f"/{coords_str}"
        )
        params = {
            "access_token": _MAPBOX_TOKEN,
            "alternatives": "true",
            "geometries": "geojson",
            "overview": "simplified",
            "steps": "false",
        }
        # Road-type excludes (motorway / toll / ferry) — supported by Mapbox
        road_excludes = [
            a for a in (avoid or [])
            if a in ("motorway", "toll", "ferry", "unpaved")
        ]
        if road_excludes:
            params["exclude"] = ",".join(road_excludes)

        r = requests.get(url, params=params, timeout=15)
        r.raise_for_status()
        routes_data = r.json().get("routes", [])

        colors = ["#00bfff", "#00ff88", "#ffcc00"]
        labels = ["Основен маршрут", "Алтернатива 1", "Алтернатива 2"]
        options = []
        for i, rt in enumerate(routes_data[:3]):
            dist_km = round(rt["distance"] / 1000)
            dur_h = int(rt["duration"] / 3600)
            dur_m = int((rt["duration"] % 3600) / 60)
            dur_str = f"{dur_h}ч {dur_m}мин" if dur_h else f"{dur_m}мин"
            options.append({
                "label": f"{labels[i]} — {dist_km}км, {dur_str}",
                "color": colors[i],
                "duration": round(rt["duration"]),
                "distance": round(rt["distance"]),
                "geometry": rt["geometry"],
                "dest_coords": [dest_lng, dest_lat],
            })

        return {
            "destination": nav["destination"],
            "dest_coords": [dest_lng, dest_lat],
            "options": options,
        }
    except Exception as exc:
        return {"error": str(exc)}


def _tool_find_truck_parking(lat: float, lng: float, radius_m: int = 20000) -> list:
    """Find truck parking via Mapbox Search Box (primary) with Overpass fallback."""
    results: list = []
    search_r = max(radius_m, 20_000)

    try:
        suggest_url = "https://api.mapbox.com/search/searchbox/v1/suggest"
        for query in ("truck stop", "truck parking", "паркинг камион"):
            params = {
                "q":             query,
                "access_token":  _MAPBOX_TOKEN,
                "language":      "en,bg",
                "types":         "poi",
                "proximity":     f"{lng},{lat}",
                "limit":         4,
                "session_token": "truckai-park-session",
            }
            r = requests.get(suggest_url, params=params, timeout=8)
            r.raise_for_status()
            suggestions = r.json().get("suggestions", [])

            for s in suggestions[:4]:
                mapbox_id = s.get("mapbox_id")
                if not mapbox_id:
                    continue
                ret_url = f"https://api.mapbox.com/search/searchbox/v1/retrieve/{mapbox_id}"
                r2 = requests.get(
                    ret_url,
                    params={"access_token": _MAPBOX_TOKEN, "session_token": "truckai-park-session"},
                    timeout=6,
                )
                r2.raise_for_status()
                features = r2.json().get("features", [])
                if not features:
                    continue
                feat   = features[0]
                c      = feat["geometry"]["coordinates"]
                el_lng, el_lat = c[0], c[1]
                dist   = round(_haversine_m(lat, lng, el_lat, el_lng))
                props  = feat.get("properties", {})
                if dist > max(search_r * 10, 200_000):
                    continue
                results.append({
                    "name":          s.get("name") or props.get("name", "Truck Parking"),
                    "lat":           el_lat,
                    "lng":           el_lng,
                    "paid":          False,
                    "showers":       False,
                    "distance_m":    dist,
                    "opening_hours": props.get("open_hours"),
                    "phone":         props.get("phone"),
                })
    except Exception:
        pass

    if len(results) < 2:
        try:
            overpass_url = "https://overpass-api.de/api/interpreter"
            overpass_q = f"""
[out:json][timeout:15];
(
  node["amenity"="parking"]["hgv"="yes"](around:{search_r},{lat},{lng});
  node["amenity"="truck_stop"](around:{search_r},{lat},{lng});
  way["amenity"="parking"]["hgv"="yes"](around:{search_r},{lat},{lng});
  node["amenity"="parking"]["capacity:hgv"](around:{search_r},{lat},{lng});
  node["highway"="rest_area"](around:{search_r},{lat},{lng});
  way["highway"="rest_area"](around:{search_r},{lat},{lng});
  node["highway"="services"](around:{search_r},{lat},{lng});
);
out center 10;
"""
            r = requests.post(overpass_url, data={"data": overpass_q}, timeout=18)
            r.raise_for_status()
            for el in r.json().get("elements", [])[:10]:
                tags   = el.get("tags", {})
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
        except Exception:
            pass

    seen: set = set()
    deduped: list = []
    for item in results:
        key = (round(item["lat"], 3), round(item["lng"], 3))
        if key not in seen:
            seen.add(key)
            deduped.append(item)

    deduped.sort(key=lambda x: x["distance_m"])
    return deduped[:8]


def _tool_find_speed_cameras(lat: float, lng: float, radius_m: int = 10000) -> dict:
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
                "lat":        el_lat,
                "lng":        el_lng,
                "maxspeed":   tags.get("maxspeed"),
                "distance_m": dist,
            })
        cameras.sort(key=lambda x: x["distance_m"])
        nearest_m = cameras[0]["distance_m"] if cameras else -1
        return {"cameras": cameras, "nearest_m": nearest_m}
    except Exception as exc:
        return {"cameras": [], "nearest_m": -1, "error": str(exc)}


def _tool_calculate_hos_reach(driven_seconds: int, speed_kmh: float) -> dict:
    HOS_LIMIT = 16200
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
    """Search for any business/address/POI using Mapbox SearchBox v1.

    Uses SearchBox suggest (best POI discovery) + parallel retrieves so all
    coordinates are fetched in ~1-2 s total instead of N × timeout sequentially.
    """

    def _retrieve_coords(mapbox_id: str) -> tuple:
        """Fetch coordinates for one suggestion. Returns (lat, lng) or (None, None)."""
        try:
            ret_url = (
                f"https://api.mapbox.com/search/searchbox/v1/retrieve/{mapbox_id}"
            )
            r2 = requests.get(
                ret_url,
                params={"access_token": _MAPBOX_TOKEN, "session_token": "truckai-biz-session"},
                timeout=5,
            )
            r2.raise_for_status()
            feats = r2.json().get("features", [])
            if feats:
                c = feats[0]["geometry"]["coordinates"]
                return c[1], c[0]  # (lat, lng)
        except Exception:
            pass
        return None, None

    try:
        suggest_url = "https://api.mapbox.com/search/searchbox/v1/suggest"
        q = f"{query} {city}".strip()
        params: dict = {
            "q":             q,
            "access_token":  _MAPBOX_TOKEN,
            "language":      "bg,en",
            "types":         "poi,address",
            "limit":         5,
            "session_token": "truckai-biz-session",
        }
        if lat and lng:
            params["proximity"] = f"{lng},{lat}"
        r = requests.get(suggest_url, params=params, timeout=8)
        r.raise_for_status()
        suggestions = r.json().get("suggestions", [])[:5]
        if not suggestions:
            return []

        # ── Parallel retrieve — all coords in ~1-2 s total ────────────────
        ids = [s.get("mapbox_id") for s in suggestions]
        coords_by_idx: dict = {}
        with ThreadPoolExecutor(max_workers=5) as ex:
            fut_map = {ex.submit(_retrieve_coords, mid): i for i, mid in enumerate(ids) if mid}
            try:
                for fut in as_completed(fut_map, timeout=6):
                    coords_by_idx[fut_map[fut]] = fut.result()
            except Exception:
                pass  # Use whatever coords arrived before timeout

        results = []
        for i, s in enumerate(suggestions):
            biz_lat, biz_lng = coords_by_idx.get(i, (None, None))
            if biz_lat is None:
                continue
            dist = round(_haversine_m(lat, lng, biz_lat, biz_lng)) if lat else 0
            results.append({
                "name":       s.get("name", ""),
                "address":    s.get("full_address") or s.get("place_formatted", ""),
                "category":   s.get("poi_category", []),
                "lat":        biz_lat,
                "lng":        biz_lng,
                "distance_m": dist,
            })
        return results
    except Exception as exc:
        return [{"error": str(exc)}]


def _tool_check_traffic(
    origin_lng: float, origin_lat: float, dest_lng: float, dest_lat: float
) -> dict:
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

        primary  = routes[0]
        duration = primary.get("duration", 0)
        typical  = primary.get("duration_typical", duration)
        delay    = max(0, duration - typical)

        result: dict = {
            "has_delay":    delay > 1200,
            "delay_min":    round(delay / 60),
            "duration_min": round(duration / 60),
            "alternative_available": len(routes) > 1 and delay > 1200,
        }
        if result["alternative_available"]:
            result["alternative_duration_min"] = round(routes[1]["duration"] / 60)
        return result
    except Exception as exc:
        return {"error": str(exc)}


def _tool_find_fuel(dest_lat: float, dest_lng: float, radius_m: int = 50000) -> list:
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
            tags   = el.get("tags", {})
            el_lat = el.get("lat", dest_lat)
            el_lng = el.get("lon", dest_lng)
            results.append({
                "name":          tags.get("name", "Бензиностанция"),
                "brand":         tags.get("brand"),
                "lat":           el_lat,
                "lng":           el_lng,
                "distance_m":    round(_haversine_m(dest_lat, dest_lng, el_lat, el_lng)),
                "truck_lane":    tags.get("hgv") == "yes",
                "opening_hours": tags.get("opening_hours"),
                "phone":         tags.get("phone"),
            })
        results.sort(key=lambda x: x["distance_m"])
        return results[:10]
    except Exception as exc:
        return [{"error": str(exc)}]


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.post("/api/transcribe")
def transcribe():
    audio = request.files.get("audio")
    if not audio:
        return jsonify({"ok": False, "error": "audio file required"}), 400
    if not _gpt4o_ready:
        return jsonify({"ok": False, "error": "OPENAI_API_KEY not set"}), 503
    try:
        result = client.audio.transcriptions.create(
            model="whisper-1",
            file=(audio.filename or "audio.m4a", audio.stream, audio.content_type or "audio/m4a"),
            language="bg",
        )
        return jsonify({"ok": True, "text": result.text})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.get("/api/health")
def health():
    return jsonify({
        "status":      "ok",
        "gpt4o_ready": _gpt4o_ready,
        "db":          DB_PATH,
        "timestamp":   now_iso(),
    })


# ── GPT-4o chat — JSON-only map brain ─────────────────────────────────────────

@app.post("/api/chat")
def chat():
    """
    Body: {
      "message": "...",
      "history": [{"role":"user"|"model","text":"..."}],
      "context": {"lat":..., "lng":..., "driven_seconds":..., "speed_kmh":...}
    }
    Response: { "ok": true, "action": <MapAction>, "reply": "<text>" }

    action is ALWAYS a JSON map command:
      {"action":"route", "destination":"...", "coords":[lng,lat], "message":"..."}
      {"action":"show_pois", "category":"truck_stop"|"fuel"|"speed_camera", "cards":[...], "message":"..."}
      {"action":"show_routes", "destination":"...", "options":[...], "message":"..."}
      {"action":"message", "text":"..."}
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

    system_txt = _SYSTEM_PROMPT
    if context:
        driven_h = context.get("driven_seconds", 0) / 3600
        system_txt += (
            f"\n\nDriver GPS: lat={context.get('lat', '?')}, "
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

    # Force parking tool on first turn for parking keywords
    _PARKING_KW = ("паркинг", "паркиране", "паркирам", "стоянка", "truck stop", "parking")
    _force_parking = any(kw in user_msg.lower() for kw in _PARKING_KW)

    action = None
    last_msg = None

    try:
        for turn in range(4):
            resp = client.chat.completions.create(
                model="gpt-4o",
                messages=messages,
                tools=_TOOLS,
                tool_choice=(
                    {"type": "function", "function": {"name": "find_truck_parking"}}
                    if (_force_parking and turn == 0)
                    else "auto"
                ),
                parallel_tool_calls=False,  # one tool at a time → no skipped calls
                temperature=0.4,
            )
            last_msg = resp.choices[0].message

            if not last_msg.tool_calls:
                break

            call = last_msg.tool_calls[0]
            fn   = call.function.name
            args = json.loads(call.function.arguments)

            # Inject driver GPS when model omits lat/lng
            if "lat" not in args and context.get("lat") is not None:
                args["lat"] = context["lat"]
                args["lng"] = context["lng"]
            if "driven_seconds" not in args:
                args["driven_seconds"] = context.get("driven_seconds", 0)
            if "speed_kmh" not in args:
                args["speed_kmh"] = context.get("speed_kmh", 80)

            # ── Dispatch to tool + build MapAction ────────────────────────────
            if fn == "navigate_to":
                result = _tool_navigate_to(args["destination"])
                if "coords" in result:
                    dest_lng, dest_lat = result["coords"]
                    action = {
                        "action":      "route",
                        "destination": result["destination"],
                        "coords":      result["coords"],
                        "waypoints":   _get_avoidance_waypoints(
                            context.get("lat"), context.get("lng"),
                            dest_lng, args.get("avoid"),
                        ),
                    }

            elif fn == "suggest_routes":
                # Inject driver origin if missing
                if "origin_lat" not in args and context.get("lat"):
                    args["origin_lat"] = context["lat"]
                    args["origin_lng"] = context["lng"]
                result = _tool_suggest_routes(
                    args["destination"],
                    args.get("origin_lat", 42.70),
                    args.get("origin_lng", 23.32),
                    args.get("avoid"),
                )
                if "options" in result:
                    dest_lng_r = result["dest_coords"][0]
                    forced_wps = _get_avoidance_waypoints(
                        args.get("origin_lat"), args.get("origin_lng"),
                        dest_lng_r, args.get("avoid"),
                    )
                    action = {
                        "action":      "show_routes",
                        "destination": result["destination"],
                        "dest_coords": result["dest_coords"],
                        "options":     result["options"],
                        "waypoints":   forced_wps,
                    }

            elif fn == "find_truck_parking":
                raw = _tool_find_truck_parking(
                    args["lat"], args["lng"], args.get("radius_m", 5000)
                )
                result = raw
                cards = []
                for p in raw[:4]:
                    info_parts = []
                    if not p.get("paid"):
                        info_parts.append("Безплатен")
                    elif p.get("paid"):
                        info_parts.append("Платен")
                    if p.get("showers"):
                        info_parts.append("с душ")
                    if p.get("opening_hours"):
                        info_parts.append(p["opening_hours"])
                    cards.append({
                        "name":          p["name"],
                        "lat":           p["lat"],
                        "lng":           p["lng"],
                        "distance_m":    p["distance_m"],
                        "paid":          p.get("paid", False),
                        "showers":       p.get("showers", False),
                        "info":          ", ".join(info_parts) if info_parts else None,
                        "opening_hours": p.get("opening_hours"),
                        "phone":         p.get("phone"),
                    })
                action = {
                    "action":   "show_pois",
                    "category": "truck_stop",
                    "cards":    cards,
                }

            elif fn == "find_speed_cameras":
                result = _tool_find_speed_cameras(
                    args["lat"], args["lng"], args.get("radius_m", 10000)
                )
                cards = []
                for cam in result.get("cameras", [])[:8]:
                    speed_label = f"{cam['maxspeed']} км/ч" if cam.get("maxspeed") else "неизвестна скорост"
                    cards.append({
                        "name":       f"📷 Камера {speed_label}",
                        "lat":        cam["lat"],
                        "lng":        cam["lng"],
                        "distance_m": cam["distance_m"],
                        "maxspeed":   cam.get("maxspeed"),
                    })
                action = {
                    "action":    "show_pois",
                    "category":  "speed_camera",
                    "cards":     cards,
                    "nearest_m": result.get("nearest_m", -1),
                }

            elif fn == "calculate_hos_reach":
                result = _tool_calculate_hos_reach(
                    args["driven_seconds"], args["speed_kmh"]
                )
                driven_h = args["driven_seconds"] / 3600
                rem_h = result["remaining_h"] + result["remaining_min"] / 60
                suggested_stop = None
                # Search for nearby parking if < 30 min remaining or break already needed
                if rem_h < 0.5 or result["break_needed"]:
                    p_lat = context.get("lat")
                    p_lng = context.get("lng")
                    if p_lat and p_lng:
                        parkings = _tool_find_truck_parking(p_lat, p_lng, 30_000)
                        if parkings:
                            p = parkings[0]
                            suggested_stop = {
                                "lat": p["lat"],
                                "lng": p["lng"],
                                "name": p["name"],
                            }
                action = {
                    "action":       "tachograph",
                    "driven_hours":   round(driven_h, 1),
                    "remaining_hours": round(rem_h, 2),
                    "break_needed":  result["break_needed"],
                    "suggested_stop": suggested_stop,
                }

            elif fn == "search_business":
                result = _tool_search_business(
                    args["query"], args.get("city", ""), args["lat"], args["lng"]
                )
                cards = []
                for b in result[:6]:
                    if b.get("error") or not b.get("lat"):
                        continue
                    cards.append({
                        "name":       b.get("name", ""),
                        "lat":        b["lat"],
                        "lng":        b["lng"],
                        "distance_m": b.get("distance_m", 0),
                        "info":       b.get("address", ""),
                    })
                action = {"action": "show_pois", "category": "business", "cards": cards}

            elif fn == "check_traffic_route":
                result = _tool_check_traffic(
                    args["origin_lng"], args["origin_lat"],
                    args["dest_lng"],   args["dest_lat"],
                )

            elif fn == "find_fuel_stations":
                raw = _tool_find_fuel(
                    args["dest_lat"], args["dest_lng"], args.get("radius_m", 50000)
                )
                result = raw
                cards = []
                for s in raw[:4]:
                    cards.append({
                        "name":          s.get("name", "Бензиностанция"),
                        "lat":           s["lat"],
                        "lng":           s["lng"],
                        "distance_m":    s.get("distance_m", 0),
                        "brand":         s.get("brand"),
                        "truck_lane":    s.get("truck_lane", False),
                        "opening_hours": s.get("opening_hours"),
                        "phone":         s.get("phone"),
                    })
                action = {
                    "action":   "show_pois",
                    "category": "fuel",
                    "cards":    cards,
                }

            else:
                result = {"error": "unknown tool"}

            messages.append(last_msg)
            messages.append({
                "role":         "tool",
                "tool_call_id": call.id,
                "content":      json.dumps(result, ensure_ascii=False),
            })
            # Respond to any extra parallel tool calls so the next request is valid.
            # GPT-4o may return multiple tool_calls in one turn; OpenAI requires
            # every tool_call_id to have a matching tool message.
            for extra in last_msg.tool_calls[1:]:
                messages.append({
                    "role":         "tool",
                    "tool_call_id": extra.id,
                    "content":      json.dumps({"skipped": True}, ensure_ascii=False),
                })

    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500

    reply = (last_msg.content or "") if last_msg else ""

    # For non-message actions, generate clean Bulgarian display text instead of
    # forwarding GPT-4o's raw JSON reply (which may contain {"action":"route",...}).
    if action is not None:
        act_type = action.get("action")
        if act_type == "route":
            display_text = f"Прокладвам маршрут до {action.get('destination', '')}."
        elif act_type == "show_pois":
            cat   = action.get("category", "")
            count = len(action.get("cards", []))
            if cat == "truck_stop":
                display_text = f"Намерих {count} паркинга за камиони."
            elif cat == "fuel":
                display_text = f"Намерих {count} горивни станции."
            elif cat == "speed_camera":
                display_text = f"Намерих {count} камери в района."
            elif cat == "business":
                display_text = f"Намерих {count} места. Натисни за маршрут."
            else:
                display_text = f"Намерих {count} резултата."
        elif act_type == "show_routes":
            count = len(action.get("options", []))
            display_text = f"Намерих {count} варианта за маршрут до {action.get('destination', '')}."
        elif act_type == "tachograph":
            driven = action.get("driven_hours", 0)
            rem    = action.get("remaining_hours", 0)
            if action.get("break_needed"):
                display_text = f"🛑 Достигнат лимит ({driven:.1f}ч)! Задължителна 45 мин почивка!"
            elif rem < 0.5:
                display_text = f"⚠️ {int(rem * 60)} мин до почивка. Шофирал {driven:.1f}ч — спри скоро!"
            else:
                display_text = f"✅ Шофирал {driven:.1f}ч. Остават {rem:.1f}ч до задължителна почивка."
            if action.get("suggested_stop"):
                display_text += f" Предлагам: {action['suggested_stop']['name']}"
        else:
            display_text = reply
    else:
        # Pure text reply — parse JSON wrapper if GPT returned one
        display_text = reply
        reply_stripped = reply.strip()
        if reply_stripped.startswith("{"):
            try:
                parsed = json.loads(reply_stripped)
                display_text = (
                    parsed.get("text")
                    or parsed.get("message")
                    or reply
                )
            except json.JSONDecodeError:
                pass

    # Final safety: never expose raw JSON in chat bubble
    _dt = (display_text or "").strip()
    if _dt.startswith("{"):
        try:
            _parsed = json.loads(_dt)
            display_text = _parsed.get("text") or _parsed.get("message") or ""
        except Exception:
            display_text = ""

    _db_save_chat(user_msg, display_text)

    if action is None:
        final_action = {"action": "message", "text": display_text or "Не мога да обработя тази заявка."}
    else:
        final_action = {**action, "message": display_text}

    return jsonify({"ok": True, "action": final_action, "reply": display_text})


# ── POI endpoints ──────────────────────────────────────────────────────────────

@app.get("/api/pois")
def list_pois():
    category = request.args.get("category")
    with get_db() as conn:
        if category:
            rows = conn.execute(
                "SELECT * FROM pois WHERE category = ? ORDER BY created_at DESC", (category,)
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM pois ORDER BY created_at DESC").fetchall()
    return jsonify({"ok": True, "pois": [row_to_poi(r) for r in rows]})


@app.post("/api/pois")
def save_poi():
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    lat  = body.get("lat")
    lng  = body.get("lng")
    if not name or lat is None or lng is None:
        return jsonify({"ok": False, "error": "name, lat, lng are required"}), 400
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO pois (name, address, category, lat, lng, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (name, body.get("address", ""), body.get("category", "custom"),
             float(lat), float(lng), body.get("notes", ""), now_iso()),
        )
        conn.commit()
        poi_id = cur.lastrowid
    row = get_db().execute("SELECT * FROM pois WHERE id = ?", (poi_id,)).fetchone()
    return jsonify({"ok": True, "poi": row_to_poi(row)}), 201


@app.delete("/api/pois/<int:poi_id>")
def delete_poi(poi_id: int):
    with get_db() as conn:
        deleted = conn.execute("DELETE FROM pois WHERE id = ?", (poi_id,)).rowcount
        conn.commit()
    if deleted == 0:
        return jsonify({"ok": False, "error": "POI not found"}), 404
    return jsonify({"ok": True})


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port  = int(os.getenv("FLASK_PORT", 5050))
    debug = os.getenv("FLASK_DEBUG", "true").lower() == "true"
    print(f"TruckAI Pro backend @ http://0.0.0.0:{port}")
    print(f"GPT-4o ready: {_gpt4o_ready}")
    app.run(host="0.0.0.0", port=port, debug=debug)
