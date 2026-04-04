"""
TruckAI Pro — Flask backend v2.1
Architecture: GPT-4o is the map brain. Every response is a JSON map action.
The frontend reads the action and executes it on Mapbox directly.

Run:
  cd backend
  pip install -r requirements.txt
  cp .env.example .env  # add your OPENAI_API_KEY
  python app.py
"""

import hashlib
import json
import math
import os
import re
import sqlite3
import time
import threading
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import requests
from flask import Flask, jsonify, request
from flask_cors import CORS
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"), override=False)


# ── Rate limiting (in-memory, per IP) ─────────────────────────────────────────
_rate_data: dict = defaultdict(list)  # ip → [timestamp, ...]
tacho_live_context = {}   # Live data from BLE tachograph — injected into Gemini system prompt

def _is_rate_limited(ip: str, limit: int, window_s: int = 60) -> bool:
    """Returns True if IP has exceeded `limit` requests in the last `window_s` seconds."""
    now = time.monotonic()
    timestamps = _rate_data[ip]
    # Drop old entries outside the window
    _rate_data[ip] = [t for t in timestamps if now - t < window_s]
    if len(_rate_data[ip]) >= limit:
        return True
    _rate_data[ip].append(now)
    return False


def _strip_md_fence(s: str) -> str:
    """Remove ```json ... ``` or ``` ... ``` markdown code fences from GPT responses."""
    s = s.strip()
    s = re.sub(r'^```[a-zA-Z]*\s*', '', s)
    s = re.sub(r'\s*```$', '', s)
    return s.strip()


# ── OpenAI setup ───────────────────────────────────────────────────────────────
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
_gpt4o_ready = bool(os.getenv("OPENAI_API_KEY"))

# ── Anthropic setup ────────────────────────────────────────────────────────────
try:
    import anthropic as _anthropic_lib
    _anthropic_client = _anthropic_lib.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))
    _anthropic_ready = bool(os.getenv("ANTHROPIC_API_KEY"))
except ImportError:
    _anthropic_client = None
    _anthropic_ready = False

_GOOGLE_PLACES_KEY = os.getenv("GOOGLE_PLACES_KEY")
_places_ready = bool(_GOOGLE_PLACES_KEY)

_TOMTOM_KEY = os.getenv("TOMTOM_API_KEY")
_tomtom_ready = bool(_TOMTOM_KEY)

# ── Gemini setup ───────────────────────────────────────────────────────────────
_GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-preview-04-17")

# EU/Balkans truck speed limits (km/h) by ISO-3166-1 alpha-3 country code
# Source: Sygic CountriesInfo.json — _TR_SL_Rural_Areas + _TR_SL_Highways
# Format: (urban, rural, motorway) — urban always 50 unless exception
_TRUCK_SPEED_LIMITS: dict[str, tuple[int, int, int]] = {
    "BGR": (50, 80, 100),   # Bulgaria
    "DEU": (50, 80,  80),   # Germany
    "AUT": (50, 70,  80),   # Austria
    "ROU": (50, 80, 110),   # Romania
    "HUN": (50, 70,  80),   # Hungary
    "HRV": (50, 80,  90),   # Croatia
    "SRB": (50, 70, 100),   # Serbia
    "GRC": (50, 80,  85),   # Greece
    "TUR": (50, 70,  90),   # Turkey
    "POL": (50, 70,  80),   # Poland
    "CZE": (50, 80,  80),   # Czechia
    "SVK": (50, 90,  90),   # Slovakia
    "SVN": (50, 80,  90),   # Slovenia
    "ITA": (50, 80, 100),   # Italy
    "FRA": (50, 80,  90),   # France
    "ESP": (50, 80,  90),   # Spain
    "NLD": (50, 80,  80),   # Netherlands
    "BEL": (50, 90,  90),   # Belgium
    "CHE": (50, 80,  80),   # Switzerland
    "GBR": (48, 50,  70),   # UK (mph: 30/50/60 → approx km/h 48/80/96, but Sygic stores mph)
    "UKR": (50, 80,  90),   # Ukraine
    "MKD": (50, 80,  80),   # North Macedonia
    "ALB": (50, 80,  90),   # Albania
    "BIH": (50, 80,  80),   # Bosnia
    "MNE": (50, 80,  80),   # Montenegro
    "SWE": (50, 80,  80),   # Sweden
    "NOR": (50, 80,  80),   # Norway
    "DNK": (50, 70,  80),   # Denmark
    "FIN": (50, 80,  80),   # Finland
    "PRT": (50, 80,  90),   # Portugal
    "LUX": (50, 75,  90),   # Luxembourg
}

try:
    from google import genai as _google_genai
    _gemini_client = _google_genai.Client(api_key=os.getenv("GEMINI_API_KEY", ""))
    _gemini_ready = bool(os.getenv("GEMINI_API_KEY"))
except ImportError:
    _gemini_client = None
    _gemini_ready = False


def _get_body() -> dict:
    """Helper to get JSON body from request safely."""
    try:
        return request.get_json(silent=True) or {}
    except Exception:
        return {}


def _build_tacho_context_block() -> str:
    """Format tacho_live_context for Gemini system prompt."""
    if not tacho_live_context:
        return ''

    rem_h  = tacho_live_context.get('driving_time_left_min', 0) // 60
    rem_m  = tacho_live_context.get('driving_time_left_min', 0) % 60
    drv_h  = tacho_live_context.get('daily_driven_min', 0) // 60
    drv_m  = tacho_live_context.get('daily_driven_min', 0) % 60

    return f"""
ТАХОГРАФ (live BLE данни):
- Текуща активност: {tacho_live_context.get('current_activity', 'unknown')}
- Изкарано днес: {drv_h}ч {drv_m}мин
- Оставащо каране: {rem_h}ч {rem_m}мин
- Скорост от сензор: {tacho_live_context.get('speed_kmh', 0)} км/ч
- Последно обновяване: {tacho_live_context.get('timestamp', '')}

Ако шофьорът пита за оставащо време или почивка — използвай горните данни.
Ако остават < 30 мин — предупреди проактивно и предложи да потърсиш паркинг.
"""

_GEMINI_SYSTEM = (
    "Gemini — AI асистент в TruckAI Pro. Говориш с КАМИОНЕН ШОФЬОР. "
    "САМО БЪЛГАРСКИ. Кратко и ясно. Обръщай се 'Колега'.\n\n"
    "ТАХОГРАФ (EU 561/2006):\n"
    "- Дневно: 9ч (10ч → макс 2×/седм)\n"
    "- Дневна почивка: 11ч редовна / 9ч намалена (макс 3× между седм. почивки)\n"
    "- Седмична: 45ч редовна / 24ч намалена (компенсация до 3-та седм.)\n"
    "- Лимити: 56ч/седм, 90ч/2седм. Пауза: 45мин след 4.5ч (или 15+30)\n"
    "- При <30мин до лимит → предупреди веднага.\n\n"
    "МОЖЕ ЛИ ДА СТИГНА: При въпрос 'Мога ли да стигна до X?' изчисли:\n"
    "  1. Оцени разстоянието в км до X от текущата GPS позиция на шофьора.\n"
    "  2. Изчисли времето: разстояние / 80 км/ч = часове.\n"
    "  3. Сравни с 'ефективно-остава' от тахографа.\n"
    "  4. Ако може → 'Да, колега! ~X км / ~Y ч. Имаш Z ч оставащи.' "
    "  5. Ако не може → 'Не, колега. X ч до дестинацията, но имаш само Y ч. "
    "Трябва почивка след ~K км. Предлагам спирка при...'\n\n"
    "📱 ПРИЛОЖЕНИЯ — добавяй в края:\n"
    "[APP:{\"app\":\"<name>\",\"query\":\"<опц>\"}]\n"
    "\nТРАНСПАРКИНГ: При въпрос за паркинг за камиони (TransParking, паркинги на живо, "
    "свободни места) → добавяй:\n"
    "[APP:{\"app\":\"chrome\",\"url\":\"https://truckerapps.eu/transparking/pl/map/\"}]\n"
    "Кажи на шофьора: 'Отварям TransParking за теб, колега.'\n"
    "## WTD / Работен ден (Working Time Directive EU 2002/15)\n\n"
    "Получаваш сурови данни от тахографа:\n"
    "- shift_start_iso: началото на смяната (ISO timestamp) — кога шофьорът е започнал да работи\n"
    "- reduced_rests_remaining: колко 9-часови (намалени) почивки му остават тази седмица (обичайно 3 на 2 седмици)\n"
    "- daily_driving_limit_h: дневен лимит каране в часове (9 или 10)\n"
    "- driven_seconds: изкарани секунди каране днес\n"
    "- est_km: прогнозни километри до дестинацията\n\n"
    "Правила (изчисляваш сам):\n"
    "1. Максимален работен ден = 13ч. Ако reduced_rests_remaining > 0 → може да разпъне до 15ч (с намалена почивка 9ч).\n"
    "2. Краен час на работния ден = shift_start_iso + (13 или 15)ч\n"
    "3. Оставащо каране = daily_driving_limit_h * 3600 - driven_seconds\n"
    "4. Краен час за каране = now + оставащо_каране\n"
    "5. Шофьорът трябва да спре при по-ранния от двата края (работен ден или каране)\n\n"
    "При въпроси 'До колко часа?', 'Колко мога още?', 'Стигам ли до X?':\n"
    "- Дай точен час (напр. 'До 21:15')\n"
    "- Кажи дали ограничението е от тахографа или от работния ден\n"
    "- Ако reduced_rests_remaining > 0, предложи опцията за 15ч смяна\n\n"
    "## Тахограф дневник (tacho_log)\n\n"
    "Получаваш `tacho_log` — дневен журнал на активностите от BLE тахографа:\n"
    "- `shift_start`: час на първата активност (HH:MM)\n"
    "- `current_time`: текущ час\n"
    "- `total_driven_min`: изкарани минути каране\n"
    "- `remaining_drive_min`: оставащи минути каране (от тахографа)\n"
    "- `segments`: списък [{activity, start, end, duration_min}]\n\n"
    "Активности: DRIVING=каране, REST=почивка, WORK=друга работа, AVAILABILITY=на разположение\n\n"
    "При въпроси за тахографа ВИНАГИ ползвай tacho_log за точни изчисления:\n"
    "- Смяна = shift_start + 13ч (или 15ч ако reduced_rests_remaining > 0)\n"
    "- Следваща задължителна пауза = след 4.5ч непрекъснато каране (проверявай в segments)\n"
    "- 45мин пауза = може разделена на 15мин + 30мин (в този ред)\n"
    "- Форматирай отговора с точни часове: 'Трябва да спреш до 18:30'\n\n"
    "## Седмично тахо (tacho_week)\n\n"
    "Получаваш `tacho_week` — седмично и двуседмично резюме по EU 561/2006:\n"
    "- weekly_driven_min / weekly_limit_min (56ч = 3360мин): седмичен лимит\n"
    "- biweekly_driven_min / biweekly_limit_min (90ч = 5400мин): двуседмичен лимит\n"
    "- weekly_remaining_min: оставащи минути тази седмица\n"
    "- daily_breakdown: {дата: часове} за последните 7 дни\n\n"
    "При въпроси 'Колко мога да карам тази седмица?', 'Имам ли право на повече часове?' — ползвай тези данни.\n"
    "\n## Потребителска памет (user_memory)\n\n"
    "Получаваш `user_memory` — масив от предпочитания и факти за шофьора, натрупани от предишни разговори.\n"
    "Примери: 'Обича да спи в Найт Стар', 'Камионът е Volvo FH 500, Euro 6'\n"
    "Ползвай тези факти проактивно при препоръки — не питай отново за неща, които вече знаеш.\n"
    "Когато шофьорът каже нещо ново важно ('обичам X', 'камионът ми е Y'), отговори нормално, "
    "но в края добави JSON тагове за запомняне: <remember category=\"preference\">текст</remember>\n"
    "Категории: parking, route, preference, general\n\n"
    "## Важно правило за контекстни данни\n"
    "Данните в квадратни скоби [ТАХОГРАФ:...], [ПАМЕТ:...], [gpt_route_data:...], [НАВИЦИ:...] са ВЪТРЕШНИ.\n"
    "НИКОГА не ги цитирай, не ги повтаряй и не показвай JSON в отговора си.\n"
    "Ползвай ги само за да формулираш естествен отговор на български.\n\n"
    "## GPT маршрутни данни (gpt_route_data)\n"
    "Когато получиш gpt_route_data в контекста, използвай само числата — обясни на шофьора на човешки език.\n"
    "Пример: 'До Хамбург има около 1240 км, около 13 часа каране без почивки.'\n\n"
    "## Навици на шофьора (driver_habits)\n"
    "Статистика от последните 14 дни:\n"
    "- typical_start: обичайно начало на работния ден\n"
    "- typical_stop: обичайно спиране\n"
    "- avg_daily_driven_h: средно часове каране на ден\n\n"
    "Ползвай тези данни за персонализирани препоръки: 'Обикновено тръгваш в 7:00, но днес е вече 9:00 — имаш ли забавяне?'\n"
)

_NAV_RE = re.compile(r'\[NAV:\s*(\{.*?\})\s*\]', re.DOTALL)
_APP_RE = re.compile(r'\[APP:\s*(\{.*?\})\s*\]', re.DOTALL)


def _extract_nav_intent(text: str):
    """Extract navigation command from Gemini response.
    Returns (nav_command_str | None, clean_reply_text).
    Removes only the [NAV:...] tag; preserves surrounding text."""
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
    """Extract app-launch intent from Gemini response.
    Returns (app_dict | None, clean_text).
    Removes only the [APP:...] tag; preserves surrounding text."""
    m = _APP_RE.search(text)
    if m:
        try:
            data = json.loads(m.group(1))
            clean = (text[:m.start()] + text[m.end():]).strip()
            return data, clean
        except Exception:
            pass
    return None, text


# ── GPT + Gemini collaboration ────────────────────────────────────────────────

_NAV_KEYWORDS = [
    'маршрут', 'route', 'навигация', 'stiga', 'стигам', 'пристигане',
    'разстояние', 'км', 'километ', 'път до', 'как да стигна', 'колко дълго',
]


def _has_nav_intent(text: str) -> bool:
    text_lower = text.lower()
    return any(kw in text_lower for kw in _NAV_KEYWORDS)


def _get_gpt_route_insight(destination: str, context: dict) -> dict | None:
    """Call GPT-4o for compact route facts as JSON. Returns dict or None on error."""
    if not _gpt4o_ready:
        return None
    try:
        lat = context.get('lat')
        lng = context.get('lng')
        loc_hint = f" from GPS {lat:.4f},{lng:.4f}" if lat and lng else ""
        messages = [
            {
                "role": "system",
                "content": (
                    "You are a truck routing assistant. "
                    "Reply with ONLY a JSON object — no prose, no code fences. "
                    'Format: {"distance_km": <number>, "duration_min": <number>, "key_waypoints": [<string>, ...]}'
                ),
            },
            {
                "role": "user",
                "content": f"Give route facts for a truck going to {destination}{loc_hint}.",
            },
        ]
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,  # type: ignore[arg-type]
            max_tokens=80,
            temperature=0,
        )
        raw = _strip_md_fence(resp.choices[0].message.content or "")
        return json.loads(raw)
    except Exception:
        return None


_MAPBOX_TOKEN = (
    "pk.eyJ1IjoiYnJlaWthOTk5IiwiYSI6ImNtbHBob2xjMzE5Z3MzZ3F4Y3QybGpod3AifQ"
    ".hprmbhb8EVFSfF7cqc4lkw"
)

# ── System prompt — GPT-4o responds ONLY with JSON map actions ─────────────────
_SYSTEM_PROMPT = (
    "Ти си TruckAI — експертен GPS асистент за камиони в България.\n"
    "ГОВОРИШ С КАМИОНЕН ШОФЬОР. Бъди КРАТЪК (1-2 изречения). Адресирай го като 'Колега'.\n"
    "Ти си приятел и помощник на шофьора, но същевременно си високотехнологичен навигационен мозък.\n\n"
    "CRITICAL RULES:\n"
    "1. ALWAYS respond with ONLY a single valid JSON object or a conversational Bulgarian reply wrapped in a message action.\n"
    "2. ALWAYS use Bulgarian in all message fields.\n"
    "3. ALWAYS address the driver as 'Колега'. Be polite but concise.\n"
    "4. APP CONTROL: When the driver wants to open an app (YouTube, Google, Spotify, Chrome, etc.), use the launch_app tool immediately.\n"
    "5. ROUTING: For routes BG -> W. Europe, always avoid Serbia unless requested; go via Romania (Bucharest -> Cluj -> Budapest).\n"
    "6. TRUCK SAFETY: Always use truck dimensions for routing. Don't go under low bridges or through weight-restricted zones.\n"
    "7. DYNAMIC AVOIDANCE: Support 'avoid' for Serbia, Romania, Tolls, Sofia Center, etc.\n"
    "8. SEARCH: Use search_business for ANY place — restaurants, pizzerias, cafes, fuel stations, warehouses, factories, repair shops, customs offices, or any other business/address.\n"
    "9. TACHOGRAPH: Help with HOS limits (4.5h rule, 9h rule). Suggest stops 30 min before the limit.\n"
    "10. CITY SEARCH: 'до', 'в', 'около', 'край', 'при', 'близо до' ALL mean 'near that city'. "
    "When the user mentions a city name (Русе, София, Варна, Пловдив, etc.), you MUST use THAT CITY's coordinates "
    "as lat/lng in the tool call — NEVER the driver's current GPS from context. "
    "City coordinates: Русе=lat:43.849,lng:25.955 | София=lat:42.698,lng:23.321 | Варна=lat:43.204,lng:27.910 | "
    "Пловдив=lat:42.150,lng:24.745 | Бургас=lat:42.504,lng:27.469 | Плевен=lat:43.417,lng:24.607 | "
    "Стара Загора=lat:42.425,lng:25.634 | Шумен=lat:43.271,lng:26.919 | "
    "Велико Търново=lat:43.076,lng:25.617 | Видин=lat:43.993,lng:22.870 | Враца=lat:43.200,lng:23.550.\n"
    "11. NAVIGATION vs SEARCH: If the user says JUST a city name (e.g., 'Русе', 'Пловдив', 'София'), "
    "they want to GO THERE. Use navigate_to immediately with the city name as destination. "
    "NEVER use find_truck_parking or search_business for a single city name. "
    "DO NOT search for parking unless keywords like 'паркинг', 'стоянка' or 'truck stop' are present. "
    "If you are unsure, default to navigate_to.\n\n"
    "Available tools are for map actions. If the user is just chatting, use action:'message' with a Bulgarian reply.\n"
)

# ── GPT-4o tool definitions ────────────────────────────────────────────────────

_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "navigate_to",
            "description": "Start navigation to a city, address, or landmark. Use this for single city names like 'Sofia' or 'Ruse'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "destination": {
                        "type": "string",
                        "description": "The destination name (city, street, or company)",
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
                    "truck_profile": {
                        "type": "object",
                        "properties": {
                            "height_m": {"type": "number"},
                            "weight_t": {"type": "number"},
                            "width_m": {"type": "number"},
                            "length_m": {"type": "number"},
                            "axle_count": {"type": "integer"},
                            "hazmat_class": {"type": "string"}
                        },
                        "description": "Truck dimensions/load"
                    }
                },
                "required": ["destination"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "suggest_routes",
            "description": "Show 2-3 route alternatives. Use when user wants to compare routes or asks for options.",
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
                    "truck_profile": {
                        "type": "object",
                        "properties": {
                            "height_m": {"type": "number"},
                            "weight_t": {"type": "number"},
                            "width_m": {"type": "number"},
                            "length_m": {"type": "number"},
                            "axle_count": {"type": "integer"},
                            "hazmat_class": {"type": "string"}
                        },
                        "description": "Truck dimensions/load"
                    }
                },
                "required": ["destination", "origin_lat", "origin_lng"],
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
                "Search for ANY place: restaurant, pizzeria, cafe, fuel station, "
                "warehouse, repair shop, factory, customs, or any address. "
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
            "description": "Check traffic on active route.",
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
            "name": "add_waypoint",
            "description": (
                "Add an intermediate stop/waypoint to the current active route. "
                "Use when user says 'добави X към маршрута', 'спри при X', 'мини през X', "
                "'добави спирка X', 'add X to route', or names a specific POI to insert as a stop. "
                "Searches for the named place and returns its coordinates."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Place name or address (in English)"},
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
            "name": "calculate_travel_matrix",
            "description": "Find optimal order for multiple stops/deliveries. Returns best route order with travel times.",
            "parameters": {
                "type": "object",
                "properties": {
                    "points": {
                        "type": "array",
                        "description": "Points to visit (max 10), each with lat, lng, label.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "lat":   {"type": "number"},
                                "lng":   {"type": "number"},
                                "label": {"type": "string", "description": "Human-readable name"},
                            },
                            "required": ["lat", "lng", "label"],
                        },
                    },
                    "profile": {
                        "type": "string",
                        "enum": ["driving-traffic", "driving"],
                        "default": "driving-traffic",
                    },
                },
                "required": ["points"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "launch_app",
            "description": "Open a mobile app like YouTube, Spotify, Google, etc.",
            "parameters": {
                "type": "object",
                "properties": {
                    "app_name": {
                        "type": "string",
                        "enum": ["youtube", "spotify", "google", "whatsapp", "viber", "facebook", "chrome", "settings"],
                        "description": "Name of the app to launch"
                    },
                    "query": {
                        "type": "string",
                        "description": "Optional search query for the app"
                    }
                },
                "required": ["app_name"]
            }
        }
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
    # Migration: add user_email and type columns if they do not exist yet
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


def _transparking_cache_refresh() -> None:
    """Fetch all parking spots from Transparking and cache them locally (24h TTL)."""
    try:
        with get_db() as db:
            row = db.execute("SELECT refreshed_at FROM transparking_cache LIMIT 1").fetchone()
            if row:
                last_refreshed = datetime.fromisoformat(row["refreshed_at"])
                if (datetime.now(timezone.utc) - last_refreshed.replace(tzinfo=timezone.utc)).total_seconds() < 86400:
                    print("[Transparking] cache still fresh, skipping refresh")
                    return

        print("[Transparking] fetching points from truckerapps.eu ...")
        url = "https://truckerapps.eu/transparking/points.php?action=list"
        r = requests.get(url, timeout=60)
        r.raise_for_status()
        data = r.json()

        features = data.get("features", [])
        print(f"[Transparking] got {len(features)} features")
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
                    print(f"[Transparking] inserted {inserted}...")
            db.commit()
        print(f"[Transparking] cache ready — {inserted} spots")
    except Exception as e:
        print(f"[Transparking] refresh FAILED: {e}")


def _transparking_match(lat: float, lng: float, radius_m: int = 150) -> dict | None:
    """Find the closest Transparking spot within radius_m."""
    try:
        with get_db() as db:
            # Bounding box filter for speed
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


init_db()
threading.Thread(target=_transparking_cache_refresh, daemon=True).start()


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
        "user_email": row["user_email"] if "user_email" in row.keys() else "",
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


# ── TomTom helpers ─────────────────────────────────────────────────────────────

def _adr_to_tunnel_code(hazmat_class: str) -> str | None:
    """Map ADR hazmat class to TomTom ADR tunnel restriction code (B/C/D/E)."""
    mapping = {
        "1": "B",  # Explosives
        "2": "C",  # Gases (flammable)
        "3": "D",  # Flammable liquids
        "4": "D",  # Flammable solids
        "5": "D",  # Oxidizers/peroxides
        "6": "D",  # Toxic substances
        "7": "B",  # Radioactive
        "8": "E",  # Corrosive
        "9": "E",  # Miscellaneous
    }
    return mapping.get(str(hazmat_class))


def _tomtom_route_to_geojson(route: dict) -> dict:
    """Convert TomTom route legs[].points[] to GeoJSON LineString."""
    coords = []
    for leg in route.get("legs", []):
        for pt in leg.get("points", []):
            coords.append([pt["longitude"], pt["latitude"]])
    return {"type": "LineString", "coordinates": coords}


# Module-level in-memory cache for map-match results (L1, 5-minute TTL).
# Keyed by route_hash; value is (result_coords, timestamp).
_mm_mem_cache: dict = {}
_MM_MEM_TTL_SEC = 300  # 5 minutes


def _mapbox_map_match(coords: list, max_points: int = 1600) -> list:
    """Snap TomTom route coordinates to the Mapbox road network with caching.

    Cache layers:
      L1 — in-memory dict (TTL 5 min) — avoids repeat calls within a session.
      L2 — SQLite persistent cache (TTL 7 days) — survives server restarts.

    NOTE: This is the only remaining Mapbox API call in the backend.
    It uses the public token (pk.*) for the Map Matching v5 endpoint.
    Mapbox Map Matching has no direct TomTom equivalent with the same
    snapping behaviour, so it is kept but fully cached to minimise calls.
    """
    if not _MAPBOX_TOKEN or len(coords) < 2:
        return coords

    # ── 1. Cache Check ──
    # Hash of first 5, last 5, and total length
    route_sig = coords[:5] + coords[-5:] + [len(coords)]
    route_hash = hashlib.sha256(json.dumps(route_sig).encode()).hexdigest()

    # L1 — in-memory
    _now = time.time()
    if route_hash in _mm_mem_cache:
        cached_coords, cached_ts = _mm_mem_cache[route_hash]
        if _now - cached_ts < _MM_MEM_TTL_SEC:
            return cached_coords
        else:
            del _mm_mem_cache[route_hash]

    # L2 — SQLite persistent cache
    try:
        with get_db() as db:
            row = db.execute(
                "SELECT coords_json, created_at FROM map_match_cache WHERE route_hash=?",
                (route_hash,)
            ).fetchone()
            if row:
                created = datetime.fromisoformat(row["created_at"])
                if (datetime.now(timezone.utc) - created.replace(tzinfo=timezone.utc)).days < 7:
                    hit = json.loads(row["coords_json"])
                    _mm_mem_cache[route_hash] = (hit, time.time())  # promote to L1
                    return hit
    except Exception:
        pass

    # ── 2. Windowed Matching ──
    to_match = coords[:max_points]
    tail     = coords[max_points:]

    CHUNK = 100
    chunks = [to_match[i:i + CHUNK] for i in range(0, len(to_match), CHUNK)]

    def _match_one(chunk: list) -> list:
        coord_str = ";".join(f"{lng},{lat}" for lng, lat in chunk)
        radiuses  = ";".join(["25"] * len(chunk))
        try:
            r = requests.get(
                f"https://api.mapbox.com/matching/v5/mapbox/driving/{coord_str}",
                params={
                    "access_token": _MAPBOX_TOKEN,
                    "geometries":   "geojson",
                    "overview":     "full",
                    "radiuses":     radiuses,
                    "tidy":         "true",
                },
                timeout=10,
            )
            if r.status_code == 200:
                pts: list = []
                for m in r.json().get("matchings", []):
                    pts.extend(m.get("geometry", {}).get("coordinates", []))
                if pts:
                    return pts
        except Exception:
            pass
        return chunk  # fallback

    with ThreadPoolExecutor(max_workers=min(len(chunks), 8)) as ex:
        results = list(ex.map(_match_one, chunks))

    snapped: list = []
    for pts in results:
        snapped.extend(pts)
    
    final_coords = snapped + tail if snapped else coords

    # ── 3. Save to Cache & Cleanup ──
    _mm_mem_cache[route_hash] = (final_coords, time.time())  # L1
    try:
        with get_db() as db:
            db.execute(
                "INSERT OR REPLACE INTO map_match_cache (route_hash, coords_json, created_at) VALUES (?, ?, ?)",
                (route_hash, json.dumps(final_coords), now_iso())
            )
            # TTL Cleanup (older than 7 days)
            db.execute(
                "DELETE FROM map_match_cache WHERE datetime(created_at) < datetime('now', '-7 days')"
            )
            db.commit()
    except Exception:
        pass

    return final_coords


def _tomtom_speed_limits(route: dict) -> list:
    """Build per-coordinate MaxspeedEntry array from TomTom speedLimit sections.

    TomTom sections use startPointIndex/endPointIndex referencing the flat
    legs[].points[] array (same order as _tomtom_route_to_geojson output).
    """
    total_pts = sum(len(leg.get("points", [])) for leg in route.get("legs", []))
    if total_pts == 0:
        return []

    speeds: list = [None] * total_pts

    for sec in route.get("sections", []):
        if sec.get("sectionType") != "SPEED_LIMIT":
            continue
        sl    = sec.get("speedLimit", {})
        value = sl.get("value")
        unit  = sl.get("unit", "KMPH")
        if value is None:
            continue
        speed_kmh = round(value * 1.609) if unit in ("MPH", "mph") else int(value)
        start = sec.get("startPointIndex", 0)
        end   = sec.get("endPointIndex", total_pts - 1)
        for i in range(start, min(end + 1, total_pts)):
            speeds[i] = speed_kmh

    return [
        {"speed": s, "unit": "km/h"} if s is not None else {"unknown": True}
        for s in speeds
    ]


# TomTom maneuver code → Mapbox-compatible direction string
_TT_MANEUVER_DIR = {
    "TURN_LEFT":        "left",
    "TURN_RIGHT":       "right",
    "KEEP_LEFT":        "slight left",
    "KEEP_RIGHT":       "slight right",
    "SHARP_LEFT":       "sharp left",
    "SHARP_RIGHT":      "sharp right",
    "STRAIGHT":         "straight",
    "ROUNDABOUT_CROSS": "straight",
    "U_TURN":           "uturn",
    "ARRIVE":           "straight",
    "DEPART":           "straight",
}


def _tomtom_lane_banner(instr: dict) -> dict | None:
    """Convert TomTom laneGuidance to BannerInstruction sub.components format.

    Returns None when no lane data is available for this instruction.
    The returned object matches the BannerInstruction interface expected by
    the MapScreen lane-guidance UI.
    """
    lg = instr.get("laneGuidance")
    msg = instr.get("message", "")
    
    # Extract signpost text and road numbers from tagged message
    # e.g. "Take <roadNumber>A1</roadNumber> towards <signpostText>Sofia</signpostText>"
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
        # Even without lanes, we might want the signpost info
        return {
            "distanceAlongGeometry": instr.get("routeOffsetInMeters", 0),
            "primary": {
                "text": primary_text,
                "type": instr.get("maneuver", "straight").lower().replace("_", " "),
                "components": components if components else [{"type": "text", "text": primary_text}]
            },
            "sub": None
        }

    lanes = lg.get("lanes", [])
    maneuver   = instr.get("maneuver", "STRAIGHT")
    active_dir = _TT_MANEUVER_DIR.get(maneuver, "straight")

    lane_components = [
        {
            "type":       "lane",
            "text":       "",
            "active":     bool(lane.get("drivable", False)),
            "directions": [active_dir] if lane.get("drivable") else ["none"],
        }
        for lane in lanes
    ]

    return {
        "distanceAlongGeometry": instr.get("routeOffsetInMeters", 0),
        "primary": {
            "text": primary_text,
            "type": maneuver.lower().replace("_", " "),
            "components": components if components else [{"type": "text", "text": primary_text}]
        },
        "sub": {"components": lane_components},
    }


def _tomtom_congestion_geojson(route: dict, geometry: dict) -> dict:
    """Build per-segment congestion FeatureCollection from TomTom traffic sections."""
    coords = geometry.get("coordinates", [])
    sections = [s for s in route.get("sections", []) if s.get("sectionType") == "TRAFFIC"]

    if not sections or len(coords) < 2:
        return {"type": "FeatureCollection", "features": [
            {"type": "Feature", "properties": {"congestion": "unknown"}, "geometry": geometry}
        ]}

    _level = {"JAM": "heavy", "ROAD_WORK": "moderate", "ROAD_CLOSURE": "severe"}
    features = []
    for sec in sections:
        start = sec.get("startPointIndex", 0)
        end   = min(sec.get("endPointIndex", start + 1) + 1, len(coords))
        level = _level.get(sec.get("simpleCategory", ""), "low")
        seg   = coords[start:end]
        if len(seg) >= 2:
            features.append({
                "type": "Feature",
                "properties": {"congestion": level},
                "geometry": {"type": "LineString", "coordinates": seg},
            })

    if not features:
        features = [{"type": "Feature", "properties": {"congestion": "low"}, "geometry": geometry}]
    return {"type": "FeatureCollection", "features": features}


def _tomtom_traffic_alerts(route: dict, geometry: dict) -> list:
    """Build traffic alert bubbles from TomTom traffic sections."""
    coords  = geometry.get("coordinates", [])
    alerts  = []
    for sec in route.get("sections", []):
        if sec.get("sectionType") != "TRAFFIC":
            continue
        category = sec.get("simpleCategory", "")
        if category not in ("JAM", "ROAD_WORK", "ROAD_CLOSURE", "SLOW_TRAFFIC", "DANGEROUS_CONDITIONS"):
            continue
        travel     = sec.get("travelTimeInSeconds", 0)
        no_traffic = sec.get("noTrafficTravelTimeInSeconds", travel)
        delay_min  = max(0, round((travel - no_traffic) / 60))
        # Thresholds per category
        if category == "SLOW_TRAFFIC" and delay_min < 5:
            continue
        if category == "JAM" and delay_min < 2:
            continue
        if category not in ("ROAD_CLOSURE", "ROAD_WORK", "DANGEROUS_CONDITIONS") and delay_min < 2:
            continue
        start_idx = sec.get("startPointIndex", 0)
        end_idx   = sec.get("endPointIndex", 0)
        mid = (start_idx + end_idx) // 2
        if mid >= len(coords):
            continue
        c = coords[mid]
        # Approximate length in km (each coord pair ~100m on highways)
        length_km = round(max(0.1, (end_idx - start_idx) * 0.1), 1)
        sev = (
            "severe"   if category in ("ROAD_CLOSURE", "DANGEROUS_CONDITIONS") else
            "heavy"    if delay_min >= 20 else
            "moderate"
        )
        if category == "ROAD_CLOSURE":
            label = "🚫 Затворен път"
        elif category == "DANGEROUS_CONDITIONS":
            label = "⚠️ Опасен участък"
        elif category == "ROAD_WORK":
            label = f"🚧 Ремонт{f' +{delay_min} мин' if delay_min > 0 else ' (бавно)'}"
        elif category == "SLOW_TRAFFIC":
            label = f"🐢 Бавно +{delay_min} мин"
        elif delay_min >= 60:
            label = f"🛑 +{delay_min // 60}ч {delay_min % 60}мин"
        else:
            label = f"🛑 +{delay_min} мин"
        alerts.append({
            "lat": round(c[1], 5), "lng": round(c[0], 5),
            "delay_min": delay_min, "severity": sev,
            "length_km": length_km, "label": label,
        })
    return alerts[:8]


def _tomtom_search(query: str, lat: float, lng: float, limit: int = 6) -> list:
    """TomTom Fuzzy Search — used for business/POI search and as Google fallback."""
    if not _tomtom_ready:
        return []
    try:
        url = f"https://api.tomtom.com/search/2/search/{requests.utils.quote(query)}.json"
        params: dict = {
            "key":   _TOMTOM_KEY,
            "limit": limit,
        }
        if lat and lng:
            params["lat"]    = lat
            params["lon"]    = lng
            params["radius"] = 100000
        r = requests.get(url, params=params, timeout=8)
        r.raise_for_status()
        results = []
        for item in r.json().get("results", []):
            pos      = item.get("position", {})
            item_lat = pos.get("lat")
            item_lng = pos.get("lon")
            if item_lat is None:
                continue
            name    = (item.get("poi") or {}).get("name") or item.get("address", {}).get("freeformAddress", "")
            address = item.get("address", {}).get("freeformAddress", "")
            dist    = round(_haversine_m(lat, lng, item_lat, item_lng)) if lat else 0
            results.append({
                "name":       name,
                "address":    address,
                "lat":        item_lat,
                "lng":        item_lng,
                "distance_m": dist,
            })
        return results
    except Exception as e:
        app.logger.warning("TomTom search failed for %r: %s", query, e)
        return []


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
    """Geocode destination via TomTom Fuzzy Search."""
    try:
        url = f"https://api.tomtom.com/search/2/search/{requests.utils.quote(destination)}.json"
        params = {
            "key":   _TOMTOM_KEY,
            "limit": 1,
        }
        r = requests.get(url, params=params, timeout=8)
        r.raise_for_status()
        results = r.json().get("results", [])
        if not results:
            return {"error": f"Не намерих '{destination}'"}

        res  = results[0]
        pos  = res.get("position", {})
        lat, lng = pos.get("lat"), pos.get("lon")

        # Check for entry points (gates)
        entry_points = res.get("entryPoints", [])
        if entry_points:
            ep = entry_points[0]
            lat, lng = ep.get("position", {}).get("lat", lat), ep.get("position", {}).get("lon", lng)

        name = (res.get("poi") or {}).get("name") or res.get("address", {}).get("freeformAddress", destination)
        return {"destination": name, "coords": [lng, lat]}
    except Exception as exc:
        app.logger.warning("TomTom navigate_to failed for %r: %s", destination, exc)
        return {"error": str(exc)}


def _tool_suggest_routes(
    destination: str, origin_lat: float, origin_lng: float,
    avoid: list = None, truck_profile: dict = None
) -> dict:
    """Fetch 2-3 route alternatives via TomTom Routing API (travelMode=truck)."""
    try:
        nav = _tool_navigate_to(destination)
        if "error" in nav:
            return {"error": nav["error"]}

        dest_lng, dest_lat = nav["coords"]

        # Avoidance corridor waypoints (Serbia bypass etc.)
        wps        = _get_avoidance_waypoints(origin_lat, origin_lng, dest_lng, avoid)
        all_points = [[origin_lng, origin_lat]] + wps + [[dest_lng, dest_lat]]
        # TomTom location format: lat,lng:lat,lng:...
        locations  = ":".join(f"{p[1]},{p[0]}" for p in all_points)

        url = f"https://api.tomtom.com/routing/1/calculateRoute/{locations}/json"
        params: dict = {
            "key":                  _TOMTOM_KEY,
            "travelMode":           "truck",
            "traffic":              "true",
            "computeTravelTimeFor": "all",
            "routeType":            "fastest",
            "maxAlternatives":      2,
            "sectionType":          "traffic",
        }

        # Truck dimensions
        if truck_profile:
            if truck_profile.get("height_m"):
                params["vehicleHeight"] = truck_profile["height_m"]
            if truck_profile.get("width_m"):
                params["vehicleWidth"] = truck_profile["width_m"]
            if truck_profile.get("length_m"):
                params["vehicleLength"] = truck_profile["length_m"]
            if truck_profile.get("weight_t"):
                params["vehicleWeight"] = int(truck_profile["weight_t"] * 1000)  # kg
            if truck_profile.get("axle_count"):
                params["vehicleNumberOfAxles"] = truck_profile["axle_count"]
            hazmat = truck_profile.get("hazmat_class", "none")
            code   = _adr_to_tunnel_code(hazmat)
            if code:
                params["vehicleAdrTunnelRestrictionCode"] = code

        # Road-type avoidance
        avoid_set = {a for a in (avoid or [])}
        if "motorway" in avoid_set:
            params["avoid"] = "motorways"
        elif "toll" in avoid_set:
            params["avoid"] = "tollRoads"
        elif "ferry" in avoid_set:
            params["avoid"] = "ferries"

        r = requests.get(url, params=params, timeout=15)
        r.raise_for_status()
        routes_data = r.json().get("routes", [])

        primary_duration = routes_data[0].get("summary", {}).get("travelTimeInSeconds", 0)

        # ── Map Matching: snap preview geometries to Mapbox road network ──
        preview_rts = routes_data[:3]
        raw_geoms_preview = [_tomtom_route_to_geojson(rt) for rt in preview_rts]
        raw_coords_preview = [g["coordinates"] for g in raw_geoms_preview]

        primary_dist_m = routes_data[0].get("summary", {}).get("lengthInMeters", 0)
        if primary_dist_m > 300_000:
            # Long route (>300 km): skip map matching for preview — raw TomTom is accurate enough
            snapped_preview = raw_coords_preview
        else:
            with ThreadPoolExecutor(max_workers=len(raw_coords_preview)) as _mm_ex:
                snapped_preview = list(_mm_ex.map(_mapbox_map_match, raw_coords_preview))
        for idx_g, g in enumerate(raw_geoms_preview):
            g["coordinates"] = snapped_preview[idx_g]

        colors  = ["#00bfff", "#00ff88", "#ffcc00"]
        labels  = ["Основен маршрут", "Алтернатива 1", "Алтернатива 2"]
        options = []
        for i, rt in enumerate(preview_rts):
            summary   = rt.get("summary", {})
            duration  = summary.get("travelTimeInSeconds", 0)
            distance  = summary.get("lengthInMeters", 0)
            delay_min = round(summary.get("trafficDelayInSeconds", 0) / 60)
            dist_km   = round(distance / 1000)

            # Calculate diff vs primary
            diff_s = duration - primary_duration
            diff_min = round(diff_s / 60)
            diff_str = ""
            if i > 0:
                if diff_min > 0: diff_str = f" (+{diff_min} мин)"
                elif diff_min < 0: diff_str = f" ({diff_min} мин)"
                else: diff_str = " (същото време)"

            dur_h     = int(duration / 3600)
            dur_m     = int((duration % 3600) / 60)
            dur_str   = f"{dur_h}ч {dur_m}мин" if dur_h else f"{dur_m}мин"

            traffic   = "low" if delay_min < 5 else "moderate" if delay_min < 20 else "heavy"
            geometry  = raw_geoms_preview[i]
            options.append({
                "label":              f"{labels[i]} — {dist_km}км, {dur_str}{diff_str}",
                "color":              colors[i],
                "duration":           duration,
                "distance":           distance,
                "diff_min":           diff_min,
                "traffic":            traffic,
                "traffic_delay_min":  delay_min,
                "geometry":           geometry,
                "dest_coords":        [dest_lng, dest_lat],
                "congestion_geojson": _tomtom_congestion_geojson(rt, geometry),
                "traffic_alerts":     _tomtom_traffic_alerts(rt, geometry),
            })

        return {
            "destination": nav["destination"],
            "dest_coords": [dest_lng, dest_lat],
            "options":     options,
        }
    except Exception as exc:
        return {"error": str(exc)}


def _congestion_geojson(geometry: dict, legs: list) -> dict:
    """Split route geometry into per-segment FeatureCollection tagged with congestion level.
    Used by the frontend to color the route line: low=neon, moderate=yellow, heavy/severe=red.
    Samples every 2nd segment on long routes to avoid large payloads (>500 segments).
    """
    coords = geometry.get("coordinates", [])
    features = []
    for leg in legs:
        congs = leg.get("annotation", {}).get("congestion", [])
        step = max(1, len(congs) // 500)  # downsample for long routes
        for i in range(0, len(congs), step):
            if i + 1 < len(coords):
                features.append({
                    "type": "Feature",
                    "properties": {"congestion": congs[i] or "unknown"},
                    "geometry": {"type": "LineString", "coordinates": [coords[i], coords[i + 1]]},
                })
    if not features:
        return {"type": "FeatureCollection", "features": [
            {"type": "Feature", "properties": {"congestion": "unknown"}, "geometry": geometry}
        ]}
    return {"type": "FeatureCollection", "features": features}


def _traffic_alerts(geometry: dict, legs: list) -> list:
    """Find clusters of heavy/severe congestion and return midpoint alert objects.
    Each alert: { lat, lng, delay_min, severity } — shown as '+X мин' bubbles on the map.
    """
    coords = geometry.get("coordinates", [])
    alerts: list = []
    for leg in legs:
        ann  = leg.get("annotation", {})
        cong = ann.get("congestion", [])
        durs = ann.get("duration",   [])
        i = 0
        while i < len(cong):
            if cong[i] in ("heavy", "severe"):
                j, cluster_s = i, 0.0
                while j < len(cong) and cong[j] in ("heavy", "severe"):
                    cluster_s += durs[j] if j < len(durs) else 30
                    j += 1
                # ~50 % of cluster time is wasted in heavy traffic
                delay_min = round(cluster_s * 0.5 / 60)
                mid = (i + j) // 2
                if delay_min >= 2 and mid < len(coords):
                    c = coords[mid]
                    sev = cong[mid]
                    length_km = round((j - i) * 0.05, 1)  # ~50m per segment estimate
                    if delay_min >= 60:
                        label = f"🛑 +{delay_min // 60}ч {delay_min % 60}мин"
                    else:
                        label = f"🛑 +{delay_min} мин"
                    alerts.append({
                        "lat": round(c[1], 5), "lng": round(c[0], 5),
                        "delay_min": delay_min, "severity": sev,
                        "length_km": length_km, "label": label,
                    })
                i = j
            else:
                i += 1
    return alerts[:8]  # max 8 bubbles to avoid clutter


_LOCATION_STOP_WORDS = {
    "до", "в", "на", "от", "при", "около", "край", "близо", "близо до",
    "намери", "намерете", "търси", "покажи", "покажете", "паркинг", "гориво",
    "бензиностанция", "ресторант", "хотел", "спирка", "почивка", "мол",
}

def _extract_location_from_message(msg: str) -> str | None:
    """Extract a location/city name from a user message by stripping stop words.

    E.g. 'паркинг до Русе' → 'Русе'
         'гориво около Пловдив' → 'Пловдив'
    Returns None if no candidate found.
    """
    words = msg.strip().split()
    candidates = [w for w in words if w.lower() not in _LOCATION_STOP_WORDS and len(w) > 2]
    # Return the last candidate (location usually comes last: "паркинг до Русе")
    return candidates[-1] if candidates else None


def _tool_find_truck_parking(lat: float, lng: float, radius_m: int = 20000) -> list:
    """Find truck parking via Mapbox Search Box (parallel) with Overpass fallback."""
    _ck = _poi_cache_key("parking", lat, lng, radius_m)
    _cached = _poi_cache_get(_ck)
    if _cached is not None:
        return _cached
    import concurrent.futures
    results: list = []
    search_r = max(radius_m, 20_000)
    
    def _search_tomtom_parking(query):
        """TomTom Fuzzy Search for truck parking queries — returns list of result dicts."""
        if not _tomtom_ready:
            return []
        try:
            url = f"https://api.tomtom.com/search/2/search/{requests.utils.quote(query)}.json"
            params = {
                "key":       _TOMTOM_KEY,
                "language":  "en-GB",
                "limit":     5,
                "typeahead": "true",
                "lat":       lat,
                "lon":       lng,
                "radius":    max(search_r, 20_000),
            }
            r = requests.get(url, params=params, timeout=5)
            r.raise_for_status()
            return r.json().get("results", [])
        except Exception:
            return []

    try:
        queries = ("truck stop", "truck parking", "hgv parking", "паркинг камион")
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            all_results = list(executor.map(_search_tomtom_parking, queries))

            seen_coords: set = set()
            for items in all_results:
                for item in items:
                    pos = item.get("position", {})
                    el_lat = pos.get("lat")
                    el_lng = pos.get("lon")
                    if el_lat is None or el_lng is None:
                        continue
                    coord_key = (round(el_lat, 4), round(el_lng, 4))
                    if coord_key in seen_coords:
                        continue
                    seen_coords.add(coord_key)
                    dist = round(_haversine_m(lat, lng, el_lat, el_lng))
                    if dist > max(search_r * 15, 300_000):
                        continue
                    poi   = item.get("poi") or {}
                    addr  = item.get("address", {})
                    name  = poi.get("name") or addr.get("freeformAddress", "Truck Parking")
                    phone = (poi.get("phone") or "").strip() or None
                    results.append({
                        "name":          name,
                        "lat":           el_lat,
                        "lng":           el_lng,
                        "paid":          False, "showers": False, "toilets": False, "wifi": False,
                        "security":      False, "lighting": False, "capacity": None,
                        "distance_m":    dist,
                        "opening_hours": None,
                        "phone":         phone,
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
                cap_raw = tags.get("capacity:hgv") or tags.get("capacity:hgv_truck")
                capacity = None
                if cap_raw:
                    try:
                        capacity = int(cap_raw)
                    except (ValueError, TypeError):
                        pass
                results.append({
                    "name":          tags.get("name", "Паркинг за камиони"),
                    "lat":           el_lat,
                    "lng":           el_lng,
                    "paid":          tags.get("fee") in ("yes", "pay"),
                    "showers":       tags.get("shower") in ("yes", "public"),
                    "toilets":       tags.get("toilets") in ("yes", "public") or tags.get("toilet") == "yes",
                    "wifi":          tags.get("internet_access") in ("yes", "wlan", "wifi"),
                    "security":      tags.get("supervised") == "yes" or tags.get("security") == "yes",
                    "lighting":      tags.get("lit") in ("yes", "24/7", "automatic"),
                    "capacity":      capacity,
                    "operator":      tags.get("operator"),
                    "website":       tags.get("website") or tags.get("url") or tags.get("contact:website"),
                    "distance_m":    round(_haversine_m(lat, lng, el_lat, el_lng)),
                    "opening_hours": tags.get("opening_hours"),
                    "phone":         tags.get("phone") or tags.get("contact:phone"),
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

    # Fallback website — link to truckerapps.eu map centred on the parking spot
    for item in deduped:
        # Match with Transparking for deep linking
        tp = _transparking_match(item["lat"], item["lng"])
        if tp:
            item["transparking_url"] = tp["url"]

        if not item.get("website"):
            item["website"] = (
                f"https://truckerapps.eu/search?lat={item['lat']}&lng={item['lng']}"
            )

    _poi_cache_set(_ck, deduped[:8])
    return deduped[:8]


def _build_voice_desc(p: dict) -> str:
    """Build a Bulgarian TTS description summarising parking pros/cons."""
    name = p.get("name", "паркинга")
    dist_km = round(p.get("distance_m", 0) / 1000, 1)
    features: list = []
    if not p.get("paid"):
        features.append("безплатен")
    else:
        features.append("платен")
    if p.get("showers"):
        features.append("с душ")
    if p.get("toilets"):
        features.append("с тоалетни")
    if p.get("wifi"):
        features.append("с WiFi")
    if p.get("security"):
        features.append("охраняем")
    if p.get("lighting"):
        features.append("осветен")
    if p.get("capacity"):
        features.append(f"до {p['capacity']} камиона")
    if p.get("opening_hours"):
        features.append(f"работи {p['opening_hours']}")
    features_str = ", ".join(features) if features else "стандартен паркинг"
    return f"{name} е на {dist_km} километра. {features_str.capitalize()}."


def _tool_calculate_travel_matrix(
    points: list,           # [{"lat": float, "lng": float, "label": str}, ...]
    profile: str = "driving-traffic",
) -> dict:
    """Haversine-based travel matrix — estimates distances and ETA for N points.

    Uses haversine distance with a truck average speed of 80 km/h.
    No external API calls required.
    """
    _TRUCK_SPEED_KMH = 80.0

    if len(points) < 2:
        return {"error": "Нужни са поне 2 точки"}
    pts = points[:10]

    # Build NxN distance matrix (km) using haversine
    n = len(pts)
    dist_matrix: list = []
    for i in range(n):
        row = []
        for j in range(n):
            if i == j:
                row.append(0.0)
            else:
                d_m = _haversine_m(pts[i]["lat"], pts[i]["lng"], pts[j]["lat"], pts[j]["lng"])
                row.append(round(d_m / 1000, 2))
        dist_matrix.append(row)

    pairs = []
    for i in range(n):
        for j in range(n):
            if i != j:
                dist_km = dist_matrix[i][j]
                pairs.append({
                    "from":         pts[i].get("label", f"Точка {i + 1}"),
                    "to":           pts[j].get("label", f"Точка {j + 1}"),
                    "duration_min": round(dist_km / _TRUCK_SPEED_KMH * 60, 1),
                    "distance_km":  dist_km,
                })

    # Nearest-neighbour TSP heuristic starting from first point
    remaining = list(range(1, n))
    order = [0]
    while remaining:
        last = order[-1]
        nearest = min(remaining, key=lambda j: dist_matrix[last][j])
        order.append(nearest)
        remaining.remove(nearest)

    optimal_order = [pts[i].get("label", f"Точка {i + 1}") for i in order]

    return {
        "labels":        [p.get("label", f"Точка {i + 1}") for i, p in enumerate(pts)],
        "pairs":         pairs,
        "optimal_order": optimal_order,
        "summary": (
            f"Оптимален ред на спирките: {' → '.join(optimal_order)}. "
            f"Изчислени {len(pairs)} двойки от {len(pts)} точки. "
            f"(Приблизително, при средна скорост {int(_TRUCK_SPEED_KMH)} км/ч)"
        ),
    }


def _tool_get_reachable_zone(
    lat: float,
    lng: float,
    minutes: int = 30,
    profile: str = "driving-traffic",
) -> dict:
    """Haversine-based reachable zone estimate — no external API call.

    Approximates the area reachable within *minutes* using a truck average
    speed of 80 km/h. Returns a bounding box and radius suitable for nearby
    POI searches.
    """
    _TRUCK_SPEED_KMH = 80.0
    minutes = max(5, min(minutes, 120))
    approx_radius_km = round(_TRUCK_SPEED_KMH * (minutes / 60), 1)

    # 1 degree latitude ≈ 111 km; longitude degree varies with cos(lat)
    import math
    lat_delta = approx_radius_km / 111.0
    lng_delta = approx_radius_km / (111.0 * math.cos(math.radians(lat)))

    return {
        "center":           {"lat": lat, "lng": lng},
        "minutes":          minutes,
        "approx_radius_km": approx_radius_km,
        "bbox": {
            "min_lat": round(lat - lat_delta, 4),
            "max_lat": round(lat + lat_delta, 4),
            "min_lng": round(lng - lng_delta, 4),
            "max_lng": round(lng + lng_delta, 4),
        },
        "summary": (
            f"За {minutes} мин. шофиране при средна скорост {int(_TRUCK_SPEED_KMH)} км/ч "
            f"можеш да достигнеш зона с приблизителен радиус ~{approx_radius_km} км около теб."
        ),
    }


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


def _tool_find_overtaking_restrictions(lat: float, lng: float, radius_m: int = 5000) -> dict:
    """Fetch overtaking restrictions from Overpass API."""
    overpass_url = "https://overpass-api.de/api/interpreter"
    query = f"""
[out:json][timeout:15];
(
  way["overtaking"="no"](around:{radius_m},{lat},{lng});
  way["overtaking:hgv"="no"](around:{radius_m},{lat},{lng});
);
out tags center;
"""
    try:
        r = requests.post(overpass_url, data={"data": query}, timeout=15)
        r.raise_for_status()
        elements = r.json().get("elements", [])
        restrictions = []
        for el in elements:
            tags = el.get("tags", {})
            center = el.get("center", {})
            el_lat = center.get("lat")
            el_lng = center.get("lon")
            if not el_lat: continue
            dist = round(_haversine_m(lat, lng, el_lat, el_lng))
            restrictions.append({
                "lat":        el_lat,
                "lng":        el_lng,
                "type":       "overtaking_no",
                "hgv_only":   tags.get("overtaking:hgv") == "no",
                "distance_m": dist,
            })
        restrictions.sort(key=lambda x: x["distance_m"])
        return {"restrictions": restrictions}
    except Exception:
        return {"restrictions": []}


def _tacho_summary(user_email: str = "") -> dict:
    """
    TachoEngine v2 (EU Regulation 561/2006).
    Calculates continuous (4.5h), daily (9h/10h), weekly (56h), and bi-weekly (90h) limits.
    Supports split breaks (15min + 30min).
    """
    from datetime import date, timedelta, datetime as dt

    today = date.today().isoformat()
    today_dt = date.today()
    week_start_dt = today_dt - timedelta(days=today_dt.weekday())
    prev_week_start_dt = week_start_dt - timedelta(days=7)
    
    week_start = week_start_dt.isoformat()
    prev_week_start = prev_week_start_dt.isoformat()

    DAILY_LIMIT      = 32400   # 9 h (10h x 2 not tracked yet)
    WEEKLY_LIMIT     = 201600  # 56 h
    BIWEEKLY_LIMIT   = 324000  # 90 h
    CONTINUOUS_LIMIT = 16200   # 4.5 h

    with get_db() as db:
        # Today's driving
        row = db.execute(
            "SELECT COALESCE(SUM(driven_seconds),0) AS t FROM tacho_sessions "
            "WHERE date=? AND user_email=? AND type='driving'",
            (today, user_email),
        ).fetchone()
        daily_s = int(row["t"]) if row else 0

        # Current week driving
        row = db.execute(
            "SELECT COALESCE(SUM(driven_seconds),0) AS t FROM tacho_sessions "
            "WHERE date>=? AND user_email=? AND type='driving'",
            (week_start, user_email),
        ).fetchone()
        weekly_s = int(row["t"]) if row else 0
        
        # Previous week driving (for 90h check)
        row = db.execute(
            "SELECT COALESCE(SUM(driven_seconds),0) AS t FROM tacho_sessions "
            "WHERE date>=? AND date<? AND user_email=? AND type='driving'",
            (prev_week_start, week_start, user_email),
        ).fetchone()
        prev_weekly_s = int(row["t"]) if row else 0
        
        # Sessions for today (ordered)
        sessions = db.execute(
            "SELECT type, start_time, end_time, driven_seconds FROM tacho_sessions "
            "WHERE date=? AND user_email=? ORDER BY start_time ASC",
            (today, user_email),
        ).fetchall()

    # Calculate continuous driving and breaks (supporting 15 + 30 split)
    continuous_s = 0
    first_split_done = False
    
    for sess in sessions:
        if sess["type"] == 'driving':
            continuous_s += int(sess["driven_seconds"])
        elif sess["type"] in ('break', 'rest'):
            dur = int(sess["driven_seconds"])
            if dur >= 2700: # 45 min
                continuous_s = 0
                first_split_done = False
            elif dur >= 1800 and first_split_done: # 30 min second part
                continuous_s = 0
                first_split_done = False
            elif dur >= 900: # 15 min first part
                first_split_done = True

    biweekly_s = weekly_s + prev_weekly_s
    rests = _analyze_weekly_rests(user_email, week_start)

    return {
        "daily_driven_s":          daily_s,
        "daily_remaining_s":       max(0, DAILY_LIMIT  - daily_s),
        "daily_driven_h":          round(daily_s  / 3600, 2),
        "daily_remaining_h":       round(max(0, DAILY_LIMIT  - daily_s)  / 3600, 2),
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


def _analyze_weekly_rests(user_email: str, week_start: str) -> dict:
    """Detect daily rest periods this week from gaps between tacho_sessions.

    EU 561/2006 daily rest categories:
      Regular  — >= 11 h (39 600 s) consecutive
      Reduced  — >= 9 h  (32 400 s) but < 11 h  — allowed max 3x per week
    Scans ALL session pairs this week so overnight rests are captured correctly.
    """
    from datetime import datetime as dt

    REGULAR_S        = 39_600   # 11 h
    REDUCED_S        = 32_400   # 9 h
    MAX_REDUCED      = 3

    with get_db() as db:
        sessions = db.execute(
            "SELECT start_time, end_time FROM tacho_sessions "
            "WHERE date >= ? AND user_email = ? AND end_time IS NOT NULL "
            "ORDER BY start_time ASC",
            (week_start, user_email),
        ).fetchall()

    regular = 0
    reduced = 0
    for i in range(len(sessions) - 1):
        try:
            end_t        = dt.fromisoformat(sessions[i]["end_time"])
            next_start_t = dt.fromisoformat(sessions[i + 1]["start_time"])
            gap_s        = (next_start_t - end_t).total_seconds()
            if gap_s >= REGULAR_S:
                regular += 1
            elif gap_s >= REDUCED_S:
                reduced += 1
        except (ValueError, TypeError):
            pass

    return {
        "weekly_regular_rests":    regular,
        "weekly_reduced_rests":    reduced,
        "reduced_rests_remaining": max(0, MAX_REDUCED - reduced),
    }


def _tool_calculate_hos_reach(driven_seconds: int, speed_kmh: float, user_email: str = "") -> dict:
    """Calculates remaining range using the MORE RESTRICTIVE of continuous (4.5 h) or daily (9 h) limit."""
    CONTINUOUS_LIMIT = 16200  # 4.5 h — mandatory 45-min break
    remaining_continuous = max(0, CONTINUOUS_LIMIT - driven_seconds)

    summary = _tacho_summary(user_email)
    remaining_s = min(remaining_continuous, summary["daily_remaining_s"])

    remaining_km = (remaining_s / 3600) * speed_kmh
    h, rest = divmod(int(remaining_s), 3600)
    m = rest // 60
    return {
        "remaining_h":        h,
        "remaining_min":      m,
        "remaining_km":       round(remaining_km),
        "break_needed":       remaining_s <= 0,
        "daily_remaining_h":  summary["daily_remaining_h"],
        "weekly_remaining_h": summary["weekly_remaining_h"],
    }


def _google_places_fallback(query: str, lat: float, lng: float) -> list:
    """Real Google Places fallback if TomTom fails."""
    if not _places_ready:
        return []
    try:
        url = "https://maps.googleapis.com/maps/api/place/textsearch/json"
        params = {
            "query":    query,
            "key":      _GOOGLE_PLACES_KEY,
            "language": "bg",
        }
        if lat and lng:
            params["location"] = f"{lat},{lng}"
            params["radius"]   = 50000
        
        r = requests.get(url, params=params, timeout=8)
        r.raise_for_status()
        
        results = []
        for item in r.json().get("results", []):
            loc      = item.get("geometry", {}).get("location", {})
            item_lat = loc.get("lat")
            item_lng = loc.get("lng")
            if item_lat is None:
                continue
            
            name    = item.get("name")
            address = item.get("formatted_address", "")
            dist    = round(_haversine_m(lat, lng, item_lat, item_lng)) if lat else 0
            
            results.append({
                "name":       name,
                "address":    address,
                "lat":        item_lat,
                "lng":        item_lng,
                "distance_m": dist,
                "source":     "google",
            })
        return results
    except Exception:
        return []


def _tool_search_business(query: str, city: str, lat: float, lng: float) -> list:
    """Search for any business/address/POI using TomTom with Google fallback."""
    q = f"{query} {city}".strip()
    _ck = f"biz:{q.lower()}:{round(lat, 2)}:{round(lng, 2)}"
    _cached = _poi_cache_get(_ck)
    if _cached is not None:
        return _cached
    
    # 1. Try TomTom
    results = _tomtom_search(q, lat, lng, limit=6)
    
    # 2. Fallback to Google if TomTom found nothing
    if not results:
        results = _google_places_fallback(q, lat, lng)
        
    if not results:
        return [{"error": f"Не намерих '{q}'"}]
    
    _poi_cache_set(_ck, results)
    return results


def _enrich_business_with_places(biz: dict) -> dict:
    """
    Enrichment disabled to save Google Cloud credits.
    Returns the business object as-is from Mapbox/OSM data.
    """
    return biz


def _tool_check_traffic(
    origin_lng: float, origin_lat: float, dest_lng: float, dest_lat: float
) -> dict:
    """Check traffic using TomTom Routing API with traffic model.

    Falls back to haversine ETA estimate (80 km/h) if TomTom is unavailable.
    """
    _TRUCK_SPEED_KMH = 80.0

    def _haversine_eta() -> dict:
        dist_km = _haversine_m(origin_lat, origin_lng, dest_lat, dest_lng) / 1000
        eta_min = round(dist_km / _TRUCK_SPEED_KMH * 60, 1)
        return {
            "has_delay":    False,
            "delay_min":    0,
            "duration_min": eta_min,
            "alternative_available": False,
            "note": "Приблизително (без трафик данни)",
        }

    if not _tomtom_ready:
        return _haversine_eta()

    try:
        url = (
            f"https://api.tomtom.com/routing/1/calculateRoute"
            f"/{origin_lat},{origin_lng}:{dest_lat},{dest_lng}/json"
        )
        params = {
            "key":          _TOMTOM_KEY,
            "routeType":    "fastest",
            "traffic":      "true",
            "travelMode":   "truck",
            "vehicleMaxSpeed": 90,
        }
        r = requests.get(url, params=params, timeout=10)
        r.raise_for_status()
        routes = r.json().get("routes", [])
        if not routes:
            return _haversine_eta()

        summary  = routes[0].get("summary", {})
        duration = summary.get("travelTimeInSeconds", 0)
        typical  = summary.get("historicTrafficTravelTimeInSeconds", duration)
        delay    = max(0, duration - typical)

        return {
            "has_delay":    delay > 1200,
            "delay_min":    round(delay / 60),
            "duration_min": round(duration / 60),
            "distance_km":  round(summary.get("lengthInMeters", 0) / 1000, 1),
            "alternative_available": False,
        }
    except Exception as exc:
        return {"error": str(exc)}


def _tool_find_fuel(dest_lat: float, dest_lng: float, radius_m: int = 50000) -> list:
    _ck = _poi_cache_key("fuel", dest_lat, dest_lng, radius_m)
    _cached = _poi_cache_get(_ck)
    if _cached is not None:
        return _cached
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
        _poi_cache_set(_ck, results[:10])
        return results[:10]
    except Exception as exc:
        return [{"error": str(exc)}]


def _tool_add_waypoint(query: str, lat: float, lng: float) -> dict:
    """Search for a POI/place via TomTom Fuzzy Search and return it as a waypoint."""
    if not _tomtom_ready:
        return {"error": "TomTom API не е конфигуриран"}
    try:
        url = f"https://api.tomtom.com/search/2/search/{requests.utils.quote(query)}.json"
        params = {
            "key":    _TOMTOM_KEY,
            "limit":  1,
            "lat":    lat,
            "lon":    lng,
            "radius": 200_000,
        }
        r = requests.get(url, params=params, timeout=8)
        r.raise_for_status()
        results = r.json().get("results", [])
        if not results:
            return {"error": f"Не намерих '{query}'"}

        item    = results[0]
        pos     = item.get("position", {})
        item_lat = pos.get("lat")
        item_lng = pos.get("lon")
        if item_lat is None or item_lng is None:
            return {"error": "Не намерих координати"}

        poi  = item.get("poi") or {}
        addr = item.get("address", {})
        name = poi.get("name") or addr.get("freeformAddress", query)

        # TomTom returns lat/lng; frontend expects [lng, lat] (GeoJSON order)
        return {"name": name, "coords": [item_lng, item_lat]}
    except Exception as exc:
        return {"error": str(exc)}


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return jsonify({
        "status":        "ok",
        "version":       "3.4-MAP-MATCH-CACHE",
        "gpt4o_ready":   _gpt4o_ready,
        "gemini_ready":  _gemini_ready,
        "tomtom_ready":  _tomtom_ready,
        "db":            DB_PATH,
        "timestamp":     now_iso(),
    })


@app.post("/api/routes/match-window")
def match_window():
    """
    Perform windowed map matching for a specific segment of the route.
    Body: { "coords": [[lng,lat], ...], "from_index": int }
    """
    data = _get_body()
    coords = data.get("coords", [])
    from_idx = data.get("from_index", 0)
    
    if not coords or from_idx >= len(coords):
        return jsonify({"coords": []})
    
    # Take window starting from from_idx
    window = coords[from_idx : from_idx + 800]
    matched = _mapbox_map_match(window, max_points=800)
    
    return jsonify({"coords": matched})


@app.get("/api/parking/bbox")
def get_parking_bbox():
    """Fetch parking spots within a bounding box for the Live Parking screen."""
    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "").split(",")[0].strip()
    if _is_rate_limited(ip, limit=60, window_s=60):
        return jsonify({"ok": False, "error": "rate limited"}), 429

    try:
        sw_lat = float(request.args.get("swLat"))
        sw_lng = float(request.args.get("swLng"))
        ne_lat = float(request.args.get("neLat"))
        ne_lng = float(request.args.get("neLng"))
    except (TypeError, ValueError):
        return jsonify({"error": "invalid bbox parameters"}), 400

    try:
        with get_db() as db:
            rows = db.execute(
                """
                SELECT pointid, name, lat, lng 
                FROM transparking_cache 
                WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
                LIMIT 150
                """,
                (sw_lat, ne_lat, sw_lng, ne_lng)
            ).fetchall()

            features = []
            for r in rows:
                features.append({
                    "type": "Feature",
                    "geometry": { "type": "Point", "coordinates": [r["lng"], r["lat"]] },
                    "properties": { 
                        "pointid": r["pointid"], 
                        "name": r["name"],
                        "url": f"https://truckerapps.eu/transparking/en/poi/{r['pointid']}"
                    }
                })
            
            return jsonify({
                "type": "FeatureCollection",
                "features": features
            })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.post("/api/poi-along-route")
def poi_along_route_v2():
    """Fetch truck parking or fuel along a route."""
    data = _get_body()
    coords = data.get("coords", [])
    category = data.get("category", "truck_stop")
    if not coords or len(coords) < 2:
        return jsonify({"pois": []})
    query = "truck stop" if category == "truck_stop" else "petrol station"
    results = _tomtom_along_route(coords, query, limit=12)
    for r in results:
        r["category"] = category
        if category == "truck_stop":
            tp = _transparking_match(r["lat"], r["lng"])
            if tp:
                r["transparking_url"] = tp["url"]
    return jsonify({"pois": results})


@app.post("/api/cameras-along-route")
def cameras_along_route_v2():
    """Fetch speed cameras within bounding box of route."""
    data = _get_body()
    coords = data.get("coords", [])
    if not coords or len(coords) < 2:
        return jsonify({"cameras": []})
    lats = [c[1] for c in coords]
    lngs = [c[0] for c in coords]
    pad = 0.008
    bbox = f"{min(lats)-pad},{min(lngs)-pad},{max(lats)+pad},{max(lngs)+pad}"
    query = (
        f'[out:json][timeout:25];'
        f'('
        f'node["highway"="speed_camera"]({bbox});'
        f'node["enforcement"="speed"]({bbox});'
        f'node["man_made"="surveillance"]["surveillance:type"="camera"]({bbox});'
        f');'
        f'out body;'
    )
    try:
        resp = requests.post("https://overpass-api.de/api/interpreter", data=query, timeout=22)
        elements = resp.json().get("elements", [])
    except Exception:
        return jsonify({"cameras": []})
    cameras = []
    for el in elements:
        tags = el.get("tags", {})
        speed = tags.get("maxspeed", "")
        name = f"📷 Радар {speed} км/ч" if speed else "📷 Радар"
        cameras.append({"lat": el["lat"], "lng": el["lon"], "name": name, "maxspeed": speed, "distance_m": 0, "category": "speed_camera"})
    return jsonify({"cameras": cameras})


@app.route('/api/tacho/live_update', methods=['POST'])
def tacho_live_update():
    """
    Receive live data from BLE tachograph and save it in memory.
    Gemini reads it for every subsequent chat.
    """
    global tacho_live_context
    try:
        data = _get_body()
        ctx = data.get('tacho_live_context', {})

        tacho_live_context = {
            'current_activity':      ctx.get('current_activity', 'unknown'),
            'activity_code':         ctx.get('activity_code', -1),
            'driving_time_left_min': ctx.get('driving_time_left_min', 0),
            'daily_driven_min':      ctx.get('daily_driven_min', 0),
            'speed_kmh':             ctx.get('speed_kmh', 0),
            'timestamp':             ctx.get('timestamp', ''),
        }
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 400


# ── In-memory caches (GPT responses + POI results) ───────────────────────────
import time as _cache_time

_gpt_cache: dict[str, tuple[dict, float]] = {}   # key → (result, expires_at)
_GPT_CACHE_TTL = 600  # 10 minutes

_route_cache: dict[str, tuple[dict, float]] = {}   # key → (result, expires_at)
_ROUTE_CACHE_TTL = 300  # 5 minutes

_poi_cache: dict[str, tuple[list, float]] = {}   # POI results cache
_POI_CACHE_TTL = 600  # 10 minutes


def _poi_cache_key(fn: str, lat: float, lng: float, radius_m: int = 0) -> str:
    """Round coords to ~1 km grid so nearby searches share cache entries."""
    return f"{fn}:{round(lat, 2)}:{round(lng, 2)}:{radius_m}"


def _poi_cache_get(key: str) -> list | None:
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


def _gpt_cache_get(key: str) -> dict | None:
    entry = _gpt_cache.get(key)
    if entry and _cache_time.time() < entry[1]:
        return entry[0]
    _gpt_cache.pop(key, None)
    return None


def _gpt_cache_set(key: str, result: dict) -> None:
    # Limit cache size to 50 entries — evict oldest
    if len(_gpt_cache) >= 500:
        oldest = min(_gpt_cache, key=lambda k: _gpt_cache[k][1])
        _gpt_cache.pop(oldest, None)
    _gpt_cache[key] = (result, _cache_time.time() + _GPT_CACHE_TTL)


# ── GPT-4o map engine (shared internal helper) ────────────────────────────────

def _classify_task_complexity(user_msg: str, tools_called: list) -> str:
    """Returns 'mini' or 'full' based on task complexity."""
    complex_keywords = ["avoid", "restriction", "hos", "legal", "multi",
                        "waypoint", "dangerous", "adr", "weight", "height",
                        "нарушение", "правен", "опасни", "тегло", "височина"]
    msg_lower = user_msg.lower()
    if any(kw in msg_lower for kw in complex_keywords):
        return "full"
    return "mini"


def _run_gpt4o_internal(user_msg: str, history: list, context: dict) -> dict:
    """Core GPT-4o map brain. Returns dict — called by /api/chat and /api/gemini/chat."""
    if not _gpt4o_ready:
        return {
            "ok":    False,
            "error": "GPT-4o не е конфигуриран. Добави OPENAI_API_KEY в backend/.env",
        }

    # Cache check — only for first-turn text queries (no GPS, no history)
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
            f"\n\nDriver GPS: lat={context.get('lat', '?')}, "
            f"lng={context.get('lng', '?')}, "
            f"driven={driven_h:.1f}h, speed={context.get('speed_kmh', 0):.0f}km/h. "
            f"Truck Profile: {prof.get('height_m', 4.0)}m height, "
            f"{prof.get('weight_t', 18)}t weight, {prof.get('width_m', 2.55)}m width, "
            f"{prof.get('length_m', 12)}m length, {prof.get('axle_count', 3)} axles, "
            f"hazmat={prof.get('hazmat_class', 'none')}."
        )
        # Inject country speed limits into GPT-4o system context
        _sl_lines = "\n".join(
            f"  {cc}: urban {u}km/h, rural {r}km/h, motorway {m}km/h"
            for cc, (u, r, m) in _TRUCK_SPEED_LIMITS.items()
        )
        system_txt += f"\n\nTruck speed limits by country (for ETA calculations):\n{_sl_lines}"


    messages = [{"role": "system", "content": system_txt}]
    for h in history:
        messages.append({
            "role": "assistant" if h.get("role") == "model" else "user",
            "content": h.get("text", ""),
        })
    messages.append({"role": "user", "content": user_msg})

    action = None
    accumulated_content = []

    try:
        for turn in range(4):
            gpt_model = "gpt-4o" if _classify_task_complexity(user_msg, []) == "full" else "gpt-4o-mini"
            resp = client.chat.completions.create(
                model=gpt_model,
                messages=messages,
                tools=_TOOLS,
                parallel_tool_calls=False,
                temperature=0.4,
            )
            curr_msg = resp.choices[0].message
            if curr_msg.content:
                accumulated_content.append(curr_msg.content)

            if not curr_msg.tool_calls:
                break

            # Parallel Tool Handling: execute ALL tool calls, but pick one MapAction to return to frontend.
            # Navigation actions (route, add_waypoint) have priority.
            turn_action = None
            turn_results = []

            for call in curr_msg.tool_calls:
                fn   = call.function.name
                args = json.loads(call.function.arguments)

                # GPS correction logic
                user_msg_ctx = context.get("last_message", "")
                driver_lat   = context.get("lat")
                driver_lng   = context.get("lng")

                if driver_lat is not None:
                    location = _extract_location_from_message(user_msg_ctx)
                    if location:
                        gpt_lat = args.get("lat", driver_lat)
                        gpt_lng = args.get("lng", driver_lng)
                        dist_km = ((gpt_lat - driver_lat)**2 + (gpt_lng - driver_lng)**2) ** 0.5 * 111
                        if dist_km < 50:
                            geo = _tool_navigate_to(location)
                            if "coords" in geo:
                                args["lng"], args["lat"] = geo["coords"]
                
                # Tool execution
                res = {"error": "unknown tool"}
                tool_act = None

                if fn == "navigate_to":
                    res = _tool_navigate_to(args["destination"])
                    if "coords" in res:
                        dest_lng, dest_lat = res["coords"]
                        tool_act = {
                            "action":      "route",
                            "destination": res["destination"],
                            "coords":      res["coords"],
                            "waypoints":   _get_avoidance_waypoints(
                                context.get("lat"), context.get("lng"),
                                dest_lng, args.get("avoid"),
                            ),
                        }
                elif fn == "suggest_routes":
                    if "origin_lat" not in args and context.get("lat"):
                        args["origin_lat"] = context["lat"]
                        args["origin_lng"] = context["lng"]
                    truck_prof = args.get("truck_profile") or context.get("profile")
                    res = _tool_suggest_routes(
                        args["destination"],
                        args.get("origin_lat", 42.70), args.get("origin_lng", 23.32),
                        args.get("avoid"), truck_profile=truck_prof
                    )
                    if "options" in res:
                        dest_lng_r = res["dest_coords"][0]
                        forced_wps = _get_avoidance_waypoints(args.get("origin_lat"), args.get("origin_lng"), dest_lng_r, args.get("avoid"))
                        tool_act = {"action": "show_routes", "destination": res["destination"], "dest_coords": res["dest_coords"], "options": res["options"], "waypoints": forced_wps}
                        res = {"destination": res["destination"], "dest_coords": res["dest_coords"], "options": [{k: v for k, v in opt.items() if k not in ("congestion_geojson", "traffic_alerts", "geometry")} for opt in tool_act["options"]]}
                elif fn == "find_truck_parking":
                    raw = _tool_find_truck_parking(args["lat"], args["lng"], args.get("radius_m", 5000))
                    res = raw
                    cards = [{"name": p["name"], "lat": p["lat"], "lng": p["lng"], "distance_m": p["distance_m"], "paid": p.get("paid", False), "showers": p.get("showers", False), "toilets": p.get("toilets", False), "wifi": p.get("wifi", False), "security": p.get("security", False), "lighting": p.get("lighting", False), "capacity": p.get("capacity"), "website": p.get("website"), "opening_hours": p.get("opening_hours"), "phone": p.get("phone"), "voice_desc": _build_voice_desc(p)} for p in raw[:5]]
                    tool_act = {"action": "show_pois", "category": "truck_stop", "cards": cards}
                elif fn == "find_speed_cameras":
                    res = _tool_find_speed_cameras(args["lat"], args["lng"], args.get("radius_m", 10000))
                    cards = [{"name": "📷 Камера {} км/ч".format(cam["maxspeed"]) if cam.get("maxspeed") else "📷 Камера неизвестна скорост", "lat": cam["lat"], "lng": cam["lng"], "distance_m": cam["distance_m"], "maxspeed": cam.get("maxspeed")} for cam in res.get("cameras", [])[:8]]
                    tool_act = {"action": "show_pois", "category": "speed_camera", "cards": cards, "nearest_m": res.get("nearest_m", -1)}
                elif fn == "calculate_hos_reach":
                    res = _tool_calculate_hos_reach(args["driven_seconds"], args["speed_kmh"])
                    rem_h = res["remaining_h"] + res["remaining_min"] / 60
                    suggested_stop = None
                    if rem_h < 0.5 or res["break_needed"]:
                        p_lat, p_lng = context.get("lat"), context.get("lng")
                        if p_lat and p_lng:
                            parkings = _tool_find_truck_parking(p_lat, p_lng, 30_000)
                            if parkings: suggested_stop = {"lat": parkings[0]["lat"], "lng": parkings[0]["lng"], "name": parkings[0]["name"]}
                    tool_act = {"action": "tachograph", "driven_hours": round(args.get("driven_seconds", 0)/3600, 1), "remaining_hours": round(rem_h, 2), "break_needed": res["break_needed"], "suggested_stop": suggested_stop}
                elif fn == "search_business":
                    res = _tool_search_business(args["query"], args.get("city", ""), args["lat"], args["lng"])
                    valid = [b for b in res[:6] if not b.get("error") and b.get("lat")]
                    enriched = list(ThreadPoolExecutor(6).map(_enrich_business_with_places, valid)) if _places_ready and valid else valid
                    cards = [{"name": b.get("name", ""), "lat": b["lat"], "lng": b["lng"], "distance_m": b.get("distance_m", 0), "info": b.get("address", ""), "photo_url": b.get("photo_url"), "review_summary": b.get("review_summary"), "business_status": b.get("business_status"), "open_now": b.get("open_now"), "needs_confirm": b.get("needs_confirm", False)} for b in enriched]
                    tool_act = {"action": "show_pois", "category": "business", "cards": cards}
                elif fn == "add_waypoint":
                    res = _tool_add_waypoint(args["query"], args["lat"], args["lng"])
                    if "coords" in res: tool_act = {"action": "add_waypoint", "name": res["name"], "coords": res["coords"]}
                    else: tool_act = {"action": "message", "text": res.get("error", "Не намерих спирката.")}
                elif fn == "find_fuel_stations":
                    raw = _tool_find_fuel(args["dest_lat"], args["dest_lng"], args.get("radius_m", 50000))
                    res = raw
                    cards = [{"name": s.get("name", "Бензиностанция"), "lat": s["lat"], "lng": s["lng"], "distance_m": s.get("distance_m", 0), "brand": s.get("brand"), "truck_lane": s.get("truck_lane", False), "opening_hours": s.get("opening_hours"), "phone": s.get("phone")} for s in raw[:4] if "lat" in s]
                    tool_act = {"action": "show_pois", "category": "fuel", "cards": cards}
                elif fn == "launch_app":
                    tool_act = {"action": "app", "data": {"app": args["app_name"], "query": args.get("query", "")}}
                    res = {"status": "success", "app": args["app_name"]}
                elif fn == "calculate_travel_matrix":
                    res = _tool_calculate_travel_matrix(args["points"], args.get("profile", "driving-traffic"))
                elif fn == "check_traffic_route":
                    res = _tool_check_traffic(args["origin_lng"], args["origin_lat"], args["dest_lng"], args["dest_lat"])

                if tool_act:
                    if tool_act.get("action") in ("route", "add_waypoint"):
                        turn_action = tool_act
                    elif not turn_action:
                        turn_action = tool_act

                turn_results.append({"role": "tool", "tool_call_id": call.id, "content": json.dumps(res, ensure_ascii=False)})

            messages.append(curr_msg)
            messages.extend(turn_results)
            if turn_action:
                action = turn_action

    except Exception as exc:
        return {"ok": False, "error": str(exc)}

    reply = " ".join(accumulated_content).strip()

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
        elif act_type == "add_waypoint":
            display_text = f"Добавена спирка: {action.get('name', '')}. Преизчислявам маршрута."
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
        # Pure text reply — strip markdown fences then parse JSON wrapper if present
        display_text = reply
        reply_clean = _strip_md_fence(reply)
        if reply_clean.startswith("{"):
            try:
                parsed = json.loads(reply_clean)
                # If GPT returned a full action object, promote it
                if parsed.get("action") and parsed.get("action") != "message":
                    action = parsed
                    display_text = parsed.get("message") or parsed.get("text") or ""
                else:
                    display_text = (
                        parsed.get("text")
                        or parsed.get("message")
                        or reply
                    )
            except json.JSONDecodeError:
                display_text = reply_clean  # clean text without fences

    # Final safety: never expose raw JSON or markdown fences in chat bubble
    _dt = _strip_md_fence(display_text or "")
    if _dt.startswith("{"):
        try:
            _parsed = json.loads(_dt)
            display_text = _parsed.get("text") or _parsed.get("message") or ""
        except Exception:
            display_text = _dt  # pass through as-is if not JSON
    else:
        display_text = _dt

    _db_save_chat(user_msg, display_text)

    if action is None:
        final_action = {"action": "message", "text": display_text or "Не мога да обработя тази заявка."}
    else:
        final_action = {**action, "message": display_text}

    result = {"ok": True, "action": final_action, "reply": display_text}

    # Store text-only responses in cache (skip map actions — location-dependent)
    if _cache_key and action is None:
        _gpt_cache_set(_cache_key, result)

    return result


# ── GPT-4o REST endpoint (thin wrapper) ───────────────────────────────────────

@app.post("/api/chat")
def chat():
    """GPT-4o map brain — thin REST wrapper over _run_gpt4o_internal."""
    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "").split(",")[0].strip()
    if _is_rate_limited(ip, limit=20, window_s=60):
        return jsonify({"ok": False, "error": "Твърде много заявки. Изчакай минута."}), 429
    body = _get_body()
    user_msg = (body.get("message") or "").strip()
    if not user_msg:
        return jsonify({"ok": False, "error": "message is required"}), 400
    result = _run_gpt4o_internal(
        user_msg, body.get("history") or [], body.get("context") or {}
    )
    if not result.get("ok"):
        code = 503 if "конфигуриран" in result.get("error", "") else 500
        return jsonify(result), code
    return jsonify(result)


# ── Gemini AI command chain ────────────────────────────────────────────────────

@app.post("/api/gemini/chat")
def gemini_chat():
    """Gemini 2.0 Flash voice assistant for trucks with parallel GPT pre-fetch."""
    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "").split(",")[0].strip()
    if _is_rate_limited(ip, limit=30, window_s=60):
        return jsonify({"ok": False, "error": "Твърде много заявки. Изчакай минута."}), 429
    if not _gemini_ready:
        if _gpt4o_ready:
            body = _get_body()
            result = _run_gpt4o_internal(
                (body.get("message") or "").strip(),
                body.get("history") or [],
                body.get("context") or {}
            )
            return jsonify({
                "ok": True,
                "reply": result.get("reply", "Разбрах, колега."),
                "action": result.get("action")
            })
        return jsonify({"ok": False, "error": "Gemini не е конфигуриран."}), 503

    body = _get_body()
    user_msg = (body.get("message") or "").strip()
    if not user_msg:
        return jsonify({"ok": False, "error": "message is required"}), 400

    history = body.get("history") or []
    context = body.get("context") or {}
    user_email = (body.get("user_email") or "").strip()

    # Parallel Execution
    with ThreadPoolExecutor(max_workers=2) as executor:
        # Task 1: Gemini Call
        def call_gemini_task():
            # Build conversation for Gemini
            contents = []
            for h in history[-4:]:
                role = "user" if h.get("role") == "user" else "model"
                contents.append({"role": role, "parts": [{"text": h.get("text", "")}]})

            ctx_note = ""
            if context.get("lat"):
                ctx_note += f" [GPS: {context['lat']:.4f},{context['lng']:.4f}]"

            tacho = _tacho_summary(user_email)
            min_remaining_h = round(min(tacho['continuous_remaining_h'], tacho['daily_remaining_h']), 1)
            est_km = round(min_remaining_h * 80)
            ctx_note += (
                f" [ТАХОГРАФ: "
                f"шофирано-непрекъснато {tacho['continuous_driven_h']}ч/4.5ч (остава {tacho['continuous_remaining_h']}ч); "
                f"шофирано-днес {tacho['daily_driven_h']}ч/9ч (остава {tacho['daily_remaining_h']}ч); "
                f"седмично {tacho['weekly_driven_h']}ч/56ч; "
                f"ефективно-остава {min_remaining_h}ч ≈ {est_km}км при 80км/ч]"
            )
            user_memory = context.get("user_memory") or []
            if user_memory:
                ctx_note += " [ПАМЕТ: " + "; ".join(user_memory) + "]"

            # Driver habits context
            driver_habits = context.get("driver_habits")
            if driver_habits:
                ctx_note += f" [НАВИЦИ: {json.dumps(driver_habits, ensure_ascii=False)}]"

            # GPT route insight — inject when nav intent detected and destination in context
            destination = context.get("destination")
            if _has_nav_intent(user_msg) and destination and _gpt4o_ready:
                route_data = _get_gpt_route_insight(str(destination), context)
                if route_data:
                    ctx_note += f" [gpt_route_data: {json.dumps(route_data, ensure_ascii=False)}]"

            internal = f"\n\n[ВЪТРЕШНИ ДАННИ — не цитирай в отговора:{ctx_note}]" if ctx_note else ""
            contents.append({"role": "user", "parts": [{"text": user_msg + internal}]})

            try:
                resp = _gemini_client.models.generate_content(
                    model=_GEMINI_MODEL,
                    contents=contents,
                    config={
                        "system_instruction": _GEMINI_SYSTEM + _build_tacho_context_block(),
                        "temperature": 0.65,
                        "max_output_tokens": 300,
                    },
                )
                return resp.text or ""
            except Exception as gemini_exc:
                print(f"[Gemini] generate_content failed: {gemini_exc}", flush=True)
                if _gpt4o_ready:
                    print("[Gemini] falling back to GPT-4o", flush=True)
                    result = _run_gpt4o_internal(user_msg, history, context)
                    return result.get("reply", "") if isinstance(result, dict) else ""
                raise

        # Task 2: GPT-4o pre-fetch only if message looks like nav intent
        _NAV_HINTS = ["карай", "навигирай", "маршрут", "отиди", "намери", "паркинг",
                      "гориво", "бензин", "дизел", "спирка", "заобиколи", "тунел",
                      "navigate", "route", "go to", "find", "parking", "fuel", "avoid"]
        _likely_nav = any(h in user_msg.lower() for h in _NAV_HINTS)

        def call_gpt_task():
            if not _gpt4o_ready or not _likely_nav:
                return None
            return _run_gpt4o_internal(user_msg, history, context)

        future_gemini = executor.submit(call_gemini_task)
        future_gpt = executor.submit(call_gpt_task)

        try:
            gemini_text = future_gemini.result()
        except Exception as exc:
            print(f"[Gemini Parallel] Error: {str(exc)}", flush=True)
            return jsonify({"ok": False, "error": f"Gemini error: {str(exc)[:100]}"}), 500

    # Process Results
    nav_command, clean_reply = _extract_nav_intent(gemini_text)
    app_intent, clean_reply = _extract_app_intent(clean_reply)
    action = None

    if nav_command and _gpt4o_ready:
        gpt_result = future_gpt.result()
        if gpt_result and gpt_result.get("ok"):
            action = gpt_result.get("action")
            if not clean_reply:
                clean_reply = gpt_result.get("reply", "")

    # Extract <remember> memory tags from reply
    remember_tags = re.findall(r'<remember\s+category="(\w+)">(.*?)</remember>', clean_reply, re.DOTALL)
    clean_reply = re.sub(r'<remember[^>]*>.*?</remember>', '', clean_reply, flags=re.DOTALL).strip()
    remember_items = [{'category': c, 'text': t.strip()} for c, t in remember_tags]

    # Safety: strip raw JSON if Gemini accidentally returned it
    _cr = _strip_md_fence(clean_reply)
    if _cr.startswith("{"):
        try:
            _p = json.loads(_cr)
            clean_reply = _p.get("text") or _p.get("message") or _p.get("reply") or clean_reply
        except Exception:
            pass

    _db_save_chat(user_msg, clean_reply)
    return jsonify({"ok": True, "reply": clean_reply, "action": action, "app_intent": app_intent, "remember": remember_items})


# ── POI endpoints ──────────────────────────────────────────────────────────────

@app.get("/api/pois")
def list_pois():
    category   = request.args.get("category")
    user_email = request.args.get("user_email", "")
    with get_db() as conn:
        if category and user_email:
            rows = conn.execute(
                "SELECT * FROM pois WHERE category = ? AND user_email = ? ORDER BY created_at DESC",
                (category, user_email),
            ).fetchall()
        elif category:
            rows = conn.execute(
                "SELECT * FROM pois WHERE category = ? ORDER BY created_at DESC", (category,)
            ).fetchall()
        elif user_email:
            rows = conn.execute(
                "SELECT * FROM pois WHERE user_email = ? ORDER BY created_at DESC", (user_email,)
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM pois ORDER BY created_at DESC").fetchall()
    return jsonify({"ok": True, "pois": [row_to_poi(r) for r in rows]})


@app.post("/api/pois")
def save_poi():
    body = _get_body()
    name       = (body.get("name") or "").strip()
    lat        = body.get("lat")
    lng        = body.get("lng")
    user_email = body.get("user_email", "")
    if not name or lat is None or lng is None:
        return jsonify({"ok": False, "error": "name, lat, lng are required"}), 400
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO pois (name, address, category, lat, lng, notes, user_email, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (name, body.get("address", ""), body.get("category", "custom"),
             float(lat), float(lng), body.get("notes", ""), user_email, now_iso()),
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


# ── TomTom Route Calculator (called directly from mobile directions.ts) ───────

@app.route("/api/routes/calculate", methods=["POST"])
def calculate_route():
    """
    Calculate a truck-safe route via TomTom Routing API.
    Called by mobile directions.ts instead of Mapbox Directions directly.

    Body: {
      origin:      [lng, lat],
      destination: [lng, lat],
      waypoints:   [[lng, lat], ...],   // optional
      truck: {
        max_height, max_width, max_weight, max_length,
        axle_count, hazmat_class
      },
      depart_at:  "ISO 8601"            // optional
    }
    """
    data        = request.json or {}
    origin      = data.get("origin")
    destination = data.get("destination")
    waypoints   = data.get("waypoints", [])
    truck       = data.get("truck", {})
    depart_at   = data.get("depart_at")
    adr_tunnel_code = data.get("adr_tunnel_code", "none")

    if not origin or not destination:
        return jsonify({"error": "origin and destination required"}), 400
    if not _tomtom_ready:
        return jsonify({"error": "TomTom API key not configured"}), 503

    # Build avoid list early for cache key
    avoid_parts = []
    if adr_tunnel_code in ("D", "E"):
        avoid_parts.append("tunnels")
    elif adr_tunnel_code == "C":
        avoid_parts.append("ferries")
    avoid_unpaved_flag = (
        data.get("avoid_unpaved", False) or
        truck.get("avoidUnpaved", False) or
        truck.get("avoid_unpaved", False)
    )
    if avoid_unpaved_flag:
        avoid_parts.append("unpavedRoads")

    # ── Cache Check ──
    o_lat, o_lng = round(origin[1], 3), round(origin[0], 3)
    d_lat, d_lng = round(destination[1], 3), round(destination[0], 3)
    avoid_key = ",".join(sorted(avoid_parts))
    # Include truck dimensions in cache key for correctness
    truck_key = f"{truck.get('max_height')}:{truck.get('max_weight')}:{truck.get('max_width')}:{truck.get('max_length')}"
    cache_key = f"route:{o_lat},{o_lng}:{d_lat},{d_lng}:{avoid_key}:{str(waypoints)}:{truck_key}"

    now = _cache_time.time()
    if cache_key in _route_cache:
        cached_res, expires_at = _route_cache[cache_key]
        if now < expires_at:
            return jsonify(cached_res)

    all_points = [origin] + waypoints + [destination]
    locations  = ":".join(f"{p[1]},{p[0]}" for p in all_points)
    url        = f"https://api.tomtom.com/routing/1/calculateRoute/{locations}/json"

    params: dict = {
        "key":                  _TOMTOM_KEY,
        "travelMode":           "truck",
        "traffic":              "true",
        "computeTravelTimeFor": "all",
        "routeType":            "fastest",
        "instructionsType":     "tagged",
        "language":             "bg-BG",
        "sectionType":          "traffic",
    }


    if truck.get("max_height"):  params["vehicleHeight"]       = truck["max_height"]
    if truck.get("max_width"):   params["vehicleWidth"]        = truck["max_width"]
    if truck.get("max_weight"):  params["vehicleWeight"]       = int(truck["max_weight"] * 1000)
    if truck.get("max_length"):  params["vehicleLength"]       = truck["max_length"]
    if truck.get("axle_count"):  params["vehicleNumberOfAxles"] = truck["axle_count"]
    code = _adr_to_tunnel_code(truck.get("hazmat_class", "none") or "none")
    if code:
        params["vehicleAdrTunnelRestrictionCode"] = code

    if avoid_parts:
        params["avoid"] = ",".join(avoid_parts)
    if depart_at:
        params["departAt"] = depart_at

    # Request 1 alternative only (reduces Map Matching load)
    params["maxAlternatives"] = 1

    try:
        r = requests.get(url, params=params, timeout=15)
        r.raise_for_status()
        routes_data = r.json().get("routes", [])
        if not routes_data:
            return jsonify({"error": "Няма намерен маршрут"}), 404

        rt       = routes_data[0]
        summary  = rt.get("summary", {})
        geometry = _tomtom_route_to_geojson(rt)

        # Build steps from TomTom guidance instructions (at route level, not inside legs)
        instructions = rt.get("guidance", {}).get("instructions", [])
        total_meters = summary.get("lengthInMeters", 0)
        steps = []
        for i, instr in enumerate(instructions):
            current_offset = instr.get("routeOffsetInMeters", 0)
            next_offset = instructions[i + 1].get("routeOffsetInMeters", 0) if i + 1 < len(instructions) else total_meters
            step_distance = max(0, next_offset - current_offset)
            banner = _tomtom_lane_banner(instr)
            steps.append({
                "maneuver": {
                    "instruction": instr.get("message", ""),
                    "type":        instr.get("maneuver", ""),
                    "modifier":    None,
                },
                "distance":          step_distance,
                "duration":          instr.get("travelTimeInSeconds", 0),
                "name":              instr.get("street", ""),
                "intersections":     [{"location": [instr["point"]["longitude"], instr["point"]["latitude"]]}]
                    if instr.get("point") else [],
                "bannerInstructions": [banner] if banner else [],
            })

        # Build simplified alternatives (geometry + duration + distance only)
        alt_colors = ["#FF8C00", "#9B59B6"]
        alt_labels = ["Алтернатива 1", "Алтернатива 2"]
        alt_routes_data = routes_data[1:3]
        alt_geoms_raw = [_tomtom_route_to_geojson(ar) for ar in alt_routes_data]

        # ── Map Matching: snap ONLY main route to Mapbox road network ──
        # Alternatives keep raw TomTom coords (saves ~60% time, avoids timeout).
        # For long routes snap only the first portion — highway TomTom coords are already accurate.
        if total_meters > 1_000_000:       # > 1000 km: snap first ~20 km only
            mm_points = 200
        elif total_meters > 500_000:       # > 500 km: snap first ~40 km
            mm_points = 400
        elif total_meters > 200_000:       # > 200 km: snap first ~80 km
            mm_points = 800
        else:
            mm_points = 1600               # short route: full snap
        geometry["coordinates"] = _mapbox_map_match(geometry["coordinates"], max_points=mm_points)

        alternatives = []
        for idx, alt_rt in enumerate(alt_routes_data):
            alt_summary  = alt_rt.get("summary", {})
            alt_geom     = alt_geoms_raw[idx]
            alt_dest_coords = destination if isinstance(destination, list) else [0, 0]
            alternatives.append({
                "label":             alt_labels[idx],
                "color":             alt_colors[idx],
                "duration":          alt_summary.get("travelTimeInSeconds", 0),
                "distance":          alt_summary.get("lengthInMeters", 0),
                "traffic":           "moderate",
                "geometry":          alt_geom,
                "dest_coords":       alt_dest_coords,
                "congestion_geojson": _tomtom_congestion_geojson(alt_rt, alt_geom),
            })

        final_res = {
            "geometry":          geometry,
            "distance":          summary.get("lengthInMeters", 0),
            "duration":          summary.get("travelTimeInSeconds", 0),
            "traffic_delay":     summary.get("trafficDelayInSeconds", 0),
            "steps":             steps,
            "maxspeeds":         _tomtom_speed_limits(rt),
            "congestionGeoJSON": _tomtom_congestion_geojson(rt, geometry),
            "traffic_alerts":    _tomtom_traffic_alerts(rt, geometry),
            "restrictions":      _extract_route_restrictions(geometry),
            "alternatives":      alternatives,
        }
        
        # Store in cache
        _route_cache[cache_key] = (final_res, _cache_time.time() + _ROUTE_CACHE_TTL)
        
        return jsonify(final_res)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


# ── Route restriction signs (Overpass) ───────────────────────────────────────

def _extract_route_restrictions(geometry: dict) -> list:
    """
    Query OpenStreetMap (Overpass) for maxheight/maxweight/maxwidth restriction
    nodes within the route bounding box. Called once per route calculation.
    Returns list of {lat, lng, type, value, value_num}.
    """
    coords = geometry.get("coordinates", [])
    if len(coords) < 2:
        return []

    lats = [c[1] for c in coords]
    lngs = [c[0] for c in coords]
    # Bounding box with 200m padding (~0.002 deg)
    south = min(lats) - 0.002
    north = max(lats) + 0.002
    west  = min(lngs) - 0.002
    east  = max(lngs) + 0.002
    bbox  = f"{south},{west},{north},{east}"

    query = f"""
[out:json][timeout:10];
(
  node["maxheight"]({bbox});
  node["maxweight"]({bbox});
  node["maxwidth"]({bbox});
  way["maxheight"]({bbox});
  way["maxweight"]({bbox});
  way["maxwidth"]({bbox});
);
out center 60;
"""
    try:
        r = requests.post(
            "https://overpass-api.de/api/interpreter",
            data={"data": query}, timeout=12,
        )
        r.raise_for_status()
        elements = r.json().get("elements", [])
    except Exception:
        return []

    results = []
    seen: set = set()
    for el in elements:
        tags = el.get("tags", {})
        lat  = el.get("lat") or (el.get("center") or {}).get("lat")
        lng  = el.get("lon") or (el.get("center") or {}).get("lon")
        if lat is None or lng is None:
            continue

        for tag in ("maxheight", "maxweight", "maxwidth"):
            raw = tags.get(tag)
            if not raw:
                continue
            # Parse numeric value (e.g. "3.8", "3.8 m", "5 t", "default" → skip)
            try:
                val_num = float(raw.replace(",", ".").split()[0])
            except (ValueError, IndexError):
                continue
            # Deduplicate within ~100m
            key = (tag, round(lat, 3), round(lng, 3))
            if key in seen:
                continue
            seen.add(key)
            results.append({
                "lat":       lat,
                "lng":       lng,
                "type":      tag,
                "value":     raw,
                "value_num": val_num,
            })

    return results


# ── Truck Restriction Checker ─────────────────────────────────────────────────

@app.route("/api/check-truck-restrictions", methods=["POST"])
def check_truck_restrictions():
    """
    Check if route is compatible with the truck profile.
    Phase 1: static dimension rules (fast, always runs).
    Phase 2: real TomTom truck routing feasibility check (when coords provided).
    Returns a list of human-readable warnings (Bulgarian).
    """
    data    = request.json or {}
    profile = data.get("profile", {})
    coords  = data.get("coords", [])   # [[lng, lat], ...] — origin + destination

    warnings: list = []

    try:
        weight_t = float(profile.get("weight_t") or 0)
        height_m = float(profile.get("height_m") or 0)
        width_m  = float(profile.get("width_m")  or 0)
        hazmat   = str(profile.get("hazmat_class") or "none")
    except (ValueError, TypeError):
        return jsonify({"ok": True, "safe": True, "warnings": []})

    # ── Phase 1: Static dimension rules ──────────────────────────────────────
    if weight_t > 60:
        warnings.append(f"🚫 Теглото {weight_t}т надвишава максималния лимит 60т — пътят може да е забранен")
    elif weight_t > 44:
        warnings.append(f"⚠️ Теглото {weight_t}т надвишава стандартното EU ограничение от 44т")

    if height_m > 4.0:
        warnings.append(f"⚠️ Височина {height_m}м — проверете мостове и тунели (стандарт 4.0м)")

    if width_m > 2.55:
        warnings.append(f"⚠️ Ширина {width_m}м — необходимо специално разрешително (>2.55м)")

    if hazmat and hazmat != "none" and hazmat.isdigit():
        cls = int(hazmat)
        if cls in [1, 2, 3, 4, 5, 6]:
            warnings.append(f"ℹ️ ADR клас {hazmat}: маршрутът автоматично избягва тунели")
        elif cls == 7:
            warnings.append(f"ℹ️ ADR клас 7 (радиоактивно): маршрутът избягва тунели и магистрали")

    # ── Phase 2: TomTom route feasibility check ───────────────────────────────
    # Requires at least origin + destination coordinates and a valid API key.
    if _tomtom_ready and len(coords) >= 2:
        try:
            origin = coords[0]   # [lng, lat]
            dest   = coords[-1]
            locations = f"{origin[1]},{origin[0]}:{dest[1]},{dest[0]}"
            tt_params: dict = {
                "key":        _TOMTOM_KEY,
                "travelMode": "truck",
                "routeType":  "fastest",
                "traffic":    "false",
            }
            if height_m: tt_params["vehicleHeight"]  = height_m
            if width_m:  tt_params["vehicleWidth"]   = width_m
            if weight_t: tt_params["vehicleWeight"]  = int(weight_t * 1000)
            code = _adr_to_tunnel_code(hazmat)
            if code: tt_params["vehicleAdrTunnelRestrictionCode"] = code

            tt_url = f"https://api.tomtom.com/routing/1/calculateRoute/{locations}/json"
            tr = requests.get(tt_url, params=tt_params, timeout=10)

            if tr.status_code == 200:
                tt_routes = tr.json().get("routes", [])
                if not tt_routes:
                    warnings.append("🚫 TomTom: Няма възможен маршрут за камион с тези параметри")
                # No additional warning when route exists — truck is compatible
            elif tr.status_code == 400:
                detail = tr.json().get("detailedError", {}).get("message", "")
                if detail:
                    warnings.append(f"⚠️ TomTom: {detail}")
                else:
                    warnings.append("⚠️ TomTom: Маршрутът не е съвместим с тези размери")
        except Exception:
            pass  # TomTom unavailable — static rules are sufficient

    critical = any("🚫" in w for w in warnings)

    return jsonify({
        "ok":       True,
        "safe":     not critical,
        "warnings": warnings,
    })


@app.get("/api/debug/env")
def debug_env():
    k = os.getenv("GEMINI_API_KEY", "NOT_SET")
    m = os.getenv("GEMINI_MODEL", "NOT_SET")
    return jsonify({"key_prefix": k[:12], "key_len": len(k), "model": m})

# ── Gemini key validation ──────────────────────────────────────────────────────

@app.post("/api/gemini/validate")
def gemini_validate():
    """
    Validate a personal Gemini API key.
    Sends a minimal ping to Gemini and returns ok/error.

    Body: {"api_key": "AIza..."}
    Response: {"ok": true, "model": "gemini-2.0-flash"} | {"ok": false, "error": "..."}
    """
    body = _get_body()
    api_key = (body.get("api_key") or "").strip()
    if not api_key:
        return jsonify({"ok": False, "error": "api_key is required"}), 400

    try:
        test_client = _google_genai.Client(api_key=api_key)
        resp = test_client.models.generate_content(
            model=_GEMINI_MODEL,
            contents=[{"role": "user", "parts": [{"text": "ping"}]}],
            config={"max_output_tokens": 5},
        )
        _ = resp.text  # trigger any auth errors
        return jsonify({"ok": True, "model": _GEMINI_MODEL})
    except Exception as exc:
        err = str(exc)
        if "API_KEY_INVALID" in err or "INVALID_ARGUMENT" in err:
            msg = "Невалиден Gemini API ключ. Провери на ai.google.dev."
        elif "RESOURCE_EXHAUSTED" in err or "429" in err:
            msg = "Gemini API квотата е изчерпана. Изчакай малко и опитай пак."
        else:
            msg = f"Gemini грешка: {err[:120]}"
        return jsonify({"ok": False, "error": msg}), 400


# ── TachoEngine v2 — EU HOS 561/2006 ──────────────────────────────────────────

@app.post("/api/tacho/session")
def tacho_save_session():
    """Save a completed session (driving, break, or rest).

    Body: { user_email, driven_seconds, date (YYYY-MM-DD), start_time, end_time, type }
    Returns summary for the day + week.
    """
    body = _get_body()
    user_email     = (body.get("user_email") or "").strip()
    driven_seconds = int(body.get("driven_seconds") or 0)
    sess_type      = (body.get("type") or "driving").strip()

    if driven_seconds <= 0:
        return jsonify({"ok": False, "error": "driven_seconds must be > 0"}), 400

    from datetime import date
    today      = date.today().isoformat()
    date_str   = (body.get("date") or today).strip()
    start_time = (body.get("start_time") or now_iso()).strip()
    end_time   = (body.get("end_time")   or now_iso()).strip()

    with get_db() as db:
        db.execute(
            "INSERT INTO tacho_sessions (user_email, date, start_time, end_time, driven_seconds, type)"
            " VALUES (?,?,?,?,?,?)",
            (user_email, date_str, start_time, end_time, driven_seconds, sess_type),
        )
        db.commit()

    summary = _tacho_summary(user_email)
    return jsonify({"ok": True, **summary})


@app.get("/api/tacho/summary")
def tacho_get_summary():
    """Return daily + weekly summary for a user.

    Query param: user_email (optional)
    """
    user_email = (request.args.get("user_email") or "").strip()
    return jsonify({"ok": True, **_tacho_summary(user_email)})


@app.get("/api/user/settings")
def get_user_settings():
    """Retrieve per-user settings like Gemini API key from the cloud."""
    user_email = (request.args.get("user_email") or "").strip()
    if not user_email:
        return jsonify({"ok": False, "error": "user_email is required"}), 400
    with get_db() as db:
        row = db.execute("SELECT * FROM user_settings WHERE user_email=?", (user_email,)).fetchone()
        if row:
            return jsonify({"ok": True, "gemini_api_key": row["gemini_api_key"]})
    return jsonify({"ok": True, "gemini_api_key": None})


@app.post("/api/user/settings")
def save_user_settings():
    """Save/update per-user settings in the cloud database."""
    body = _get_body()
    user_email = (body.get("user_email") or "").strip()
    key = (body.get("gemini_api_key") or "").strip()
    if not user_email:
        return jsonify({"ok": False, "error": "user_email is required"}), 400
    with get_db() as db:
        db.execute(
            "INSERT OR REPLACE INTO user_settings (user_email, gemini_api_key, updated_at) "
            "VALUES (?, ?, ?)",
            (user_email, key, now_iso()),
        )
        db.commit()
    return jsonify({"ok": True})


# ── Google Sync (Real implementation) ──────────────────────────────────────────

@app.route("/api/google-sync", methods=["GET", "POST"])
def google_sync():
    """
    Import/Export POIs for Google Account integration.
    GET: List current synced POIs for the user.
    POST: Bulk import POIs from a Google-exported JSON or external list.
    """
    user_email = (request.args.get("user_email") or "").strip()
    if not user_email:
        return jsonify({"ok": False, "error": "user_email is required"}), 400

    if request.method == "GET":
        with get_db() as conn:
            rows = conn.execute(
                "SELECT * FROM pois WHERE user_email = ? AND category = 'google_synced' ORDER BY created_at DESC",
                (user_email,)
            ).fetchall()
        return jsonify({"ok": True, "pois": [row_to_poi(r) for r in rows]})

    if request.method == "POST":
        body = _get_body()
        pois = body.get("pois", [])
        if not pois:
            return jsonify({"ok": False, "error": "No POIs provided for sync"}), 400
        
        imported_count = 0
        with get_db() as conn:
            for p in pois:
                name = (p.get("name") or "").strip()
                lat  = p.get("lat")
                lng  = p.get("lng")
                if name and lat is not None and lng is not None:
                    conn.execute(
                        "INSERT OR REPLACE INTO pois (name, address, category, lat, lng, notes, user_email, created_at) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        (name, p.get("address", ""), "google_synced",
                         float(lat), float(lng), p.get("notes", ""), user_email, now_iso()),
                    )
                    imported_count += 1
            conn.commit()
        return jsonify({"ok": True, "imported": imported_count})


def _tomtom_along_route(coords: list, query: str, max_detour_s: int = 600, limit: int = 10) -> list:
    """Find POIs along a route using TomTom Along Route Search."""
    if not _tomtom_ready or not coords or len(coords) < 2:
        return []
    
    # Downsample coords to ~150 points for TomTom efficiency
    MAX_PTS = 150
    sampled = coords
    if len(coords) > MAX_PTS:
        step = len(coords) // MAX_PTS
        sampled = coords[::step]
    
    # Ensure end point is included if downsampled
    if sampled[-1] != coords[-1]:
        sampled.append(coords[-1])
    
    try:
        # Pre-calculate cumulative distances for sampled route points
        n_pts = len(sampled)
        route_dists = [0.0] * n_pts
        curr_total = 0.0
        for i in range(1, n_pts):
            curr_total += _haversine_m(sampled[i-1][1], sampled[i-1][0], sampled[i][1], sampled[i][0])
            route_dists[i] = curr_total

        url = f"https://api.tomtom.com/search/2/alongRouteSearch/{requests.utils.quote(query)}.json"
        params = {
            "key":           _TOMTOM_KEY,
            "maxDetourTime": max_detour_s,
            "limit":         limit,
            "vehicleType":   "Truck",
            "language":      "bg-BG",
            "spreadingMode": "auto",
        }
        body = {
            "route": {
                "points": [{"lat": c[1], "lon": c[0]} for c in sampled]
            }
        }
        r = requests.post(url, params=params, json=body, timeout=12)
        r.raise_for_status()

        results = []
        for item in r.json().get("results", []):
            pos = item.get("position", {})
            lat, lng = pos.get("lat"), pos.get("lon")
            if lat is None: continue

            # Find nearest point in sampled route to estimate distance_m
            best_dist_to_route = float('inf')
            poi_distance_m = 0
            for i, rp in enumerate(sampled):
                d = _haversine_m(lat, lng, rp[1], rp[0])
                if d < best_dist_to_route:
                    best_dist_to_route = d
                    poi_distance_m = int(route_dists[i])

            poi_data = item.get("poi") or {}
            name = poi_data.get("name") or item.get("address", {}).get("freeformAddress", "Обект")
            brand = (poi_data.get("brands") or [{}])[0].get("name")

            # Check for truck specific lanes (fuel)
            truck_lane = False
            for cat in poi_data.get("categories", []):
                if "truck" in cat.lower(): truck_lane = True

            results.append({
                "name":       name,
                "lat":        lat,
                "lng":        lng,
                "distance_m": poi_distance_m,
                "brand":      brand,
                "truck_lane": truck_lane,
                "info":       item.get("address", {}).get("freeformAddress"),
                "voice_desc": f"Намерих {name} на {(poi_distance_m/1000):.1f} километра по маршрута.",
            })
        return results
    except Exception:
        return []




@app.get("/api/proximity-alerts")
def proximity_alerts():
    """Get speed cameras and overtaking restrictions within a radius (default 10km)."""
    lat = request.args.get("lat", type=float)
    lng = request.args.get("lng", type=float)
    radius_m = request.args.get("radius_m", default=10000, type=int)

    if lat is None or lng is None:
        return jsonify({"ok": False, "error": "lat and lng required"}), 400

    cameras = _tool_find_speed_cameras(lat, lng, radius_m)
    overtaking = _tool_find_overtaking_restrictions(lat, lng, radius_m)

    return jsonify({
        "ok": True,
        "cameras": cameras.get("cameras", []),
        "overtaking": overtaking.get("restrictions", []),
        "nearest_camera_m": cameras.get("nearest_m", -1)
    })


# ── Gemini multimodal audio transcription ────────────────────────────────────

@app.post("/api/gemini/transcribe")
def gemini_transcribe():
    """Gemini multimodal audio transcription (M4A)."""
    if not _gemini_ready:
        return whisper_transcribe() # fallback to Whisper ONLY if gemini_ready is False at startup

    audio_file = request.files.get("audio")
    if not audio_file:
        return jsonify({"ok": False, "error": "No audio file provided."}), 400

    personal_key = (request.form.get("user_api_key") or "").strip()
    is_personal = bool(personal_key)
    
    if is_personal:
        try:
            gemini_client_to_use = _google_genai.Client(api_key=personal_key)
        except Exception:
            gemini_client_to_use = _gemini_client
    else:
        gemini_client_to_use = _gemini_client

    try:
        audio_data = audio_file.read()
        resp = gemini_client_to_use.models.generate_content(
            model=_GEMINI_MODEL,
            contents=[
                {"role": "user", "parts": [
                    {"inline_data": {"data": audio_data, "mime_type": audio_file.mimetype or "audio/m4a"}},
                    {"text": "Transcribe the following Bulgarian speech to text exactly. Return ONLY the text."}
                ]}
            ],
            config={"temperature": 0.0}
        )
        text = (resp.text or "").strip()
        return jsonify({"ok": bool(text), "text": text})
    except Exception as exc:
        print(f"[Gemini Transcribe] Error: {str(exc)}", flush=True)
        return jsonify({"ok": False, "error": "Gemini transcription unavailable"}), 500


# ── Whisper transcription (OpenAI fallback) ───────────────────────────────────

@app.post("/api/transcribe")
def whisper_transcribe():
    """Transcribe audio using OpenAI Whisper (fallback when Gemini unavailable).

    Accepts multipart/form-data with field 'audio'.
    Returns: { ok, text } or { ok: false, error }
    """
    if _gemini_ready:
        return jsonify({"ok": False, "error": "Gemini transcription unavailable"}), 500

    if not _gpt4o_ready:
        return jsonify({"ok": False, "error": "OpenAI не е конфигуриран."}), 503

    audio_file = request.files.get("audio")
    if not audio_file:
        return jsonify({"ok": False, "error": "No audio file provided."}), 400

    try:
        audio_file.stream.seek(0)
        resp = client.audio.transcriptions.create(
            model="whisper-1",
            file=(audio_file.filename or "recording.m4a", audio_file.stream, audio_file.mimetype or "audio/m4a"),
            language="bg",
        )
        text = (resp.text or "").strip()
        return jsonify({"ok": bool(text), "text": text})
    except Exception as exc:
        return jsonify({"ok": False, "error": f"Whisper error: {str(exc)[:120]}"}), 500


# ── Multi-agent orchestration pipeline ────────────────────────────────────────

_ORCHESTRATOR_SYSTEM = (
    "Ти си оркестратор в multi-agent pipeline за камионни шофьори.\n"
    "Получаваш заявка от шофьор и я разбиваш на максимум 3 подзадачи.\n"
    "Всяка подзадача ще бъде изпълнена от Gemini AI работник.\n\n"
    "Отговаряй САМО с валиден JSON масив, без обяснения:\n"
    "[\n"
    "  {\"task\": \"<конкретна подзадача>\", \"context\": \"<допълнителен контекст>\"},\n"
    "  ...\n"
    "]\n\n"
    "Примери за декомпозиция:\n"
    "- 'Безопасно ли е да карам до Германия утре?' →\n"
    "  [{\"task\": \"Провери времеви ограничения за камиони в Германия\", \"context\": \"неделя/почивен ден\"},\n"
    "   {\"task\": \"Провери метеорологични условия по маршрута\", \"context\": \"зима/лошо време\"},\n"
    "   {\"task\": \"Провери HOS лимити за дълго пътуване\", \"context\": \"EU 561/2006\"}]\n"
    "- 'Имам ли нужда от ADR за гориво?' →\n"
    "  [{\"task\": \"Обясни ADR изисквания за горива\", \"context\": \"клас 3 запалими течности\"}]\n"
)

_SYNTHESIZER_SYSTEM = (
    "Ти си финален синтезатор в multi-agent pipeline за камионни шофьори.\n"
    "Получаваш резултати от няколко Gemini AI работника и ги комбинираш.\n"
    "Говори САМО на БЪЛГАРСКИ. Бъди КРАТЪК и ПРАКТИЧЕН (3-5 изречения).\n"
    "Адресирай шофьора като 'Колега'. Фокусирай се върху практичните изводи.\n"
)

_GEMINI_WORKER_SYSTEM = (
    "Ти си специализиран AI работник в multi-agent pipeline за камионни шофьори.\n"
    "Отговаряй САМО на БЪЛГАРСКИ. Бъди точен и конкретен (2-4 изречения).\n"
    "Фокусирай се САМО върху зададената подзадача — не разширявай отговора.\n"
)


def _run_gemini_worker(task: str, context: str) -> str:
    """Executes a single Gemini worker task. Returns text result."""
    prompt = f"Задача: {task}\nКонтекст: {context}"
    try:
        resp = _gemini_client.models.generate_content(
            model=_GEMINI_MODEL,
            contents=prompt,
            config=_google_genai.types.GenerateContentConfig(
                system_instruction=_GEMINI_WORKER_SYSTEM,
                max_output_tokens=300,
            ),
        )
        return resp.text or "(без отговор)"
    except Exception as exc:
        return f"(грешка: {str(exc)[:250]})"


@app.route("/api/orchestrate", methods=["POST"])
def orchestrate():
    """Multi-agent pipeline: Claude orchestrates → Gemini workers → Claude synthesizes."""
    if not _anthropic_ready:
        return jsonify({"ok": False, "error": "Anthropic API не е конфигуриран."}), 503
    if not _gemini_ready:
        return jsonify({"ok": False, "error": "Gemini API не е конфигуриран."}), 503

    ip = request.remote_addr or "unknown"
    if _is_rate_limited(ip, limit=10, window_s=60):
        return jsonify({"ok": False, "error": "Прекалено много заявки. Изчакай малко."}), 429

    data = _get_body()
    user_message = (data.get("message") or "").strip()
    if not user_message:
        return jsonify({"ok": False, "error": "Липсва съобщение."}), 400

    # Step 1 — Claude orchestrator: decompose into subtasks
    try:
        orch_resp = _anthropic_client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=512,
            system=_ORCHESTRATOR_SYSTEM,
            messages=[{"role": "user", "content": user_message}],
        )
        raw_tasks = orch_resp.content[0].text.strip()
        raw_tasks = _strip_md_fence(raw_tasks)
        tasks: list[dict] = json.loads(raw_tasks)
        if not isinstance(tasks, list) or not tasks:
            raise ValueError("Невалиден task list")
        tasks = tasks[:3]  # max 3 subtasks
    except Exception as exc:
        return jsonify({"ok": False, "error": f"Orchestrator грешка: {str(exc)[:120]}"}), 500

    # Step 2 — Gemini workers: execute tasks in parallel
    worker_results: list[str] = [""] * len(tasks)
    with ThreadPoolExecutor(max_workers=len(tasks)) as pool:
        futures = {
            pool.submit(_run_gemini_worker, t.get("task", ""), t.get("context", "")): i
            for i, t in enumerate(tasks)
        }
        for future in as_completed(futures):
            idx = futures[future]
            worker_results[idx] = future.result()

    # Step 3 — Claude synthesizer: combine results into final answer
    synthesis_prompt = (
        f"Оригинална заявка: {user_message}\n\n"
        + "\n\n".join(
            f"Подзадача {i+1} ({tasks[i].get('task', '')}):\n{result}"
            for i, result in enumerate(worker_results)
        )
    )
    try:
        synth_resp = _anthropic_client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=512,
            system=_SYNTHESIZER_SYSTEM,
            messages=[{"role": "user", "content": synthesis_prompt}],
        )
        final_answer = synth_resp.content[0].text.strip()
    except Exception as exc:
        return jsonify({"ok": False, "error": f"Synthesizer грешка: {str(exc)[:120]}"}), 500

    return jsonify({
        "ok": True,
        "answer": final_answer,
        "tasks": [
            {"task": t.get("task", ""), "result": worker_results[i]}
            for i, t in enumerate(tasks)
        ],
    })


@app.route("/api/truck-bans", methods=["GET"])
def get_truck_bans():
    """
    Fetch truck bans for a specific date from trafficban.com with session+header auth.
    Cache for 7 days in truck_bans_cache SQLite table.
    """
    date_str = request.args.get("date")
    if not date_str:
        return jsonify({"bans": [], "error": "date parameter is required"}), 400

    # 1. Check cache (7 days TTL)
    try:
        with get_db() as conn:
            row = conn.execute(
                "SELECT data, fetched_at FROM truck_bans_cache WHERE date = ?",
                (date_str,)
            ).fetchone()

            if row:
                fetched_at_str = row["fetched_at"]
                fetched_at = datetime.fromisoformat(fetched_at_str)
                if fetched_at.tzinfo is None:
                    fetched_at = fetched_at.replace(tzinfo=timezone.utc)
                
                now = datetime.now(timezone.utc)
                if (now - fetched_at).total_seconds() < 604800: # 7 days
                    return jsonify({"bans": json.loads(row["data"])})
    except Exception as e:
        print(f"Truck bans cache check error: {e}")

    # 2. Live fetch from trafficban.com
    session = requests.Session()
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": "https://www.trafficban.com/",
    }

    def fetch_live():
        # Step 1: Init session (visit homepage for cookies)
        session.get("https://www.trafficban.com/", headers=headers, timeout=10)
        
        # Step 2: Get dynamic parameter name from JS file
        js_url = "https://www.trafficban.com/res/js/js.ban.list.for.date.html"
        js_resp = session.get(js_url, headers=headers, timeout=10)
        param_match = re.search(r'\?([K][a-zA-Z0-9]+)=', js_resp.text)
        if not param_match:
            raise ValueError("Could not find dynamic parameter in JS")
        param_name = param_match.group(1)

        # Step 3: Get key for date
        key_headers = headers.copy()
        key_headers.update({
            "Accept": "application/json, text/plain, */*",
            "Origin": "https://www.trafficban.com",
        })
        key_url = f"https://www.trafficban.com/res/json/json.get.key.html?d={date_str}"
        key_resp = session.get(key_url, headers=key_headers, timeout=10)
        key_data = key_resp.json()
        key = key_data.get("key")
        if not key:
            raise ValueError("Could not obtain key for date")

        # Step 4: Get ban list
        bans_url = f"https://www.trafficban.com/res/json/json.ban.list.for.date.html?{param_name}={key}&d={date_str}"
        bans_resp = session.get(bans_url, headers=key_headers, timeout=10)
        raw_bans = bans_resp.json()
        
        # Map fields: fl->flag, cr->country, tm->time, al->alert (bool)
        formatted = []
        for b in raw_bans:
            alert = bool(b.get("al"))
            formatted.append({
                "flag": b.get("fl"),
                "country": b.get("cr"),
                "time": b.get("tm"),
                "alert": alert,
                "note": "Важна забрана" if alert else ""
            })
        return formatted

    try:
        try:
            bans = fetch_live()
        except Exception:
            # Retry once with fresh session
            session.cookies.clear()
            bans = fetch_live()

        # Save to cache
        with get_db() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO truck_bans_cache (date, data, fetched_at) VALUES (?, ?, ?)",
                (date_str, json.dumps(bans), now_iso())
            )
            conn.commit()
        
        return jsonify({"bans": bans})

    except Exception as e:
        print(f"Trafficban.com fetch error: {e}")
        return jsonify({"bans": [], "error": "source unavailable"})



@app.route("/api/places/search", methods=["GET"])
def places_search():
    """
    Google Places Text Search fallback for the mobile SearchBar.
    Called only when TomTom returns 0 results.
    Returns: [{name, address, lat, lng}]
    """
    q   = request.args.get("q", "").strip()
    lat = float(request.args.get("lat", 0) or 0)
    lng = float(request.args.get("lng", 0) or 0)

    if not q or len(q) < 2:
        return jsonify({"results": [], "error": "query too short"})
    if not _places_ready:
        return jsonify({"results": [], "error": "Google Places not configured"})

    ip = request.remote_addr or "unknown"
    if _is_rate_limited(ip, limit=30, window_s=60):
        return jsonify({"results": [], "error": "rate limited"}), 429

    results = _google_places_fallback(q, lat, lng)
    return jsonify({"results": results})


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port  = int(os.getenv("PORT", os.getenv("FLASK_PORT", 5050)))
    debug = os.getenv("FLASK_DEBUG", "true").lower() == "true"
    print(f"TruckAI Pro backend @ http://0.0.0.0:{port}")
    print(f"GPT-4o ready: {_gpt4o_ready}")
    print(f"Gemini model: {_GEMINI_MODEL}")
    app.run(host="0.0.0.0", port=port, debug=debug)
