import hashlib
import json
import requests
import concurrent.futures
import math
import time
from config import GOOGLE_PLACES_KEY, TOMTOM_API_KEY
from utils.helpers import _haversine_m
from utils.redis_client import get_redis
from database import _transparking_match, _poi_cache_get, _poi_cache_set, _poi_cache_key

_places_ready = bool(GOOGLE_PLACES_KEY)
_tomtom_ready = bool(TOMTOM_API_KEY)
_GOOGLE_SEARCH_CACHE_TTL_S = 30 * 86400
_NEGATIVE_CACHE_TTL_S = 3600
_OVERPASS_CACHE_TTL_S = 24 * 3600
_overpass_memory_cache: dict[str, tuple[float, dict]] = {}

def _google_places_fallback(query: str, lat: float, lng: float) -> list:
    if not _places_ready: return []
    _lat_r = round(float(lat or 0), 1)
    _lng_r = round(float(lng or 0), 1)
    _rk = "geo:google:" + hashlib.sha256(f"{query.lower().strip()}:{_lat_r}:{_lng_r}".encode("utf-8")).hexdigest()
    _rc = get_redis()
    if _rc:
        try:
            raw = _rc.get(_rk)
            if raw:
                return json.loads(raw)
        except Exception:
            pass
    try:
        url = "https://maps.googleapis.com/maps/api/place/textsearch/json"
        params = {"query": query, "key": GOOGLE_PLACES_KEY, "language": "bg"}
        if lat and lng: params.update({"location": f"{lat},{lng}", "radius": 50000})
        r = requests.get(url, params=params, timeout=8)
        r.raise_for_status()
        results = []
        for item in r.json().get("results", []):
            loc = item.get("geometry", {}).get("location", {})
            if loc.get("lat") is None: continue
            results.append({"name": item.get("name"), "address": item.get("formatted_address", ""), "lat": loc["lat"], "lng": loc["lng"], "distance_m": round(_haversine_m(lat, lng, loc["lat"], loc["lng"])) if lat else 0, "source": "google"})
        if _rc:
            try:
                _rc.setex(_rk, _NEGATIVE_CACHE_TTL_S if not results else _GOOGLE_SEARCH_CACHE_TTL_S, json.dumps(results, default=str))
            except Exception:
                pass
        return results
    except Exception: return []

def _safe_lat(v) -> float:
    f = float(v)
    if not (-90.0 <= f <= 90.0): raise ValueError(f"lat out of range: {f}")
    return f

def _safe_lng(v) -> float:
    f = float(v)
    if not (-180.0 <= f <= 180.0): raise ValueError(f"lng out of range: {f}")
    return f

def _safe_radius(v, max_m: int = 500_000) -> int:
    i = int(float(v))
    if not (0 < i <= max_m): raise ValueError(f"radius out of range: {i}")
    return i

def _overpass_cache_key(kind: str, lat: float, lng: float, radius_m: int) -> str:
    rounded_lat = round(lat, 3)
    rounded_lng = round(lng, 3)
    radius_bucket = int(math.ceil(radius_m / 1000) * 1000)
    raw = f"{kind}:{rounded_lat}:{rounded_lng}:{radius_bucket}"
    return "overpass:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()

def _overpass_cache_get(key: str) -> dict | None:
    cached = _overpass_memory_cache.get(key)
    if cached:
        expires_at, value = cached
        if expires_at > time.time():
            return value
        _overpass_memory_cache.pop(key, None)
    client = get_redis()
    if client:
        try:
            raw = client.get(key)
            if raw:
                value = json.loads(raw)
                _overpass_memory_cache[key] = (time.time() + _OVERPASS_CACHE_TTL_S, value)
                return value
        except Exception:
            pass
    return None

def _overpass_cache_set(key: str, value: dict) -> None:
    expires_at = time.time() + _OVERPASS_CACHE_TTL_S
    _overpass_memory_cache[key] = (expires_at, value)
    if len(_overpass_memory_cache) > 500:
        oldest = min(_overpass_memory_cache, key=lambda item: _overpass_memory_cache[item][0])
        _overpass_memory_cache.pop(oldest, None)
    client = get_redis()
    if client:
        try:
            client.setex(key, _OVERPASS_CACHE_TTL_S, json.dumps(value, default=str))
        except Exception:
            pass

def _tool_find_truck_parking(lat: float, lng: float, radius_m: int = 20000) -> list:
    lat, lng, radius_m = _safe_lat(lat), _safe_lng(lng), _safe_radius(radius_m)
    _ck = _poi_cache_key("parking", lat, lng, radius_m)
    cached = _poi_cache_get(_ck)
    if cached is not None: return cached

    results, search_r = [], max(radius_m, 20_000)
    def _search_tt(q):
        if not _tomtom_ready: return []
        try:
            r = requests.get(f"https://api.tomtom.com/search/2/search/{requests.utils.quote(q)}.json", params={"key": TOMTOM_API_KEY, "language": "en-GB", "limit": 5, "typeahead": "true", "lat": lat, "lon": lng, "radius": search_r}, timeout=5)
            return r.json().get("results", [])
        except: return []

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        all_res = ex.map(_search_tt, ("truck stop", "truck parking", "hgv parking", "паркинг камион"))
        seen = set()
        for items in all_res:
            for item in items:
                pos = item.get("position", {})
                if not pos.get("lat"): continue
                key = (round(pos["lat"], 4), round(pos["lon"], 4))
                if key in seen: continue
                seen.add(key)
                dist = round(_haversine_m(lat, lng, pos["lat"], pos["lon"]))
                if dist > search_r * 15: continue
                poi, addr = item.get("poi", {}), item.get("address", {})
                results.append({"name": poi.get("name") or addr.get("freeformAddress", "Truck Parking"), "lat": pos["lat"], "lng": pos["lon"], "paid": False, "showers": False, "toilets": False, "wifi": False, "security": False, "lighting": False, "distance_m": dist, "phone": poi.get("phone")})

    if len(results) < 2:
        try:
            q = f'[out:json][timeout:15];(node["amenity"="parking"]["hgv"="yes"](around:{search_r},{lat},{lng});node["amenity"="truck_stop"](around:{search_r},{lat},{lng});way["amenity"="parking"]["hgv"="yes"](around:{search_r},{lat},{lng});node["highway"="rest_area"](around:{search_r},{lat},{lng});node["highway"="services"](around:{search_r},{lat},{lng}););out center 10;'
            r = requests.post("https://overpass-api.de/api/interpreter", data={"data": q}, timeout=18)
            for el in r.json().get("elements", []):
                tags, pos = el.get("tags", {}), el.get("lat") or el.get("center", {}).get("lat")
                if not pos: continue
                results.append({"name": tags.get("name", "Паркинг за камиони"), "lat": pos, "lng": el.get("lon") or el.get("center", {}).get("lon"), "paid": tags.get("fee") in ("yes", "pay"), "showers": tags.get("shower") == "yes", "toilets": tags.get("toilets") == "yes", "wifi": tags.get("internet_access") in ("yes", "wifi"), "security": tags.get("supervised") == "yes", "distance_m": round(_haversine_m(lat, lng, pos, el.get("lon") or el.get("center", {}).get("lon")))})
        except: pass

    deduped = []
    seen.clear()
    for item in sorted(results, key=lambda x: x["distance_m"]):
        key = (round(item["lat"], 3), round(item["lng"], 3))
        if key not in seen:
            seen.add(key)
            tp = _transparking_match(item["lat"], item["lng"])
            if tp: item.update({"transparking_url": tp["url"], "transparking_id": tp["pointid"]})
            if not item.get("website"): item["website"] = f"https://truckerapps.eu/search?lat={item['lat']}&lng={item['lng']}"
            deduped.append(item)
    
    _poi_cache_set(_ck, deduped[:8])
    return deduped[:8]

def _tool_find_speed_cameras(lat: float, lng: float, radius_m: int = 10000) -> dict:
    try:
        lat, lng, radius_m = _safe_lat(lat), _safe_lng(lng), _safe_radius(radius_m, max_m=100_000)
        cache_key = _overpass_cache_key("speed_cameras", lat, lng, radius_m)
        cached = _overpass_cache_get(cache_key)
        if cached is not None:
            return cached
        q = f'[out:json][timeout:10];node["highway"="speed_camera"](around:{radius_m},{lat},{lng});out 15;'
        r = requests.post("https://overpass-api.de/api/interpreter", data={"data": q}, timeout=15)
        cameras = []
        for el in r.json().get("elements", []):
            dist = round(_haversine_m(lat, lng, el["lat"], el["lon"]))
            cameras.append({"lat": el["lat"], "lng": el["lon"], "maxspeed": el.get("tags", {}).get("maxspeed"), "distance_m": dist})
        cameras.sort(key=lambda x: x["distance_m"])
        result = {"cameras": cameras, "nearest_m": cameras[0]["distance_m"] if cameras else -1}
        _overpass_cache_set(cache_key, result)
        return result
    except Exception as e: return {"cameras": [], "nearest_m": -1, "error": str(e)}

def _tool_find_fuel(lat: float, lng: float, radius_m: int = 50000) -> list:
    lat, lng, radius_m = _safe_lat(lat), _safe_lng(lng), _safe_radius(radius_m)
    _ck = _poi_cache_key("fuel", lat, lng, radius_m)
    cached = _poi_cache_get(_ck)
    if cached is not None: return cached
    try:
        q = f'[out:json][timeout:15];(node["amenity"="fuel"]["hgv"="yes"](around:{radius_m},{lat},{lng});node["amenity"="fuel"](around:{radius_m},{lat},{lng}););out 10;'
        r = requests.post("https://overpass-api.de/api/interpreter", data={"data": q}, timeout=20)
        results, seen = [], set()
        for el in r.json().get("elements", []):
            if el["id"] in seen: continue
            seen.add(el["id"])
            tags = el.get("tags", {})
            results.append({"name": tags.get("name", "Бензиностанция"), "brand": tags.get("brand"), "lat": el["lat"], "lng": el["lon"], "distance_m": round(_haversine_m(lat, lng, el["lat"], el["lon"])), "truck_lane": tags.get("hgv") == "yes", "opening_hours": tags.get("opening_hours"), "phone": tags.get("phone")})
        results.sort(key=lambda x: x["distance_m"])
        _poi_cache_set(_ck, results[:10])
        return results[:10]
    except: return []

def _tool_add_waypoint(query: str, lat: float, lng: float) -> dict:
    from services.tomtom_service import _tomtom_search
    res = _tomtom_search(query, lat, lng, limit=1)
    if not res: return {"error": f"Не намерих '{query}'"}
    return {"name": res[0]["name"], "coords": [res[0]["lng"], res[0]["lat"]]}

def _enrich_business_with_places(biz: dict) -> dict: return biz

def _tool_find_overtaking_restrictions(lat: float, lng: float, radius_m: int = 5000) -> dict:
    lat, lng, radius_m = _safe_lat(lat), _safe_lng(lng), _safe_radius(radius_m, max_m=100_000)
    cache_key = _overpass_cache_key("overtaking", lat, lng, radius_m)
    cached = _overpass_cache_get(cache_key)
    if cached is not None:
        return cached
    lat_delta = radius_m / 111_320
    lng_delta = radius_m / max(1, 111_320 * math.cos(math.radians(lat)))
    south = lat - lat_delta
    north = lat + lat_delta
    west = lng - lng_delta
    east = lng + lng_delta
    query = f"""
[out:json][timeout:15];
(
  way["overtaking"="no"]({south},{west},{north},{east});
  way["overtaking:hgv"="no"]({south},{west},{north},{east});
);
out body geom;
"""
    try:
        r = requests.post(
            "https://overpass-api.de/api/interpreter",
            data={"data": query},
            headers={"User-Agent": "TruckExpoAI/1.0 truck-navigation-alerts"},
            timeout=20,
        )
        r.raise_for_status()
        restrictions = []
        seen = set()
        for el in r.json().get("elements", []):
            el_id = el.get("id")
            if el_id in seen:
                continue
            seen.add(el_id)
            tags   = el.get("tags", {})
            center = el.get("center", {})
            geometry = []
            for p in el.get("geometry", []) or []:
                p_lat = p.get("lat")
                p_lng = p.get("lon")
                if p_lat is not None and p_lng is not None:
                    geometry.append([p_lng, p_lat])
            el_lat = center.get("lat")
            el_lng = center.get("lon")
            if (el_lat is None or el_lng is None) and geometry:
                mid_lng, mid_lat = geometry[len(geometry) // 2]
                el_lat = mid_lat
                el_lng = mid_lng
            if el_lat is None or el_lng is None:
                continue
            dist_candidates = [_haversine_m(lat, lng, el_lat, el_lng)]
            dist_candidates.extend(_haversine_m(lat, lng, p_lat, p_lng) for p_lng, p_lat in geometry)
            dist = round(min(dist_candidates))
            if dist > radius_m:
                continue
            restrictions.append({
                "lat": el_lat, "lng": el_lng,
                "type": "overtaking_no",
                "hgv_only": tags.get("overtaking:hgv") == "no",
                "distance_m": dist,
                "geometry": geometry or None,
            })
        restrictions.sort(key=lambda x: x["distance_m"])
        result = {"restrictions": restrictions}
        _overpass_cache_set(cache_key, result)
        return result
    except Exception:
        return {"restrictions": []}
