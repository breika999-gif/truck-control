import re
import requests
import json
import time
import math
import hashlib
import threading
from concurrent.futures import ThreadPoolExecutor
from config import (
    TOMTOM_API_KEY, MAPBOX_PUBLIC_TOKEN, _BUCHAREST_WP, _CLUJ_WP, _BUDAPEST_WP,
    _BELGRADE_WP, _ZAGREB_WP, _SOFIA_BYPASS
)
from utils.helpers import _haversine_m, now_iso
from utils.redis_client import get_redis

_tomtom_ready = bool(TOMTOM_API_KEY)
_match_cache: dict = {}
_match_cache_lock = threading.Lock()
_MATCH_MEMORY_MAX = 500
_MATCH_CACHE_TTL_S = 180 * 86400  # snapped geometry is stable enough to reuse long-term
_MATCH_CACHE_PREFIX = "route_match:"
_SEARCH_CACHE_TTL_S = 30 * 86400
_NEGATIVE_CACHE_TTL_S = 3600
_INCIDENT_CACHE_TTL_S = 300
_INCIDENT_CACHE_PREFIX = "tomtom_incidents:"
_incident_cache: dict = {}
_incident_cache_lock = threading.Lock()

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

def _sample_coords_for_snap(coords: list, max_points: int = 1200) -> list:
    if len(coords) <= max_points:
        return coords
    step = (len(coords) - 1) / float(max_points - 1)
    sampled = [coords[round(i * step)] for i in range(max_points)]
    sampled[0] = coords[0]
    sampled[-1] = coords[-1]
    deduped = []
    for coord in sampled:
        if not deduped or coord != deduped[-1]:
            deduped.append(coord)
    return deduped

def _flat_route_coords(route_features: list) -> list:
    merged = []
    for feat in route_features:
        seg = (feat or {}).get("geometry", {}).get("coordinates", [])
        for coord in seg:
            if not merged or coord != merged[-1]:
                merged.append(coord)
    return merged

def _route_distance_m(coords: list) -> float:
    total = 0.0
    for i in range(1, len(coords)):
        total += _haversine_m(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0])
    return total

def _match_cache_key(coords: list, edge_only_m: int = 0) -> str:
    if len(coords) < 2:
        return ""
    first, last = coords[0], coords[-1]
    distance_m = round(_route_distance_m(coords))
    raw = json.dumps(
        {
            "first": [round(first[0], 5), round(first[1], 5)],
            "last": [round(last[0], 5), round(last[1], 5)],
            "distance": distance_m,
            "edge": edge_only_m,
        },
        sort_keys=True,
    )
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()

def _match_cache_get(key: str):
    if not key:
        return None
    with _match_cache_lock:
        cached = _match_cache.get(key)
        if cached:
            ts, value = cached
            if time.time() - ts <= _MATCH_CACHE_TTL_S:
                print(f"[ROUTING] mapbox match memory cache hit key={key[:8]}", flush=True)
                return value
            _match_cache.pop(key, None)

    try:
        client = get_redis()
        if client is not None:
            raw = client.get(f"{_MATCH_CACHE_PREFIX}{key}")
            if raw:
                payload = json.loads(raw)
                value = (payload["geometry"], bool(payload["success"]))
                with _match_cache_lock:
                    if len(_match_cache) >= _MATCH_MEMORY_MAX:
                        oldest = min(_match_cache, key=lambda k: _match_cache[k][0])
                        _match_cache.pop(oldest, None)
                    _match_cache[key] = (time.time(), value)
                print(f"[ROUTING] mapbox match redis cache hit key={key[:8]}", flush=True)
                return value
    except Exception:
        pass

    return None

def _match_cache_set(key: str, value):
    if key:
        with _match_cache_lock:
            if len(_match_cache) >= _MATCH_MEMORY_MAX:
                oldest = min(_match_cache, key=lambda k: _match_cache[k][0])
                _match_cache.pop(oldest, None)
            _match_cache[key] = (time.time(), value)
        try:
            client = get_redis()
            if client is not None:
                client.setex(
                    f"{_MATCH_CACHE_PREFIX}{key}",
                    _MATCH_CACHE_TTL_S,
                    json.dumps({"geometry": value[0], "success": bool(value[1])}),
                )
        except Exception:
            pass

def _split_edge_segments(coords: list, edge_m: int) -> tuple[list, list, list]:
    if len(coords) < 2 or edge_m <= 0:
        return coords, [], []

    total_m = _route_distance_m(coords)
    if total_m <= edge_m * 2:
        return coords, [], []

    cum = [0.0]
    for i in range(1, len(coords)):
        cum.append(cum[-1] + _haversine_m(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]))

    first_end = 1
    while first_end < len(cum) - 1 and cum[first_end] < edge_m:
        first_end += 1

    last_start = len(cum) - 2
    last_target = total_m - edge_m
    while last_start > 0 and cum[last_start] > last_target:
        last_start -= 1

    first = coords[:first_end + 1]
    middle = coords[first_end:last_start + 1]
    last = coords[last_start:]
    return first, middle, last

def _match_coordinate_chunks(coords: list) -> tuple[list, bool]:
    CHUNK = 99  # Mapbox limit is 100, use 99 with 1-point overlap
    all_snapped: list = []
    any_matched = False
    i = 0
    while i < len(coords):
        chunk = coords[i:i + CHUNK]
        if len(chunk) < 2:
            break

        coords_str = ";".join(f"{c[0]},{c[1]}" for c in chunk)
        radiuses = ";".join(["25"] * len(chunk))  # 25m tolerance — keeps us on truck route

        r = requests.get(
            f"https://api.mapbox.com/matching/v5/mapbox/driving/{coords_str}",
            params={
                "access_token": MAPBOX_PUBLIC_TOKEN,
                "geometries": "geojson",
                "radiuses": radiuses,
                "overview": "full",
                "tidy": "false",
            },
            timeout=10,
        )
        r.raise_for_status()
        data = r.json()

        if data.get("code") == "Ok" and data.get("matchings"):
            chunk_coords = data["matchings"][0]["geometry"]["coordinates"]
            any_matched = True
            if all_snapped:
                all_snapped.extend(chunk_coords[1:])  # skip first to avoid duplicate
            else:
                all_snapped.extend(chunk_coords)
        else:
            # Matching failed for this chunk — use original coords
            if all_snapped:
                all_snapped.extend(chunk[1:])
            else:
                all_snapped.extend(chunk)

        i += CHUNK - 1  # 1-point overlap between chunks

    return all_snapped, any_matched

def _merge_segments(*segments: list) -> list:
    merged = []
    for segment in segments:
        for coord in segment:
            if not merged or coord != merged[-1]:
                merged.append(coord)
    return merged

def _find_openlr_code(payload) -> str | None:
    if isinstance(payload, dict):
        for key, value in payload.items():
            if key in ("openlrCode", "openLrCode", "openlr", "openLR") and isinstance(value, str) and value:
                return value
            found = _find_openlr_code(value)
            if found:
                return found
    elif isinstance(payload, list):
        for item in payload:
            found = _find_openlr_code(item)
            if found:
                return found
    return None

def _mapbox_openlr_match(openlr_code: str) -> dict | None:
    if not MAPBOX_PUBLIC_TOKEN or not openlr_code:
        return None
    cache_key = "openlr:" + hashlib.sha1(openlr_code.encode("utf-8")).hexdigest()
    cached = _match_cache_get(cache_key)
    if cached is not None:
        return cached[0]
    try:
        r = requests.get(
            f"https://api.mapbox.com/matching/v5/mapbox/driving/{requests.utils.quote(openlr_code, safe='')}",
            params={
                "openlr_spec": "tomtom",
                "openlr_format": "tomtom",
                "geometries": "geojson",
                "overview": "full",
                "access_token": MAPBOX_PUBLIC_TOKEN,
            },
            timeout=10,
        )
        r.raise_for_status()
        data = r.json()
        if data.get("code") == "Ok" and data.get("matchings"):
            geometry = data["matchings"][0].get("geometry")
            if geometry and len(geometry.get("coordinates", [])) >= 2:
                _match_cache_set(cache_key, (geometry, True))
                return geometry
    except Exception as exc:
        print(f"[ROUTING] openlr match failed: {exc}", flush=True)
    return None

def _mapbox_match_geometry(geometry: dict, edge_only_m: int = 0) -> tuple[dict, bool]:
    """Snap TomTom geometry to Mapbox road network using Map Matching API.
    Returns (snapped_geometry, success). Falls back to original on any error.
    """
    coords = geometry.get("coordinates", [])
    if not MAPBOX_PUBLIC_TOKEN or len(coords) < 2:
        return geometry, False

    key = _match_cache_key(coords, edge_only_m)
    cached = _match_cache_get(key)
    if cached is not None:
        return cached

    try:
        if edge_only_m > 0:
            first, middle, last = _split_edge_segments(coords, edge_only_m)
            first_snapped, first_ok = _match_coordinate_chunks(first)
            if last:
                last_snapped, last_ok = _match_coordinate_chunks(last)
            else:
                last_snapped, last_ok = [], False
            all_snapped = _merge_segments(
                first_snapped if first_snapped else first,
                middle,
                last_snapped if last_snapped else last,
            )
            any_matched = first_ok or last_ok
        else:
            # Full-route matching keeps the rendered polyline on Mapbox roads.
            # Sampling bounds the number of matching requests on long haul routes.
            sampled = _sample_coords_for_snap(coords, max_points=600)
            all_snapped, any_matched = _match_coordinate_chunks(sampled)

        if len(all_snapped) >= 2:
            result = ({"type": "LineString", "coordinates": all_snapped}, any_matched)
            _match_cache_set(key, result)
            return result
    except Exception as exc:
        print(f"[ROUTING] coordinate match failed: {exc}", flush=True)

    return geometry, False


def _tomtom_search(query: str, lat: float, lng: float, limit: int = 6) -> list:
    if not _tomtom_ready: return []
    _lat_r = round(float(lat or 0), 1)
    _lng_r = round(float(lng or 0), 1)
    _rk = "geo:tts:" + hashlib.sha256(f"{query.lower().strip()}:{_lat_r}:{_lng_r}:{limit}".encode("utf-8")).hexdigest()
    _rc = get_redis()
    if _rc:
        try:
            raw = _rc.get(_rk)
            if raw:
                return json.loads(raw)
        except Exception:
            pass
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
        if _rc:
            try:
                _rc.setex(_rk, _NEGATIVE_CACHE_TTL_S if not results else _SEARCH_CACHE_TTL_S, json.dumps(results, default=str))
            except Exception:
                pass
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
    if len(coords) < 3:
        return {"type": "FeatureCollection", "features": []}
    if not sections:
        return {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"congestion": "unknown"}, "geometry": geometry}]}
    _level = {"JAM": "heavy", "ROAD_WORK": "moderate", "ROAD_CLOSURE": "severe"}
    features = []
    for sec in sections:
        start = sec.get("startPointIndex", 0)
        end   = min(sec.get("endPointIndex", start + 1) + 1, len(coords))
        level = _level.get(sec.get("simpleCategory", ""), "low")
        seg   = coords[start:end]
        if len(seg) >= 3:
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

def _point_distance_to_route_m(lat: float, lng: float, coords: list) -> float:
    if not coords:
        return float("inf")
    best = float("inf")
    # Sample long polylines so live incident filtering stays cheap.
    step = max(1, len(coords) // 300)
    for coord in coords[::step]:
        try:
            best = min(best, _haversine_m(lat, lng, coord[1], coord[0]))
        except Exception:
            continue
    return best

def _incident_coord(geometry: dict) -> tuple[float, float] | None:
    coords = geometry.get("coordinates")
    if not coords:
        return None
    cursor = coords
    while isinstance(cursor, list) and cursor and isinstance(cursor[0], list):
        cursor = cursor[len(cursor) // 2]
    if (
        isinstance(cursor, list)
        and len(cursor) >= 2
        and isinstance(cursor[0], (int, float))
        and isinstance(cursor[1], (int, float))
    ):
        return float(cursor[1]), float(cursor[0])
    return None

def _incident_cache_key(coords: list) -> tuple[str, str] | None:
    if len(coords) < 2:
        return None
    lngs = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    pad = 0.08
    left = round(min(lngs) - pad, 2)
    bottom = round(min(lats) - pad, 2)
    right = round(max(lngs) + pad, 2)
    top = round(max(lats) + pad, 2)
    bbox = f"{left},{bottom},{right},{top}"
    key = hashlib.sha1(bbox.encode("utf-8")).hexdigest()
    return key, bbox

def _tomtom_incidents_for_bbox(cache_key: str, bbox: str) -> list:
    now = time.time()
    with _incident_cache_lock:
        cached = _incident_cache.get(cache_key)
        if cached:
            ts, value = cached
            if now - ts <= _INCIDENT_CACHE_TTL_S:
                return value
            _incident_cache.pop(cache_key, None)

    try:
        client = get_redis()
        if client is not None:
            raw = client.get(f"{_INCIDENT_CACHE_PREFIX}{cache_key}")
            if raw:
                value = json.loads(raw)
                with _incident_cache_lock:
                    _incident_cache[cache_key] = (now, value)
                return value
    except Exception:
        pass

    fields = (
        "{incidents{type,geometry{type,coordinates},properties{"
        "iconCategory,magnitudeOfDelay,events{description,code},"
        "from,to,length,delay,roadNumbers"
        "}}}"
    )
    response = requests.get(
        "https://api.tomtom.com/traffic/services/5/incidentDetails",
        params={
            "key": TOMTOM_API_KEY,
            "bbox": bbox,
            "fields": fields,
            "language": "en-GB",
            "timeValidityFilter": "present",
        },
        timeout=6,
    )
    response.raise_for_status()
    payload = response.json()
    incidents = payload.get("incidents") or []

    with _incident_cache_lock:
        _incident_cache[cache_key] = (now, incidents)
    try:
        client = get_redis()
        if client is not None:
            client.setex(f"{_INCIDENT_CACHE_PREFIX}{cache_key}", _INCIDENT_CACHE_TTL_S, json.dumps(incidents))
    except Exception:
        pass
    return incidents

def _tomtom_live_incidents_along_route(geometry: dict, max_results: int = 12) -> list:
    """Official TomTom Traffic Incidents API, filtered to the route corridor.

    If the key has no incidents entitlement, or TomTom changes/blocks the call,
    this intentionally returns [] so route calculation remains usable.
    """
    coords = geometry.get("coordinates", [])
    if not _tomtom_ready or len(coords) < 2:
        return []
    try:
        cache_info = _incident_cache_key(coords)
        if not cache_info:
            return []
        cache_key, bbox = cache_info
        incidents = _tomtom_incidents_for_bbox(cache_key, bbox)
        alerts = []
        for incident in incidents:
            coord = _incident_coord(incident.get("geometry") or {})
            if not coord:
                continue
            lat, lng = coord
            if _point_distance_to_route_m(lat, lng, coords) > 1200:
                continue
            props = incident.get("properties") or {}
            events = props.get("events") or []
            description = ""
            if events and isinstance(events[0], dict):
                description = events[0].get("description") or ""
            category = str(props.get("iconCategory") or incident.get("type") or "").upper()
            delay_min = max(0, round(float(props.get("delay") or 0) / 60))
            magnitude = int(props.get("magnitudeOfDelay") or 0)
            severity = "severe" if magnitude >= 4 or delay_min >= 20 else "heavy" if magnitude >= 3 or delay_min >= 8 else "moderate"
            label_prefix = "🚧" if "ROAD" in category else "🚨" if "ACCIDENT" in category else "⚠️"
            label = f"{label_prefix} {description or 'Traffic incident'}"
            if delay_min > 0:
                label = f"{label} +{delay_min} min"
            alerts.append({
                "lat": round(lat, 5),
                "lng": round(lng, 5),
                "delay_min": delay_min,
                "severity": severity,
                "length_km": round(max(0, float(props.get("length") or 0)) / 1000, 1),
                "label": label,
                "source": "tomtom_incidents",
            })
        return alerts[:max_results]
    except Exception:
        return []

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
    # Forward-fill: propagate last known limit into unknown segments
    last = None
    for i in range(len(speeds)):
        if speeds[i] is not None:
            last = speeds[i]
        elif last is not None:
            speeds[i] = last
    # Backward-fill: fill leading Nones using first known value
    first = next((s for s in speeds if s is not None), None)
    if first is not None:
        for i in range(len(speeds)):
            if speeds[i] is None:
                speeds[i] = first
            else:
                break
    # EU HGV cap fallback (90 km/h) when TomTom has no data at all
    HGV_EU_CAP = 90
    return [
        {"speed": s, "unit": "km/h"} if s is not None else {"speed": HGV_EU_CAP, "unit": "km/h", "fallback": True}
        for s in speeds
    ]

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
        r = requests.post(url, params={"key": TOMTOM_API_KEY, "maxDetourTime": max_detour_s, "limit": limit, "language": "bg-BG", "spreadingMode": "auto"}, json=body, timeout=12)
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
            # Estimate travel time based on distance along route (80km/h = 22.2 m/s)
            travel_s = int(poi_distance_m / 22.2)
            results.append({"name": name, "lat": lat, "lng": lng, "distance_m": poi_distance_m, "travel_time": travel_s, "brand": brand, "truck_lane": truck_lane, "info": item.get("address", {}).get("freeformAddress"), "voice_desc": f"Намерих {name} на {(poi_distance_m/1000):.1f} километра по маршрута."})
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
        print(f"[ERROR] {exc}")
        return {"error": "Internal server error"}


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
            "routeRepresentation": "polyline",
            "locationReferencing": ["openlr"],
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
        if not routes_data and params.get("locationReferencing"):
            retry_params = dict(params)
            retry_params.pop("locationReferencing", None)
            print("[ROUTING] suggest_routes openlr request returned no routes; retrying without locationReferencing", flush=True)
            r = requests.get(url, params=retry_params, timeout=15)
            r.raise_for_status()
            routes_data = r.json().get("routes", [])
        if not routes_data:
            return {"error": "Няма маршрут", "steps": [], "geometry": None}
        primary_duration = routes_data[0].get("summary", {}).get("travelTimeInSeconds", 0)
        primary_dist_m   = routes_data[0].get("summary", {}).get("lengthInMeters", 0)

        preview_rts = routes_data[:3]
        raw_geoms   = [_tomtom_route_to_geojson(rt) for rt in preview_rts]

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
        print(f"[ERROR] {exc}")
        return {"error": "Internal server error"}


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
    except Exception as exc:
        print(f"[ERROR] {exc}")
        return {"error": "Internal server error"}
