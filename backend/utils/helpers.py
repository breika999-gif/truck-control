import re
import json
import math
import time
from collections import defaultdict
from datetime import datetime, timezone
from flask import request

# ── Global State ────────────────────────────────────────────────────────────
_rate_data: dict = defaultdict(list)  # ip → [timestamp, ...]
tacho_live_context = {}   # Live data from BLE tachograph

# ── Helpers ────────────────────────────────────────────────────────────────────

def _is_rate_limited(ip: str, limit: int, window_s: int = 60) -> bool:
    """Returns True if IP has exceeded `limit` requests in the last `window_s` seconds."""
    now = time.monotonic()
    timestamps = _rate_data[ip]
    _rate_data[ip] = [t for t in timestamps if now - t < window_s]
    if len(_rate_data[ip]) >= limit:
        return True
    _rate_data[ip].append(now)
    return False

def _strip_md_fence(s: str) -> str:
    """Remove ```json ... ``` or ``` ... ``` markdown code fences."""
    s = s.strip()
    s = re.sub(r'^```[a-zA-Z]*\s*', '', s)
    s = re.sub(r'\s*```$', '', s)
    return s.strip()

def _get_body() -> dict:
    """Helper to get JSON body from request safely."""
    try:
        return request.get_json(silent=True) or {}
    except Exception:
        return {}

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6_371_000
    to_rad = math.radians
    d_lat = to_rad(lat2 - lat1)
    d_lng = to_rad(lng2 - lng1)
    a = math.sin(d_lat / 2) ** 2 + (
        math.cos(to_rad(lat1)) * math.cos(to_rad(lat2)) * math.sin(d_lng / 2) ** 2
    )
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

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

from config import NAV_RE, APP_RE, NAV_KEYWORDS, LOCATION_STOP_WORDS

def _extract_nav_intent(text: str):
    m = NAV_RE.search(text)
    if m:
        try:
            data = json.loads(m.group(1))
            clean = (text[:m.start()] + text[m.end():]).strip()
            return data.get("command"), clean
        except Exception:
            pass
    return None, text

def _extract_app_intent(text: str):
    m = APP_RE.search(text)
    if m:
        try:
            data = json.loads(m.group(1))
            clean = (text[:m.start()] + text[m.end():]).strip()
            return data, clean
        except Exception:
            pass
    return None, text

def _has_nav_intent(text: str) -> bool:
    text_lower = text.lower()
    return any(kw in text_lower for kw in NAV_KEYWORDS)

def _extract_location_from_message(msg: str) -> str | None:
    words = msg.strip().split()
    candidates = [w for w in words if w.lower() not in LOCATION_STOP_WORDS and len(w) > 2]
    return candidates[-1] if candidates else None

def _build_voice_desc(p: dict) -> str:
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
