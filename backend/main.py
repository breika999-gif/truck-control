"""
TruckAI Pro — FastAPI backend (full port from app.py)
Run: uvicorn main:app --host 0.0.0.0 --port 5050 --reload
"""
import json
import math
import os
import re
import sqlite3
import time as _cache_time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import requests
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from pydantic import BaseModel

load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"), override=True)

# ── API Keys ──────────────────────────────────────────────────────────────────
OPENAI_KEY         = os.getenv("OPENAI_API_KEY")
GEMINI_KEY         = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL       = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
_TOMTOM_KEY        = os.getenv("TOMTOM_API_KEY")
_GOOGLE_PLACES_KEY = os.getenv("GOOGLE_PLACES_KEY")

_gpt4o_ready  = bool(OPENAI_KEY)
_gemini_ready = bool(GEMINI_KEY)
_tomtom_ready = bool(_TOMTOM_KEY)
_places_ready = bool(_GOOGLE_PLACES_KEY)

openai_client = OpenAI(api_key=OPENAI_KEY) if _gpt4o_ready else None

try:
    from google import genai as _google_genai
    _gemini_client = _google_genai.Client(api_key=GEMINI_KEY or "") if GEMINI_KEY else None
except ImportError:
    _google_genai  = None
    _gemini_client = None
    _gemini_ready  = False

_MAPBOX_TOKEN = (
    "pk.eyJ1IjoiYnJlaWthOTk5IiwiYSI6ImNtbHBob2xjMzE5Z3MzZ3F4Y3QybGpod3AifQ"
    ".hprmbhb8EVFSfF7cqc4lkw"
)

# ── Avoidance waypoints [lng, lat] ────────────────────────────────────────────
_BUCHAREST_WP = [26.1025, 44.4268]
_CLUJ_WP      = [23.5890, 46.7690]
_BUDAPEST_WP  = [19.0402, 47.4979]
_BELGRADE_WP  = [20.4568, 44.8176]
_ZAGREB_WP    = [15.9799, 45.8150]
_SOFIA_BYPASS = [[23.2600, 42.7400], [23.4300, 42.7100]]

# ── GPT-4o system prompt ──────────────────────────────────────────────────────
_SYSTEM_PROMPT = (
    "Ти си TruckAI — експертен GPS асистент за камиони в България.\n"
    "ГОВОРИШ С КАМИОНЕН ШОФЬОР. Бъди КРАТЪК (1-2 изречения). Адресирай го като 'Колега'.\n"
    "Ти си приятел и помощник на шофьора, но същевременно си високотехнологичен навигационен мозък.\n\n"
    "CRITICAL RULES:\n"
    "1. ALWAYS respond with ONLY a single valid JSON object or a conversational Bulgarian reply.\n"
    "2. ALWAYS use Bulgarian in all message fields.\n"
    "3. ALWAYS address the driver as 'Колега'. Be polite but concise.\n"
    "4. APP CONTROL: When the driver wants to open an app, use the launch_app tool immediately.\n"
    "5. ROUTING: For routes BG -> W. Europe, always avoid Serbia; go via Romania (Bucharest -> Cluj -> Budapest).\n"
    "6. TRUCK SAFETY: Always use truck dimensions for routing.\n"
    "7. DYNAMIC AVOIDANCE: Support 'avoid' for Serbia, Romania, Tolls, Sofia Center, etc.\n"
    "8. SEARCH: Use search_business for ANY company, warehouse, factory, repair shop, or address.\n"
    "9. TACHOGRAPH: Help with HOS limits (4.5h rule, 9h rule). Suggest stops 30 min before the limit.\n\n"
    "Available tools are for map actions. If the user is just chatting, use action:'message' with a Bulgarian reply.\n"
)

# ── Gemini system prompt ──────────────────────────────────────────────────────
_GEMINI_SYSTEM = (
    "Ти си Gemini — AI асистент на TruckAI Pro за КАМИОНИ.\n"
    "Говориш с КАМИОНЕН ШОФЬОР по време на шофиране.\n\n"
    "ПРАВИЛА:\n"
    "1. Говори САМО на БЪЛГАРСКИ. Бъди КРАТЪК (1-2 изречения). Адресирай шофьора като 'Колега'.\n"
    "2. Помагаш с: общи въпроси, метео, музика (YouTube/Spotify), почивки, товари, регулации, отваряне на приложения.\n"
    "3. За навигация потребителят има отделен GPT-4o навигационен асистент.\n"
    "4. ТАХОГРАФ (EU 561/2006) — в контекста получаваш:\n"
    "   [ТАХОГРАФ: непрекъснато Xч/4.5ч; днес Xч/9ч; седмично Xч/56ч; двуседмично Xч/90ч]\n"
    "   ПРАВИЛА:\n"
    "   - MAX 4.5ч непрекъснато → задължителна 45-мин почивка (или 15+30)\n"
    "   - MAX 9ч дневно (10ч два пъти седмично)\n"
    "   - MAX 56ч седмично; MAX 90ч общо за 2 седмици\n"
    "   - Ако остават < 30 мин до някой лимит → предупреди проактивно\n"
    "5. КАМИОННА СПЕЦИФИКА — когато е релевантно споменавай ограничения за тегло/височина/ширина,\n"
    "   места за паркинг за тежкотоварни, времеви ограничения, зареждане с AdBlue + дизел.\n"
    "6. Предупреждавай проактивно: 'Колега, след 4ч ти трябва 45-мин почивка.'\n\n"
    "📱 ПРИЛОЖЕНИЯ — добавяй в КРАЯ при нужда:\n"
    "[APP:{\"app\":\"<app_name>\",\"query\":\"<опционална заявка>\"}]\n"
    "app_name: youtube, spotify, whatsapp, telegram, viber, maps, "
    "settings, phone, camera, calculator, chrome, facebook, instagram\n"
)

_NAV_RE = re.compile(r'\[NAV:\s*(\{.*?\})\s*\]', re.DOTALL)
_APP_RE = re.compile(r'\[APP:\s*(\{.*?\})\s*\]', re.DOTALL)

# ── GPT-4o tool definitions ───────────────────────────────────────────────────
_TOOLS = [
    {"type": "function", "function": {
        "name": "navigate_to",
        "description": "Start turn-by-turn navigation to a destination.",
        "parameters": {"type": "object", "properties": {
            "destination": {"type": "string"},
            "avoid": {"type": "array", "items": {"type": "string"},
                      "description": "Regions to avoid: 'serbia','romania','greece','turkey','sofia_center','motorway','toll','ferry'"},
            "truck_profile": {"type": "object", "properties": {
                "height_m": {"type": "number"}, "weight_t": {"type": "number"},
                "width_m": {"type": "number"}, "length_m": {"type": "number"},
                "axle_count": {"type": "integer"}, "hazmat_class": {"type": "string"}}}
        }, "required": ["destination"]}}},
    {"type": "function", "function": {
        "name": "suggest_routes",
        "description": "Show 2-3 route alternatives.",
        "parameters": {"type": "object", "properties": {
            "destination": {"type": "string"},
            "origin_lat": {"type": "number"}, "origin_lng": {"type": "number"},
            "avoid": {"type": "array", "items": {"type": "string"}},
            "truck_profile": {"type": "object", "properties": {
                "height_m": {"type": "number"}, "weight_t": {"type": "number"},
                "width_m": {"type": "number"}, "length_m": {"type": "number"},
                "axle_count": {"type": "integer"}, "hazmat_class": {"type": "string"}}}
        }, "required": ["destination", "origin_lat", "origin_lng"]}}},
    {"type": "function", "function": {
        "name": "find_truck_parking",
        "description": "Find truck stops and HGV parking near a location.",
        "parameters": {"type": "object", "properties": {
            "lat": {"type": "number"}, "lng": {"type": "number"},
            "radius_m": {"type": "integer", "default": 5000}
        }, "required": ["lat", "lng"]}}},
    {"type": "function", "function": {
        "name": "find_speed_cameras",
        "description": "Find speed cameras near a position.",
        "parameters": {"type": "object", "properties": {
            "lat": {"type": "number"}, "lng": {"type": "number"},
            "radius_m": {"type": "integer", "default": 10000}
        }, "required": ["lat", "lng"]}}},
    {"type": "function", "function": {
        "name": "calculate_hos_reach",
        "description": "Calculate remaining drive time before mandatory 45-min break.",
        "parameters": {"type": "object", "properties": {
            "driven_seconds": {"type": "integer"}, "speed_kmh": {"type": "number"}
        }, "required": ["driven_seconds", "speed_kmh"]}}},
    {"type": "function", "function": {
        "name": "search_business",
        "description": "Search for a business (warehouse, repair shop, customs, etc.).",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string"}, "city": {"type": "string"},
            "lat": {"type": "number"}, "lng": {"type": "number"}
        }, "required": ["query", "lat", "lng"]}}},
    {"type": "function", "function": {
        "name": "check_traffic_route",
        "description": "Check current traffic on route.",
        "parameters": {"type": "object", "properties": {
            "origin_lng": {"type": "number"}, "origin_lat": {"type": "number"},
            "dest_lng": {"type": "number"}, "dest_lat": {"type": "number"}
        }, "required": ["origin_lng", "origin_lat", "dest_lng", "dest_lat"]}}},
    {"type": "function", "function": {
        "name": "add_waypoint",
        "description": "Add an intermediate stop/waypoint to the current active route.",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string"}, "lat": {"type": "number"}, "lng": {"type": "number"}
        }, "required": ["query", "lat", "lng"]}}},
    {"type": "function", "function": {
        "name": "find_fuel_stations",
        "description": "Find fuel/diesel stations near a destination city.",
        "parameters": {"type": "object", "properties": {
            "dest_lat": {"type": "number"}, "dest_lng": {"type": "number"},
            "radius_m": {"type": "integer", "default": 50000}
        }, "required": ["dest_lat", "dest_lng"]}}},
    {"type": "function", "function": {
        "name": "calculate_travel_matrix",
        "description": "Calculate travel times and distances between multiple points.",
        "parameters": {"type": "object", "properties": {
            "points": {"type": "array", "items": {"type": "object", "properties": {
                "lat": {"type": "number"}, "lng": {"type": "number"}, "label": {"type": "string"}
            }, "required": ["lat", "lng", "label"]}},
            "profile": {"type": "string", "enum": ["driving-traffic", "driving"], "default": "driving-traffic"}
        }, "required": ["points"]}}},
    {"type": "function", "function": {
        "name": "launch_app",
        "description": "Open a mobile app like YouTube, Spotify, Google, etc.",
        "parameters": {"type": "object", "properties": {
            "app_name": {"type": "string",
                         "enum": ["youtube", "spotify", "google", "whatsapp", "viber", "facebook", "chrome", "settings"]},
            "query": {"type": "string"}
        }, "required": ["app_name"]}}},
]

# ── Database ──────────────────────────────────────────────────────────────────
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "truckai.db")


def _db_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def get_db():
    conn = _db_conn()
    try:
        yield conn
    finally:
        conn.close()


def init_db() -> None:
    with _db_conn() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS pois (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
            address TEXT, category TEXT NOT NULL DEFAULT 'custom',
            lat REAL NOT NULL, lng REAL NOT NULL, notes TEXT, created_at TEXT NOT NULL)""")
        conn.execute("""CREATE TABLE IF NOT EXISTS chat_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL,
            message TEXT NOT NULL, created_at TEXT NOT NULL)""")
        conn.execute("""CREATE TABLE IF NOT EXISTS tacho_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT NOT NULL DEFAULT '',
            date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT,
            driven_seconds INTEGER NOT NULL DEFAULT 0)""")
        conn.execute("""CREATE TABLE IF NOT EXISTS user_settings (
            user_email TEXT PRIMARY KEY, gemini_api_key TEXT, updated_at TEXT NOT NULL)""")
        conn.commit()
    for migration in [
        "ALTER TABLE pois ADD COLUMN user_email TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE tacho_sessions ADD COLUMN type TEXT NOT NULL DEFAULT 'driving'",
    ]:
        try:
            with _db_conn() as c:
                c.execute(migration)
                c.commit()
        except Exception:
            pass


# ── FastAPI app ───────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="TruckAI Pro (FastAPI)", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── Helpers ───────────────────────────────────────────────────────────────────

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _strip_md_fence(s: str) -> str:
    s = s.strip()
    s = re.sub(r'^```[a-zA-Z]*\s*', '', s)
    s = re.sub(r'\s*```$', '', s)
    return s.strip()


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6_371_000
    to_rad = math.radians
    d_lat = to_rad(lat2 - lat1)
    d_lng = to_rad(lng2 - lng1)
    a = math.sin(d_lat / 2) ** 2 + (
        math.cos(to_rad(lat1)) * math.cos(to_rad(lat2)) * math.sin(d_lng / 2) ** 2
    )
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def row_to_poi(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"], "name": row["name"], "address": row["address"],
        "category": row["category"], "lat": row["lat"], "lng": row["lng"],
        "notes": row["notes"],
        "user_email": row["user_email"] if "user_email" in row.keys() else "",
        "created_at": row["created_at"],
    }


def _db_save_chat(user_msg: str, reply: str) -> None:
    with _db_conn() as conn:
        conn.execute("INSERT INTO chat_history (role, message, created_at) VALUES (?, ?, ?)",
                     ("user", user_msg, now_iso()))
        conn.execute("INSERT INTO chat_history (role, message, created_at) VALUES (?, ?, ?)",
                     ("model", reply, now_iso()))
        conn.commit()


def _extract_nav_intent(text: str):
    m = _NAV_RE.search(text)
    if m:
        try:
            data = json.loads(m.group(1))
            clean = (text[:m.start()] + text[m.end():]).strip()
            return data.get("command"), clean
        except Exception:
            pass
    return None, text


def _extract_app_intent(text: str):
    m = _APP_RE.search(text)
    if m:
        try:
            data = json.loads(m.group(1))
            clean = (text[:m.start()] + text[m.end():]).strip()
            return data, clean
        except Exception:
            pass
    return None, text


# ── TomTom helpers ────────────────────────────────────────────────────────────

def _adr_to_tunnel_code(hazmat_class: str) -> str | None:
    mapping = {"1": "B", "2": "C", "3": "D", "4": "D", "5": "D",
               "6": "D", "7": "B", "8": "E", "9": "E"}
    return mapping.get(str(hazmat_class))


def _tomtom_route_to_geojson(route: dict) -> dict:
    coords = []
    for leg in route.get("legs", []):
        for pt in leg.get("points", []):
            coords.append([pt["longitude"], pt["latitude"]])
    return {"type": "LineString", "coordinates": coords}


def _tomtom_speed_limits(route: dict) -> list:
    total_pts = sum(len(leg.get("points", [])) for leg in route.get("legs", []))
    if total_pts == 0:
        return []
    speeds: list = [None] * total_pts
    for sec in route.get("sections", []):
        if sec.get("sectionType") != "SPEED_LIMIT":
            continue
        sl = sec.get("speedLimit", {})
        value = sl.get("value")
        unit = sl.get("unit", "KMPH")
        if value is None:
            continue
        speed_kmh = round(value * 1.609) if unit in ("MPH", "mph") else int(value)
        start = sec.get("startPointIndex", 0)
        end = sec.get("endPointIndex", total_pts - 1)
        for i in range(start, min(end + 1, total_pts)):
            speeds[i] = speed_kmh
    return [{"speed": s, "unit": "km/h"} if s is not None else {"unknown": True} for s in speeds]


_TT_MANEUVER_DIR = {
    "TURN_LEFT": "left", "TURN_RIGHT": "right", "KEEP_LEFT": "slight left",
    "KEEP_RIGHT": "slight right", "SHARP_LEFT": "sharp left", "SHARP_RIGHT": "sharp right",
    "STRAIGHT": "straight", "ROUNDABOUT_CROSS": "straight", "U_TURN": "uturn",
    "ARRIVE": "straight", "DEPART": "straight",
}


def _tomtom_lane_banner(instr: dict) -> dict | None:
    lg = instr.get("laneGuidance")
    msg = instr.get("message", "")
    signposts = re.findall(r"<signpostText>(.*?)</signpostText>", msg)
    road_nums = re.findall(r"<roadNumber>(.*?)</roadNumber>", msg)
    exit_nums = re.findall(r"<exitNumber>(.*?)</exitNumber>", msg)
    primary_text = " / ".join(signposts) if signposts else re.sub(r"<.*?>", "", msg)
    components = []
    if exit_nums:
        components.append({"type": "exit-number", "text": exit_nums[0]})
    for rn in road_nums:
        components.append({"type": "text", "text": rn})
    for sp in signposts:
        components.append({"type": "text", "text": sp})
    if not lg:
        return {
            "distanceAlongGeometry": instr.get("routeOffsetInMeters", 0),
            "primary": {"text": primary_text,
                        "type": instr.get("maneuver", "straight").lower().replace("_", " "),
                        "components": components if components else [{"type": "text", "text": primary_text}]},
            "sub": None,
        }
    lanes = lg.get("lanes", [])
    maneuver = instr.get("maneuver", "STRAIGHT")
    active_dir = _TT_MANEUVER_DIR.get(maneuver, "straight")
    lane_components = [
        {"type": "lane", "text": "", "active": bool(lane.get("drivable", False)),
         "directions": [active_dir] if lane.get("drivable") else ["none"]}
        for lane in lanes
    ]
    return {
        "distanceAlongGeometry": instr.get("routeOffsetInMeters", 0),
        "primary": {"text": primary_text, "type": maneuver.lower().replace("_", " "),
                    "components": components if components else [{"type": "text", "text": primary_text}]},
        "sub": {"components": lane_components},
    }


def _tomtom_congestion_geojson(route: dict, geometry: dict) -> dict:
    coords = geometry.get("coordinates", [])
    sections = [s for s in route.get("sections", []) if s.get("sectionType") == "TRAFFIC"]
    if not sections or len(coords) < 2:
        return {"type": "FeatureCollection", "features": [
            {"type": "Feature", "properties": {"congestion": "unknown"}, "geometry": geometry}]}
    _level = {"JAM": "heavy", "ROAD_WORK": "moderate", "ROAD_CLOSURE": "severe"}
    features = []
    for sec in sections:
        start = sec.get("startPointIndex", 0)
        end = min(sec.get("endPointIndex", start + 1) + 1, len(coords))
        level = _level.get(sec.get("simpleCategory", ""), "low")
        seg = coords[start:end]
        if len(seg) >= 2:
            features.append({"type": "Feature", "properties": {"congestion": level},
                              "geometry": {"type": "LineString", "coordinates": seg}})
    if not features:
        features = [{"type": "Feature", "properties": {"congestion": "low"}, "geometry": geometry}]
    return {"type": "FeatureCollection", "features": features}


def _tomtom_traffic_alerts(route: dict, geometry: dict) -> list:
    coords = geometry.get("coordinates", [])
    alerts = []
    for sec in route.get("sections", []):
        if sec.get("sectionType") != "TRAFFIC":
            continue
        category = sec.get("simpleCategory", "")
        if category not in ("JAM", "ROAD_WORK", "ROAD_CLOSURE"):
            continue
        travel = sec.get("travelTimeInSeconds", 0)
        no_traffic = sec.get("noTrafficTravelTimeInSeconds", travel)
        delay_min = max(0, round((travel - no_traffic) / 60))
        if delay_min < 2 and category != "ROAD_CLOSURE":
            continue
        mid = (sec.get("startPointIndex", 0) + sec.get("endPointIndex", 0)) // 2
        if mid >= len(coords):
            continue
        c = coords[mid]
        sev = "severe" if category == "ROAD_CLOSURE" else "heavy" if delay_min >= 20 else "moderate"
        if category == "ROAD_CLOSURE":
            label = "🚫 Затворен път"
        elif category == "ROAD_WORK":
            label = f"🚧 Ремонт{f' +{delay_min} мин' if delay_min > 0 else ''}"
        elif delay_min >= 60:
            label = f"🛑 +{delay_min // 60}ч {delay_min % 60}мин"
        else:
            label = f"🛑 +{delay_min} мин"
        alerts.append({"lat": round(c[1], 5), "lng": round(c[0], 5),
                        "delay_min": delay_min, "severity": sev, "label": label})
    return alerts[:8]


def _tomtom_search(query: str, lat: float, lng: float, limit: int = 6) -> list:
    if not _tomtom_ready:
        return []
    try:
        url = f"https://api.tomtom.com/search/2/search/{requests.utils.quote(query)}.json"
        params: dict = {"key": _TOMTOM_KEY, "language": "bg-BG", "limit": limit, "typeahead": "true"}
        if lat and lng:
            params.update({"lat": lat, "lon": lng, "radius": 50000})
        r = requests.get(url, params=params, timeout=8)
        r.raise_for_status()
        results = []
        for item in r.json().get("results", []):
            pos = item.get("position", {})
            item_lat, item_lng = pos.get("lat"), pos.get("lon")
            if item_lat is None:
                continue
            name = (item.get("poi") or {}).get("name") or item.get("address", {}).get("freeformAddress", "")
            address = item.get("address", {}).get("freeformAddress", "")
            dist = round(_haversine_m(lat, lng, item_lat, item_lng)) if lat else 0
            results.append({"name": name, "address": address, "lat": item_lat, "lng": item_lng, "distance_m": dist})
        return results
    except Exception:
        return []


def _get_avoidance_waypoints(origin_lat, origin_lng, dest_lng: float, avoid: list = None) -> list:
    avoid_set = {a.lower() for a in (avoid or [])}
    if origin_lat is None or origin_lng is None:
        return []
    in_bulgaria = (41.0 <= origin_lat <= 44.5) and (22.0 <= origin_lng <= 29.0)
    going_west = dest_lng is not None and dest_lng < 17.0
    if "serbia" in avoid_set or (in_bulgaria and going_west and "romania" not in avoid_set):
        return [_BUCHAREST_WP, _CLUJ_WP, _BUDAPEST_WP]
    if "romania" in avoid_set and in_bulgaria and going_west:
        return [_BELGRADE_WP, _ZAGREB_WP]
    if "sofia_center" in avoid_set:
        return _SOFIA_BYPASS
    return []


# ── Tool implementations ──────────────────────────────────────────────────────

def _tool_navigate_to(destination: str) -> dict:
    try:
        url = f"https://api.tomtom.com/search/2/search/{requests.utils.quote(destination)}.json"
        r = requests.get(url, params={"key": _TOMTOM_KEY, "language": "bg-BG", "limit": 1, "typeahead": "true"}, timeout=8)
        r.raise_for_status()
        results = r.json().get("results", [])
        if not results:
            return {"error": f"Не намерих '{destination}'"}
        res = results[0]
        pos = res.get("position", {})
        lat, lng = pos.get("lat"), pos.get("lon")
        entry_points = res.get("entryPoints", [])
        if entry_points:
            ep = entry_points[0]
            lat = ep.get("position", {}).get("lat", lat)
            lng = ep.get("position", {}).get("lon", lng)
        name = (res.get("poi") or {}).get("name") or res.get("address", {}).get("freeformAddress", destination)
        return {"destination": name, "coords": [lng, lat]}
    except Exception as exc:
        return {"error": str(exc)}


def _tool_suggest_routes(destination: str, origin_lat: float, origin_lng: float,
                          avoid: list = None, truck_profile: dict = None) -> dict:
    try:
        nav = _tool_navigate_to(destination)
        if "error" in nav:
            return {"error": nav["error"]}
        dest_lng, dest_lat = nav["coords"]
        wps = _get_avoidance_waypoints(origin_lat, origin_lng, dest_lng, avoid)
        all_points = [[origin_lng, origin_lat]] + wps + [[dest_lng, dest_lat]]
        locations = ":".join(f"{p[1]},{p[0]}" for p in all_points)
        url = f"https://api.tomtom.com/routing/1/calculateRoute/{locations}/json"
        params: dict = {"key": _TOMTOM_KEY, "travelMode": "truck", "traffic": "true",
                        "computeTravelTimeFor": "all", "routeType": "fastest",
                        "maxAlternatives": 2, "sectionType": "traffic"}
        if truck_profile:
            if truck_profile.get("height_m"): params["vehicleHeight"] = truck_profile["height_m"]
            if truck_profile.get("width_m"):  params["vehicleWidth"]  = truck_profile["width_m"]
            if truck_profile.get("length_m"): params["vehicleLength"] = truck_profile["length_m"]
            if truck_profile.get("weight_t"): params["vehicleWeight"] = int(truck_profile["weight_t"] * 1000)
            if truck_profile.get("axle_count"): params["vehicleNumberOfAxles"] = truck_profile["axle_count"]
            code = _adr_to_tunnel_code(truck_profile.get("hazmat_class", "none"))
            if code: params["vehicleAdrTunnelRestrictionCode"] = code
        avoid_set = {a for a in (avoid or [])}
        if "motorway" in avoid_set: params["avoid"] = "motorways"
        elif "toll" in avoid_set:   params["avoid"] = "tollRoads"
        elif "ferry" in avoid_set:  params["avoid"] = "ferries"
        r = requests.get(url, params=params, timeout=15)
        r.raise_for_status()
        routes_data = r.json().get("routes", [])
        primary_duration = routes_data[0].get("summary", {}).get("travelTimeInSeconds", 0)
        colors = ["#00bfff", "#00ff88", "#ffcc00"]
        labels = ["Основен маршрут", "Алтернатива 1", "Алтернатива 2"]
        options = []
        for i, rt in enumerate(routes_data[:3]):
            summary = rt.get("summary", {})
            duration = summary.get("travelTimeInSeconds", 0)
            distance = summary.get("lengthInMeters", 0)
            delay_min = round(summary.get("trafficDelayInSeconds", 0) / 60)
            dist_km = round(distance / 1000)
            diff_min = round((duration - primary_duration) / 60)
            diff_str = f" (+{diff_min} мин)" if i > 0 and diff_min > 0 else (f" ({diff_min} мин)" if i > 0 and diff_min < 0 else (" (същото)" if i > 0 else ""))
            dur_h = int(duration / 3600)
            dur_m = int((duration % 3600) / 60)
            dur_str = f"{dur_h}ч {dur_m}мин" if dur_h else f"{dur_m}мин"
            traffic = "low" if delay_min < 5 else "moderate" if delay_min < 20 else "heavy"
            geometry = _tomtom_route_to_geojson(rt)
            options.append({
                "label": f"{labels[i]} — {dist_km}км, {dur_str}{diff_str}",
                "color": colors[i], "duration": duration, "distance": distance,
                "diff_min": diff_min, "traffic": traffic, "traffic_delay_min": delay_min,
                "geometry": geometry, "dest_coords": [dest_lng, dest_lat],
                "congestion_geojson": _tomtom_congestion_geojson(rt, geometry),
                "traffic_alerts": _tomtom_traffic_alerts(rt, geometry),
            })
        return {"destination": nav["destination"], "dest_coords": [dest_lng, dest_lat], "options": options}
    except Exception as exc:
        return {"error": str(exc)}


def _tool_find_truck_parking(lat: float, lng: float, radius_m: int = 20000) -> list:
    results: list = []
    search_r = max(radius_m, 20_000)
    try:
        for query in ("truck stop", "truck parking", "паркинг камион"):
            params = {"q": query, "access_token": _MAPBOX_TOKEN, "language": "en,bg",
                      "types": "poi", "proximity": f"{lng},{lat}", "limit": 4,
                      "session_token": "truckai-park-session"}
            r = requests.get("https://api.mapbox.com/search/searchbox/v1/suggest", params=params, timeout=8)
            r.raise_for_status()
            for s in r.json().get("suggestions", [])[:4]:
                mapbox_id = s.get("mapbox_id")
                if not mapbox_id:
                    continue
                r2 = requests.get(f"https://api.mapbox.com/search/searchbox/v1/retrieve/{mapbox_id}",
                                   params={"access_token": _MAPBOX_TOKEN, "session_token": "truckai-park-session"}, timeout=6)
                r2.raise_for_status()
                features = r2.json().get("features", [])
                if not features:
                    continue
                feat = features[0]
                c = feat["geometry"]["coordinates"]
                el_lng, el_lat = c[0], c[1]
                dist = round(_haversine_m(lat, lng, el_lat, el_lng))
                if dist > max(search_r * 10, 200_000):
                    continue
                props = feat.get("properties", {})
                results.append({"name": s.get("name") or props.get("name", "Truck Parking"),
                                 "lat": el_lat, "lng": el_lng, "paid": False, "showers": False,
                                 "toilets": False, "wifi": False, "security": False, "lighting": False,
                                 "capacity": None, "operator": None, "website": None,
                                 "distance_m": dist, "opening_hours": props.get("open_hours"),
                                 "phone": props.get("phone")})
    except Exception:
        pass
    if len(results) < 2:
        try:
            overpass_q = f"""[out:json][timeout:15];(
  node["amenity"="parking"]["hgv"="yes"](around:{search_r},{lat},{lng});
  node["amenity"="truck_stop"](around:{search_r},{lat},{lng});
  node["highway"="rest_area"](around:{search_r},{lat},{lng});
);out center 10;"""
            r = requests.post("https://overpass-api.de/api/interpreter", data={"data": overpass_q}, timeout=18)
            r.raise_for_status()
            for el in r.json().get("elements", [])[:10]:
                tags = el.get("tags", {})
                el_lat = el.get("lat") or el.get("center", {}).get("lat")
                el_lng = el.get("lon") or el.get("center", {}).get("lon")
                if el_lat is None or el_lng is None:
                    continue
                cap_raw = tags.get("capacity:hgv")
                capacity = None
                try:
                    capacity = int(cap_raw) if cap_raw else None
                except (ValueError, TypeError):
                    pass
                results.append({"name": tags.get("name", "Паркинг за камиони"),
                                 "lat": el_lat, "lng": el_lng,
                                 "paid": tags.get("fee") in ("yes", "pay"),
                                 "showers": tags.get("shower") in ("yes", "public"),
                                 "toilets": tags.get("toilets") in ("yes", "public"),
                                 "wifi": tags.get("internet_access") in ("yes", "wlan", "wifi"),
                                 "security": tags.get("supervised") == "yes",
                                 "lighting": tags.get("lit") in ("yes", "24/7"),
                                 "capacity": capacity, "operator": tags.get("operator"),
                                 "website": tags.get("website"),
                                 "distance_m": round(_haversine_m(lat, lng, el_lat, el_lng)),
                                 "opening_hours": tags.get("opening_hours"),
                                 "phone": tags.get("phone")})
        except Exception:
            pass
    seen: set = set()
    deduped = [item for item in results if (key := (round(item["lat"], 3), round(item["lng"], 3))) not in seen and not seen.add(key)]
    deduped.sort(key=lambda x: x["distance_m"])
    for item in deduped:
        if not item.get("website"):
            item["website"] = f"https://truckerapps.eu/search?lat={item['lat']}&lng={item['lng']}"
    return deduped[:8]


def _build_voice_desc(p: dict) -> str:
    name = p.get("name", "паркинга")
    dist_km = round(p.get("distance_m", 0) / 1000, 1)
    features = []
    features.append("безплатен" if not p.get("paid") else "платен")
    if p.get("showers"): features.append("с душ")
    if p.get("toilets"): features.append("с тоалетни")
    if p.get("wifi"):    features.append("с WiFi")
    if p.get("security"): features.append("охраняем")
    if p.get("lighting"): features.append("осветен")
    if p.get("capacity"): features.append(f"до {p['capacity']} камиона")
    return f"{name} е на {dist_km} километра. {', '.join(features).capitalize()}."


def _tool_find_speed_cameras(lat: float, lng: float, radius_m: int = 10000) -> dict:
    query = f"[out:json][timeout:10];\nnode[\"highway\"=\"speed_camera\"](around:{radius_m},{lat},{lng});\nout 15;"
    try:
        r = requests.post("https://overpass-api.de/api/interpreter", data={"data": query}, timeout=15)
        r.raise_for_status()
        cameras = []
        for el in r.json().get("elements", []):
            tags = el.get("tags", {})
            dist = round(_haversine_m(lat, lng, el["lat"], el["lon"]))
            cameras.append({"lat": el["lat"], "lng": el["lon"],
                             "maxspeed": tags.get("maxspeed"), "distance_m": dist})
        cameras.sort(key=lambda x: x["distance_m"])
        return {"cameras": cameras, "nearest_m": cameras[0]["distance_m"] if cameras else -1}
    except Exception as exc:
        return {"cameras": [], "nearest_m": -1, "error": str(exc)}


def _tool_search_business(query: str, city: str, lat: float, lng: float) -> list:
    q = f"{query} {city}".strip()
    results = _tomtom_search(q, lat, lng, limit=6)
    if not results:
        return [{"error": f"Не намерих '{q}'"}]
    return results


def _tool_check_traffic(origin_lng: float, origin_lat: float, dest_lng: float, dest_lat: float) -> dict:
    try:
        url = (f"https://api.mapbox.com/directions/v5/mapbox/driving-traffic"
               f"/{origin_lng},{origin_lat};{dest_lng},{dest_lat}")
        r = requests.get(url, params={"access_token": _MAPBOX_TOKEN, "alternatives": "true", "overview": "simplified"}, timeout=10)
        r.raise_for_status()
        routes = r.json().get("routes", [])
        if not routes:
            return {"error": "Няма маршрут"}
        primary = routes[0]
        duration = primary.get("duration", 0)
        typical = primary.get("duration_typical", duration)
        delay = max(0, duration - typical)
        result: dict = {"has_delay": delay > 1200, "delay_min": round(delay / 60),
                        "duration_min": round(duration / 60),
                        "alternative_available": len(routes) > 1 and delay > 1200}
        if result["alternative_available"]:
            result["alternative_duration_min"] = round(routes[1]["duration"] / 60)
        return result
    except Exception as exc:
        return {"error": str(exc)}


def _tool_find_fuel(dest_lat: float, dest_lng: float, radius_m: int = 50000) -> list:
    query = f"[out:json][timeout:15];\n(node[\"amenity\"=\"fuel\"][\"hgv\"=\"yes\"](around:{radius_m},{dest_lat},{dest_lng});\nnode[\"amenity\"=\"fuel\"](around:{radius_m},{dest_lat},{dest_lng}););\nout 10;"
    try:
        r = requests.post("https://overpass-api.de/api/interpreter", data={"data": query}, timeout=20)
        r.raise_for_status()
        seen_ids: set = set()
        results = []
        for el in r.json().get("elements", []):
            if el["id"] in seen_ids:
                continue
            seen_ids.add(el["id"])
            tags = el.get("tags", {})
            el_lat = el.get("lat", dest_lat)
            el_lng = el.get("lon", dest_lng)
            results.append({"name": tags.get("name", "Бензиностанция"),
                             "brand": tags.get("brand"), "lat": el_lat, "lng": el_lng,
                             "distance_m": round(_haversine_m(dest_lat, dest_lng, el_lat, el_lng)),
                             "truck_lane": tags.get("hgv") == "yes",
                             "opening_hours": tags.get("opening_hours"),
                             "phone": tags.get("phone")})
        results.sort(key=lambda x: x["distance_m"])
        return results[:10]
    except Exception as exc:
        return [{"error": str(exc)}]


def _tool_add_waypoint(query: str, lat: float, lng: float) -> dict:
    try:
        params = {"q": query, "access_token": _MAPBOX_TOKEN, "language": "bg,en",
                  "types": "poi,address,place", "proximity": f"{lng},{lat}", "limit": 1,
                  "session_token": "truckai-waypoint-session"}
        r = requests.get("https://api.mapbox.com/search/searchbox/v1/suggest", params=params, timeout=8)
        r.raise_for_status()
        suggestions = r.json().get("suggestions", [])
        if not suggestions:
            return {"error": f"Не намерих '{query}'"}
        mapbox_id = suggestions[0].get("mapbox_id")
        name = suggestions[0].get("name", query)
        r2 = requests.get(f"https://api.mapbox.com/search/searchbox/v1/retrieve/{mapbox_id}",
                           params={"access_token": _MAPBOX_TOKEN, "session_token": "truckai-waypoint-session"}, timeout=8)
        r2.raise_for_status()
        features = r2.json().get("features", [])
        if not features:
            return {"error": "Не намерих координати"}
        coords = features[0]["geometry"]["coordinates"]
        return {"name": name, "coords": coords}
    except Exception as exc:
        return {"error": str(exc)}


def _tool_find_overtaking_restrictions(lat: float, lng: float, radius_m: int = 5000) -> dict:
    query = f"""[out:json][timeout:15];
(way["overtaking"="no"](around:{radius_m},{lat},{lng});
 way["overtaking:hgv"="no"](around:{radius_m},{lat},{lng}););
out tags center;"""
    try:
        r = requests.post("https://overpass-api.de/api/interpreter", data={"data": query}, timeout=15)
        r.raise_for_status()
        restrictions = []
        for el in r.json().get("elements", []):
            tags = el.get("tags", {})
            center = el.get("center", {})
            el_lat, el_lng = center.get("lat"), center.get("lon")
            if not el_lat:
                continue
            restrictions.append({"lat": el_lat, "lng": el_lng, "type": "overtaking_no",
                                   "hgv_only": tags.get("overtaking:hgv") == "no",
                                   "distance_m": round(_haversine_m(lat, lng, el_lat, el_lng))})
        restrictions.sort(key=lambda x: x["distance_m"])
        return {"restrictions": restrictions}
    except Exception:
        return {"restrictions": []}


def _tool_calculate_travel_matrix(points: list, profile: str = "driving-traffic") -> dict:
    if len(points) < 2:
        return {"error": "Нужни са поне 2 точки"}
    pts = points[:10]
    coords_str = ";".join(f"{p['lng']},{p['lat']}" for p in pts)
    url = f"https://api.mapbox.com/directions-matrix/v1/mapbox/{profile}/{coords_str}"
    try:
        r = requests.get(url, params={"access_token": _MAPBOX_TOKEN, "annotations": "duration,distance"}, timeout=12)
        r.raise_for_status()
        data = r.json()
        durations = data.get("durations", [])
        distances = data.get("distances", [])
        pairs = []
        for i, row in enumerate(durations):
            for j, val in enumerate(row):
                if i != j and val is not None:
                    pairs.append({"from": pts[i].get("label", f"Точка {i+1}"),
                                  "to": pts[j].get("label", f"Точка {j+1}"),
                                  "duration_min": round(val / 60, 1),
                                  "distance_km": round(distances[i][j] / 1000, 1) if distances and distances[i][j] is not None else None})
        remaining = list(range(1, len(pts)))
        order = [0]
        while remaining:
            last = order[-1]
            nearest = min(remaining, key=lambda j: durations[last][j] or float("inf"))
            order.append(nearest)
            remaining.remove(nearest)
        optimal_order = [pts[i].get("label", f"Точка {i+1}") for i in order]
        return {"labels": [p.get("label", f"Точка {i+1}") for i, p in enumerate(pts)],
                "pairs": pairs, "optimal_order": optimal_order,
                "summary": f"Оптимален ред: {' → '.join(optimal_order)}."}
    except Exception as exc:
        return {"error": str(exc)}


# ── TachoEngine v2 — EU HOS 561/2006 ─────────────────────────────────────────

def _analyze_weekly_rests(user_email: str, week_start: str) -> dict:
    REGULAR_S = 39_600
    REDUCED_S = 32_400
    MAX_REDUCED = 3
    with _db_conn() as db:
        sessions = db.execute(
            "SELECT start_time, end_time FROM tacho_sessions "
            "WHERE date >= ? AND user_email = ? AND end_time IS NOT NULL ORDER BY start_time ASC",
            (week_start, user_email),
        ).fetchall()
    regular = 0
    reduced = 0
    for i in range(len(sessions) - 1):
        try:
            end_t = datetime.fromisoformat(sessions[i]["end_time"])
            next_start_t = datetime.fromisoformat(sessions[i + 1]["start_time"])
            gap_s = (next_start_t - end_t).total_seconds()
            if gap_s >= REGULAR_S:
                regular += 1
            elif gap_s >= REDUCED_S:
                reduced += 1
        except (ValueError, TypeError):
            pass
    return {"weekly_regular_rests": regular, "weekly_reduced_rests": reduced,
            "reduced_rests_remaining": max(0, MAX_REDUCED - reduced)}


def _tacho_summary(user_email: str = "") -> dict:
    today = date.today().isoformat()
    today_dt = date.today()
    week_start_dt = today_dt - timedelta(days=today_dt.weekday())
    prev_week_start_dt = week_start_dt - timedelta(days=7)
    week_start = week_start_dt.isoformat()
    prev_week_start = prev_week_start_dt.isoformat()

    DAILY_LIMIT      = 32400
    WEEKLY_LIMIT     = 201600
    BIWEEKLY_LIMIT   = 324000
    CONTINUOUS_LIMIT = 16200

    with _db_conn() as db:
        row = db.execute(
            "SELECT COALESCE(SUM(driven_seconds),0) AS t FROM tacho_sessions "
            "WHERE date=? AND user_email=? AND type='driving'", (today, user_email)).fetchone()
        daily_s = int(row["t"]) if row else 0

        row = db.execute(
            "SELECT COALESCE(SUM(driven_seconds),0) AS t FROM tacho_sessions "
            "WHERE date>=? AND user_email=? AND type='driving'", (week_start, user_email)).fetchone()
        weekly_s = int(row["t"]) if row else 0

        row = db.execute(
            "SELECT COALESCE(SUM(driven_seconds),0) AS t FROM tacho_sessions "
            "WHERE date>=? AND date<? AND user_email=? AND type='driving'",
            (prev_week_start, week_start, user_email)).fetchone()
        prev_weekly_s = int(row["t"]) if row else 0

        sessions = db.execute(
            "SELECT type, start_time, end_time, driven_seconds FROM tacho_sessions "
            "WHERE date=? AND user_email=? ORDER BY start_time ASC", (today, user_email)).fetchall()

    continuous_s = 0
    first_split_done = False
    for sess in sessions:
        if sess["type"] == "driving":
            continuous_s += int(sess["driven_seconds"])
        elif sess["type"] in ("break", "rest"):
            dur = int(sess["driven_seconds"])
            if dur >= 2700:
                continuous_s = 0
                first_split_done = False
            elif dur >= 1800 and first_split_done:
                continuous_s = 0
                first_split_done = False
            elif dur >= 900:
                first_split_done = True

    biweekly_s = weekly_s + prev_weekly_s
    rests = _analyze_weekly_rests(user_email, week_start)

    return {
        "daily_driven_s":          daily_s,
        "daily_remaining_s":       max(0, DAILY_LIMIT - daily_s),
        "daily_driven_h":          round(daily_s / 3600, 2),
        "daily_remaining_h":       round(max(0, DAILY_LIMIT - daily_s) / 3600, 2),
        "weekly_driven_s":         weekly_s,
        "weekly_remaining_s":      max(0, WEEKLY_LIMIT - weekly_s),
        "weekly_driven_h":         round(weekly_s / 3600, 2),
        "weekly_remaining_h":      round(max(0, WEEKLY_LIMIT - weekly_s) / 3600, 2),
        "continuous_driven_s":     continuous_s,
        "continuous_remaining_s":  max(0, CONTINUOUS_LIMIT - continuous_s),
        "continuous_driven_h":     round(continuous_s / 3600, 2),
        "continuous_remaining_h":  round(max(0, CONTINUOUS_LIMIT - continuous_s) / 3600, 2),
        "break_needed":            continuous_s >= CONTINUOUS_LIMIT,
        "biweekly_driven_h":       round(biweekly_s / 3600, 2),
        "biweekly_remaining_h":    round(max(0, BIWEEKLY_LIMIT - biweekly_s) / 3600, 2),
        "biweekly_limit_h":        90,
        "weekly_regular_rests":    rests["weekly_regular_rests"],
        "weekly_reduced_rests":    rests["weekly_reduced_rests"],
        "reduced_rests_remaining": rests["reduced_rests_remaining"],
        "daily_limit_h":           9,
        "weekly_limit_h":          56,
        "date":                    today,
        "week_start":              week_start,
    }


def _tool_calculate_hos_reach(driven_seconds: int, speed_kmh: float, user_email: str = "") -> dict:
    CONTINUOUS_LIMIT = 16200
    remaining_continuous = max(0, CONTINUOUS_LIMIT - driven_seconds)
    summary = _tacho_summary(user_email)
    remaining_s = min(remaining_continuous, summary["daily_remaining_s"])
    remaining_km = (remaining_s / 3600) * speed_kmh
    h, rest = divmod(int(remaining_s), 3600)
    m = rest // 60
    return {"remaining_h": h, "remaining_min": m, "remaining_km": round(remaining_km),
            "break_needed": remaining_s <= 0,
            "daily_remaining_h": summary["daily_remaining_h"],
            "weekly_remaining_h": summary["weekly_remaining_h"]}


# ── GPT-4o in-memory cache (10-min TTL) ──────────────────────────────────────
_gpt_cache: dict[str, tuple[dict, float]] = {}
_GPT_CACHE_TTL = 600


def _gpt_cache_get(key: str) -> dict | None:
    entry = _gpt_cache.get(key)
    if entry and _cache_time.time() < entry[1]:
        return entry[0]
    _gpt_cache.pop(key, None)
    return None


def _gpt_cache_set(key: str, result: dict) -> None:
    if len(_gpt_cache) >= 50:
        oldest = min(_gpt_cache, key=lambda k: _gpt_cache[k][1])
        _gpt_cache.pop(oldest, None)
    _gpt_cache[key] = (result, _cache_time.time() + _GPT_CACHE_TTL)


# ── GPT-4o map engine ─────────────────────────────────────────────────────────

def _run_gpt4o_internal(user_msg: str, history: list, context: dict) -> dict:
    if not _gpt4o_ready:
        return {"ok": False, "error": "GPT-4o не е конфигуриран. Добави OPENAI_API_KEY в backend/.env"}

    _cache_key = None
    if not history and not context.get("lat"):
        _cache_key = user_msg.strip().lower()
        cached = _gpt_cache_get(_cache_key)
        if cached:
            return cached

    system_txt = _SYSTEM_PROMPT
    if context:
        driven_h = context.get("driven_seconds", 0) / 3600
        prof = context.get("profile", {})
        system_txt += (
            f"\n\nDriver GPS: lat={context.get('lat', '?')}, lng={context.get('lng', '?')}, "
            f"driven={driven_h:.1f}h, speed={context.get('speed_kmh', 0):.0f}km/h. "
            f"Truck Profile: {prof.get('height_m', 4.0)}m height, {prof.get('weight_t', 18)}t weight, "
            f"{prof.get('width_m', 2.55)}m width, {prof.get('length_m', 12)}m length, "
            f"{prof.get('axle_count', 3)} axles, hazmat={prof.get('hazmat_class', 'none')}."
        )

    messages = [{"role": "system", "content": system_txt}]
    for h in history:
        messages.append({"role": "assistant" if h.get("role") == "model" else "user", "content": h.get("text", "")})
    messages.append({"role": "user", "content": user_msg})

    _PARKING_KW = ("паркинг", "паркиране", "паркирам", "стоянка", "truck stop", "parking")
    _force_parking = any(kw in user_msg.lower() for kw in _PARKING_KW)

    action = None
    last_msg = None

    try:
        for turn in range(4):
            resp = openai_client.chat.completions.create(
                model="gpt-4o-mini", messages=messages, tools=_TOOLS,
                tool_choice=({"type": "function", "function": {"name": "find_truck_parking"}}
                             if (_force_parking and turn == 0) else "auto"),
                parallel_tool_calls=False, temperature=0.4,
            )
            last_msg = resp.choices[0].message
            if not last_msg.tool_calls:
                break

            call = last_msg.tool_calls[0]
            fn = call.function.name
            args = json.loads(call.function.arguments)

            if "lat" not in args and context.get("lat") is not None:
                args["lat"] = context["lat"]
                args["lng"] = context["lng"]
            if "driven_seconds" not in args:
                args["driven_seconds"] = context.get("driven_seconds", 0)
            if "speed_kmh" not in args:
                args["speed_kmh"] = context.get("speed_kmh", 80)

            if fn == "navigate_to":
                result = _tool_navigate_to(args["destination"])
                if "coords" in result:
                    dest_lng, dest_lat = result["coords"]
                    action = {"action": "route", "destination": result["destination"],
                              "coords": result["coords"],
                              "waypoints": _get_avoidance_waypoints(
                                  context.get("lat"), context.get("lng"), dest_lng, args.get("avoid"))}
            elif fn == "suggest_routes":
                if "origin_lat" not in args and context.get("lat"):
                    args["origin_lat"] = context["lat"]
                    args["origin_lng"] = context["lng"]
                truck_prof = args.get("truck_profile") or context.get("profile")
                result = _tool_suggest_routes(args["destination"],
                                               args.get("origin_lat", 42.70),
                                               args.get("origin_lng", 23.32),
                                               args.get("avoid"), truck_profile=truck_prof)
                if "options" in result:
                    dest_lng_r = result["dest_coords"][0]
                    forced_wps = _get_avoidance_waypoints(args.get("origin_lat"), args.get("origin_lng"),
                                                           dest_lng_r, args.get("avoid"))
                    action = {"action": "show_routes", "destination": result["destination"],
                              "dest_coords": result["dest_coords"], "options": result["options"],
                              "waypoints": forced_wps}
                    result = {"destination": result["destination"], "dest_coords": result["dest_coords"],
                              "options": [{k: v for k, v in opt.items()
                                           if k not in ("congestion_geojson", "traffic_alerts", "geometry")}
                                          for opt in action["options"]]}
            elif fn == "find_truck_parking":
                raw = _tool_find_truck_parking(args["lat"], args["lng"], args.get("radius_m", 5000))
                result = raw
                cards = [{"name": p["name"], "lat": p["lat"], "lng": p["lng"],
                           "distance_m": p["distance_m"], "paid": p.get("paid", False),
                           "showers": p.get("showers", False), "toilets": p.get("toilets", False),
                           "wifi": p.get("wifi", False), "security": p.get("security", False),
                           "lighting": p.get("lighting", False), "capacity": p.get("capacity"),
                           "website": p.get("website"), "opening_hours": p.get("opening_hours"),
                           "phone": p.get("phone"), "voice_desc": _build_voice_desc(p)}
                          for p in raw[:5]]
                action = {"action": "show_pois", "category": "truck_stop", "cards": cards}
            elif fn == "find_speed_cameras":
                result = _tool_find_speed_cameras(args["lat"], args["lng"], args.get("radius_m", 10000))
                cards = [{"name": f"📷 Камера {cam['maxspeed']} км/ч" if cam.get("maxspeed") else "📷 Камера",
                           "lat": cam["lat"], "lng": cam["lng"], "distance_m": cam["distance_m"],
                           "maxspeed": cam.get("maxspeed")} for cam in result.get("cameras", [])[:8]]
                action = {"action": "show_pois", "category": "speed_camera", "cards": cards,
                          "nearest_m": result.get("nearest_m", -1)}
            elif fn == "calculate_hos_reach":
                result = _tool_calculate_hos_reach(args["driven_seconds"], args["speed_kmh"])
                driven_h = args["driven_seconds"] / 3600
                rem_h = result["remaining_h"] + result["remaining_min"] / 60
                suggested_stop = None
                if rem_h < 0.5 or result["break_needed"]:
                    p_lat = context.get("lat")
                    p_lng = context.get("lng")
                    if p_lat and p_lng:
                        parkings = _tool_find_truck_parking(p_lat, p_lng, 30_000)
                        if parkings:
                            p = parkings[0]
                            suggested_stop = {"lat": p["lat"], "lng": p["lng"], "name": p["name"]}
                action = {"action": "tachograph", "driven_hours": round(driven_h, 1),
                          "remaining_hours": round(rem_h, 2), "break_needed": result["break_needed"],
                          "suggested_stop": suggested_stop}
            elif fn == "search_business":
                result = _tool_search_business(args["query"], args.get("city", ""), args["lat"], args["lng"])
                valid = [b for b in result[:6] if not b.get("error") and b.get("lat")]
                cards = [{"name": b.get("name", ""), "lat": b["lat"], "lng": b["lng"],
                           "distance_m": b.get("distance_m", 0), "info": b.get("address", "")}
                          for b in valid]
                action = {"action": "show_pois", "category": "business", "cards": cards}
            elif fn == "check_traffic_route":
                result = _tool_check_traffic(args["origin_lng"], args["origin_lat"],
                                              args["dest_lng"], args["dest_lat"])
            elif fn == "add_waypoint":
                result = _tool_add_waypoint(args["query"], args["lat"], args["lng"])
                if "coords" in result:
                    action = {"action": "add_waypoint", "name": result["name"], "coords": result["coords"]}
                else:
                    action = {"action": "message", "text": result.get("error", "Не намерих спирката.")}
            elif fn == "find_fuel_stations":
                raw = _tool_find_fuel(args["dest_lat"], args["dest_lng"], args.get("radius_m", 50000))
                result = raw
                cards = [{"name": s.get("name", "Бензиностанция"), "lat": s["lat"], "lng": s["lng"],
                           "distance_m": s.get("distance_m", 0), "brand": s.get("brand"),
                           "truck_lane": s.get("truck_lane", False), "opening_hours": s.get("opening_hours"),
                           "phone": s.get("phone")} for s in raw[:4]]
                action = {"action": "show_pois", "category": "fuel", "cards": cards}
            elif fn == "calculate_travel_matrix":
                result = _tool_calculate_travel_matrix(args["points"], args.get("profile", "driving-traffic"))
            elif fn == "launch_app":
                action = {"action": "app", "data": {"app": args["app_name"], "query": args.get("query", "")}}
                result = {"status": "success", "app": args["app_name"]}
            else:
                result = {"error": "unknown tool"}

            messages.append(last_msg)
            messages.append({"role": "tool", "tool_call_id": call.id,
                              "content": json.dumps(result, ensure_ascii=False)})
            for extra in last_msg.tool_calls[1:]:
                messages.append({"role": "tool", "tool_call_id": extra.id,
                                  "content": json.dumps({"skipped": True}, ensure_ascii=False)})
    except Exception as exc:
        return {"ok": False, "error": str(exc)}

    reply = (last_msg.content or "") if last_msg else ""

    if action is not None:
        act_type = action.get("action")
        if act_type == "route":
            display_text = f"Прокладвам маршрут до {action.get('destination', '')}."
        elif act_type == "show_pois":
            cat = action.get("category", "")
            count = len(action.get("cards", []))
            display_text = {
                "truck_stop": f"Намерих {count} паркинга за камиони.",
                "fuel": f"Намерих {count} горивни станции.",
                "speed_camera": f"Намерих {count} камери в района.",
                "business": f"Намерих {count} места. Натисни за маршрут.",
            }.get(cat, f"Намерих {count} резултата.")
        elif act_type == "show_routes":
            display_text = f"Намерих {len(action.get('options', []))} варианта до {action.get('destination', '')}."
        elif act_type == "add_waypoint":
            display_text = f"Добавена спирка: {action.get('name', '')}."
        elif act_type == "tachograph":
            driven = action.get("driven_hours", 0)
            rem = action.get("remaining_hours", 0)
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
        display_text = reply
        reply_clean = _strip_md_fence(reply)
        if reply_clean.startswith("{"):
            try:
                parsed = json.loads(reply_clean)
                if parsed.get("action") and parsed.get("action") != "message":
                    action = parsed
                    display_text = parsed.get("message") or parsed.get("text") or ""
                else:
                    display_text = parsed.get("text") or parsed.get("message") or reply
            except json.JSONDecodeError:
                display_text = reply_clean

    _dt = _strip_md_fence(display_text or "")
    if _dt.startswith("{"):
        try:
            _parsed = json.loads(_dt)
            display_text = _parsed.get("text") or _parsed.get("message") or ""
        except Exception:
            display_text = _dt
    else:
        display_text = _dt

    _db_save_chat(user_msg, display_text)

    if action is None:
        final_action = {"action": "message", "text": display_text or "Не мога да обработя тази заявка."}
    else:
        final_action = {**action, "message": display_text}

    result_out = {"ok": True, "action": final_action, "reply": display_text}
    if _cache_key and action is None:
        _gpt_cache_set(_cache_key, result_out)
    return result_out


# ── Pydantic models ───────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str
    text: str


class ChatContext(BaseModel):
    lat: Optional[float] = None
    lng: Optional[float] = None
    driven_seconds: Optional[int] = 0
    speed_kmh: Optional[float] = 0
    profile: Optional[Dict[str, Any]] = None


class ChatRequest(BaseModel):
    message: str
    history: Optional[List[ChatMessage]] = []
    context: Optional[ChatContext] = None
    user_email: Optional[str] = None
    user_api_key: Optional[str] = None


class POICreate(BaseModel):
    name: str
    lat: float
    lng: float
    address: Optional[str] = ""
    category: Optional[str] = "custom"
    notes: Optional[str] = ""
    user_email: Optional[str] = ""


class TachoSessionCreate(BaseModel):
    user_email: Optional[str] = ""
    driven_seconds: int
    date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    type: Optional[str] = "driving"


class GoogleSyncRequest(BaseModel):
    user_email: str
    pois: List[Dict[str, Any]]


class RouteCalcRequest(BaseModel):
    origin: List[float]
    destination: List[float]
    waypoints: Optional[List[List[float]]] = []
    truck: Optional[Dict[str, Any]] = {}
    depart_at: Optional[str] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
@app.get("/api/health")
async def health():
    return {"status": "ok", "framework": "fastapi",
            "ai": {"gpt4o": _gpt4o_ready, "gemini": _gemini_ready, "tomtom": _tomtom_ready},
            "timestamp": now_iso()}


@app.post("/api/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    if not _gpt4o_ready:
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY not set")
    try:
        audio_data = await audio.read()
        result = openai_client.audio.transcriptions.create(
            model="whisper-1",
            file=(audio.filename or "audio.m4a", audio_data, audio.content_type or "audio/m4a"),
            language="bg",
        )
        return {"ok": True, "text": result.text}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/chat")
async def chat(req: ChatRequest):
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="message is required")
    ctx = {}
    if req.context:
        ctx = {"lat": req.context.lat, "lng": req.context.lng,
               "driven_seconds": req.context.driven_seconds or 0,
               "speed_kmh": req.context.speed_kmh or 0,
               "profile": req.context.profile or {}}
    history = [{"role": m.role, "text": m.text} for m in (req.history or [])]
    result = _run_gpt4o_internal(req.message.strip(), history, ctx)
    if not result.get("ok"):
        code = 503 if "конфигуриран" in result.get("error", "") else 500
        raise HTTPException(status_code=code, detail=result.get("error"))
    return result


@app.post("/api/gemini/chat")
async def gemini_chat(req: ChatRequest):
    user_msg = req.message.strip()
    if not user_msg:
        raise HTTPException(status_code=400, detail="message is required")

    personal_key = (req.user_api_key or "").strip()
    is_personal = bool(personal_key)

    if is_personal:
        try:
            gemini_client_to_use = _google_genai.Client(api_key=personal_key)
        except Exception:
            gemini_client_to_use = _gemini_client
            is_personal = False
    elif _gemini_ready:
        gemini_client_to_use = _gemini_client
    elif _gpt4o_ready:
        ctx = {}
        if req.context:
            ctx = {"lat": req.context.lat, "lng": req.context.lng,
                   "driven_seconds": req.context.driven_seconds or 0}
        history = [{"role": m.role, "text": m.text} for m in (req.history or [])]
        result = _run_gpt4o_internal(user_msg, history, ctx)
        if not result.get("ok"):
            raise HTTPException(status_code=500, detail=result.get("error"))
        return {"ok": True, "reply": result.get("reply", "Разбрах, колега."), "action": result.get("action")}
    else:
        raise HTTPException(status_code=503, detail="Gemini не е конфигуриран.")

    history_contents = []
    for h in (req.history or [])[-4:]:
        role = "user" if h.role == "user" else "model"
        history_contents.append({"role": role, "parts": [{"text": h.text}]})

    ctx_note = ""
    if req.context and req.context.lat:
        ctx_note += f" [GPS: {req.context.lat:.4f},{req.context.lng:.4f}]"

    tacho = _tacho_summary(req.user_email or "")
    ctx_note += (
        f" [ТАХОГРАФ: непрекъснато {tacho['continuous_driven_h']}ч/4.5ч; "
        f"днес {tacho['daily_driven_h']}ч/9ч; "
        f"седмично {tacho['weekly_driven_h']}ч/56ч; "
        f"двуседмично {tacho['biweekly_driven_h']}ч/90ч]"
    )
    history_contents.append({"role": "user", "parts": [{"text": user_msg + ctx_note}]})

    import time as _time

    def _call_gemini(client_to_use):
        for attempt in range(2):
            try:
                return client_to_use.models.generate_content(
                    model=GEMINI_MODEL, contents=history_contents,
                    config={"system_instruction": _GEMINI_SYSTEM, "temperature": 0.65, "max_output_tokens": 300})
            except Exception as e:
                if ("429" in str(e) or "RESOURCE_EXHAUSTED" in str(e)) and attempt == 0:
                    _time.sleep(2)
                    continue
                raise e

    def _fmt_err(raw, personal=False):
        r = raw.lower()
        if ("quota" in r and ("exceeded" in r or "billing" in r or "plan" in r)) \
                or "perday" in r or ("per_day" in r and "quota" in r):
            source = "Личният ти" if personal else "Сървърният"
            return f"{source} Gemini ключ е изчерпал квотата си. Опитай пак след 60 секунди."
        if "resource_exhausted" in r or "429" in raw:
            return "Gemini е претоварен (15 съобщения/мин). Изчакай 30 сек."
        if "timeout" in r or "deadline" in r:
            return "Gemini не отговори навреме. Опитай пак."
        if "api_key" in r or "401" in raw or "403" in raw:
            return "Невалиден Gemini API ключ. Провери в настройките (⚙️ → Gemini ключ)."
        return f"Gemini грешка: {raw[:120]}"

    try:
        resp = _call_gemini(gemini_client_to_use)
        gemini_text = (resp.text or "").strip()
    except Exception as exc:
        err_raw = str(exc)
        raise HTTPException(status_code=500, detail=_fmt_err(err_raw, is_personal))

    nav_command, clean_reply = _extract_nav_intent(gemini_text)
    app_intent, clean_reply = _extract_app_intent(clean_reply)
    action = None
    if nav_command and _gpt4o_ready:
        ctx = {}
        if req.context:
            ctx = {"lat": req.context.lat, "lng": req.context.lng}
        history = [{"role": m.role, "text": m.text} for m in (req.history or [])]
        gpt_result = _run_gpt4o_internal(nav_command, history, ctx)
        if gpt_result.get("ok"):
            action = gpt_result.get("action")
            if not clean_reply:
                clean_reply = gpt_result.get("reply", "")

    _db_save_chat(user_msg, clean_reply)
    return {"ok": True, "reply": clean_reply, "action": action, "app_intent": app_intent}


@app.post("/api/gemini/transcribe")
async def gemini_transcribe(audio: UploadFile = File(...), user_api_key: str = Form(None)):
    if not _gemini_ready and not user_api_key:
        raise HTTPException(status_code=503, detail="Gemini не е конфигуриран.")
    gemini_client_to_use = _google_genai.Client(api_key=user_api_key) if user_api_key else _gemini_client
    try:
        audio_data = await audio.read()
        resp = gemini_client_to_use.models.generate_content(
            model=GEMINI_MODEL,
            contents=[{"role": "user", "parts": [
                {"inline_data": {"data": audio_data, "mime_type": audio.content_type or "audio/m4a"}},
                {"text": "Transcribe the following Bulgarian speech to text exactly. Return ONLY the text."}
            ]}],
            config={"temperature": 0.0})
        return {"ok": True, "text": (resp.text or "").strip()}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/gemini/validate")
async def gemini_validate(body: dict):
    api_key = (body.get("api_key") or "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="api_key is required")
    try:
        test_client = _google_genai.Client(api_key=api_key)
        resp = test_client.models.generate_content(
            model=GEMINI_MODEL,
            contents=[{"role": "user", "parts": [{"text": "ping"}]}],
            config={"max_output_tokens": 5})
        _ = resp.text
        return {"ok": True, "model": GEMINI_MODEL}
    except Exception as exc:
        err = str(exc)
        if "API_KEY_INVALID" in err or "INVALID_ARGUMENT" in err:
            msg = "Невалиден Gemini API ключ. Провери на ai.google.dev."
        elif "RESOURCE_EXHAUSTED" in err or "429" in err:
            msg = "Gemini API квотата е изчерпана. Изчакай малко и опитай пак."
        else:
            msg = f"Gemini грешка: {err[:120]}"
        raise HTTPException(status_code=400, detail=msg)


@app.get("/api/pois")
async def list_pois(category: Optional[str] = Query(None),
                    user_email: Optional[str] = Query(""),
                    db: sqlite3.Connection = Depends(get_db)):
    if category and user_email:
        rows = db.execute("SELECT * FROM pois WHERE category=? AND user_email=? ORDER BY created_at DESC",
                          (category, user_email)).fetchall()
    elif category:
        rows = db.execute("SELECT * FROM pois WHERE category=? ORDER BY created_at DESC", (category,)).fetchall()
    elif user_email:
        rows = db.execute("SELECT * FROM pois WHERE user_email=? ORDER BY created_at DESC", (user_email,)).fetchall()
    else:
        rows = db.execute("SELECT * FROM pois ORDER BY created_at DESC").fetchall()
    return {"ok": True, "pois": [row_to_poi(r) for r in rows]}


@app.post("/api/pois", status_code=201)
async def save_poi(req: POICreate, db: sqlite3.Connection = Depends(get_db)):
    cur = db.execute(
        "INSERT INTO pois (name, address, category, lat, lng, notes, user_email, created_at) VALUES (?,?,?,?,?,?,?,?)",
        (req.name, req.address, req.category, req.lat, req.lng, req.notes, req.user_email, now_iso()))
    db.commit()
    row = _db_conn().execute("SELECT * FROM pois WHERE id=?", (cur.lastrowid,)).fetchone()
    return {"ok": True, "poi": row_to_poi(row)}


@app.delete("/api/pois/{poi_id}")
async def delete_poi(poi_id: int, db: sqlite3.Connection = Depends(get_db)):
    deleted = db.execute("DELETE FROM pois WHERE id=?", (poi_id,)).rowcount
    db.commit()
    if deleted == 0:
        raise HTTPException(status_code=404, detail="POI not found")
    return {"ok": True}


@app.post("/api/routes/calculate")
async def calculate_route(req: RouteCalcRequest):
    if not _tomtom_ready:
        raise HTTPException(status_code=503, detail="TomTom API key not configured")
    all_points = [req.origin] + (req.waypoints or []) + [req.destination]
    locations = ":".join(f"{p[1]},{p[0]}" for p in all_points)
    url = f"https://api.tomtom.com/routing/1/calculateRoute/{locations}/json"
    truck = req.truck or {}
    params: dict = {"key": _TOMTOM_KEY, "travelMode": "truck", "traffic": "true",
                    "computeTravelTimeFor": "all", "routeType": "fastest",
                    "instructionsType": "tagged", "language": "bg-BG", "sectionType": "traffic,lanes"}
    if truck.get("max_height"):  params["vehicleHeight"]        = truck["max_height"]
    if truck.get("max_width"):   params["vehicleWidth"]         = truck["max_width"]
    if truck.get("max_weight"):  params["vehicleWeight"]        = int(truck["max_weight"] * 1000)
    if truck.get("max_length"):  params["vehicleLength"]        = truck["max_length"]
    if truck.get("axle_count"):  params["vehicleNumberOfAxles"] = truck["axle_count"]
    code = _adr_to_tunnel_code(truck.get("hazmat_class", "none") or "none")
    if code: params["vehicleAdrTunnelRestrictionCode"] = code
    if req.depart_at: params["departAt"] = req.depart_at
    try:
        r = requests.get(url, params=params, timeout=15)
        r.raise_for_status()
        routes_data = r.json().get("routes", [])
        if not routes_data:
            raise HTTPException(status_code=404, detail="Няма намерен маршрут")
        rt = routes_data[0]
        summary = rt.get("summary", {})
        geometry = _tomtom_route_to_geojson(rt)
        instructions = rt.get("guidance", {}).get("instructions", [])
        total_meters = summary.get("lengthInMeters", 0)
        steps = []
        for i, instr in enumerate(instructions):
            current_offset = instr.get("routeOffsetInMeters", 0)
            next_offset = instructions[i + 1].get("routeOffsetInMeters", 0) if i + 1 < len(instructions) else total_meters
            banner = _tomtom_lane_banner(instr)
            steps.append({
                "maneuver": {"instruction": instr.get("message", ""), "type": instr.get("maneuver", ""), "modifier": None},
                "distance": max(0, next_offset - current_offset),
                "duration": instr.get("travelTimeInSeconds", 0),
                "name": instr.get("street", ""),
                "intersections": [{"location": [instr["point"]["longitude"], instr["point"]["latitude"]]}] if instr.get("point") else [],
                "bannerInstructions": [banner] if banner else [],
            })
        return {"geometry": geometry, "distance": summary.get("lengthInMeters", 0),
                "duration": summary.get("travelTimeInSeconds", 0),
                "traffic_delay": summary.get("trafficDelayInSeconds", 0),
                "steps": steps, "maxspeeds": _tomtom_speed_limits(rt),
                "congestionGeoJSON": _tomtom_congestion_geojson(rt, geometry),
                "traffic_alerts": _tomtom_traffic_alerts(rt, geometry)}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/tacho/session")
async def tacho_save_session(req: TachoSessionCreate):
    if req.driven_seconds <= 0:
        raise HTTPException(status_code=400, detail="driven_seconds must be > 0")
    today = date.today().isoformat()
    with _db_conn() as db:
        db.execute(
            "INSERT INTO tacho_sessions (user_email, date, start_time, end_time, driven_seconds, type) VALUES (?,?,?,?,?,?)",
            (req.user_email, req.date or today, req.start_time or now_iso(),
             req.end_time or now_iso(), req.driven_seconds, req.type or "driving"))
        db.commit()
    return {"ok": True, **_tacho_summary(req.user_email or "")}


@app.get("/api/tacho/summary")
async def tacho_get_summary(user_email: Optional[str] = Query("")):
    return {"ok": True, **_tacho_summary(user_email or "")}


@app.get("/api/user/settings")
async def get_user_settings(user_email: str = Query(...)):
    with _db_conn() as db:
        row = db.execute("SELECT * FROM user_settings WHERE user_email=?", (user_email,)).fetchone()
        if row:
            return {"ok": True, "gemini_api_key": row["gemini_api_key"]}
    return {"ok": True, "gemini_api_key": None}


@app.post("/api/user/settings")
async def save_user_settings(body: dict):
    user_email = (body.get("user_email") or "").strip()
    key = (body.get("gemini_api_key") or "").strip()
    if not user_email:
        raise HTTPException(status_code=400, detail="user_email is required")
    with _db_conn() as db:
        db.execute(
            "INSERT OR REPLACE INTO user_settings (user_email, gemini_api_key, updated_at) VALUES (?,?,?)",
            (user_email, key, now_iso()))
        db.commit()
    return {"ok": True}


@app.get("/api/google-sync")
@app.post("/api/google-sync")
async def google_sync(req: Optional[GoogleSyncRequest] = None,
                      user_email: Optional[str] = Query(None)):
    if req is not None:
        # POST
        imported_count = 0
        with _db_conn() as conn:
            for p in req.pois:
                name = (p.get("name") or "").strip()
                lat, lng = p.get("lat"), p.get("lng")
                if name and lat is not None and lng is not None:
                    conn.execute(
                        "INSERT OR REPLACE INTO pois (name, address, category, lat, lng, notes, user_email, created_at) "
                        "VALUES (?,?,?,?,?,?,?,?)",
                        (name, p.get("address", ""), "google_synced",
                         float(lat), float(lng), p.get("notes", ""), req.user_email, now_iso()))
                    imported_count += 1
            conn.commit()
        return {"ok": True, "imported": imported_count}
    # GET
    email = user_email or ""
    if not email:
        raise HTTPException(status_code=400, detail="user_email is required")
    with _db_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM pois WHERE user_email=? AND category='google_synced' ORDER BY created_at DESC",
            (email,)).fetchall()
    return {"ok": True, "pois": [row_to_poi(r) for r in rows]}


@app.get("/api/proximity-alerts")
async def proximity_alerts(lat: float = Query(...), lng: float = Query(...),
                            radius_m: int = Query(10000)):
    cameras = _tool_find_speed_cameras(lat, lng, radius_m)
    overtaking = _tool_find_overtaking_restrictions(lat, lng, radius_m)
    return {"ok": True, "cameras": cameras.get("cameras", []),
            "overtaking": overtaking.get("restrictions", []),
            "nearest_camera_m": cameras.get("nearest_m", -1)}


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 5050))
    uvicorn.run(app, host="0.0.0.0", port=port)
