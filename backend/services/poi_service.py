import requests
import concurrent.futures
from config import GOOGLE_PLACES_KEY, TOMTOM_API_KEY
from utils.helpers import _haversine_m
from database import _transparking_match, _poi_cache_get, _poi_cache_set, _poi_cache_key

_places_ready = bool(GOOGLE_PLACES_KEY)
_tomtom_ready = bool(TOMTOM_API_KEY)

def _google_places_fallback(query: str, lat: float, lng: float) -> list:
    if not _places_ready: return []
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
        return results
    except Exception: return []

def _tool_find_truck_parking(lat: float, lng: float, radius_m: int = 20000) -> list:
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
        q = f'[out:json][timeout:10];node["highway"="speed_camera"](around:{radius_m},{lat},{lng});out 15;'
        r = requests.post("https://overpass-api.de/api/interpreter", data={"data": q}, timeout=15)
        cameras = []
        for el in r.json().get("elements", []):
            dist = round(_haversine_m(lat, lng, el["lat"], el["lon"]))
            cameras.append({"lat": el["lat"], "lng": el["lon"], "maxspeed": el.get("tags", {}).get("maxspeed"), "distance_m": dist})
        cameras.sort(key=lambda x: x["distance_m"])
        return {"cameras": cameras, "nearest_m": cameras[0]["distance_m"] if cameras else -1}
    except Exception as e: return {"cameras": [], "nearest_m": -1, "error": str(e)}

def _tool_find_fuel(lat: float, lng: float, radius_m: int = 50000) -> list:
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
    query = f"""
[out:json][timeout:15];
(
  way["overtaking"="no"](around:{radius_m},{lat},{lng});
  way["overtaking:hgv"="no"](around:{radius_m},{lat},{lng});
);
out tags center;
"""
    try:
        r = requests.post("https://overpass-api.de/api/interpreter", data={"data": query}, timeout=15)
        r.raise_for_status()
        restrictions = []
        for el in r.json().get("elements", []):
            tags   = el.get("tags", {})
            center = el.get("center", {})
            el_lat = center.get("lat")
            el_lng = center.get("lon")
            if not el_lat:
                continue
            dist = round(_haversine_m(lat, lng, el_lat, el_lng))
            restrictions.append({
                "lat": el_lat, "lng": el_lng,
                "type": "overtaking_no",
                "hgv_only": tags.get("overtaking:hgv") == "no",
                "distance_m": dist,
            })
        restrictions.sort(key=lambda x: x["distance_m"])
        return {"restrictions": restrictions}
    except Exception:
        return {"restrictions": []}
