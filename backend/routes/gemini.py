import re
import json
from flask import Blueprint, jsonify
from google import genai as _google_genai
from config import (
    GEMINI_MODEL,
    ANTHROPIC_API_KEY,
)
from services.gemini_service import (
    _gemini_client, _gemini_ready, classify_intent, is_simple_message,
    build_gemini_system,
)
from services.gpt_service import _run_gpt4o_internal, _gpt4o_ready, _get_gpt_route_insight
from services.tacho_service import _tacho_summary
from utils.helpers import (
    _is_rate_limited, _get_body, _build_tacho_context_block,
    _extract_nav_intent, _extract_app_intent, _has_nav_intent, _strip_md_fence
)
from database import _db_save_chat

_TACHO_HINTS = ["тахограф", "остава", "стигам", "до колко", "почивка", "пауза", "смяна", "лимит", "седмично", "driving", "remain", "hours", "break"]

gemini_bp = Blueprint('gemini', __name__)



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
    is_simple = is_simple_message(user_msg)
    intent = "general" if is_simple else classify_intent(user_msg)
    has_memory = bool((body.get("context") or {}).get("user_memory"))
    system_instruction = build_gemini_system(intent, has_memory)

    def call_gemini_task():
        contents = []
        history_window = 2 if is_simple else 6
        for h in history[-history_window:]:
            role = "user" if h.get("role") == "user" else "model"
            contents.append({"role": role, "parts": [{"text": h.get("text", "")}]})

        ctx_note = ""
        if context.get("lat"):
            ctx_note += f" [GPS: {context['lat']:.4f},{context['lng']:.4f}]"

        if not context.get("tacho_log") and any(h in user_msg.lower() for h in _TACHO_HINTS):
            tacho = _tacho_summary(user_email)
            min_rem_h = round(min(tacho['continuous_remaining_h'], tacho['daily_remaining_h']), 1)
            est_km = round(min_rem_h * 80)
            
            # Reconstruct detailed tacho note from original implementation
            ctx_note += (
                f" [ТАХОГРАФ: шофирано-непрекъснато {tacho['continuous_remaining_h']}ч/4.5ч; "
                f"днес {tacho['daily_driven_h']}ч/{tacho['daily_limit_h']}ч; "
                f"оставащо днес {tacho['daily_remaining_h']}ч; "
                f"седмично {tacho['weekly_driven_h']}ч/56ч; "
                f"ефективно-остава {min_rem_h}ч ≈ {est_km}км при 80км/ч]"
            )

        ble_block = _build_tacho_context_block(user_email)
        if ble_block:
            ctx_note += ble_block

        # Inject frontend overrides if present
        fe_ctx = ""
        if context.get("shift_start_iso"): fe_ctx += f" shift_start={context['shift_start_iso']};"
        if context.get("daily_driving_limit_h"): fe_ctx += f" daily_limit={context['daily_driving_limit_h']}h;"
        if fe_ctx: ctx_note += f" [FRONTEND_CTX:{fe_ctx}]"

        if context.get("tacho_log"):
            digest = _digest_tacho_log(context["tacho_log"])
            if digest:
                ctx_note += f" [TACHO:{digest}]"

        _week_hints = {"седмично", "седмица", "тази седмица", "weekly", "week", "90ч", "56ч"}
        _habit_hints = {"обичайно", "обикновено", "тръгвам", "спирам", "статистика"}
        msg_lower = user_msg.lower()

        if context.get("tacho_week") and any(h in msg_lower for h in _week_hints):
            ctx_note += _format_ctx_block("TACHO_WEEK", context["tacho_week"])

        if context.get("user_memory"):
            mem = context["user_memory"]
            if isinstance(mem, list) and len(mem) > 10:
                mem = mem[-10:]
            ctx_note += " [ПАМЕТ: " + "; ".join(mem) + "]"
        
        if context.get("driver_habits") and any(h in msg_lower for h in _habit_hints):
            ctx_note += f" [НАВИЦИ:{json.dumps(context['driver_habits'], ensure_ascii=False)}]"

        if _has_nav_intent(user_msg) and context.get("destination") and _gpt4o_ready:
            rd = _get_gpt_route_insight(str(context["destination"]), context)
            if rd: ctx_note += f" [gpt_route_data: {json.dumps(rd, ensure_ascii=False)}]"

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
                _gpt_ctx = {k: context[k] for k in ("lat", "lng", "profile", "speed_kmh") if k in context}
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
        _gpt_ctx = {k: context[k] for k in ("lat", "lng", "profile", "speed_kmh") if k in context}
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

