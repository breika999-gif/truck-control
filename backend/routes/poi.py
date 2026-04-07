import requests
from flask import Blueprint, jsonify, request
from database import get_db, row_to_poi, _transparking_match
from utils.helpers import _is_rate_limited, _get_body, now_iso
from services.tomtom_service import _tomtom_along_route
from services.poi_service import _tool_find_truck_parking, _tool_find_speed_cameras, _tool_find_overtaking_restrictions

poi_bp = Blueprint('poi', __name__)

@poi_bp.get("/api/pois")
def list_pois():
    cat, email = request.args.get("category"), request.args.get("user_email", "")
    with get_db() as conn:
        if cat and email: rows = conn.execute("SELECT * FROM pois WHERE category=? AND user_email=? ORDER BY created_at DESC", (cat, email)).fetchall()
        elif cat: rows = conn.execute("SELECT * FROM pois WHERE category=? ORDER BY created_at DESC", (cat,)).fetchall()
        elif email: rows = conn.execute("SELECT * FROM pois WHERE user_email=? ORDER BY created_at DESC", (email,)).fetchall()
        else: rows = conn.execute("SELECT * FROM pois ORDER BY created_at DESC").fetchall()
    return jsonify({"ok": True, "pois": [row_to_poi(r) for r in rows]})

@poi_bp.post("/api/pois")
def save_poi():
    body = _get_body()
    name, lat, lng, email = (body.get("name") or "").strip(), body.get("lat"), body.get("lng"), body.get("user_email", "")
    if not name or lat is None or lng is None: return jsonify({"ok": False, "error": "name, lat, lng required"}), 400
    with get_db() as conn:
        cur = conn.execute("INSERT INTO pois (name, address, category, lat, lng, notes, user_email, created_at) VALUES (?,?,?,?,?,?,?,?)", (name, body.get("address", ""), body.get("category", "custom"), float(lat), float(lng), body.get("notes", ""), email, now_iso()))
        pid = cur.lastrowid
    row = get_db().execute("SELECT * FROM pois WHERE id=?", (pid,)).fetchone()
    return jsonify({"ok": True, "poi": row_to_poi(row)}), 201

@poi_bp.delete("/api/pois/<int:poi_id>")
def delete_poi(poi_id: int):
    with get_db() as conn: deleted = conn.execute("DELETE FROM pois WHERE id=?", (poi_id,)).rowcount
    return jsonify({"ok": deleted > 0})

@poi_bp.get("/api/parking/bbox")
def get_parking_bbox():
    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "").split(",")[0].strip()
    if _is_rate_limited(ip, 60): return jsonify({"error": "rate limited"}), 429
    try:
        sw_lat, sw_lng = float(request.args.get("swLat")), float(request.args.get("swLng"))
        ne_lat, ne_lng = float(request.args.get("neLat")), float(request.args.get("neLng"))
        with get_db() as db:
            rows = db.execute("SELECT pointid, name, lat, lng FROM transparking_cache WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? LIMIT 150", (sw_lat, ne_lat, sw_lng, ne_lng)).fetchall()
            features = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [r["lng"], r["lat"]]}, "properties": {"pointid": r["pointid"], "name": r["name"], "url": f"https://truckerapps.eu/transparking/en/poi/{r['pointid']}"}} for r in rows]
            return jsonify({"type": "FeatureCollection", "features": features})
    except: return jsonify({"error": "invalid params"}), 400

@poi_bp.post("/api/poi-along-route")
def poi_along_route_v2():
    data = _get_body()
    coords, category = data.get("coords", []), data.get("category", "truck_stop")
    if not coords or len(coords) < 2: return jsonify({"pois": []})
    results = _tomtom_along_route(coords, "truck stop" if category == "truck_stop" else "petrol station", max_detour_s=900, limit=40)
    for r in results:
        r["category"] = category
        if category == "truck_stop":
            tp = _transparking_match(r["lat"], r["lng"])
            if tp: r["transparking_url"] = tp["url"]
    return jsonify({"pois": results})

@poi_bp.post("/api/cameras-along-route")
def cameras_along_route_v2():
    coords = _get_body().get("coords", [])
    if not coords or len(coords) < 2: return jsonify({"cameras": []})
    SEG_SIZE, seen_ids, cameras, pad = 150, set(), [], 0.008
    segments = [coords[i:i+SEG_SIZE] for i in range(0, len(coords), SEG_SIZE)]
    for i, seg in enumerate(segments):
        work_seg = (segments[i-1][-20:] + seg) if i > 0 else seg
        lats, lngs = [c[1] for c in work_seg], [c[0] for c in work_seg]
        bbox = f"{min(lats)-pad},{min(lngs)-pad},{max(lats)+pad},{max(lngs)+pad}"
        q = f'[out:json][timeout:20];(node["highway"="speed_camera"]({bbox});node["enforcement"="speed"]({bbox});node["man_made"="surveillance"]["surveillance:type"="camera"]({bbox}););out body;'
        try:
            resp = requests.post("https://overpass-api.de/api/interpreter", data=q, timeout=18)
            for el in resp.json().get("elements", []):
                if el["id"] in seen_ids: continue
                seen_ids.add(el["id"])
                tags = el.get("tags", {})
                speed = tags.get("maxspeed", "")
                cameras.append({"lat": el["lat"], "lng": el["lon"], "name": f"📷 Радар {speed} км/ч" if speed else "📷 Радар", "maxspeed": speed, "distance_m": 0, "category": "speed_camera"})
        except: continue
    return jsonify({"cameras": cameras})

@poi_bp.get("/api/proximity-alerts")
def proximity_alerts():
    lat, lng = request.args.get("lat", type=float), request.args.get("lng", type=float)
    rad = request.args.get("radius_m", default=10000, type=int)
    if lat is None or lng is None: return jsonify({"ok": False}), 400
    cams = _tool_find_speed_cameras(lat, lng, rad)
    ovt = _tool_find_overtaking_restrictions(lat, lng, rad)
    return jsonify({"ok": True, "cameras": cams.get("cameras", []), "overtaking": ovt.get("restrictions", []), "nearest_camera_m": cams.get("nearest_m", -1)})

@poi_bp.get("/api/places/search")
def places_search():
    from services.poi_service import _google_places_fallback
    q, lat, lng = request.args.get("q", "").strip(), float(request.args.get("lat", 0)), float(request.args.get("lng", 0))
    if len(q) < 2: return jsonify({"results": []})
    return jsonify({"results": _google_places_fallback(q, lat, lng)})
