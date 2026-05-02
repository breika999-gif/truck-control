import math
import requests
from flask import Blueprint, jsonify, request
from database import get_db, row_to_poi, _transparking_match
from utils.helpers import _is_rate_limited, _get_body, now_iso
from services.tomtom_service import _tomtom_along_route
from services.poi_service import _tool_find_truck_parking, _tool_find_speed_cameras, _tool_find_overtaking_restrictions

def _point_to_segment_distance_m(point: list, start: list, end: list) -> float:
    px, py = point[0], point[1]
    ax, ay = start[0], start[1]
    bx, by = end[0], end[1]
    dx, dy = bx - ax, by - ay
    len_sq = dx * dx + dy * dy
    t = 0.0 if len_sq == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / len_sq))
    cx, cy = ax + t * dx, ay + t * dy
    return math.sqrt((cx - px) ** 2 + (cy - py) ** 2) * 111000

def _distance_to_polyline_m(point: list, coords: list) -> float:
    if not coords:
        return float("inf")
    best = min(math.sqrt((point[0] - c[0]) ** 2 + (point[1] - c[1]) ** 2) * 111000 for c in coords)
    for idx in range(len(coords) - 1):
        best = min(best, _point_to_segment_distance_m(point, coords[idx], coords[idx + 1]))
    return best

def _transparking_along_route(coords: list, max_results: int = 20) -> list:
    """Find TransParking truck stops along a route using our local DB."""
    if not coords or len(coords) < 2:
        return []

    cum = [0.0]
    for i in range(1, len(coords)):
        dx = coords[i][0] - coords[i - 1][0]
        dy = coords[i][1] - coords[i - 1][1]
        cum.append(cum[-1] + math.sqrt(dx * dx + dy * dy) * 111000)

    STEP_M = 25_000
    MAX_POINTS = 20

    sample_idxs = []
    next_target = STEP_M
    for i, d in enumerate(cum):
        if d >= next_target:
            sample_idxs.append(i)
            next_target += STEP_M
            if len(sample_idxs) >= MAX_POINTS:
                break

    if not sample_idxs:
        sample_idxs = [len(coords) // 2]

    PAD = 0.09  # ~10 km
    seen, results = set(), []

    with get_db() as db:
        for idx in sample_idxs:
            lng, lat = coords[idx][0], coords[idx][1]
            # NOTE: transparking_cache schema has lat/lng columns swapped —
            # the column named "lat" stores longitude values and vice versa.
            rows = db.execute(
                "SELECT pointid, name, lat, lng FROM transparking_cache "
                "WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? LIMIT 20",
                (lng - PAD, lng + PAD, lat - PAD, lat + PAD)
            ).fetchall()
            for r in rows:
                if r["pointid"] in seen:
                    continue
                seen.add(r["pointid"])
                # Swap back: real_lat = r["lng"], real_lng = r["lat"]
                real_lat, real_lng = r["lng"], r["lat"]
                dist_m = int(math.sqrt((real_lat - lat)**2 + (real_lng - lng)**2) * 111000)
                travel_s = int(dist_m / 22.2)
                results.append({
                    "name": r["name"],
                    "lat": real_lat,
                    "lng": real_lng,
                    "distance_m": dist_m,
                    "travel_time": travel_s,
                    "transparking_id": r["pointid"],
                    "transparking_url": f"https://truckerapps.eu/transparking/en/poi/{r['pointid']}",
                    "paid": True,
                    "category": "truck_stop",
                    "voice_desc": f"Паркинг {r['name']} на {dist_m // 1000} километра от маршрута.",
                })

    results.sort(key=lambda x: x["distance_m"])
    return results[:max_results]

poi_bp = Blueprint('poi', __name__)

@poi_bp.get("/api/pois")
def list_pois():
    email = (request.args.get("user_email") or "").strip()
    if not email: return jsonify({"error": "user_email required"}), 400
    cat = request.args.get("category")
    limit = min(max(request.args.get("limit", default=100, type=int) or 100, 1), 500)
    offset = max(request.args.get("offset", default=0, type=int) or 0, 0)
    with get_db() as conn:
        if cat:
            rows = conn.execute("SELECT * FROM pois WHERE category=? AND user_email=? ORDER BY created_at DESC LIMIT ? OFFSET ?", (cat, email, limit, offset)).fetchall()
        else:
            rows = conn.execute("SELECT * FROM pois WHERE user_email=? ORDER BY created_at DESC LIMIT ? OFFSET ?", (email, limit, offset)).fetchall()
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
    email = (request.args.get("user_email") or _get_body().get("user_email") or "").strip()
    if not email: return jsonify({"ok": False, "error": "email required"}), 400
    with get_db() as conn: 
        deleted = conn.execute("DELETE FROM pois WHERE id=? AND user_email=?", (poi_id, email)).rowcount
        conn.commit()
    return jsonify({"ok": deleted > 0})

@poi_bp.get("/api/parking/bbox")
def get_parking_bbox():
    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "").split(",")[0].strip()
    if _is_rate_limited(ip, 60): return jsonify({"error": "rate limited"}), 429
    try:
        sw_lat, sw_lng = float(request.args.get("swLat")), float(request.args.get("swLng"))
        ne_lat, ne_lng = float(request.args.get("neLat")), float(request.args.get("neLng"))
        with get_db() as db:
            # lat/lng columns are swapped in schema: "lat" holds lng values, "lng" holds lat values
            rows = db.execute("SELECT pointid, name, lat, lng FROM transparking_cache WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? LIMIT 150", (sw_lng, ne_lng, sw_lat, ne_lat)).fetchall()
            features = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [r["lat"], r["lng"]]}, "properties": {"pointid": r["pointid"], "name": r["name"], "url": f"https://truckerapps.eu/transparking/en/poi/{r['pointid']}"}} for r in rows]
            return jsonify({"type": "FeatureCollection", "features": features})
    except: return jsonify({"error": "invalid params"}), 400

@poi_bp.post("/api/poi-along-route")
def poi_along_route_v2():
    data = _get_body()
    coords, category = data.get("coords", []), data.get("category", "truck_stop")
    if not coords or len(coords) < 2: return jsonify({"pois": []})
    if category == "truck_stop":
        results = _transparking_along_route(coords, max_results=20)
    else:
        results = _tomtom_along_route(coords, "gas station", max_detour_s=900, limit=25)
        for r in results:
            r["category"] = category
    return jsonify({"pois": results})

@poi_bp.post("/api/cameras-along-route")
def cameras_along_route_v2():
    coords = _get_body().get("coords", [])
    if not coords or not isinstance(coords, list) or len(coords) < 2:
        return jsonify({"ok": False, "error": "Invalid coords"}), 400
    MAX_COORDS = 80
    if len(coords) > MAX_COORDS:
        step = len(coords) / MAX_COORDS
        coords = [coords[int(i * step)] for i in range(MAX_COORDS)]
    SEG_SIZE, seen_ids, cameras, pad = 150, set(), [], 0.008
    MAX_SEGMENTS = 10
    segments = [coords[i:i+SEG_SIZE] for i in range(0, len(coords), SEG_SIZE)]
    segments = segments[:MAX_SEGMENTS]
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
                dist_to_route = _distance_to_polyline_m([el["lon"], el["lat"]], work_seg)
                if dist_to_route > 80:
                    continue
                tags = el.get("tags", {})
                speed = tags.get("maxspeed", "")
                cameras.append({
                    "lat": el["lat"],
                    "lng": el["lon"],
                    "name": f"📷 Радар {speed} км/ч" if speed else "📷 Радар",
                    "maxspeed": speed,
                    "distance_m": int(dist_to_route),
                    "category": "speed_camera",
                })
        except: continue
    return jsonify({"cameras": cameras})

@poi_bp.get("/api/proximity-alerts")
def proximity_alerts():
    lat, lng = request.args.get("lat", type=float), request.args.get("lng", type=float)
    rad = min(max(request.args.get("radius_m", default=5000, type=int) or 5000, 0), 15000)
    if lat is None or lng is None: return jsonify({"ok": False}), 400
    cams = _tool_find_speed_cameras(lat, lng, rad)
    ovt = _tool_find_overtaking_restrictions(lat, lng, rad)
    return jsonify({"ok": True, "cameras": cams.get("cameras", []), "overtaking": ovt.get("restrictions", []), "nearest_camera_m": cams.get("nearest_m", -1)})

@poi_bp.post("/api/cameras/report")
def report_camera():
    body = _get_body()
    lat, lng, email = body.get("lat"), body.get("lng"), body.get("user_email", "")
    if lat is None or lng is None: return jsonify({"ok": False, "error": "lat, lng required"}), 400
    with get_db() as conn:
        conn.execute("INSERT INTO pois (name, address, category, lat, lng, notes, user_email, created_at) VALUES (?,?,?,?,?,?,?,?)", ("📷 Докладвана камера", "Добавена от потребител", "speed_camera", float(lat), float(lng), "User reported", email, now_iso()))
        conn.commit()
    return jsonify({"ok": True})

@poi_bp.get("/api/places/search")
def places_search():
    from services.poi_service import _google_places_fallback
    q, lat, lng = request.args.get("q", "").strip(), float(request.args.get("lat", 0)), float(request.args.get("lng", 0))
    if len(q) < 2: return jsonify({"results": []})
    return jsonify({"results": _google_places_fallback(q, lat, lng)})
