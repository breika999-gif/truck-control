from flask import Blueprint, jsonify, request
from database import get_db
from utils.helpers import _get_body, now_iso, tacho_live_context
from services.tacho_service import _tacho_summary

tacho_bp = Blueprint('tacho', __name__)

@tacho_bp.route('/api/tacho/live_update', methods=['POST'])
def tacho_live_update():
    global tacho_live_context
    try:
        data = _get_body()
        ctx = data.get('tacho_live_context', {})
        tacho_live_context.update({
            'current_activity':      ctx.get('current_activity', 'unknown'),
            'activity_code':         ctx.get('activity_code', -1),
            'driving_time_left_min': ctx.get('driving_time_left_min', 0),
            'daily_driven_min':      ctx.get('daily_driven_min', 0),
            'speed_kmh':             ctx.get('speed_kmh', 0),
            'timestamp':             ctx.get('timestamp', ''),
        })
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 400

@tacho_bp.post("/api/tacho/session")
def tacho_save_session():
    body = _get_body()
    email, secs, stype = (body.get("user_email") or "").strip(), int(body.get("driven_seconds") or 0), (body.get("type") or "driving").strip()
    if secs <= 0: return jsonify({"ok": False, "error": "driven_seconds must be > 0"}), 400
    with get_db() as db:
        db.execute("INSERT INTO tacho_sessions (user_email, date, start_time, end_time, driven_seconds, type) VALUES (?,?,?,?,?,?)", (email, (body.get("date") or now_iso()[:10]).strip(), (body.get("start_time") or now_iso()).strip(), (body.get("end_time") or now_iso()).strip(), secs, stype))
        db.commit()
    return jsonify({"ok": True, **_tacho_summary(email)})

@tacho_bp.get("/api/tacho/summary")
def tacho_get_summary():
    return jsonify({"ok": True, **_tacho_summary((request.args.get("user_email") or "").strip())})
