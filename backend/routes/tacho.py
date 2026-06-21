from flask import Blueprint, g, jsonify
from database import get_db
from utils.auth import require_auth
from utils.helpers import _get_body, now_iso, tacho_live_context, validate_coords
from services.tacho_service import _tacho_summary

tacho_bp = Blueprint('tacho', __name__)
_REST_TYPES = {"break_45min", "daily_9h", "daily_11h", "reduced_9h"}

@tacho_bp.route('/api/tacho/live_update', methods=['POST'])
@require_auth
def tacho_live_update():
    try:
        data = _get_body()
        ctx = data.get('tacho_live_context', {})
        tacho_live_context.update(g.user_email, {
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
@require_auth
def tacho_save_session():
    body = _get_body()
    email = g.user_email
    secs, stype = int(body.get("driven_seconds") or 0), (body.get("type") or "driving").strip()
    if secs <= 0: return jsonify({"ok": False, "error": "driven_seconds must be > 0"}), 400
    with get_db() as db:
        db.execute("INSERT INTO tacho_sessions (user_email, date, start_time, end_time, driven_seconds, type) VALUES (?,?,?,?,?,?)", (email, (body.get("date") or now_iso()[:10]).strip(), (body.get("start_time") or now_iso()).strip(), (body.get("end_time") or now_iso()).strip(), secs, stype))
        db.commit()
    return jsonify({"ok": True, **_tacho_summary(email)})

@tacho_bp.get("/api/tacho/summary")
@require_auth
def tacho_get_summary():
    return jsonify({"ok": True, **_tacho_summary(g.user_email)})

@tacho_bp.post("/api/rest/log")
@require_auth
def log_rest_stop():
    body = _get_body()
    lat, lng = validate_coords(body.get("lat"), body.get("lng"))
    if lat is None:
        return jsonify({"ok": False, "error": "invalid coordinates"}), 400
    rest_type = (body.get("rest_type") or "").strip()
    if rest_type not in _REST_TYPES:
        return jsonify({"ok": False, "error": "invalid rest_type"}), 400
    try:
        duration_min = int(body.get("duration_min"))
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "invalid duration_min"}), 400
    if duration_min <= 0 or duration_min > 7 * 24 * 60:
        return jsonify({"ok": False, "error": "invalid duration_min"}), 400

    now = now_iso()
    started_at = body.get("started_at") or now
    if not isinstance(started_at, str):
        return jsonify({"ok": False, "error": "invalid started_at"}), 400
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO rest_log (
                user_email, lat, lng, rest_type,
                duration_min, started_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                g.user_email,
                lat, lng, rest_type, duration_min,
                started_at.strip(),
                now,
            ),
        )
        conn.commit()
    return jsonify({"ok": True}), 201
