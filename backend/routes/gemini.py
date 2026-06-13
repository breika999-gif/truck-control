import os
import re
import json
from flask import Blueprint, jsonify
from google import genai as _google_genai
import requests as _requests
from config import (
    GEMINI_MODEL,
    ANTHROPIC_API_KEY,
)
from services.gemini_service import (
    _gemini_client, _gemini_ready, classify_intent, is_simple_message,
    build_gemini_system,
)
from services.gpt_service import _run_gpt4o_internal, _gpt4o_ready
from services.tacho_service import _tacho_summary
from utils.helpers import (
    _is_rate_limited, _get_body, _build_tacho_context_block,
    _extract_nav_intent, _extract_app_intent, _strip_md_fence,
    maybe_reach_answer, require_app_token,
)
from database import _db_save_chat

_WEATHER_CACHE: dict[str, tuple[float, str]] = {}  # key → (expires_ts, result)
_WEATHER_TTL_S = 600  # 10 min

_TACHO_HINTS = [
    "тахограф", "остава", "стигам", "стигна", "докъде", "до къде",
    "каране", "шофиране", "до колко", "почивка", "пауза", "смяна",
    "лимит", "седмично", "driving", "drive", "reach", "remain",
    "hours", "break",
]

gemini_bp = Blueprint('gemini', __name__)

def _fetch_weather(lat, lng):
    import time as _time
    api_key = os.environ.get("OPENWEATHER_KEY", "")
    if not api_key:
        return ""
    cache_key = f"{round(float(lat), 2)},{round(float(lng), 2)}"
    cached = _WEATHER_CACHE.get(cache_key)
    if cached and _time.time() < cached[0]:
        return cached[1]
    try:
        r = _requests.get(
            "https://api.openweathermap.org/data/2.5/weather",
            params={"lat": lat, "lon": lng, "appid": api_key, "units": "metric", "lang": "en"},
            timeout=3,
        )
        if not r.ok:
            return ""
        d = r.json()
        desc = d["weather"][0]["description"]
        temp = round(d["main"]["temp"])
        wind = round(d["wind"]["speed"] * 3.6)
        result = f" [WEATHER_AT_DEST: {desc}, {temp}°C, wind {wind}km/h]"
        _WEATHER_CACHE[cache_key] = (_time.time() + _WEATHER_TTL_S, result)
        return result
    except Exception:
        return ""



def _format_ctx_block(label: str, payload, max_chars: int = 800) -> str:
    try:
        s = json.dumps(payload, ensure_ascii=False)
        if len(s) > max_chars:
            s = s[:max_chars] + "…"
        return f" [{label}:{s}]"
    except Exception:
        return ""


def _digest_tacho_log(tacho_log) -> str:
    if not tacho_log or not isinstance(tacho_log, dict):
        return ""
    segs = tacho_log.get("segments", [])
    driven = sum(s.get("duration_min", 0) for s in segs if s.get("activity") == "DRIVING")
    recent_driving = 0
    for s in reversed(segs):
        if s.get("activity") == "DRIVING":
            recent_driving += s.get("duration_min", 0)
        else:
            break
    rem = tacho_log.get("remaining_drive_min", 0)
    pause_in = max(0, 270 - recent_driving)
    shift = tacho_log.get("shift_start", "")
    return (
        f"карал:{driven}мин непрекъснато:{recent_driving}мин "
        f"остава:{rem}мин пауза_след:{pause_in}мин смяна:{shift}"
    )


@gemini_bp.post("/api/gemini/chat")
@require_app_token
def gemini_chat():
    if _is_rate_limited(limit=30, window_s=60):
        return jsonify({"ok": False, "error": "Твърде много заявки. Изчакай минута."}), 429
    if not _gemini_ready:
        if _gpt4o_ready:
            body = _get_body()
            user_email = (body.get("user_email") or "").strip()
            result = _run_gpt4o_internal((body.get("message") or "").strip(), body.get("history") or [], body.get("context") or {}, user_email=user_email)
            return jsonify({"ok": True, "reply": result.get("reply", "Разбрах, колега."), "action": result.get("action")})
        return jsonify({"ok": False, "error": "Gemini не е конфигуриран."}), 503

    body = _get_body()
    user_msg = (body.get("message") or "").strip()
    if not user_msg: return jsonify({"ok": False, "error": "message is required"}), 400

    history, context, user_email = body.get("history") or [], body.get("context") or {}, (body.get("user_email") or "").strip()
    request_role = (body.get("role") or "").strip()
    reach = maybe_reach_answer(user_msg, context)
    if reach:
        _db_save_chat(user_msg, reach, user_email=user_email)
        return jsonify({"ok": True, "reply": reach, "action": None, "app_intent": None, "remember": []})

    is_simple = is_simple_message(user_msg)
    intent = "tacho" if request_role == "system_summary" else "general" if is_simple else classify_intent(user_msg)
    has_memory = bool((body.get("context") or {}).get("user_memory")) and not is_simple
    system_instruction = build_gemini_system(intent, has_memory)

    # Cost guard: navigation commands need MapAction JSON, so send them straight to
    # the navigation engine instead of spending one Gemini call and then one GPT call.
    if intent == "nav" and _gpt4o_ready:
        gpt_context = dict(context or {})
        gpt_context["last_message"] = user_msg
        gpt_res = _run_gpt4o_internal(user_msg, [], gpt_context, user_email=user_email)
        if not gpt_res.get("ok"):
            code = 503 if "конфигуриран" in gpt_res.get("error", "") else 500
            return jsonify(gpt_res), code
        return jsonify({
            "ok": True,
            "reply": gpt_res.get("reply") or gpt_res.get("text") or "Разбрах, колега.",
            "action": gpt_res.get("action"),
            "app_intent": None,
            "remember": [],
        })

    def call_gemini_task():
        contents = []

        if is_simple:
            # No history, no context — just the message itself
            contents.append({"role": "user", "parts": [{"text": user_msg}]})
        else:
            for h in history[-6:]:
                role = "user" if h.get("role") == "user" else "model"
                contents.append({"role": role, "parts": [{"text": h.get("text", "")}]})

            ctx_note = ""
            msg_lower = user_msg.lower()

            if context.get("lat"):
                ctx_note += f" [GPS: {context['lat']:.4f},{context['lng']:.4f}]"

            if not context.get("tacho_log") and any(h in msg_lower for h in _TACHO_HINTS):
                tacho = _tacho_summary(user_email)
                min_rem_h = round(min(tacho['continuous_remaining_h'], tacho['daily_remaining_h']), 1)
                est_km = round(min_rem_h * 80)
                ctx_note += (
                    f" [ТАХОГРАФ: шофирано-непрекъснато {tacho['continuous_remaining_h']}ч/4.5ч; "
                    f"днес {tacho['daily_driven_h']}ч/{tacho['daily_limit_h']}ч; "
                    f"оставащо днес {tacho['daily_remaining_h']}ч; "
                    f"седмично {tacho['weekly_driven_h']}ч/56ч; "
                    f"ефективно-остава {min_rem_h}ч ≈ {est_km}км при 80км/ч]"
                )

            # BLE tacho: only when tacho-relevant
            if intent == "tacho" or any(h in msg_lower for h in _TACHO_HINTS):
                ble_block = _build_tacho_context_block(user_email)
                if ble_block:
                    ctx_note += ble_block

            fe_ctx = ""
            if context.get("shift_start_iso"): fe_ctx += f" shift_start={context['shift_start_iso']};"
            if context.get("daily_driving_limit_h"): fe_ctx += f" daily_limit={context['daily_driving_limit_h']}h;"
            if context.get("bt_connected") is not None: fe_ctx += f" bt={'on' if context['bt_connected'] else 'off'};"
            if context.get("bt_activity"): fe_ctx += f" activity={context['bt_activity']};"
            if context.get("bt_live_activity"): fe_ctx += f" live_activity={context['bt_live_activity']};"
            if context.get("bt_card") is not None: fe_ctx += f" card={'in' if context['bt_card'] else 'out'};"
            if context.get("bt_driving_time_left_min") is not None: fe_ctx += f" bt_left={context['bt_driving_time_left_min']}min;"
            if context.get("bt_daily_driven_min") is not None: fe_ctx += f" bt_daily={context['bt_daily_driven_min']}min;"
            if context.get("bt_speed_kmh") is not None: fe_ctx += f" bt_speed={context['bt_speed_kmh']}kmh;"
            if context.get("current_time_iso"): fe_ctx += f" now={context['current_time_iso']};"
            if context.get("eta_iso"): fe_ctx += f" eta={context['eta_iso']};"
            if context.get("distance_since_rest_km") is not None: fe_ctx += f" since_rest={context['distance_since_rest_km']}km;"
            if context.get("dest_lat") is not None and context.get("dest_lng") is not None:
                fe_ctx += f" dest={context['dest_lat']},{context['dest_lng']};"
            if fe_ctx: ctx_note += f" [FRONTEND_CTX:{fe_ctx}]"

            if context.get("destination"):
                rd_parts = []
                if context.get("route_distance_km") is not None:
                    rd_parts.append(f"dist={context['route_distance_km']}км")
                if context.get("route_duration_min") is not None:
                    rd_parts.append(f"ест={context['route_duration_min']}мин")
                if context.get("remaining_drive_min") is not None:
                    rd_parts.append(f"остава={context['remaining_drive_min']}мин")
                if rd_parts:
                    ctx_note += f" [МАРШРУТ до {context['destination']}: {' '.join(rd_parts)}]"

            dest_lat = context.get("dest_lat")
            dest_lng = context.get("dest_lng")
            if dest_lat is not None and dest_lng is not None:
                ctx_note += _fetch_weather(dest_lat, dest_lng)

            if context.get("tacho_log"):
                digest = _digest_tacho_log(context["tacho_log"])
                if digest:
                    ctx_note += f" [TACHO:{digest}]"

            _week_hints = {"седмично", "седмица", "тази седмица", "weekly", "week", "90ч", "56ч"}
            _habit_hints = {"обичайно", "обикновено", "тръгвам", "спирам", "статистика"}

            if context.get("tacho_week") and any(h in msg_lower for h in _week_hints):
                ctx_note += _format_ctx_block("TACHO_WEEK", context["tacho_week"])

            if context.get("weekly_status") and (intent == "tacho" or any(h in msg_lower for h in _TACHO_HINTS)):
                ctx_note += _format_ctx_block("WEEKLY_STATUS", context["weekly_status"], max_chars=320)

            if context.get("user_memory"):
                mem = context["user_memory"]
                if isinstance(mem, list) and len(mem) > 10:
                    mem = mem[-10:]
                ctx_note += " [ПАМЕТ: " + "; ".join(mem) + "]"

            if context.get("driver_habits") and any(h in msg_lower for h in _habit_hints):
                ctx_note += f" [НАВИЦИ:{json.dumps(context['driver_habits'], ensure_ascii=False)}]"

            if context.get("parking_cards"):
                ctx_note += f" [PARKING_CARDS:{json.dumps(context['parking_cards'], ensure_ascii=False)[:600]}]"

            contents.append({"role": "user", "parts": [{"text": user_msg + (f"\n\n[ВЪТРЕШНИ ДАННИ:{ctx_note}]" if ctx_note else "")}]})
        
        try:
            resp = _gemini_client.models.generate_content(
                model=GEMINI_MODEL,
                contents=contents,
                config={"system_instruction": system_instruction, "temperature": 0.65, "max_output_tokens": 300},
            )
            return resp.text or ""
        except Exception as e:
            if _gpt4o_ready:
                _gpt_ctx = {k: context[k] for k in (
                    "lat", "lng", "profile", "speed_kmh", "destination",
                    "route_distance_km", "route_duration_min", "remaining_drive_min",
                    "current_time_iso", "eta_iso", "distance_since_rest_km",
                    "dest_lat", "dest_lng",
                    "bt_connected", "bt_activity", "bt_live_activity", "bt_card",
                    "bt_driving_time_left_min", "bt_daily_driven_min", "bt_speed_kmh",
                    "weekly_status", "found_parking", "parking_cards",
                ) if k in context}
                res = _run_gpt4o_internal(user_msg, history, _gpt_ctx)
                return res.get("reply", "") if isinstance(res, dict) else ""
            return f"Грешка: {str(e)}"

    try:
        gemini_text = call_gemini_task()
    except Exception as e:
        return jsonify({"ok": False, "error": f"Gemini error: {str(e)[:100]}"}), 500

    nav_cmd, clean_reply = _extract_nav_intent(gemini_text)
    app_intent, clean_reply = _extract_app_intent(clean_reply)
    
    if nav_cmd and _gpt4o_ready:
        _gpt_ctx = {k: context[k] for k in (
            "lat", "lng", "profile", "speed_kmh", "destination",
            "route_distance_km", "route_duration_min", "remaining_drive_min",
            "current_time_iso", "eta_iso", "distance_since_rest_km",
            "dest_lat", "dest_lng",
            "bt_connected", "bt_activity", "bt_live_activity", "bt_card",
            "bt_driving_time_left_min", "bt_daily_driven_min", "bt_speed_kmh",
            "weekly_status", "found_parking", "parking_cards",
        ) if k in context}
        gpt_res = _run_gpt4o_internal(user_msg, history, _gpt_ctx, user_email=user_email)
    else:
        gpt_res = None
    action = gpt_res.get("action") if gpt_res else None
    
    rem_tags = re.findall(r'<remember\s+category="(\w+)">(.*?)</remember>', clean_reply, re.DOTALL)
    clean_reply = re.sub(r'<remember[^>]*>.*?</remember>', '', clean_reply, flags=re.DOTALL).strip()
    
    _cr = _strip_md_fence(clean_reply)
    if _cr.startswith("{"):
        try: p = json.loads(_cr); clean_reply = p.get("text") or p.get("message") or p.get("reply") or clean_reply
        except: pass

    _db_save_chat(user_msg, clean_reply, user_email=user_email)
    return jsonify({"ok": True, "reply": clean_reply, "action": action, "app_intent": app_intent, "remember": [{'category': c, 'text': t.strip()} for c, t in rem_tags]})

@gemini_bp.post("/api/gemini/validate")
@require_app_token
def gemini_validate():
    body = _get_body()
    api_key = (body.get("api_key") or "").strip()
    if not api_key: return jsonify({"ok": False, "error": "api_key is required"}), 400
    try:
        _google_genai.Client(api_key=api_key).models.generate_content(model=GEMINI_MODEL, contents=[{"role": "user", "parts": [{"text": "ping"}]}], config={"max_output_tokens": 5})
        return jsonify({"ok": True, "model": GEMINI_MODEL})
    except Exception as e:
        err = str(e)
        msg = "Невалиден API ключ." if "API_KEY_INVALID" in err else "Квотата е изчерпана." if "429" in err else f"Грешка: {err[:120]}"
        return jsonify({"ok": False, "error": msg}), 400

