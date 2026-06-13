import math
import requests
from flask import Blueprint, jsonify, request
from database import get_db, row_to_poi, _transparking_match
from utils.helpers import _is_rate_limited, _get_body, now_iso, require_app_token, validate_coords
from services.tomtom_service import _tomtom_along_route
from services.tomtom_service import _tomtom_search
from services.poi_service import _tool_find_truck_parking, _tool_find_speed_cameras, _tool_find_overtaking_restrictions, _tool_find_fuel

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

def _route_position_m(point: list, coords: list) -> float:
    if not coords:
        return 0.0
    if len(coords) == 1:
        return 0.0
    cum = [0.0]
    for idx in range(1, len(coords)):
        cum.append(cum[-1] + math.sqrt((coords[idx][0] - coords[idx - 1][0]) ** 2 + (coords[idx][1] - coords[idx - 1][1]) ** 2) * 111000)
    best_pos, best_dist = 0.0, float("inf")
    px, py = point[0], point[1]
    for idx in range(len(coords) - 1):
        ax, ay = coords[idx][0], coords[idx][1]
        bx, by = coords[idx + 1][0], coords[idx + 1][1]
        dx, dy = bx - ax, by - ay
        len_sq = dx * dx + dy * dy
        t = 0.0 if len_sq == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / len_sq))
        cx, cy = ax + t * dx, ay + t * dy
        dist = math.sqrt((cx - px) ** 2 + (cy - py) ** 2) * 111000
        if dist < best_dist:
            seg_m = math.sqrt(dx * dx + dy * dy) * 111000
            best_dist = dist
            best_pos = cum[idx] + t * seg_m
    return best_pos

def _sample_route_points(coords: list, step_m: int = 25_000, max_points: int = 10) -> list:
    if not coords or len(coords) < 2:
        return []
    cum = [0.0]
    for idx in range(1, len(coords)):
        cum.append(cum[-1] + math.sqrt((coords[idx][0] - coords[idx - 1][0]) ** 2 + (coords[idx][1] - coords[idx - 1][1]) ** 2) * 111000)
    samples, next_target = [], step_m
    for idx, dist in enumerate(cum):
        if dist >= next_target:
            samples.append(coords[idx])
            next_target += step_m
            if len(samples) >= max_points:
                break
    if not samples:
        samples = [coords[len(coords) // 2]]
    return samples

def _dedupe_route_pois(items: list, coords: list, max_detour_m: int, max_results: int) -> list:
    seen, results = set(), []
    for item in items:
        lat, lng = item.get("lat"), item.get("lng")
        if lat is None or lng is None:
            continue
        detour_m = int(_distance_to_polyline_m([lng, lat], coords))
        if detour_m > max_detour_m:
            continue
        key = (round(lat, 4), round(lng, 4), (item.get("name") or "").lower())
        if key in seen:
            continue
        seen.add(key)
        route_m = int(_route_position_m([lng, lat], coords))
        enriched = dict(item)
        enriched["distance_m"] = route_m
        enriched["detour_m"] = detour_m
        enriched["travel_time"] = int(route_m / 22.2)
        results.append(enriched)
    results.sort(key=lambda x: x["distance_m"])
    return results[:max_results]

def _fallback_pois_along_route(coords: list, category: str, max_results: int = 20, debug: dict | None = None) -> list:
    samples = _sample_route_points(coords)
    if debug is not None:
        debug["fallback_samples"] = len(samples)
        debug["tomtom_search_results"] = 0
        debug["service_results"] = 0
        debug["raw_results"] = 0
        debug["deduped_results"] = 0
    raw = []
    for lng, lat in samples:
        if category == "fuel":
            tt_results = _tomtom_search("gas station", lat, lng, limit=8) + _tomtom_search("fuel station", lat, lng, limit=8)
            service_results = _tool_find_fuel(lat, lng, 30_000)
            if debug is not None:
                debug["tomtom_search_results"] += len(tt_results)
                debug["service_results"] += len(service_results)
            raw.extend(tt_results)
            raw.extend(service_results)
        else:
            service_results = _tool_find_truck_parking(lat, lng, 30_000)
            if debug is not None:
                debug["service_results"] += len(service_results)
            raw.extend(service_results)
        if len(raw) >= max_results * 4:
            break
    results = _dedupe_route_pois(raw, coords, 15_000, max_results)
    if debug is not None:
        debug["raw_results"] = len(raw)
        debug["deduped_results"] = len(results)
    return results

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
            rows = db.execute(
                "SELECT pointid, name, lat, lng FROM transparking_cache "
                "WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? LIMIT 20",
                (lat - PAD, lat + PAD, lng - PAD, lng + PAD)
            ).fetchall()
            for r in rows:
                if r["pointid"] in seen:
                    continue
                seen.add(r["pointid"])
                real_lat, real_lng = r["lat"], r["lng"]
                dist_m = int(math.sqrt((real_lat - lat)**2 + (real_lng - lng)**2) * 111000)
                travel_s = int(dist_m / 22.2)
                results.append({
                    "name": r["name"],
                    "lat": real_lat,
                    "lng": real_lng,
                    "distance_m": dist_m,
                    "travel_time": travel_s,
                    "transparking_id": r["pointid"],
                    "transparking_url": "https://truckerapps.eu/transparking/bg/map/",
                    "paid": True,
                    "category": "truck_stop",
                    "voice_desc": f"Паркинг {r['name']} на {dist_m // 1000} километра от маршрута.",
                })

    results.sort(key=lambda x: x["distance_m"])
    return results[:max_results]

poi_bp = Blueprint('poi', __name__)

def _validated_route_coords(coords):
    if not isinstance(coords, list):
        return None
    validated = []
    for coord in coords:
        if not isinstance(coord, (list, tuple)) or len(coord) < 2:
            return None
        lat, lng = validate_coords(coord[1], coord[0])
        if lat is None:
            return None
        validated.append([lng, lat])
    return validated

@poi_bp.get("/api/pois")
@require_app_token
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
@require_app_token
def save_poi():
    body = _get_body()
    name, lat, lng, email = (body.get("name") or "").strip(), body.get("lat"), body.get("lng"), (body.get("user_email") or "").strip()
    if not name or lat is None or lng is None: return jsonify({"ok": False, "error": "name, lat, lng required"}), 400
    if not email: return jsonify({"ok": False, "error": "user_email required"}), 400
    lat_f, lng_f = validate_coords(lat, lng)
    if lat_f is None:
        return jsonify({"ok": False, "error": "invalid coordinates"}), 400
    with get_db() as conn:
        cur = conn.execute("INSERT INTO pois (name, address, category, lat, lng, notes, user_email, created_at) VALUES (?,?,?,?,?,?,?,?)", (name, body.get("address", ""), body.get("category", "custom"), lat_f, lng_f, body.get("notes", ""), email, now_iso()))
        pid = cur.lastrowid
        row = conn.execute("SELECT * FROM pois WHERE id=?", (pid,)).fetchone()
    return jsonify({"ok": True, "poi": row_to_poi(row)}), 201

@poi_bp.delete("/api/pois/<int:poi_id>")
@require_app_token
def delete_poi(poi_id: int):
    email = (request.args.get("user_email") or _get_body().get("user_email") or "").strip()
    if not email: return jsonify({"ok": False, "error": "email required"}), 400
    with get_db() as conn: 
        deleted = conn.execute("DELETE FROM pois WHERE id=? AND user_email=?", (poi_id, email)).rowcount
        conn.commit()
    return jsonify({"ok": deleted > 0})

@poi_bp.get("/api/parking/nearby")
@require_app_token
def nearby_truck_parking():
    if _is_rate_limited(limit=30, window_s=60): return jsonify({"ok": False, "error": "rate limited"}), 429
    try:
        lat, lng = validate_coords(request.args.get("lat"), request.args.get("lng"))
        if lat is None:
            raise ValueError("invalid coordinates")
        radius_m = int(float(request.args.get("radius") or request.args.get("radius_m") or 20000))
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "invalid coordinates"}), 400

    spots = _tool_find_truck_parking(lat, lng, max(1000, min(radius_m, 50000)))
    return jsonify({"ok": True, "spots": spots, "pois": spots})

@poi_bp.post("/api/poi-along-route")
@require_app_token
def poi_along_route_v2():
    data = _get_body()
    coords, category = data.get("coords", []) or [], data.get("category", "truck_stop")
    if not isinstance(coords, list): return jsonify({"ok": False, "error": "Invalid coords"}), 400
    if len(coords) > 500: return jsonify({"ok": False, "error": "too many coordinates"}), 400
    if not coords or len(coords) < 2: return jsonify({"pois": []})
    coords = _validated_route_coords(coords)
    if coords is None: return jsonify({"ok": False, "error": "invalid coordinates"}), 400
    if category == "truck_stop":
        results = _transparking_along_route(coords, max_results=20)
        if len(results) < 3:
            results = _dedupe_route_pois(results + _fallback_pois_along_route(coords, category, max_results=20), coords, 15_000, 20)
    else:
        results = _tomtom_along_route(coords, "gas station", max_detour_s=900, limit=25)
        if len(results) < 3:
            results = _dedupe_route_pois(results + _fallback_pois_along_route(coords, category, max_results=20), coords, 15_000, 20)
        for r in results:
            r["category"] = category
    return jsonify({"pois": results})

@poi_bp.post("/api/cameras-along-route")
@require_app_token
def cameras_along_route_v2():
    coords = _get_body().get("coords", [])
    if not coords or not isinstance(coords, list) or len(coords) < 2:
        return jsonify({"ok": False, "error": "Invalid coords"}), 400
    coords = _validated_route_coords(coords)
    if coords is None:
        return jsonify({"ok": False, "error": "invalid coordinates"}), 400
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
@require_app_token
def proximity_alerts():
    lat, lng = validate_coords(request.args.get("lat"), request.args.get("lng"))
    rad = min(max(request.args.get("radius_m", default=5000, type=int) or 5000, 0), 15000)
    if lat is None or lng is None: return jsonify({"ok": False}), 400
    cams = _tool_find_speed_cameras(lat, lng, rad)
    ovt = _tool_find_overtaking_restrictions(lat, lng, rad)
    return jsonify({"ok": True, "cameras": cams.get("cameras", []), "overtaking": ovt.get("restrictions", []), "nearest_camera_m": cams.get("nearest_m", -1)})

@poi_bp.post("/api/cameras/report")
@require_app_token
def report_camera():
    body = _get_body()
    lat, lng, email = body.get("lat"), body.get("lng"), body.get("user_email", "")
    if lat is None or lng is None: return jsonify({"ok": False, "error": "lat, lng required"}), 400
    lat_f, lng_f = validate_coords(lat, lng)
    if lat_f is None:
        return jsonify({"ok": False, "error": "invalid coordinates"}), 400
    with get_db() as conn:
        conn.execute("INSERT INTO pois (name, address, category, lat, lng, notes, user_email, created_at) VALUES (?,?,?,?,?,?,?,?)", ("📷 Докладвана камера", "Добавена от потребител", "speed_camera", lat_f, lng_f, "User reported", email, now_iso()))
        conn.commit()
    return jsonify({"ok": True})

@poi_bp.get("/api/places/search")
@require_app_token
def places_search():
    from services.poi_service import _google_places_fallback
    q = request.args.get("q", "").strip()
    lat, lng = validate_coords(request.args.get("lat", 0), request.args.get("lng", 0))
    if lat is None:
        return jsonify({"error": "invalid coordinates"}), 400
    if len(q) < 2: return jsonify({"results": []})
    return jsonify({"results": _google_places_fallback(q, lat, lng)})
