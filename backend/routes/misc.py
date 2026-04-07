import os, sys, json, re, requests, time as _cache_time
from datetime import datetime, timezone
from flask import Blueprint, jsonify, request
from concurrent.futures import ThreadPoolExecutor, as_completed
from config import (
    OPENAI_API_KEY, TOMTOM_API_KEY, _ORCHESTRATOR_SYSTEM, _SYNTHESIZER_SYSTEM,
    MAPBOX_TOKEN, ANTHROPIC_API_KEY
)
from database import get_db, row_to_poi, DB_PATH
from utils.helpers import _is_rate_limited, _get_body, now_iso, _strip_md_fence
from services.tomtom_service import (
    _mapbox_map_match, _tomtom_route_to_geojson, _tomtom_lane_banner,
    _tomtom_speed_limits, _tomtom_congestion_geojson, _tomtom_traffic_alerts,
    _adr_to_tunnel_code
)
from services.gemini_service import _run_gemini_worker, _gemini_ready
from services.gpt_service import _gpt4o_ready, client

misc_bp = Blueprint('misc', __name__)

try:
    import anthropic as _anthropic_lib
    _anthropic_client = _anthropic_lib.Anthropic(api_key=ANTHROPIC_API_KEY)
    _anthropic_ready = bool(ANTHROPIC_API_KEY)
except:
    _anthropic_client = None
    _anthropic_ready = False

_route_cache: dict = {}
_ROUTE_CACHE_TTL = 300

@misc_bp.get("/api/health")
def health():
    return jsonify({"status": "ok", "version": "modular-v1.1", "python": sys.version, "gpt4o_ready": _gpt4o_ready, "gemini_ready": _gemini_ready, "tomtom_ready": bool(TOMTOM_API_KEY), "db": DB_PATH, "timestamp": now_iso()})

@misc_bp.post("/api/routes/match-window")
def match_window():
    data = _get_body()
    coords, from_idx = data.get("coords", []), data.get("from_index", 0)
    if not coords or from_idx >= len(coords): return jsonify({"coords": []})
    window = coords[from_idx : from_idx + 800]
    return jsonify({"coords": _mapbox_map_match(window, max_points=800)})

@misc_bp.route("/api/google-sync", methods=["GET", "POST"])
def google_sync():
    email = (request.args.get("user_email") or "").strip()
    if not email: return jsonify({"ok": False, "error": "email required"}), 400
    if request.method == "GET":
        with get_db() as conn: rows = conn.execute("SELECT * FROM pois WHERE user_email=? AND category='google_synced' ORDER BY created_at DESC", (email,)).fetchall()
        return jsonify({"ok": True, "pois": [row_to_poi(r) for r in rows]})
    pois, count = _get_body().get("pois", []), 0
    with get_db() as conn:
        for p in pois:
            if p.get("name") and p.get("lat") is not None:
                conn.execute("INSERT OR REPLACE INTO pois (name, address, category, lat, lng, notes, user_email, created_at) VALUES (?,?,?,?,?,?,?,?)", (p["name"], p.get("address", ""), "google_synced", float(p["lat"]), float(p["lng"]), p.get("notes", ""), email, now_iso()))
                count += 1
        conn.commit()
    return jsonify({"ok": True, "imported": count})

@misc_bp.route("/api/orchestrate", methods=["POST"])
def orchestrate():
    if not _anthropic_ready or not _gemini_ready: return jsonify({"ok": False, "error": "APIs not ready"}), 503
    ip = request.remote_addr or "unknown"
    if _is_rate_limited(ip, 10): return jsonify({"ok": False, "error": "Rate limited"}), 429
    user_msg = (_get_body().get("message") or "").strip()
    if not user_msg: return jsonify({"ok": False, "error": "Empty message"}), 400
    try:
        orch_resp = _anthropic_client.messages.create(model="claude-haiku-4-5-20251001", max_tokens=512, system=_ORCHESTRATOR_SYSTEM, messages=[{"role": "user", "content": user_msg}])
        tasks = json.loads(_strip_md_fence(orch_resp.content[0].text.strip()))[:3]
    except Exception as e: return jsonify({"ok": False, "error": f"Orch error: {str(e)}"}), 500
    worker_results = [""] * len(tasks)
    with ThreadPoolExecutor(max_workers=len(tasks)) as pool:
        futures = {pool.submit(_run_gemini_worker, t.get("task", ""), t.get("context", "")): i for i, t in enumerate(tasks)}
        for future in as_completed(futures): worker_results[futures[future]] = future.result()
    synthesis_prompt = f"Оригинална заявка: {user_msg}\n\n" + "\n\n".join(f"Подзадача {i+1} ({tasks[i].get('task', '')}):\n{res}" for i, res in enumerate(worker_results))
    try:
        synth_resp = _anthropic_client.messages.create(model="claude-haiku-4-5-20251001", max_tokens=512, system=_SYNTHESIZER_SYSTEM, messages=[{"role": "user", "content": synthesis_prompt}])
        return jsonify({"ok": True, "answer": synth_resp.content[0].text.strip(), "tasks": [{"task": t.get("task", ""), "result": worker_results[i]} for i, t in enumerate(tasks)]})
    except Exception as e: return jsonify({"ok": False, "error": str(e)}), 500

@misc_bp.route("/api/truck-bans/cache", methods=["DELETE", "POST"])
def clear_truck_bans_cache():
    try:
        with get_db() as conn:
            conn.execute("DELETE FROM truck_bans_cache")
            conn.commit()
        return jsonify({"ok": True, "message": "Cache cleared"})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

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
        
        debug_info = {
            "root_status": root_resp.status_code,
            "key_status": key_resp.status_code,
            "bans_status": bans_resp.status_code,
            "has_key": bool(key),
            "content_type": bans_resp.headers.get('Content-Type'),
            "sample": bans_resp.text[:500] if bans_resp.text else "empty"
        }

        if not bans_resp.ok:
            return jsonify({"bans": [], "error": f"HTTP {bans_resp.status_code}", "debug": debug_info}), 502

        try:
            raw_bans = bans_resp.json()
        except:
            return jsonify({"bans": [], "error": "Not JSON", "debug": debug_info}), 502

        if not isinstance(raw_bans, list):
            return jsonify({"bans": [], "error": "Not a list", "debug": debug_info}), 502

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

        return jsonify({"bans": formatted, "source": "live", "debug": debug_info})

    except Exception as e:
        return jsonify({"bans": [], "error": "Request failed", "details": str(e)}), 502

def _extract_route_restrictions(geometry: dict) -> list:
    coords = geometry.get("coordinates", [])
    if len(coords) < 2: return []
    lats, lngs = [c[1] for c in coords], [c[0] for c in coords]
    bbox = f"{min(lats)-0.002},{min(lngs)-0.002},{max(lats)+0.002},{max(lngs)+0.002}"
    try:
        r = requests.post("https://overpass-api.de/api/interpreter", data={"data": f'[out:json][timeout:10];(node["maxheight"]({bbox});node["maxweight"]({bbox});node["maxwidth"]({bbox});way["maxheight"]({bbox});way["maxweight"]({bbox});way["maxwidth"]({bbox}););out center 60;'}, timeout=12)
        results, seen = [], set()
        for el in r.json().get("elements", []):
            tags = el.get("tags", {})
            lat, lng = el.get("lat") or el.get("center", {}).get("lat"), el.get("lon") or el.get("center", {}).get("lon")
            if lat is None: continue
            for tag in ("maxheight", "maxweight", "maxwidth"):
                raw = tags.get(tag)
                if not raw: continue
                try: val_num = float(raw.replace(",", ".").split()[0])
                except: continue
                if (tag, round(lat, 3), round(lng, 3)) not in seen:
                    seen.add((tag, round(lat, 3), round(lng, 3)))
                    results.append({"lat": lat, "lng": lng, "type": tag, "value": raw, "value_num": val_num})
        return results
    except: return []

@misc_bp.route("/api/routes/calculate", methods=["POST"])
def calculate_route():
    data = request.json or {}
    origin, destination, waypoints, truck = data.get("origin"), data.get("destination"), data.get("waypoints", []), data.get("truck", {})
    if not origin or not destination: return jsonify({"error": "origin and destination required"}), 400
    if not TOMTOM_API_KEY: return jsonify({"error": "TomTom API key not configured"}), 503
    o_lat, o_lng, d_lat, d_lng = round(origin[1], 3), round(origin[0], 3), round(destination[1], 3), round(destination[0], 3)
    truck_key = f"{truck.get('max_height')}:{truck.get('max_weight')}:{truck.get('max_width')}:{truck.get('max_length')}"
    cache_key = f"route:{o_lat},{o_lng}:{d_lat},{d_lng}:{str(waypoints)}:{truck_key}:opt={data.get('optimize', False)}"
    if cache_key in _route_cache:
        res, exp = _route_cache[cache_key]
        if _cache_time.time() < exp: return jsonify(res)
    all_points = [origin] + waypoints + [destination]
    locations = ":".join(f"{p[1]},{p[0]}" for p in all_points)
    params = {"key": TOMTOM_API_KEY, "travelMode": "truck", "traffic": "true", "computeTravelTimeFor": "all", "routeType": "fastest", "instructionsType": "tagged", "language": "bg-BG", "sectionType": "traffic", "maxAlternatives": 1}
    if data.get("optimize"): params["computeBestOrder"] = "true"
    if truck.get("max_height"): params["vehicleHeight"] = truck["max_height"]
    if truck.get("max_width"): params["vehicleWidth"] = truck["max_width"]
    if truck.get("max_weight"): params["vehicleWeight"] = int(truck["max_weight"] * 1000)
    if truck.get("max_length"): params["vehicleLength"] = truck["max_length"]
    if truck.get("axle_count"): params["vehicleNumberOfAxles"] = truck["axle_count"]
    code = _adr_to_tunnel_code(truck.get("hazmat_class", "none"))
    if code: params["vehicleAdrTunnelRestrictionCode"] = code
    try:
        r = requests.get(f"https://api.tomtom.com/routing/1/calculateRoute/{locations}/json", params=params, timeout=15)
        routes = r.json().get("routes", [])
        if not routes: return jsonify({"error": "Няма маршрут"}), 404
        rt, summary = routes[0], routes[0].get("summary", {})
        geom = _tomtom_route_to_geojson(rt)
        instructions = rt.get("guidance", {}).get("instructions", [])
        total_m, steps = summary.get("lengthInMeters", 0), []
        for i, instr in enumerate(instructions):
            nxt = instructions[i+1].get("routeOffsetInMeters", 0) if i+1 < len(instructions) else total_m
            steps.append({"maneuver": {"instruction": instr.get("message", ""), "type": instr.get("maneuver", ""), "modifier": None}, "distance": max(0, nxt - instr.get("routeOffsetInMeters", 0)), "duration": instr.get("travelTimeInSeconds", 0), "name": instr.get("street", ""), "intersections": [{"location": [instr["point"]["longitude"], instr["point"]["latitude"]]}] if instr.get("point") else [], "bannerInstructions": [_tomtom_lane_banner(instr)] if _tomtom_lane_banner(instr) else []})
        alt_routes = routes[1:3]
        alternatives = [{"label": ["Алтернатива 1", "Алтернатива 2"][idx], "color": ["#B922FF", "#08F384"][idx], "duration": ar.get("summary", {}).get("travelTimeInSeconds", 0), "distance": ar.get("summary", {}).get("lengthInMeters", 0), "traffic": "moderate", "geometry": _tomtom_route_to_geojson(ar), "dest_coords": destination, "congestion_geojson": _tomtom_congestion_geojson(ar, _tomtom_route_to_geojson(ar))} for idx, ar in enumerate(alt_routes)]
        mm_pts = 200 if total_m > 1000000 else 400 if total_m > 500000 else 800 if total_m > 200000 else 1600
        geom["coordinates"] = _mapbox_map_match(geom["coordinates"], max_points=mm_pts)
        final = {"geometry": geom, "distance": total_m, "duration": summary.get("travelTimeInSeconds", 0), "traffic_delay": summary.get("trafficDelayInSeconds", 0), "steps": steps, "maxspeeds": _tomtom_speed_limits(rt), "congestionGeoJSON": _tomtom_congestion_geojson(rt, geom), "traffic_alerts": _tomtom_traffic_alerts(rt, geom), "restrictions": _extract_route_restrictions(geom), "alternatives": alternatives, "optimizedWaypointOrder": [w.get("providedIndex") for w in rt.get("optimizedWaypoints", [])] if data.get("optimize") else None}
        _route_cache[cache_key] = (final, _cache_time.time() + _ROUTE_CACHE_TTL)
        return jsonify(final)
    except Exception as e: return jsonify({"error": str(e)}), 500

@misc_bp.post("/api/transcribe")
def whisper_transcribe():
    audio_file = request.files.get("audio")
    if not audio_file: return jsonify({"ok": False, "error": "No audio file"}), 400
    try:
        audio_file.stream.seek(0)
        resp = client.audio.transcriptions.create(model="whisper-1", file=(audio_file.filename or "recording.m4a", audio_file.stream, audio_file.mimetype or "audio/m4a"), language="bg")
        return jsonify({"ok": bool(resp.text), "text": resp.text.strip()})
    except Exception as e: return jsonify({"ok": False, "error": str(e)}), 500
