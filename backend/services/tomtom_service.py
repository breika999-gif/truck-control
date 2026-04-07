import re
import requests
import hashlib
import json
import time
import math
from concurrent.futures import ThreadPoolExecutor
from config import (
    TOMTOM_API_KEY, MAPBOX_TOKEN, _BUCHAREST_WP, _CLUJ_WP, _BUDAPEST_WP,
    _BELGRADE_WP, _ZAGREB_WP, _SOFIA_BYPASS
)
from utils.helpers import _haversine_m, now_iso

_tomtom_ready = bool(TOMTOM_API_KEY)

_TT_MANEUVER_DIR = {
    "TURN_LEFT":        "left",
    "TURN_RIGHT":       "right",
    "KEEP_LEFT":        "slight left",
    "KEEP_RIGHT":       "slight right",
    "SHARP_LEFT":       "sharp left",
    "SHARP_RIGHT":      "sharp right",
    "STRAIGHT":         "straight",
    "ROUNDABOUT_CROSS": "straight",
    "U_TURN":           "uturn",
    "ARRIVE":           "straight",
    "DEPART":           "straight",
}

# Module-level in-memory cache for map-match results
_mm_mem_cache: dict = {}
_MM_MEM_TTL_SEC = 300

def _adr_to_tunnel_code(hazmat_class: str) -> str | None:
    mapping = {
        "1": "B", "2": "C", "3": "D", "4": "D", "5": "D",
        "6": "D", "7": "B", "8": "E", "9": "E",
    }
    return mapping.get(str(hazmat_class))

def _tomtom_route_to_geojson(route: dict) -> dict:
    coords = []
    for leg in route.get("legs", []):
        for pt in leg.get("points", []):
            coords.append([pt["longitude"], pt["latitude"]])
    return {"type": "LineString", "coordinates": coords}

def _mapbox_map_match(coords: list, max_points: int = 1600) -> list:
    from database import get_db, datetime, timezone
    if not MAPBOX_TOKEN or len(coords) < 2:
        return coords

    route_sig = coords[:5] + coords[-5:] + [len(coords)]
    route_hash = hashlib.sha256(json.dumps(route_sig).encode()).hexdigest()

    _now = time.time()
    if route_hash in _mm_mem_cache:
        cached_coords, cached_ts = _mm_mem_cache[route_hash]
        if _now - cached_ts < _MM_MEM_TTL_SEC:
            return cached_coords

    try:
        with get_db() as db:
            row = db.execute("SELECT coords_json, created_at FROM map_match_cache WHERE route_hash=?", (route_hash,)).fetchone()
            if row:
                created = datetime.fromisoformat(row["created_at"])
                if (datetime.now(timezone.utc) - created.replace(tzinfo=timezone.utc)).days < 7:
                    hit = json.loads(row["coords_json"])
                    _mm_mem_cache[route_hash] = (hit, time.time())
                    return hit
    except Exception: pass

    to_match = coords[:max_points]
    tail     = coords[max_points:]
    CHUNK = 100
    chunks = [to_match[i:i + CHUNK] for i in range(0, len(to_match), CHUNK)]

    def _match_one(chunk: list) -> list:
        coord_str = ";".join(f"{lng},{lat}" for lng, lat in chunk)
        radiuses  = ";".join(["25"] * len(chunk))
        try:
            r = requests.get(
                f"https://api.mapbox.com/matching/v5/mapbox/driving/{coord_str}",
                params={"access_token": MAPBOX_TOKEN, "geometries": "geojson", "overview": "full", "radiuses": radiuses, "tidy": "true"},
                timeout=10,
            )
            if r.status_code == 200:
                pts: list = []
                for m in r.json().get("matchings", []):
                    pts.extend(m.get("geometry", {}).get("coordinates", []))
                if pts: return pts
        except Exception: pass
        return chunk

    with ThreadPoolExecutor(max_workers=min(len(chunks), 8)) as ex:
        results = list(ex.map(_match_one, chunks))

    snapped: list = []
    for pts in results: snapped.extend(pts)
    final_coords = snapped + tail if snapped else coords

    _mm_mem_cache[route_hash] = (final_coords, time.time())
    try:
        with get_db() as db:
            db.execute("INSERT OR REPLACE INTO map_match_cache (route_hash, coords_json, created_at) VALUES (?, ?, ?)", (route_hash, json.dumps(final_coords), now_iso()))
            db.execute("DELETE FROM map_match_cache WHERE datetime(created_at) < datetime('now', '-7 days')")
            db.commit()
    except Exception: pass
    return final_coords

def _tomtom_search(query: str, lat: float, lng: float, limit: int = 6) -> list:
    if not _tomtom_ready: return []
    try:
        url = f"https://api.tomtom.com/search/2/search/{requests.utils.quote(query)}.json"
        params = {"key": TOMTOM_API_KEY, "limit": limit}
        if lat and lng:
            params["lat"] = lat
            params["lon"] = lng
            params["radius"] = 100000
        r = requests.get(url, params=params, timeout=8)
        r.raise_for_status()
        results = []
        for item in r.json().get("results", []):
            pos = item.get("position", {})
            item_lat, item_lng = pos.get("lat"), pos.get("lon")
            if item_lat is None: continue
            name = (item.get("poi") or {}).get("name") or item.get("address", {}).get("freeformAddress", "")
            results.append({"name": name, "address": item.get("address", {}).get("freeformAddress", ""), "lat": item_lat, "lng": item_lng, "distance_m": round(_haversine_m(lat, lng, item_lat, item_lng)) if lat else 0})
        return results
    except Exception: return []

def _get_avoidance_waypoints(origin_lat, origin_lng, dest_lng: float, avoid: list = None) -> list:
    avoid_set = {a.lower() for a in (avoid or [])}
    if origin_lat is None or origin_lng is None: return []
    in_bulgaria = (41.0 <= origin_lat <= 44.5) and (22.0 <= origin_lng <= 29.0)
    going_west  = dest_lng is not None and dest_lng < 17.0
    if "serbia" in avoid_set or (in_bulgaria and going_west and "romania" not in avoid_set):
        return [_BUCHAREST_WP, _CLUJ_WP, _BUDAPEST_WP]
    if "romania" in avoid_set and in_bulgaria and going_west:
        return [_BELGRADE_WP, _ZAGREB_WP]
    if "sofia_center" in avoid_set: return _SOFIA_BYPASS
    return []

def _tomtom_congestion_geojson(route: dict, geometry: dict) -> dict:
    coords = geometry.get("coordinates", [])
    sections = [s for s in route.get("sections", []) if s.get("sectionType") == "TRAFFIC"]
    if not sections or len(coords) < 2:
        return {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"congestion": "unknown"}, "geometry": geometry}]}
    _level = {"JAM": "heavy", "ROAD_WORK": "moderate", "ROAD_CLOSURE": "severe"}
    features = []
    for sec in sections:
        start = sec.get("startPointIndex", 0)
        end   = min(sec.get("endPointIndex", start + 1) + 1, len(coords))
        level = _level.get(sec.get("simpleCategory", ""), "low")
        seg   = coords[start:end]
        if len(seg) >= 2:
            features.append({"type": "Feature", "properties": {"congestion": level}, "geometry": {"type": "LineString", "coordinates": seg}})
    if not features: features = [{"type": "Feature", "properties": {"congestion": "low"}, "geometry": geometry}]
    return {"type": "FeatureCollection", "features": features}

def _tomtom_traffic_alerts(route: dict, geometry: dict) -> list:
    coords, alerts = geometry.get("coordinates", []), []
    for sec in route.get("sections", []):
        if sec.get("sectionType") != "TRAFFIC": continue
        category = sec.get("simpleCategory", "")
        if category not in ("JAM", "ROAD_WORK", "ROAD_CLOSURE", "SLOW_TRAFFIC", "DANGEROUS_CONDITIONS"): continue
        travel = sec.get("travelTimeInSeconds", 0)
        no_traffic = sec.get("noTrafficTravelTimeInSeconds", travel)
        delay_min  = max(0, round((travel - no_traffic) / 60))
        if category == "SLOW_TRAFFIC" and delay_min < 5: continue
        if category == "JAM" and delay_min < 2: continue
        if category not in ("ROAD_CLOSURE", "ROAD_WORK", "DANGEROUS_CONDITIONS") and delay_min < 2: continue
        start_idx, end_idx = sec.get("startPointIndex", 0), sec.get("endPointIndex", 0)
        mid = (start_idx + end_idx) // 2
        if mid >= len(coords): continue
        c, length_km = coords[mid], round(max(0.1, (end_idx - start_idx) * 0.1), 1)
        sev = "severe" if category in ("ROAD_CLOSURE", "DANGEROUS_CONDITIONS") else "heavy" if delay_min >= 20 else "moderate"
        labels = {"ROAD_CLOSURE": "🚫 Затворен път", "DANGEROUS_CONDITIONS": "⚠️ Опасен участък", "ROAD_WORK": f"🚧 Ремонт{f' +{delay_min} мин' if delay_min > 0 else ' (бавно)'}", "SLOW_TRAFFIC": f"🐢 Бавно +{delay_min} мин"}
        label = labels.get(category, f"🛑 +{delay_min // 60}ч {delay_min % 60}мин" if delay_min >= 60 else f"🛑 +{delay_min} мин")
        alerts.append({"lat": round(c[1], 5), "lng": round(c[0], 5), "delay_min": delay_min, "severity": sev, "length_km": length_km, "label": label})
    return alerts[:8]

def _tomtom_speed_limits(route: dict) -> list:
    total_pts = sum(len(leg.get("points", [])) for leg in route.get("legs", []))
    if total_pts == 0: return []
    speeds: list = [None] * total_pts
    for sec in route.get("sections", []):
        if sec.get("sectionType") != "SPEED_LIMIT": continue
        sl = sec.get("speedLimit", {})
        value, unit = sl.get("value"), sl.get("unit", "KMPH")
        if value is None: continue
        speed_kmh = round(value * 1.609) if unit in ("MPH", "mph") else int(value)
        start, end = sec.get("startPointIndex", 0), sec.get("endPointIndex", total_pts - 1)
        for i in range(start, min(end + 1, total_pts)): speeds[i] = speed_kmh
    return [{"speed": s, "unit": "km/h"} if s is not None else {"unknown": True} for s in speeds]

def _tomtom_lane_banner(instr: dict) -> dict | None:
    lg, msg = instr.get("laneGuidance"), instr.get("message", "")
    signposts, road_nums, exit_nums = re.findall(r"<signpostText>(.*?)</signpostText>", msg), re.findall(r"<roadNumber>(.*?)</roadNumber>", msg), re.findall(r"<exitNumber>(.*?)</exitNumber>", msg)
    primary_text = " / ".join(signposts) if signposts else re.sub(r"<.*?>", "", msg)
    components = []
    if exit_nums: components.append({"type": "exit-number", "text": exit_nums[0]})
    for rn in road_nums: components.append({"type": "text", "text": rn})
    for sp in signposts: components.append({"type": "text", "text": sp})
    if not lg:
        return {"distanceAlongGeometry": instr.get("routeOffsetInMeters", 0), "primary": {"text": primary_text, "type": instr.get("maneuver", "straight").lower().replace("_", " "), "components": components if components else [{"type": "text", "text": primary_text}]}, "sub": None}
    lanes, maneuver = lg.get("lanes", []), instr.get("maneuver", "STRAIGHT")
    active_dir = _TT_MANEUVER_DIR.get(maneuver, "straight")
    lane_components = [{"type": "lane", "text": "", "active": bool(lane.get("drivable", False)), "directions": [active_dir] if lane.get("drivable") else ["none"]} for lane in lanes]
    return {"distanceAlongGeometry": instr.get("routeOffsetInMeters", 0), "primary": {"text": primary_text, "type": maneuver.lower().replace("_", " "), "components": components if components else [{"type": "text", "text": primary_text}]}, "sub": {"components": lane_components}}

def _tomtom_along_route(coords: list, query: str, max_detour_s: int = 600, limit: int = 10) -> list:
    if not _tomtom_ready or not coords or len(coords) < 2: return []
    MAX_PTS = 150
    sampled = coords[::max(1, len(coords) // MAX_PTS)]
    if sampled[-1] != coords[-1]: sampled.append(coords[-1])
    try:
        n_pts = len(sampled)
        route_dists, curr_total = [0.0] * n_pts, 0.0
        for i in range(1, n_pts):
            curr_total += _haversine_m(sampled[i-1][1], sampled[i-1][0], sampled[i][1], sampled[i][0])
            route_dists[i] = curr_total
        url = f"https://api.tomtom.com/search/2/alongRouteSearch/{requests.utils.quote(query)}.json"
        body = {"route": {"points": [{"lat": c[1], "lon": c[0]} for c in sampled]}}
        r = requests.post(url, params={"key": TOMTOM_API_KEY, "maxDetourTime": max_detour_s, "limit": limit, "vehicleType": "Truck", "language": "bg-BG", "spreadingMode": "auto"}, json=body, timeout=12)
        r.raise_for_status()
        results = []
        for item in r.json().get("results", []):
            pos = item.get("position", {})
            lat, lng = pos.get("lat"), pos.get("lon")
            if lat is None: continue
            best_dist_to_route, poi_distance_m = float('inf'), 0
            for i, rp in enumerate(sampled):
                d = _haversine_m(lat, lng, rp[1], rp[0])
                if d < best_dist_to_route: best_dist_to_route, poi_distance_m = d, int(route_dists[i])
            poi_data = item.get("poi") or {}
            brand = (poi_data.get("brands") or [{}])[0].get("name")
            truck_lane = any("truck" in cat.lower() for cat in poi_data.get("categories", []))
            name = poi_data.get("name") or item.get("address", {}).get("freeformAddress", "Обект")
            results.append({"name": name, "lat": lat, "lng": lng, "distance_m": poi_distance_m, "brand": brand, "truck_lane": truck_lane, "info": item.get("address", {}).get("freeformAddress"), "voice_desc": f"Намерих {name} на {(poi_distance_m/1000):.1f} километра по маршрута."})
        return results
    except Exception: return []

def _tool_navigate_to(destination: str) -> dict:
    """Geocode destination via TomTom Fuzzy Search."""
    try:
        url = f"https://api.tomtom.com/search/2/search/{requests.utils.quote(destination)}.json"
        r = requests.get(url, params={"key": TOMTOM_API_KEY, "limit": 1}, timeout=8)
        r.raise_for_status()
        results = r.json().get("results", [])
        if not results:
            return {"error": f"Не намерих '{destination}'"}
        res = results[0]
        pos = res.get("position", {})
        lat, lng = pos.get("lat"), pos.get("lon")
        entry_points = res.get("entryPoints", [])
        if entry_points:
            ep = entry_points[0]
            lat = ep.get("position", {}).get("lat", lat)
            lng = ep.get("position", {}).get("lon", lng)
        name = (res.get("poi") or {}).get("name") or res.get("address", {}).get("freeformAddress", destination)
        return {"destination": name, "coords": [lng, lat]}
    except Exception as exc:
        return {"error": str(exc)}


def _tool_suggest_routes(
    destination: str, origin_lat: float, origin_lng: float,
    avoid: list = None, truck_profile: dict = None
) -> dict:
    """Fetch 2-3 route alternatives via TomTom Routing API (travelMode=truck)."""
    try:
        nav = _tool_navigate_to(destination)
        if "error" in nav:
            return {"error": nav["error"]}
        dest_lng, dest_lat = nav["coords"]
        wps = _get_avoidance_waypoints(origin_lat, origin_lng, dest_lng, avoid)
        all_points = [[origin_lng, origin_lat]] + wps + [[dest_lng, dest_lat]]
        locations = ":".join(f"{p[1]},{p[0]}" for p in all_points)
        url = f"https://api.tomtom.com/routing/1/calculateRoute/{locations}/json"
        params: dict = {
            "key": TOMTOM_API_KEY, "travelMode": "truck", "traffic": "true",
            "computeTravelTimeFor": "all", "routeType": "fastest",
            "maxAlternatives": 2, "sectionType": "traffic",
        }
        if truck_profile:
            if truck_profile.get("height_m"):  params["vehicleHeight"] = truck_profile["height_m"]
            if truck_profile.get("width_m"):   params["vehicleWidth"]  = truck_profile["width_m"]
            if truck_profile.get("length_m"):  params["vehicleLength"] = truck_profile["length_m"]
            if truck_profile.get("weight_t"):  params["vehicleWeight"] = int(truck_profile["weight_t"] * 1000)
            if truck_profile.get("axle_count"): params["vehicleNumberOfAxles"] = truck_profile["axle_count"]
            code = _adr_to_tunnel_code(truck_profile.get("hazmat_class", "none") or "none")
            if code: params["vehicleAdrTunnelRestrictionCode"] = code
        avoid_set = set(avoid or [])
        if "motorway" in avoid_set:   params["avoid"] = "motorways"
        elif "toll" in avoid_set:     params["avoid"] = "tollRoads"
        elif "ferry" in avoid_set:    params["avoid"] = "ferries"

        r = requests.get(url, params=params, timeout=15)
        r.raise_for_status()
        routes_data = r.json().get("routes", [])
        primary_duration = routes_data[0].get("summary", {}).get("travelTimeInSeconds", 0)
        primary_dist_m   = routes_data[0].get("summary", {}).get("lengthInMeters", 0)

        preview_rts = routes_data[:3]
        raw_geoms   = [_tomtom_route_to_geojson(rt) for rt in preview_rts]
        raw_coords  = [g["coordinates"] for g in raw_geoms]

        if primary_dist_m > 300_000:
            snapped = raw_coords
        else:
            with ThreadPoolExecutor(max_workers=len(raw_coords)) as ex:
                snapped = list(ex.map(_mapbox_map_match, raw_coords))
        for i, g in enumerate(raw_geoms):
            g["coordinates"] = snapped[i]

        colors = ["#00bfff", "#00ff88", "#ffcc00"]
        labels = ["Основен маршрут", "Алтернатива 1", "Алтернатива 2"]
        options = []
        for i, rt in enumerate(preview_rts):
            summary   = rt.get("summary", {})
            duration  = summary.get("travelTimeInSeconds", 0)
            distance  = summary.get("lengthInMeters", 0)
            delay_min = round(summary.get("trafficDelayInSeconds", 0) / 60)
            dist_km   = round(distance / 1000)
            diff_min  = round((duration - primary_duration) / 60)
            diff_str  = f" (+{diff_min} мин)" if diff_min > 0 else (f" ({diff_min} мин)" if diff_min < 0 else " (същото време)") if i > 0 else ""
            dur_h, dur_m = int(duration / 3600), int((duration % 3600) / 60)
            dur_str   = f"{dur_h}ч {dur_m}мин" if dur_h else f"{dur_m}мин"
            geometry  = raw_geoms[i]
            options.append({
                "label":             f"{labels[i]} — {dist_km}км, {dur_str}{diff_str}",
                "color":             colors[i],
                "duration":          duration,
                "distance":          distance,
                "diff_min":          diff_min,
                "traffic":           "low" if delay_min < 5 else "moderate" if delay_min < 20 else "heavy",
                "traffic_delay_min": delay_min,
                "geometry":          geometry,
                "dest_coords":       [dest_lng, dest_lat],
                "congestion_geojson": _tomtom_congestion_geojson(rt, geometry),
                "traffic_alerts":    _tomtom_traffic_alerts(rt, geometry),
            })
        return {"destination": nav["destination"], "dest_coords": [dest_lng, dest_lat], "options": options}
    except Exception as exc:
        return {"error": str(exc)}


def _tool_check_traffic(origin_lng: float, origin_lat: float, dest_lng: float, dest_lat: float) -> dict:
    _TRUCK_SPEED_KMH = 80.0
    def _haversine_eta() -> dict:
        dist_km = _haversine_m(origin_lat, origin_lng, dest_lat, dest_lng) / 1000
        return {"has_delay": False, "delay_min": 0, "duration_min": round(dist_km / _TRUCK_SPEED_KMH * 60, 1), "alternative_available": False, "note": "Приблизително (без трафик данни)"}
    if not _tomtom_ready: return _haversine_eta()
    try:
        url = f"https://api.tomtom.com/routing/1/calculateRoute/{origin_lat},{origin_lng}:{dest_lat},{dest_lng}/json"
        r = requests.get(url, params={"key": TOMTOM_API_KEY, "routeType": "fastest", "traffic": "true", "travelMode": "truck", "vehicleMaxSpeed": 90}, timeout=10)
        r.raise_for_status()
        routes = r.json().get("routes", [])
        if not routes: return _haversine_eta()
        summary = routes[0].get("summary", {})
        duration, typical = summary.get("travelTimeInSeconds", 0), summary.get("historicTrafficTravelTimeInSeconds", summary.get("travelTimeInSeconds", 0))
        delay = max(0, duration - typical)
        return {"has_delay": delay > 1200, "delay_min": round(delay / 60), "duration_min": round(duration / 60), "distance_km": round(summary.get("lengthInMeters", 0) / 1000, 1), "alternative_available": False}
    except Exception as exc: return {"error": str(exc)}
