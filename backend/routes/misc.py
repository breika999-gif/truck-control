import os, json, math, re, requests, time as _cache_time
from datetime import datetime, timezone
from flask import Blueprint, jsonify, request
from config import TOMTOM_API_KEY
from database import get_db, row_to_poi, DB_PATH
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

@misc_bp.post("/api/poi/search-along-route")
@require_app_token
def poi_search_along_route_proxy():
    body = _get_body()
    query = (body.get("query") or "").strip()
    points = (body.get("route") or {}).get("points") or []
    if not query:
        return jsonify({"error": "missing query"}), 400
    if not isinstance(points, list) or len(points) < 2 or len(points) > 400:
        return jsonify({"error": "invalid route"}), 400
    validated_points = []
    for point in points:
        if not isinstance(point, dict):
            return jsonify({"error": "invalid coordinates"}), 400
        lat, lon = validate_coords(point.get("lat"), point.get("lon"))
        if lat is None:
            return jsonify({"error": "invalid coordinates"}), 400
        validated_points.append({"lat": lat, "lon": lon})
    if not TOMTOM_API_KEY:
        return jsonify({"error": "TomTom API key not configured"}), 503

    params = {
        "key": TOMTOM_API_KEY,
        "maxDetourTime": _bounded_int(body.get("maxDetourTime"), 600, 0, 3600),
        "limit": _bounded_int(body.get("limit"), 8, 1, 20),
        "vehicleType": "Truck",
        "language": "bg-BG",
        "spreadingMode": "auto",
    }
    try:
        url = f"https://api.tomtom.com/search/2/alongRouteSearch/{requests.utils.quote(query, safe='')}.json"
        resp = requests.post(url, params=params, json={"route": {"points": validated_points}}, timeout=8)
        return jsonify(resp.json()), resp.status_code
    except requests.RequestException:
        return jsonify({"error": "POI search unavailable"}), 502
    except ValueError:
        return jsonify({"error": "invalid POI response"}), 502

@misc_bp.route("/api/google-sync", methods=["GET", "POST"])
@require_app_token
def google_sync():
    email = (request.args.get("user_email") or "").strip()
    if not email: return jsonify({"ok": False, "error": "email required"}), 400
    if request.method == "GET":
        with get_db() as conn: rows = conn.execute("SELECT * FROM pois WHERE user_email=? AND category='google_synced' ORDER BY created_at DESC", (email,)).fetchall()
        return jsonify({"ok": True, "pois": [row_to_poi(r) for r in rows]})
    pois, count, validated_pois = _get_body().get("pois", []), 0, []
    for p in pois:
        if not p.get("name") or p.get("lat") is None or p.get("lng") is None:
            continue
        lat, lng = validate_coords(p.get("lat"), p.get("lng"))
        if lat is None:
            return jsonify({"ok": False, "error": "invalid coordinates"}), 400
        validated_pois.append((p, lat, lng))
    with get_db() as conn:
        for p, lat, lng in validated_pois:
            conn.execute("INSERT OR REPLACE INTO pois (name, address, category, lat, lng, notes, user_email, created_at) VALUES (?,?,?,?,?,?,?,?)", (p["name"], p.get("address", ""), "google_synced", lat, lng, p.get("notes", ""), email, now_iso()))
            count += 1
        conn.commit()
    return jsonify({"ok": True, "imported": count})

@misc_bp.route("/api/truck-bans/cache", methods=["DELETE", "POST"])
def clear_truck_bans_cache():
    admin_key = request.headers.get("X-Admin-Key", "")
    if admin_key != os.environ.get("ADMIN_KEY", ""): return jsonify({"error": "Unauthorized"}), 401
    try:
        with get_db() as conn:
            conn.execute("DELETE FROM truck_bans_cache")
            conn.commit()
        return jsonify({"ok": True, "message": "Cache cleared"})
    except Exception as e:
        print(f"[ERROR] {e}")
        return jsonify({"ok": False, "error": "Internal server error"}), 500

@misc_bp.route("/api/truck-bans", methods=["GET"])
def get_truck_bans():
    date_str = request.args.get("date")
    if not date_str: return jsonify({"bans": [], "error": "date required"}), 400
    
    # Try cache first
    try:
        with get_db() as conn:
            row = conn.execute("SELECT data, fetched_at FROM truck_bans_cache WHERE date=?", (date_str,)).fetchone()
            if row:
                diff = (datetime.now(timezone.utc) - datetime.fromisoformat(row["fetched_at"]).replace(tzinfo=timezone.utc)).total_seconds()
                if diff < 604800: # 1 week
                    return jsonify({"bans": json.loads(row["data"]), "source": "cache"})
    except: pass

    session = requests.Session()
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "en-US,en;q=0.9",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": "https://www.trafficban.com/",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
    }

    try:
        # Step 1: get cookies
        root_resp = session.get("https://www.trafficban.com/", headers=headers, timeout=10)
        
        # Step 2: get dynamic param name from JS
        js_resp = session.get("https://www.trafficban.com/res/js/js.ban.list.for.date.html", headers=headers, timeout=10)
        m = re.search(r'\?([A-Za-z0-9]{5,15})=', js_resp.text)
        param_name = m.group(1) if m else "KHcYF42A"
        
        # Step 3: try session key
        key_resp = session.get(f"https://www.trafficban.com/res/json/json.get.key.html?d={date_str}", headers=headers, timeout=10)
        key_data = {}
        try: key_data = key_resp.json()
        except: pass
        key = key_data.get("key")
        
        # Step 4: try fetch (with key or without)
        fetch_url = f"https://www.trafficban.com/res/json/json.ban.list.for.date.html?{param_name}={key or ''}&d={date_str}"
        bans_resp = session.get(fetch_url, headers=headers, timeout=10)
        
        if not bans_resp.ok:
            return jsonify({"bans": [], "error": f"HTTP {bans_resp.status_code}"}), 502

        try:
            raw_bans = bans_resp.json()
        except:
            return jsonify({"bans": [], "error": "Not JSON"}), 502

        if not isinstance(raw_bans, list):
            return jsonify({"bans": [], "error": "Not a list"}), 502

        formatted = []
        for b in raw_bans:
            formatted.append({
                "flag": b.get("fl"),
                "country": b.get("cr"),
                "time": b.get("tm"),
                "alert": bool(b.get("al")),
                "note": "Важна забрана" if b.get("al") else ""
            })

        # Save to cache
        try:
            with get_db() as conn:
                conn.execute("INSERT OR REPLACE INTO truck_bans_cache (date, data, fetched_at) VALUES (?, ?, ?)", 
                             (date_str, json.dumps(formatted), now_iso()))
                conn.commit()
        except: pass

        return jsonify({"bans": formatted, "source": "live"})

    except Exception:
        return jsonify({"bans": [], "error": "Request failed"}), 502

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

def _overpass_restrictions(query: str) -> list:
    last_error = None
    for endpoint in _OVERPASS_ENDPOINTS:
        try:
            r = requests.post(
                endpoint,
                data={"data": query},
                headers=_OVERPASS_HEADERS,
                timeout=12,
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

def _extract_route_restrictions(geometry: dict, include_status: bool = False):
    coords = geometry.get("coordinates", [])
    if len(coords) < 2:
        return ([], False) if include_status else []

    max_points = 48
    if len(coords) > max_points:
        step = len(coords) / max_points
        coords = [coords[int(i * step)] for i in range(max_points)]
        coords[-1] = geometry.get("coordinates", [])[-1]

    approx_m = 0.0
    for i in range(1, len(coords)):
        dx = coords[i][0] - coords[i - 1][0]
        dy = coords[i][1] - coords[i - 1][1]
        approx_m += (dx * dx + dy * dy) ** 0.5 * 111000

    max_segments = 4 if approx_m <= 250000 else 2
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
        lats, lngs = [c[1] for c in seg], [c[0] for c in seg]
        bbox = f"{min(lats)-0.006},{min(lngs)-0.006},{max(lats)+0.006},{max(lngs)+0.006}"
        try:
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
            alt_restrictions = _extract_route_restrictions(alt_geom) if include_restrictions and alt_m <= 400000 else []
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
                "restrictions": alt_restrictions,
            })

        # Section indices match the raw TomTom polyline. If we replace the geometry with snapped
        # road segments, keep traffic colouring simple so the visible line stays aligned.
        congestion_geojson = (
            _simple_congestion_geojson(geom, summary.get("trafficDelayInSeconds", 0))
            if snapped_primary else
            _tomtom_congestion_geojson(rt, raw_geom)
        )
        traffic_alerts = _tomtom_traffic_alerts(rt, raw_geom)
        restrictions = _extract_route_restrictions(geom) if include_restrictions and total_m <= 400000 else []

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

@misc_bp.get("/api/routes")
@require_app_token
def route_history():
    email = (request.args.get("user_email") or "").strip()
    limit = _bounded_int(request.args.get("limit"), 20, 1, 100)
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT id, user_email, origin_name, destination_name,
                   origin_lat, origin_lng, dest_lat, dest_lng,
                   waypoints_json, distance_m, duration_s,
                   started_at, completed_at, created_at
            FROM routes
            WHERE user_email=?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (email, limit),
        ).fetchall()
    return jsonify({"ok": True, "routes": [dict(row) for row in rows]})

@misc_bp.post("/api/transcribe")
@require_app_token
def whisper_transcribe():
    if _is_rate_limited(limit=5, window_s=60): return jsonify({"error": "Rate limited"}), 429
    audio_file = request.files.get("audio")
    if not audio_file: return jsonify({"ok": False, "error": "No audio file"}), 400
    try:
        audio_file.stream.seek(0)
        resp = client.audio.transcriptions.create(model="whisper-1", file=(audio_file.filename or "recording.m4a", audio_file.stream, audio_file.mimetype or "audio/m4a"), language="bg")
        return jsonify({"ok": bool(resp.text), "text": resp.text.strip()})
    except Exception as e:
        print(f"[ERROR] {e}")
        return jsonify({"ok": False, "error": "Internal server error"}), 500
