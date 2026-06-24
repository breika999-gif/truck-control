import re
import json
import math
import os
import time
import threading
from collections import defaultdict
from datetime import datetime, timezone
from functools import wraps
from hmac import compare_digest
from flask import jsonify, request
from utils.redis_client import get_redis

# ── Global State ────────────────────────────────────────────────────────────
_rate_data: dict = defaultdict(list)  # ip → [timestamp, ...]
_rate_lock = threading.Lock()
_RATE_MAX_KEYS = 5000


class TachoLiveContextStore:
    def __init__(self):
        self._fallback = defaultdict(dict)
        self._lock = threading.Lock()

    def get(self, user_email: str) -> dict:
        if not user_email:
            return {}
        try:
            client = get_redis()
            if client is not None:
                values = client.hgetall(f"tacho:{user_email}")
                if values:
                    return {key: json.loads(value) for key, value in values.items()}
        except Exception:
            pass
        return dict(self._fallback.get(user_email) or {})

    def update(self, user_email: str, values: dict) -> None:
        if not user_email:
            return
        try:
            client = get_redis()
            if client is not None:
                key = f"tacho:{user_email}"
                client.hset(key, mapping={name: json.dumps(value) for name, value in values.items()})
                client.expire(key, 3600)
                return
        except Exception:
            pass
        with self._lock:
            self._fallback[user_email].update(values)


tacho_live_context = TachoLiveContextStore()

# ── Helpers ────────────────────────────────────────────────────────────────────

def _is_rate_limited(limit: int, window_s: int = 60) -> bool:
    """Returns True if current request IP has exceeded `limit` requests."""
    ip = request.remote_addr or "unknown"
    try:
        client = get_redis()
        if client is not None:
            key = f"rate:{request.endpoint or 'unknown'}:{ip}:{window_s}"
            count = client.incr(key)
            if count == 1:
                client.expire(key, window_s)
            return count > limit
    except Exception:
        pass

    with _rate_lock:
        now = time.monotonic()
        key = f"{request.endpoint or 'unknown'}:{ip}"
        timestamps = _rate_data[key]
        _rate_data[key] = [t for t in timestamps if now - t < window_s]
        if len(_rate_data[key]) >= limit:
            return True
        _rate_data[key].append(now)
        if len(_rate_data) > _RATE_MAX_KEYS:
            oldest = sorted(_rate_data, key=lambda k: _rate_data[k][-1] if _rate_data[k] else 0)
            for old_key in oldest[:500]:
                _rate_data.pop(old_key, None)
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

def _require_app_token():
    """Reject protected requests unless the configured shared app token matches."""
    expected = os.environ.get("APP_INTERNAL_TOKEN", "")
    provided = request.headers.get("X-App-Token", "")
    if not expected or not compare_digest(provided, expected):
        return jsonify({"ok": False, "error": "forbidden"}), 403
    return None

def require_app_token(fn):
    """Flask decorator for endpoints guarded by the temporary shared app token."""
    @wraps(fn)
    def wrapped(*args, **kwargs):
        auth_error = _require_app_token()
        if auth_error:
            return auth_error
        return fn(*args, **kwargs)
    return wrapped

def validate_coords(lat, lng):
    """Return finite latitude/longitude values inside valid WGS84 ranges."""
    try:
        lat_f, lng_f = float(lat), float(lng)
    except (TypeError, ValueError):
        return None, None
    if not math.isfinite(lat_f) or not math.isfinite(lng_f):
        return None, None
    if not (-90 <= lat_f <= 90) or not (-180 <= lng_f <= 180):
        return None, None
    return lat_f, lng_f

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

def _build_tacho_context_block(user_email: str = "") -> str:
    """Format tacho_live_context for Gemini system prompt."""
    ctx = tacho_live_context.get(user_email) or {} if user_email else {}
    if not ctx:
        return ''

    rem_h  = ctx.get('driving_time_left_min', 0) // 60
    rem_m  = ctx.get('driving_time_left_min', 0) % 60
    drv_h  = ctx.get('daily_driven_min', 0) // 60
    drv_m  = ctx.get('daily_driven_min', 0) % 60

    return f"""
ТАХОГРАФ (live BLE данни):
- Текуща активност: {ctx.get('current_activity', 'unknown')}
- Изкарано днес: {drv_h}ч {drv_m}мин
- Оставащо каране: {rem_h}ч {rem_m}мин
- Скорост от сензор: {ctx.get('speed_kmh', 0)} км/ч
- Последно обновяване: {ctx.get('timestamp', '')}

Ако шофьорът пита за оставащо време или почивка — използвай горните данни.
Ако остават < 30 мин — предупреди проактивно и предложи да потърсиш паркинг.
"""

def _fmt_reach_minutes(minutes: int) -> str:
    hours = minutes // 60
    mins = minutes % 60
    if hours and mins:
        return f"{hours}ч {mins}мин"
    if hours:
        return f"{hours}ч"
    return f"{mins}мин"

TRUCK_SPEED_CAP_KMH = 90

def _num_or_none(value) -> float | None:
    try:
        number = float(str(value).replace(",", "."))
        return number if math.isfinite(number) else None
    except Exception:
        return None

def _extract_requested_drive_minutes(text: str) -> int | None:
    msg = (text or "").lower()
    total = 0

    for match in re.finditer(r"(\d+(?:[.,]\d+)?)\s*(?:ч|час|часа|часове|h|hr|hour|hours)\b", msg):
        hours = _num_or_none(match.group(1))
        if hours is not None:
            total += round(hours * 60)

    for match in re.finditer(r"(\d+(?:[.,]\d+)?)\s*(?:мин|минута|минути|min|mins|minutes)\b", msg):
        mins = _num_or_none(match.group(1))
        if mins is not None:
            total += round(mins)

    return total if total > 0 else None

def _deterministic_reach_reply(user_msg: str, context: dict | None) -> str | None:
    """Answer HOS reach questions deterministically before an LLM guesses."""
    msg = (user_msg or "").lower()
    if not msg:
        return None

    asks_reach = any(
        hint in msg
        for hint in (
            "до къде", "докъде", "къде ще стиг", "ще стигна", "ще стигнем",
            "до каде", "докаде", "каде ще стиг", "къде мога да стиг", "каде мога да стиг",
            "мога ли да стиг", "стигам ли", "reach", "how far", "where can i",
        )
    )
    mentions_driving_time = any(
        hint in msg
        for hint in ("каране", "шофиране", "карам", "шофирам", "driving", "drive")
    )
    requested_min = _extract_requested_drive_minutes(msg)
    context = context or {}
    remaining_min = _num_or_none(context.get("remaining_drive_min"))
    if requested_min is None and remaining_min is not None:
        requested_min = round(remaining_min)

    if not asks_reach or (requested_min is None and not mentions_driving_time):
        return None

    available_min = max(0, int(requested_min or 0))
    if available_min <= 0:
        return "Колега, по текущите данни нямаш оставащо време за каране. Трябва почивка преди да продължиш."

    dest = context.get("destination")
    route_km = _num_or_none(context.get("route_distance_km"))
    route_min = _num_or_none(context.get("route_duration_min"))

    if dest and route_km is not None and route_min is not None and route_min > 0:
        truck_capped_route_min = max(route_min, (route_km / TRUCK_SPEED_CAP_KMH) * 60)

        if available_min >= truck_capped_route_min:
            buffer_min = available_min - round(truck_capped_route_min)
            return (
                f"Колега, стигаш до {dest}: ~{route_km:g}км/~{_fmt_reach_minutes(round(truck_capped_route_min))}. "
                f"Имаш около {buffer_min}мин резерв."
            )

        reachable_km = min(route_km, TRUCK_SPEED_CAP_KMH * available_min / 60)
        remaining_after_min = max(0, round(truck_capped_route_min - available_min))
        remaining_after_km = max(0, route_km - reachable_km)
        return (
            f"Колега, няма да стигнеш до {dest} с {_fmt_reach_minutes(available_min)}. "
            f"Ще минеш около {reachable_km:.0f}км от {route_km:g}км; "
            f"остават ~{remaining_after_km:.0f}км/~{_fmt_reach_minutes(remaining_after_min)}. "
            "Търси почивка преди финала."
        )

    speed_kmh = _num_or_none(context.get("speed_kmh"))
    if speed_kmh is None or speed_kmh < 10:
        speed_kmh = 80
    speed_kmh = min(speed_kmh, TRUCK_SPEED_CAP_KMH)
    reach_km = round(speed_kmh * available_min / 60)
    return (
        f"Колега, за {_fmt_reach_minutes(available_min)} ще стигнеш приблизително {reach_km}км "
        f"при {speed_kmh:g}км/ч. За точна точка ми трябва активен маршрут."
    )

def maybe_reach_answer(user_msg: str, context: dict | None) -> str | None:
    return _deterministic_reach_reply(user_msg, context)

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
    parts = [p.get("name") or "паркинг"]
    dist = p.get("distance_m")
    if dist is not None:
        km = dist / 1000
        parts.append(f"на {km:.1f} км" if km >= 1 else f"на {int(dist)} м")
    tags = []
    if p.get("paid"):
        tags.append("платен")
    else:
        tags.append("безплатен")
    if p.get("showers"):
        tags.append("душове")
    if p.get("toilets"):
        tags.append("тоалетни")
    if p.get("security"):
        tags.append("охрана")
    if p.get("wifi"):
        tags.append("WiFi")
    if p.get("lighting"):
        tags.append("осветен")
    if p.get("capacity"):
        tags.append(f"{p['capacity']} места")
    if tags:
        parts.append(", ".join(tags))
    return ". ".join(parts)
