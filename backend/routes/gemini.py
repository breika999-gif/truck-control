import re
import json
from flask import Blueprint, jsonify, request
from concurrent.futures import ThreadPoolExecutor
from google import genai as _google_genai
from config import GEMINI_MODEL, _GEMINI_SYSTEM, ANTHROPIC_API_KEY
from services.gemini_service import _gemini_client, _gemini_ready, _personal_gemini_clients
from services.gpt_service import _run_gpt4o_internal, _gpt4o_ready, _get_gpt_route_insight
from services.tacho_service import _tacho_summary
from utils.helpers import (
    _is_rate_limited, _get_body, _build_tacho_context_block,
    _extract_nav_intent, _extract_app_intent, _has_nav_intent, _strip_md_fence
)
from database import _db_save_chat

gemini_bp = Blueprint('gemini', __name__)

@gemini_bp.post("/api/gemini/chat")
def gemini_chat():
    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "").split(",")[0].strip()
    if _is_rate_limited(ip, limit=30, window_s=60):
        return jsonify({"ok": False, "error": "Твърде много заявки. Изчакай минута."}), 429
    if not _gemini_ready:
        if _gpt4o_ready:
            body = _get_body()
            result = _run_gpt4o_internal((body.get("message") or "").strip(), body.get("history") or [], body.get("context") or {})
            return jsonify({"ok": True, "reply": result.get("reply", "Разбрах, колега."), "action": result.get("action")})
        return jsonify({"ok": False, "error": "Gemini не е конфигуриран."}), 503

    body = _get_body()
    user_msg = (body.get("message") or "").strip()
    if not user_msg: return jsonify({"ok": False, "error": "message is required"}), 400

    history, context, user_email = body.get("history") or [], body.get("context") or {}, (body.get("user_email") or "").strip()

    with ThreadPoolExecutor(max_workers=2) as executor:
        def call_gemini_task():
            contents = []
            for h in history[-4:]:
                role = "user" if h.get("role") == "user" else "model"
                contents.append({"role": role, "parts": [{"text": h.get("text", "")}]})
            ctx_note = f" [GPS: {context['lat']:.4f},{context['lng']:.4f}]" if context.get("lat") else ""
            tacho = _tacho_summary(user_email)
            min_rem_h = round(min(tacho['continuous_remaining_h'], tacho['daily_remaining_h']), 1)
            ctx_note += f" [ТАХОГРАФ: шофирано-непрекъснато {tacho['continuous_driven_h']}ч/4.5ч; днес {tacho['daily_driven_h']}ч/9ч; ефективно-остава {min_rem_h}ч ≈ {round(min_rem_h * 80)}км]"
            if context.get("user_memory"): ctx_note += " [ПАМЕТ: " + "; ".join(context["user_memory"]) + "]"
            if context.get("driver_habits"): ctx_note += f" [НАВИЦИ: {json.dumps(context['driver_habits'], ensure_ascii=False)}]"
            if _has_nav_intent(user_msg) and context.get("destination") and _gpt4o_ready:
                rd = _get_gpt_route_insight(str(context["destination"]), context)
                if rd: ctx_note += f" [gpt_route_data: {json.dumps(rd, ensure_ascii=False)}]"
            contents.append({"role": "user", "parts": [{"text": user_msg + (f"\n\n[ВЪТРЕШНИ ДАННИ:{ctx_note}]" if ctx_note else "")}]})
            resp = _gemini_client.models.generate_content(model=GEMINI_MODEL, contents=contents, config={"system_instruction": _GEMINI_SYSTEM + _build_tacho_context_block(), "temperature": 0.65, "max_output_tokens": 300})
            return resp.text or ""

        _NAV_HINTS = ["карай до", "навигирай", "маршрут до", "отиди до", "паркинг", "гориво", "бензиностанция", "дизел", "добави спирка", "заобиколи", "тунел", "navigate to", "route to", "go to", "find parking", "find fuel", "avoid"]
        likely_nav = any(h in user_msg.lower() for h in _NAV_HINTS)
        def call_gpt_task(): return _run_gpt4o_internal(user_msg, history, context) if _gpt4o_ready and likely_nav else None

        f_gem, f_gpt = executor.submit(call_gemini_task), executor.submit(call_gpt_task)
        try: gemini_text = f_gem.result()
        except Exception as e: return jsonify({"ok": False, "error": f"Gemini error: {str(e)[:100]}"}), 500

    nav_cmd, clean_reply = _extract_nav_intent(gemini_text)
    app_intent, clean_reply = _extract_app_intent(clean_reply)
    action = f_gpt.result().get("action") if nav_cmd and _gpt4o_ready and f_gpt.result() else None
    
    rem_tags = re.findall(r'<remember\s+category="(\w+)">(.*?)</remember>', clean_reply, re.DOTALL)
    clean_reply = re.sub(r'<remember[^>]*>.*?</remember>', '', clean_reply, flags=re.DOTALL).strip()
    
    _cr = _strip_md_fence(clean_reply)
    if _cr.startswith("{"):
        try: p = json.loads(_cr); clean_reply = p.get("text") or p.get("message") or p.get("reply") or clean_reply
        except: pass

    _db_save_chat(user_msg, clean_reply)
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

@gemini_bp.post("/api/gemini/transcribe")
def gemini_transcribe():
    if not _gemini_ready: from routes.misc import whisper_transcribe; return whisper_transcribe()
    audio_file = request.files.get("audio")
    if not audio_file: return jsonify({"ok": False, "error": "No audio file"}), 400
    key = (request.form.get("user_api_key") or "").strip()
    client = _personal_gemini_clients.get(key) or _google_genai.Client(api_key=key) if key else _gemini_client
    if key and key not in _personal_gemini_clients: _personal_gemini_clients[key] = client
    try:
        resp = client.models.generate_content(model=GEMINI_MODEL, contents=[{"role": "user", "parts": [{"inline_data": {"data": audio_file.read(), "mime_type": audio_file.mimetype or "audio/m4a"}}, {"text": "Transcribe the following Bulgarian speech exactly. Return ONLY text."}]}], config={"temperature": 0.0})
        return jsonify({"ok": bool(resp.text), "text": resp.text.strip()})
    except: return jsonify({"ok": False, "error": "Transcription unavailable"}), 500
