import os, json, math, requests, time as _cache_time
from flask import Blueprint, jsonify, request
from config import TOMTOM_API_KEY
from database import get_db
from utils.helpers import _is_rate_limited, _get_body, now_iso, require_app_token, validate_coords
from services.tomtom_service import (
    _tomtom_route_to_geojson, _tomtom_lane_banner,
    _tomtom_speed_limits, _tomtom_congestion_geojson, _tomtom_traffic_alerts,
    _adr_to_tunnel_code, _mapbox_match_geometry, _mapbox_openlr_match, _find_openlr_code
)
from services.gpt_service import client

misc_bp = Blueprint('misc', __name__)

from collections import OrderedDict

class LRUCache(OrderedDict):
    def __init__(self, maxsize=200):
        self.maxsize = maxsize
        super().__init__()
    def __getitem__(self, key):
        value = super().__getitem__(key)
        self.move_to_end(key)
        return value
    def __setitem__(self, key, value):
        if key in self: self.move_to_end(key)
        super().__setitem__(key, value)
        if len(self) > self.maxsize: self.popitem(last=False)

_route_cache = LRUCache(maxsize=200)
_ROUTE_CACHE_TTL = 300
_ROUTE_RESTRICTION_DEADLINE_S = 6.0
_ROUTE_FAST_OVERPASS_TIMEOUT_S = 4.0

def _search_parking_tomtom(lat: float, lng: float, radius_m: int = 20000) -> list:
    from services.poi_service import _tool_find_truck_parking
    return _tool_find_truck_parking(lat, lng, radius_m)

def _validate_lng_lat_point(point):
    if not isinstance(point, (list, tuple)) or len(point) < 2:
        return None
    lat, lng = validate_coords(point[1], point[0])
    return [lng, lat] if lat is not None else None

def _validate_lng_lat_points(points, max_points: int = 500):
    if not isinstance(points, list) or len(points) > max_points:
        return None
    validated = []
    for point in points:
        parsed = _validate_lng_lat_point(point)
        if parsed is None:
            return None
        validated.append(parsed)
    return validated

def _bounded_int(value, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return min(max(parsed, minimum), maximum)

def _json_bool(value, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)

@misc_bp.get("/api/health")
def health():
    return jsonify({
        "status": "ok",
        "timestamp": now_iso()
    })

@misc_bp.post("/api/elevation")
def elevation_profile():
    body = _get_body()
    coords = _validate_lng_lat_points(body.get("coords") or [], max_points=80)
    if coords is None:
        return jsonify({"ok": False, "error": "invalid coords"}), 400
    if not coords:
        return jsonify({"ok": True, "elevations": []})

    locations = "|".join(f"{lat:.6f},{lng:.6f}" for lng, lat in coords)
    try:
        resp = requests.get(
            "https://api.opentopodata.org/v1/aster30m",
            params={"locations": locations},
            timeout=8,
        )
        resp.raise_for_status()
        results = resp.json().get("results")
        if not isinstance(results, list) or len(results) != len(coords):
            return jsonify({"ok": True, "elevations": None})

        elevations = []
        for item in results:
            elevation = item.get("elevation") if isinstance(item, dict) else None
            value = float(elevation)
            if not math.isfinite(value):
                return jsonify({"ok": True, "elevations": None})
            elevations.append(value)
        return jsonify({"ok": True, "elevations": elevations})
    except Exception:
        return jsonify({"ok": True, "elevations": None})

@misc_bp.get("/api/geocode")
@require_app_token
def geocode_proxy():
    query = request.args.get("query", "").strip()
    if not query:
        return jsonify({"error": "missing query"}), 400
    if not TOMTOM_API_KEY:
        return jsonify({"error": "TomTom API key not configured"}), 503

    params = {
        "key": TOMTOM_API_KEY,
        "limit": _bounded_int(request.args.get("limit"), 10, 1, 20),
        "language": "bg-BG",
    }
    lat, lon = request.args.get("lat"), request.args.get("lon")
    if lat or lon:
        lat_f, lon_f = validate_coords(lat, lon)
        if lat_f is None:
            return jsonify({"error": "invalid coordinates"}), 400
        params["lat"], params["lon"] = lat_f, lon_f
    radius = request.args.get("radius", type=int)
    if radius is not None:
        params["radius"] = min(max(radius, 1), 100_000)
    if request.args.get("typeahead") == "true":
        params["typeahead"] = "true"

    try:
        url = f"https://api.tomtom.com/search/2/search/{requests.utils.quote(query, safe='')}.json"
        resp = requests.get(url, params=params, timeout=8)
        return jsonify(resp.json()), resp.status_code
    except requests.RequestException:
        return jsonify({"error": "geocoding unavailable"}), 502
    except ValueError:
        return jsonify({"error": "invalid geocoding response"}), 502

@misc_bp.get("/api/geocode/place")
@require_app_token
def geocode_place_proxy():
    entity_id = request.args.get("entity_id", "").strip()
    if not entity_id:
        return jsonify({"error": "missing entity_id"}), 400
    if not TOMTOM_API_KEY:
        return jsonify({"error": "TomTom API key not configured"}), 503
    try:
        resp = requests.get(
            "https://api.tomtom.com/search/2/place.json",
            params={"entityId": entity_id, "key": TOMTOM_API_KEY, "language": "bg-BG"},
            timeout=8,
        )
        return jsonify(resp.json()), resp.status_code
    except requests.RequestException:
        return jsonify({"error": "geocoding unavailable"}), 502
    except ValueError:
        return jsonify({"error": "invalid geocoding response"}), 502

_NUMERIC_RESTRICTION_TAGS = (
    "maxheight",
    "maxweight",
    "maxwidth",
    "maxweight:hgv",
    "maxweightrating",
    "maxgcweight",
)
_ACCESS_RESTRICTION_TAGS = ("hgv", "goods", "hazmat")
_RESTRICTION_TAGS = _NUMERIC_RESTRICTION_TAGS + _ACCESS_RESTRICTION_TAGS
_DENY_VALUES = {"no", "private", "destination", "delivery"}
_OVERPASS_ENDPOINTS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://z.overpass-api.de/api/interpreter",
)
_OVERPASS_HEADERS = {
    "User-Agent": "TruckAI/1.0 route-restriction-checker",
    "Accept": "application/json",
}

def _restriction_query(bbox: str) -> str:
    clauses = []
    for tag in _RESTRICTION_TAGS:
        clauses.append(f'node["{tag}"]({bbox});')
        clauses.append(f'way["{tag}"]({bbox});')
    return f'[out:json][timeout:10];({"".join(clauses)});out center 400;'

def _overpass_restrictions(query: str, timeout_s: float = 12, max_endpoints: int | None = None) -> list:
    last_error = None
    endpoints = _OVERPASS_ENDPOINTS[:max_endpoints] if max_endpoints else _OVERPASS_ENDPOINTS
    for endpoint in endpoints:
        try:
            r = requests.post(
                endpoint,
                data={"data": query},
                headers=_OVERPASS_HEADERS,
                timeout=timeout_s,
            )
            r.raise_for_status()
            return r.json().get("elements", [])
        except Exception as e:
            last_error = e
            print(f"[OVERPASS] restriction check failed via {endpoint}: {e}", flush=True)
    if last_error:
        raise last_error
    return []

def _restriction_value_num(raw: str) -> float | None:
    try:
        value = float(str(raw).replace(",", ".").split()[0])
        # OSM weight limits are usually tonnes when decimal (3.5), but some
        # data uses kilograms (3500). The app stores vehicle weight in tonnes.
        return value / 1000 if value > 100 else value
    except Exception:
        return None

def _normalize_restriction(tag: str, raw: str) -> dict | None:
    raw_text = str(raw).strip()
    if tag in ("maxweight:hgv", "maxweightrating", "maxgcweight"):
        value_num = _restriction_value_num(raw_text)
        return {"type": "maxweight", "value": raw_text, "value_num": value_num} if value_num is not None else None
    if tag in ("maxheight", "maxweight", "maxwidth"):
        value_num = _restriction_value_num(raw_text)
        return {"type": tag, "value": raw_text, "value_num": value_num} if value_num is not None else None
    deny_value = raw_text.lower().split("@", 1)[0].strip()
    if tag in ("hgv", "goods") and deny_value in _DENY_VALUES:
        return {"type": "no_trucks", "value": raw_text, "value_num": 0}
    if tag == "hazmat" and deny_value in _DENY_VALUES:
        return {"type": "hazmat", "value": raw_text, "value_num": 0}
    return None

def _extract_route_restrictions(geometry: dict, include_status: bool = False, fast: bool = False):
    coords = geometry.get("coordinates", [])
    if len(coords) < 2:
        return ([], False) if include_status else []

    max_points = 24 if fast else 48
    if len(coords) > max_points:
        step = len(coords) / max_points
        coords = [coords[int(i * step)] for i in range(max_points)]
        coords[-1] = geometry.get("coordinates", [])[-1]

    approx_m = 0.0
    for i in range(1, len(coords)):
        dx = coords[i][0] - coords[i - 1][0]
        dy = coords[i][1] - coords[i - 1][1]
        approx_m += (dx * dx + dy * dy) ** 0.5 * 111000

    if fast:
        max_segments = 2 if approx_m <= 250000 else 1
        deadline = _cache_time.monotonic() + _ROUTE_RESTRICTION_DEADLINE_S
    else:
        max_segments = 4 if approx_m <= 250000 else 2
        deadline = None
    seg_size = max(2, (len(coords) + max_segments - 1) // max_segments)
    segments = []
    for start in range(0, len(coords), seg_size):
        seg = coords[start:start + seg_size]
        if start > 0 and seg:
            seg = [coords[start - 1]] + seg
        if len(seg) >= 2:
            segments.append(seg)

    results, seen = [], set()
    successful_checks = 0
    for seg in segments[:max_segments]:
        if deadline is not None and _cache_time.monotonic() >= deadline:
            print("[OVERPASS] route restriction fast deadline reached", flush=True)
            break
        lats, lngs = [c[1] for c in seg], [c[0] for c in seg]
        bbox = f"{min(lats)-0.006},{min(lngs)-0.006},{max(lats)+0.006},{max(lngs)+0.006}"
        try:
            if deadline is not None:
                remaining_s = max(1.0, min(_ROUTE_FAST_OVERPASS_TIMEOUT_S, deadline - _cache_time.monotonic()))
                elements = _overpass_restrictions(_restriction_query(bbox), timeout_s=remaining_s, max_endpoints=1)
            else:
                elements = _overpass_restrictions(_restriction_query(bbox))
            successful_checks += 1
        except Exception as e:
            print(f"[OVERPASS] restriction check failed for bbox {bbox}: {e}", flush=True)
            continue
        for el in elements:
            tags = el.get("tags", {})
            lat, lng = el.get("lat") or el.get("center", {}).get("lat"), el.get("lon") or el.get("center", {}).get("lon")
            if lat is None: continue
            for tag in _RESTRICTION_TAGS:
                raw = tags.get(tag)
                if not raw: continue
                normalized = _normalize_restriction(tag, raw)
                if not normalized: continue
                key = (normalized["type"], str(normalized["value"]), round(lat, 3), round(lng, 3))
                if key not in seen:
                    seen.add(key)
                    results.append({"lat": lat, "lng": lng, "tag": tag, **normalized})
    checked = successful_checks > 0
    if include_status:
        return results[:80], checked
    return results[:80]

@misc_bp.post("/api/check-truck-restrictions")
@require_app_token
def check_truck_restrictions():
    if _is_rate_limited(limit=10, window_s=60): return jsonify({"ok": False, "safe": False, "warnings": ["Проверката за ограничения е временно ограничена. Опитайте пак след малко."], "restrictions_checked": False, "error": "Rate limited"}), 429
    body = _get_body()
    profile, coords = body.get("profile") or {}, body.get("coords") or []
    if not isinstance(coords, list) or len(coords) < 2:
        return jsonify({"ok": False, "safe": False, "warnings": ["Няма достатъчно координати за проверка на ограничения."], "restrictions_checked": False, "error": "coords required"}), 400
    coords = _validate_lng_lat_points(coords)
    if coords is None:
        return jsonify({"ok": False, "safe": False, "warnings": [], "restrictions_checked": False, "error": "invalid coordinates"}), 400

    def _num(value):
        try:
            return float(str(value).replace(",", ".").split()[0])
        except Exception:
            return None

    checks = {
        "maxheight": ("height_m", "височина", "м"),
        "maxwidth":  ("width_m",  "ширина",  "м"),
        "maxweight": ("weight_t", "тегло",   "т"),
    }
    restrictions, restrictions_checked = _extract_route_restrictions({"type": "LineString", "coordinates": coords}, include_status=True)
    if not restrictions_checked:
        return jsonify({
            "ok": True,
            "safe": False,
            "warnings": ["Проверката за ограничения по маршрута не успя. Не приемай маршрута като проверен за камион."],
            "restrictions_checked": False,
        })

    warnings, seen = [], set()
    for restriction in restrictions:
        if restriction.get("type") == "no_trucks":
            truck_weight_t = _num(profile.get("weight_t"))
            truck_length_m = _num(profile.get("length_m"))
            is_truck = (
                (truck_weight_t is not None and truck_weight_t >= 3.5) or
                (truck_length_m is not None and truck_length_m > 6.0)
            )
            if is_truck:
                key = ("no_trucks", round(restriction.get("lat", 0), 3), round(restriction.get("lng", 0), 3))
                if key not in seen:
                    seen.add(key)
                    warnings.append(f"Забрана за камиони около {restriction.get('lat'):.4f},{restriction.get('lng'):.4f}.")
            continue
        if restriction.get("type") == "hazmat":
            hazmat_class = str(profile.get("hazmat_class") or "none").lower()
            if hazmat_class not in ("", "none", "0", "false"):
                key = ("hazmat", round(restriction.get("lat", 0), 3), round(restriction.get("lng", 0), 3))
                if key not in seen:
                    seen.add(key)
                    warnings.append(f"ADR/hazmat забрана около {restriction.get('lat'):.4f},{restriction.get('lng'):.4f}.")
            continue
        field, label, unit = checks.get(restriction.get("type"), (None, None, None))
        truck_value = _num(profile.get(field)) if field else None
        limit_value = _num(restriction.get("value_num") or restriction.get("value"))
        if truck_value is None or limit_value is None or truck_value <= limit_value:
            continue
        key = (field, round(restriction.get("lat", 0), 3), round(restriction.get("lng", 0), 3), limit_value)
        if key in seen:
            continue
        seen.add(key)
        warnings.append(
            f"Ограничение по {label}: {limit_value:g}{unit}; камионът е {truck_value:g}{unit} "
            f"около {restriction.get('lat'):.4f},{restriction.get('lng'):.4f}."
        )
    return jsonify({"ok": True, "safe": len(warnings) == 0, "warnings": warnings, "restrictions": restrictions, "restrictions_checked": True})

def _decode_google_polyline(encoded: str) -> list:
    """Decode Google encoded polyline to [[lng, lat], ...] list."""
    coords, index, lat, lng = [], 0, 0, 0
    while index < len(encoded):
        shift, result = 0, 0
        while True:
            b = ord(encoded[index]) - 63; index += 1
            result |= (b & 0x1f) << shift; shift += 5
            if b < 0x20: break
        lat += (~(result >> 1) if (result & 1) else (result >> 1))
        shift, result = 0, 0
        while True:
            b = ord(encoded[index]) - 63; index += 1
            result |= (b & 0x1f) << shift; shift += 5
            if b < 0x20: break
        lng += (~(result >> 1) if (result & 1) else (result >> 1))
        coords.append([lng / 1e5, lat / 1e5])
    return coords

def _sample_tomtom_waypoints(instructions: list, max_wps: int = 23) -> list:
    """Extract key turn waypoints from TomTom instructions, max 23 (leaving 2 for origin/dest).
    Adds a midpoint for straight segments > 50 km to prevent Google from shortcutting."""
    TURNS = {'TURN_RIGHT','TURN_LEFT','BEAR_RIGHT','BEAR_LEFT','SHARP_RIGHT','SHARP_LEFT',
             'ROUNDABOUT_RIGHT','ROUNDABOUT_LEFT','KEEP_RIGHT','KEEP_LEFT',
             'FORK_RIGHT','FORK_LEFT','U_TURN_RIGHT','U_TURN_LEFT',
             'MOTORWAY_EXIT_RIGHT','MOTORWAY_EXIT_LEFT','ROUNDABOUT'}
    selected, prev_offset, prev_coord = [], 0, None
    for instr in instructions:
        point = instr.get('point')
        if not point: continue
        coord = [point['longitude'], point['latitude']]
        offset = instr.get('routeOffsetInMeters', 0)
        # Insert midpoint for long straight segments > 50 km
        if prev_coord and (offset - prev_offset) > 50_000:
            selected.append([(prev_coord[0]+coord[0])/2, (prev_coord[1]+coord[1])/2])
        if instr.get('maneuver', '').upper() in TURNS:
            selected.append(coord)
        prev_offset, prev_coord = offset, coord
    # Subsample if still over limit
    if len(selected) > max_wps:
        step = len(selected) / max_wps
        selected = [selected[int(i * step)] for i in range(max_wps)]
    return selected

def _google_directions_polyline(origin: list, destination: list, waypoints: list) -> list:
    """Re-route via Google Directions API using TomTom waypoints → returns [lng,lat] coords."""
    api_key = os.environ.get('GOOGLE_MAPS_API_KEY') or os.environ.get('GOOGLE_PLACES_KEY', '')
    if not api_key: return []
    params = {
        "origin": f"{origin[1]},{origin[0]}",
        "destination": f"{destination[1]},{destination[0]}",
        "mode": "driving",
        "key": api_key,
    }
    if waypoints:
        params["waypoints"] = "via:" + "|via:".join(f"{c[1]},{c[0]}" for c in waypoints)
    try:
        r = requests.get("https://maps.googleapis.com/maps/api/directions/json", params=params, timeout=12)
        r.raise_for_status()
        data = r.json()
        if data.get("status") != "OK": return []
        encoded = data["routes"][0]["overview_polyline"]["points"]
        return _decode_google_polyline(encoded)
    except Exception:
        return []

def _simple_congestion_geojson(geometry: dict, delay_seconds: int = 0) -> dict:
    congestion = "heavy" if delay_seconds >= 900 else "moderate" if delay_seconds >= 300 else "low"
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"congestion": congestion},
                "geometry": geometry,
            }
        ],
    }

def _tomtom_steps(route: dict, total_m: int) -> list:
    instructions = route.get("guidance", {}).get("instructions", [])
    total_s = route.get("summary", {}).get("travelTimeInSeconds", 0)
    steps = []
    for i, instr in enumerate(instructions):
        nxt = instructions[i+1].get("routeOffsetInMeters", 0) if i+1 < len(instructions) else total_m
        current_s = instr.get("travelTimeInSeconds", 0)
        next_s = instructions[i+1].get("travelTimeInSeconds", total_s) if i+1 < len(instructions) else total_s
        steps.append({
            "maneuver": {
                "instruction": instr.get("message", ""),
                "type": instr.get("maneuver", ""),
                "modifier": None,
            },
            "distance": max(0, nxt - instr.get("routeOffsetInMeters", 0)),
            "duration": max(0, next_s - current_s),
            "name": instr.get("street", ""),
            "intersections": [{"location": [instr["point"]["longitude"], instr["point"]["latitude"]]}] if instr.get("point") else [],
            "bannerInstructions": [_tomtom_lane_banner(instr)] if _tomtom_lane_banner(instr) else [],
        })
    return steps

@misc_bp.route("/api/routes/calculate", methods=["POST"])
@require_app_token
def calculate_route():
    if _is_rate_limited(limit=10, window_s=60): return jsonify({"error": "Rate limited"}), 429
    data = request.json or {}
    origin, destination, waypoints, truck = data.get("origin"), data.get("destination"), data.get("waypoints", []), data.get("truck", {})
    if not origin or not destination: return jsonify({"error": "origin and destination required"}), 400
    origin, destination = _validate_lng_lat_point(origin), _validate_lng_lat_point(destination)
    waypoints = _validate_lng_lat_points(waypoints, max_points=25)
    if origin is None or destination is None or waypoints is None:
        return jsonify({"error": "invalid coordinates"}), 400
    if not TOMTOM_API_KEY: return jsonify({"error": "TomTom API key not configured"}), 503
    include_restrictions = _json_bool(data.get("include_restrictions"), True)
    o_lat, o_lng, d_lat, d_lng = round(origin[1], 6), round(origin[0], 6), round(destination[1], 6), round(destination[0], 6)
    truck_key = (
        f"{truck.get('max_height')}:{truck.get('max_weight')}:{truck.get('max_width')}:"
        f"{truck.get('max_length')}:{truck.get('hazmat_class')}:{truck.get('adr_tunnel')}:"
        f"{truck.get('avoidUnpaved')}:{data.get('depart_at')}:vmax=90"
    )
    cache_key = f"route:{o_lat},{o_lng}:{d_lat},{d_lng}:{str(waypoints)}:{truck_key}:opt={data.get('optimize', False)}:restr={include_restrictions}"
    if cache_key in _route_cache:
        res, exp = _route_cache[cache_key]
        if _cache_time.time() < exp: return jsonify(res)
    all_points = [origin] + waypoints + [destination]
    locations = ":".join(f"{p[1]},{p[0]}" for p in all_points)
    # Base avoid list — low emission zones + unpaved
    avoid_list = ["lowEmissionZones", "unpavedRoads"] if truck.get("avoidUnpaved") else ["lowEmissionZones"]
    params = {"key": TOMTOM_API_KEY, "travelMode": "truck", "vehicleCommercial": "true", "vehicleMaxSpeed": 90, "vehicleEngineType": "combustion", "avoid": ",".join(avoid_list), "traffic": "true", "computeTravelTimeFor": "all", "routeType": "fastest", "instructionsType": "tagged", "language": "bg-BG", "sectionType": "traffic", "maxAlternatives": 1, "routeRepresentation": "polyline", "locationReferencing": ["openlr"]}
    if data.get("optimize"): params["computeBestOrder"] = "true"
    if truck.get("max_height"): params["vehicleHeight"] = truck["max_height"]
    if truck.get("max_width"): params["vehicleWidth"] = truck["max_width"]
    if truck.get("max_weight"): params["vehicleWeight"] = int(truck["max_weight"] * 1000)
    if truck.get("max_length"): params["vehicleLength"] = truck["max_length"]
    if truck.get("axle_count"): params["vehicleNumberOfAxles"] = truck["axle_count"]
    adr_tunnel = truck.get("adr_tunnel") or data.get("adr_tunnel_code")
    code = adr_tunnel if adr_tunnel in {"B", "C", "D", "E"} else _adr_to_tunnel_code(truck.get("hazmat_class", "none"))
    if code: params["vehicleAdrTunnelRestrictionCode"] = code
    try:
        r = requests.get(f"https://api.tomtom.com/routing/1/calculateRoute/{locations}/json", params=params, timeout=15)
        tomtom_data = r.json()
        routes = tomtom_data.get("routes", [])
        if not routes and params.get("locationReferencing"):
            retry_params = dict(params)
            retry_params.pop("locationReferencing", None)
            print("[ROUTING] openlr route request returned no routes; retrying without locationReferencing", flush=True)
            r = requests.get(f"https://api.tomtom.com/routing/1/calculateRoute/{locations}/json", params=retry_params, timeout=15)
            tomtom_data = r.json()
            routes = tomtom_data.get("routes", [])
        if not routes: return jsonify({"error": "Няма маршрут"}), 404
        rt, summary = routes[0], routes[0].get("summary", {})
        total_m = summary.get("lengthInMeters", 0)
        raw_geom = _tomtom_route_to_geojson(rt)
        geom, snapped_primary = raw_geom, False
        openlr_code = _find_openlr_code(rt)
        match_path = "raw"
        if openlr_code:
            openlr_geom = _mapbox_openlr_match(openlr_code)
            if openlr_geom:
                geom, snapped_primary = openlr_geom, True
                match_path = "openlr"
        if not snapped_primary:
            geom, snapped_primary = _mapbox_match_geometry(raw_geom)
            match_path = "coordinate_match" if snapped_primary else "raw"
        print(f"[ROUTING] using {match_path} openlr={bool(openlr_code)} distance_m={total_m} coords={len(raw_geom.get('coordinates', []))}", flush=True)

        instructions = rt.get("guidance", {}).get("instructions", [])
        steps = _tomtom_steps(rt, total_m)

        # If Mapbox matching refuses the geometry (common when TomTom returns many points),
        # restore the short-route Google polyline fallback that keeps urban routes snapped.
        if not snapped_primary and total_m < 80_000:
            wps = _sample_tomtom_waypoints(instructions)
            google_coords = _google_directions_polyline(origin, destination, wps)
            if google_coords:
                geom = {"type": "LineString", "coordinates": google_coords}
                snapped_primary = True

        alt_routes = routes[1:3]
        alternatives = []
        for idx, ar in enumerate(alt_routes):
            alt_summary = ar.get("summary", {})
            raw_alt_geom = _tomtom_route_to_geojson(ar)
            alt_m = alt_summary.get("lengthInMeters", 0)
            alt_geom, snapped_alt = raw_alt_geom, False
            alt_openlr_code = _find_openlr_code(ar)
            alt_match_path = "raw"
            if alt_openlr_code:
                alt_openlr_geom = _mapbox_openlr_match(alt_openlr_code)
                if alt_openlr_geom:
                    alt_geom, snapped_alt = alt_openlr_geom, True
                    alt_match_path = "openlr"
            if not snapped_alt:
                alt_geom, snapped_alt = _mapbox_match_geometry(raw_alt_geom)
                alt_match_path = "coordinate_match" if snapped_alt else "raw"
            print(f"[ROUTING] alt {idx + 1} using {alt_match_path} openlr={bool(alt_openlr_code)} distance_m={alt_m} coords={len(raw_alt_geom.get('coordinates', []))}", flush=True)
            alt_congestion = (
                _simple_congestion_geojson(alt_geom, alt_summary.get("trafficDelayInSeconds", 0))
                if snapped_alt else
                _tomtom_congestion_geojson(ar, raw_alt_geom)
            )
            alt_traffic_alerts = _tomtom_traffic_alerts(ar, raw_alt_geom)
            alternatives.append({
                "label": ["Алтернатива 1", "Алтернатива 2"][idx],
                "color": ["#B922FF", "#08F384"][idx],
                "duration": alt_summary.get("travelTimeInSeconds", 0),
                "distance": alt_summary.get("lengthInMeters", 0),
                "traffic": "moderate",
                "geometry": alt_geom,
                "dest_coords": destination,
                "congestion_geojson": alt_congestion,
                "traffic_alerts": alt_traffic_alerts,
                "steps": _tomtom_steps(ar, alt_m),
                "maxspeeds": _tomtom_speed_limits(ar),
                "restrictions": [],
            })

        # Section indices match the raw TomTom polyline. If we replace the geometry with snapped
        # road segments, keep traffic colouring simple so the visible line stays aligned.
        congestion_geojson = (
            _simple_congestion_geojson(geom, summary.get("trafficDelayInSeconds", 0))
            if snapped_primary else
            _tomtom_congestion_geojson(rt, raw_geom)
        )
        traffic_alerts = _tomtom_traffic_alerts(rt, raw_geom)
        restrictions = _extract_route_restrictions(geom, fast=True) if include_restrictions and total_m <= 400000 else []

        final = {"geometry": geom, "distance": total_m, "duration": summary.get("travelTimeInSeconds", 0), "traffic_delay": summary.get("trafficDelayInSeconds", 0), "steps": steps, "maxspeeds": _tomtom_speed_limits(rt), "congestionGeoJSON": congestion_geojson, "traffic_alerts": traffic_alerts, "restrictions": restrictions, "alternatives": alternatives, "optimizedWaypointOrder": [w.get("providedIndex") for w in rt.get("optimizedWaypoints", [])] if data.get("optimize") else None}
        _route_cache[cache_key] = (final, _cache_time.time() + _ROUTE_CACHE_TTL)
        return jsonify(final)
    except Exception as e: return jsonify({"error": str(e)}), 500

@misc_bp.post("/api/routes/start")
@require_app_token
def start_route_log():
    data = _get_body()
    origin_lat, origin_lng = validate_coords(data.get("origin_lat"), data.get("origin_lng"))
    dest_lat, dest_lng = validate_coords(data.get("dest_lat"), data.get("dest_lng"))
    if origin_lat is None or dest_lat is None:
        return jsonify({"ok": False, "error": "invalid coordinates"}), 400

    try:
        waypoints = json.loads(data.get("waypoints_json") or "[]")
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "invalid waypoints_json"}), 400
    if not isinstance(waypoints, list) or len(waypoints) > 25:
        return jsonify({"ok": False, "error": "invalid waypoints_json"}), 400
    validated_waypoints = []
    for point in waypoints:
        if not isinstance(point, (list, tuple)) or len(point) < 2:
            return jsonify({"ok": False, "error": "invalid waypoints_json"}), 400
        lat, lng = validate_coords(point[0], point[1])
        if lat is None:
            return jsonify({"ok": False, "error": "invalid waypoints_json"}), 400
        validated_waypoints.append([lat, lng])

    try:
        distance_m = max(0.0, float(data.get("distance_m") or 0))
        duration_s = max(0.0, float(data.get("duration_s") or 0))
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "invalid route metrics"}), 400
    if not math.isfinite(distance_m) or not math.isfinite(duration_s):
        return jsonify({"ok": False, "error": "invalid route metrics"}), 400

    now = now_iso()
    with get_db() as conn:
        cursor = conn.execute(
            """
            INSERT INTO routes (
                user_email, origin_name, destination_name,
                origin_lat, origin_lng, dest_lat, dest_lng,
                waypoints_json, distance_m, duration_s,
                started_at, completed_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
            """,
            (
                (data.get("user_email") or "").strip(),
                (data.get("origin_name") or "").strip(),
                (data.get("destination_name") or "").strip(),
                origin_lat, origin_lng, dest_lat, dest_lng,
                json.dumps(validated_waypoints, ensure_ascii=False),
                distance_m, duration_s, now, now,
            ),
        )
        conn.commit()
    return jsonify({"ok": True, "route_id": cursor.lastrowid}), 201

@misc_bp.post("/api/routes/complete")
@require_app_token
def complete_route_log():
    try:
        route_id = int(_get_body().get("route_id"))
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "invalid route_id"}), 400
    with get_db() as conn:
        updated = conn.execute(
            "UPDATE routes SET completed_at=? WHERE id=? AND completed_at IS NULL",
            (now_iso(), route_id),
        ).rowcount
        conn.commit()
    return jsonify({"ok": updated > 0})

_LANDING_SYSTEM = (
    "You are TruckExpoAI's website assistant. Answer concisely (2-4 sentences max). "
    "Detect the visitor's language from their message and respond in the same language. "
    "You know everything about TruckExpoAI — a professional HGV truck navigation app for Android:\n"
    "• AI: GPT-4o for navigation commands + Gemini 2.0 Flash as AI co-driver\n"
    "• Maps: Mapbox GL with 3D buildings, traffic layers, terrain\n"
    "• Routing: TomTom truck-safe routing (HGV weight/height/width/hazmat)\n"
    "• TransParking: 59,436 truck parking spots offline database\n"
    "• Google Places fallback when TomTom search finds nothing\n"
    "• Tachograph: EU 561/2006 compliance + Bluetooth BLE tachograph integration\n"
    "• Truck bans: real-time weekend/holiday restrictions via trafficban.com\n"
    "• Voice: speak to the AI, it navigates and answers questions\n"
    "• POI management: save custom stops with TomTom geocoding\n"
    "• Offline maps support, Sentry crash reporting\n"
    "• Pricing: free tier available + Pro plans via in-app purchase (RevenueCat)\n"
    "• Platform: Android now, iOS coming\n"
    "• Beta access: email ceo@truckexpoai.com\n"
    "Do NOT make up features. If unsure, say to contact ceo@truckexpoai.com."
)

_LANDING_RATE: dict = {}
_LANDING_RATE_MAX_IPS = 2000  # prevent unbounded growth

@misc_bp.post("/api/landing-chat")
def landing_chat():
    import time as _t
    # Use remote_addr only — X-Forwarded-For is trivially spoofed
    ip = request.remote_addr or "unknown"
    now = _t.time()
    window = _LANDING_RATE.get(ip, [])
    window = [ts for ts in window if now - ts < 60]
    if len(window) >= 10:
        return jsonify({"ok": False, "error": "Too many requests"}), 429
    window.append(now)
    # Evict oldest entries when dict grows too large
    if len(_LANDING_RATE) > _LANDING_RATE_MAX_IPS:
        oldest = sorted(_LANDING_RATE, key=lambda k: _LANDING_RATE[k][-1] if _LANDING_RATE[k] else 0)
        for k in oldest[:200]:
            _LANDING_RATE.pop(k, None)
    _LANDING_RATE[ip] = window

    body = _get_body()
    user_msg = (body.get("message") or "")[:500].strip()
    if not user_msg:
        return jsonify({"ok": False, "error": "message required"}), 400

    raw_history = body.get("history") or []
    if not isinstance(raw_history, list):
        raw_history = []
    history = [
        {"role": h.get("role", "user"), "text": str(h.get("text", ""))[:300]}
        for h in raw_history[-6:]
        if isinstance(h, dict)
    ]

    from services.gemini_service import _gemini_client, _gemini_ready
    if not _gemini_ready:
        return jsonify({"ok": False, "error": "AI unavailable"}), 503

    contents = []
    for h in history:
        role = "user" if h["role"] == "user" else "model"
        contents.append({"role": role, "parts": [{"text": h["text"]}]})
    contents.append({"role": "user", "parts": [{"text": user_msg}]})

    try:
        from config import GEMINI_MODEL
        resp = _gemini_client.models.generate_content(
            model=GEMINI_MODEL,
            contents=contents,
            config={"system_instruction": _LANDING_SYSTEM, "temperature": 0.5, "max_output_tokens": 200},
        )
        return jsonify({"ok": True, "reply": (resp.text or "").strip()})
    except Exception:
        return jsonify({"ok": False, "error": "AI temporarily unavailable"}), 500


@misc_bp.post("/api/transcribe")
@require_app_token
def whisper_transcribe():
    if _is_rate_limited(limit=5, window_s=60): return jsonify({"error": "Rate limited"}), 429
    audio_file = request.files.get("audio")
    if not audio_file: return jsonify({"ok": False, "error": "No audio file"}), 400
    try:
        audio_file.stream.seek(0)
        resp = client.audio.transcriptions.create(
            model="whisper-1",
            file=(audio_file.filename or "recording.m4a", audio_file.stream, audio_file.mimetype or "audio/m4a"),
            language="bg",
            prompt="Truck navigation Bulgarian commands: маршрут, навигирай, карай до, паркинг за камион, гориво, тахограф, почивка, Лейда, Барселона, Испания.",
        )
        return jsonify({"ok": bool(resp.text), "text": resp.text.strip()})
    except Exception as e:
        print(f"[ERROR] {e}")
        return jsonify({"ok": False, "error": "Internal server error"}), 500
