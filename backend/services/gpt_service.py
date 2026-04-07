import json
import time
from concurrent.futures import ThreadPoolExecutor
from openai import OpenAI
from config import (
    OPENAI_API_KEY, _SYSTEM_PROMPT, _TOOLS, _TRUCK_SPEED_LIMITS
)
from utils.helpers import (
    _strip_md_fence, _extract_location_from_message, _build_voice_desc
)
from database import _db_save_chat
from services.tomtom_service import (
    _tool_navigate_to, _tool_suggest_routes, _get_avoidance_waypoints,
    _tool_check_traffic, _adr_to_tunnel_code, _tomtom_search
)

# ── Setup ────────────────────────────────────────────────────────────────────
client = OpenAI(api_key=OPENAI_API_KEY)
_gpt4o_ready = bool(OPENAI_API_KEY)

# ── Cache ────────────────────────────────────────────────────────────────────
_gpt_cache: dict[str, tuple[dict, float]] = {}
_GPT_CACHE_TTL = 600

def _gpt_cache_get(key: str) -> dict | None:
    entry = _gpt_cache.get(key)
    if entry and time.time() < entry[1]: return entry[0]
    _gpt_cache.pop(key, None)
    return None

def _gpt_cache_set(key: str, result: dict) -> None:
    if len(_gpt_cache) >= 500:
        oldest = min(_gpt_cache, key=lambda k: _gpt_cache[k][1])
        _gpt_cache.pop(oldest, None)
    _gpt_cache[key] = (result, time.time() + _GPT_CACHE_TTL)

# ── Logic ─────────────────────────────────────────────────────────────────────

def _classify_task_complexity(user_msg: str, tools_called: list) -> str:
    complex_keywords = ["avoid", "restriction", "hos", "legal", "multi", "waypoint", "dangerous", "adr", "weight", "height", "нарушение", "правен", "опасни", "тегло", "височина"]
    return "full" if any(kw in user_msg.lower() for kw in complex_keywords) else "mini"

def _get_gpt_route_insight(destination: str, context: dict) -> dict | None:
    if not _gpt4o_ready: return None
    try:
        lat, lng = context.get('lat'), context.get('lng')
        loc_hint = f" from GPS {lat:.4f},{lng:.4f}" if lat and lng else ""
        messages = [
            {"role": "system", "content": "You are a truck routing assistant. Reply with ONLY a JSON object — no prose, no code fences. Format: {\"distance_km\": <number>, \"duration_min\": <number>, \"key_waypoints\": [<string>, ...]}"},
            {"role": "user", "content": f"Give route facts for a truck going to {destination}{loc_hint}."}
        ]
        resp = client.chat.completions.create(model="gpt-4o-mini", messages=messages, max_tokens=80, temperature=0)
        return json.loads(_strip_md_fence(resp.choices[0].message.content or ""))
    except Exception: return None

def _run_gpt4o_internal(user_msg: str, history: list, context: dict) -> dict:
    if not _gpt4o_ready: return {"ok": False, "error": "GPT-4o не е конфигуриран."}
    _cache_key = user_msg.strip().lower() if not history and not context.get("lat") else None
    if _cache_key:
        cached = _gpt_cache_get(_cache_key)
        if cached: return cached

    system_txt = _SYSTEM_PROMPT
    if context:
        driven_h = context.get("driven_seconds", 0) / 3600
        prof = context.get("profile", {})
        system_txt += f"\n\nDriver GPS: lat={context.get('lat', '?')}, lng={context.get('lng', '?')}, driven={driven_h:.1f}h, speed={context.get('speed_kmh', 0):.0f}km/h. Truck Profile: {prof.get('height_m', 4.0)}m height, {prof.get('weight_t', 18)}t weight, {prof.get('width_m', 2.55)}m width, {prof.get('length_m', 12)}m length, {prof.get('axle_count', 3)} axles, hazmat={prof.get('hazmat_class', 'none')}."
        _sl_lines = "\n".join(f"  {cc}: urban {u}km/h, rural {r}km/h, motorway {m}km/h" for cc, (u, r, m) in _TRUCK_SPEED_LIMITS.items())
        system_txt += f"\n\nTruck speed limits by country:\n{_sl_lines}"

    messages = [{"role": "system", "content": system_txt}]
    for h in history: messages.append({"role": "assistant" if h.get("role") == "model" else "user", "content": h.get("text", "")})
    messages.append({"role": "user", "content": user_msg})

    action, accumulated_content = None, []
    try:
        for turn in range(4):
            resp = client.chat.completions.create(model="gpt-4o" if _classify_task_complexity(user_msg, []) == "full" else "gpt-4o-mini", messages=messages, tools=_TOOLS, parallel_tool_calls=False, temperature=0.4)
            curr_msg = resp.choices[0].message
            if curr_msg.content: accumulated_content.append(curr_msg.content)
            if not curr_msg.tool_calls: break

            turn_action, turn_results = None, []
            for call in curr_msg.tool_calls:
                fn, args = call.function.name, json.loads(call.function.arguments)
                # POI/Waypoint location correction logic
                user_msg_ctx, driver_lat, driver_lng = context.get("last_message", ""), context.get("lat"), context.get("lng")
                if driver_lat is not None:
                    location = _extract_location_from_message(user_msg_ctx)
                    if location:
                        geo = _tool_navigate_to(location)
                        if "coords" in geo: args["lng"], args["lat"] = geo["coords"]

                res, tool_act = {"error": "unknown tool"}, None
                if fn == "navigate_to":
                    res = _tool_navigate_to(args["destination"])
                    if "coords" in res: tool_act = {"action": "route", "destination": res["destination"], "coords": res["coords"], "waypoints": _get_avoidance_waypoints(context.get("lat"), context.get("lng"), res["coords"][0], args.get("avoid"))}
                elif fn == "suggest_routes":
                    if "origin_lat" not in args and context.get("lat"): args["origin_lat"], args["origin_lng"] = context["lat"], context["lng"]
                    res = _tool_suggest_routes(args["destination"], args.get("origin_lat", 42.70), args.get("origin_lng", 23.32), args.get("avoid"), truck_profile=args.get("truck_profile") or context.get("profile"))
                    if "options" in res: tool_act = {"action": "show_routes", "destination": res["destination"], "dest_coords": res["dest_coords"], "options": res["options"], "waypoints": _get_avoidance_waypoints(args.get("origin_lat"), args.get("origin_lng"), res["dest_coords"][0], args.get("avoid"))}
                elif fn == "find_truck_parking":
                    from services.poi_service import _tool_find_truck_parking
                    from utils.helpers import _build_voice_desc
                    raw = _tool_find_truck_parking(args["lat"], args["lng"], args.get("radius_m", 5000))
                    res = raw
                    cards = [{"name": p["name"], "lat": p["lat"], "lng": p["lng"], "distance_m": p["distance_m"],
                              "paid": p.get("paid", False), "showers": p.get("showers", False),
                              "toilets": p.get("toilets", False), "wifi": p.get("wifi", False),
                              "security": p.get("security", False), "lighting": p.get("lighting", False),
                              "capacity": p.get("capacity"), "website": p.get("website"),
                              "opening_hours": p.get("opening_hours"), "phone": p.get("phone"),
                              "voice_desc": _build_voice_desc(p)} for p in raw[:5]]
                    tool_act = {"action": "show_pois", "category": "truck_stop", "cards": cards}
                elif fn == "find_fuel_stations":
                    from services.poi_service import _tool_find_fuel
                    raw = _tool_find_fuel(args["dest_lat"], args["dest_lng"], args.get("radius_m", 50000))
                    res = raw
                    cards = [{"name": s.get("name", "Бензиностанция"), "lat": s["lat"], "lng": s["lng"],
                              "distance_m": s.get("distance_m", 0), "brand": s.get("brand"),
                              "truck_lane": s.get("truck_lane", False), "opening_hours": s.get("opening_hours"),
                              "phone": s.get("phone")} for s in raw[:4] if "lat" in s]
                    tool_act = {"action": "show_pois", "category": "fuel", "cards": cards}
                elif fn == "find_speed_cameras":
                    from services.poi_service import _tool_find_speed_cameras
                    res = _tool_find_speed_cameras(args["lat"], args["lng"], args.get("radius_m", 10000))
                    cards = [{"name": "📷 Камера {} км/ч".format(cam["maxspeed"]) if cam.get("maxspeed") else "📷 Камера",
                              "lat": cam["lat"], "lng": cam["lng"], "distance_m": cam["distance_m"],
                              "maxspeed": cam.get("maxspeed")} for cam in res.get("cameras", [])[:8]]
                    tool_act = {"action": "show_pois", "category": "speed_camera", "cards": cards, "nearest_m": res.get("nearest_m", -1)}
                elif fn == "search_business":
                    from services.poi_service import _google_places_fallback
                    from database import _poi_cache_get, _poi_cache_set
                    q = f"{args['query']} {args.get('city', '')}".strip()
                    _ck = f"biz:{q.lower()}:{round(args['lat'],2)}:{round(args['lng'],2)}"
                    res = _poi_cache_get(_ck) or _tomtom_search(q, args["lat"], args["lng"])
                    if not res: res = _google_places_fallback(q, args["lat"], args["lng"])
                    _poi_cache_set(_ck, res)
                    
                    valid = [b for b in res[:6] if b.get("lat")]
                    cards = [{"name": b.get("name", ""), "lat": b["lat"], "lng": b["lng"],
                              "distance_m": b.get("distance_m", 0), "info": b.get("address", ""),
                              "photo_url": b.get("photo_url"), "open_now": b.get("open_now"),
                              "needs_confirm": b.get("needs_confirm", False)} for b in valid]
                    tool_act = {"action": "show_pois", "category": "business", "cards": cards}
                elif fn == "add_waypoint":
                    from services.poi_service import _tool_add_waypoint
                    res = _tool_add_waypoint(args["query"], args["lat"], args["lng"])
                    if "coords" in res: tool_act = {"action": "add_waypoint", "name": res["name"], "coords": res["coords"]}
                    else: tool_act = {"action": "message", "text": res.get("error", "Не намерих спирката.")}
                elif fn == "calculate_hos_reach":
                    from services.tacho_service import _tool_calculate_hos_reach
                    from services.poi_service import _tool_find_truck_parking
                    res = _tool_calculate_hos_reach(args["driven_seconds"], args["speed_kmh"])
                    rem_h = res["remaining_h"] + res["remaining_min"] / 60
                    suggested_stop = None
                    if rem_h < 0.5 or res["break_needed"]:
                        p_lat, p_lng = context.get("lat"), context.get("lng")
                        if p_lat and p_lng:
                            parkings = _tool_find_truck_parking(p_lat, p_lng, 30_000)
                            if parkings: suggested_stop = {"lat": parkings[0]["lat"], "lng": parkings[0]["lng"], "name": parkings[0]["name"]}
                    tool_act = {"action": "tachograph", "driven_hours": round(args.get("driven_seconds", 0)/3600, 1),
                                "remaining_hours": round(rem_h, 2), "break_needed": res["break_needed"],
                                "suggested_stop": suggested_stop}
                elif fn == "calculate_travel_matrix":
                    from utils.helpers import _haversine_m
                    pts = args.get("points", [])[:10]
                    if len(pts) < 2:
                        res = {"error": "Нужни са поне 2 точки"}
                    else:
                        n = len(pts)
                        dist_matrix = [[round(_haversine_m(pts[i]["lat"],pts[i]["lng"],pts[j]["lat"],pts[j]["lng"])/1000,2) if i!=j else 0.0 for j in range(n)] for i in range(n)]
                        remaining, order = list(range(1,n)), [0]
                        while remaining:
                            last = order[-1]
                            nearest = min(remaining, key=lambda j: dist_matrix[last][j])
                            order.append(nearest)
                            remaining.remove(nearest)
                        optimal = [pts[i].get("label",f"Точка {i+1}") for i in order]
                        res = {"optimal_order": optimal, "summary": f"Оптимален ред: {' → '.join(optimal)}"}
                elif fn == "check_traffic_route":
                    res = _tool_check_traffic(args["origin_lng"], args["origin_lat"], args["dest_lng"], args["dest_lat"])
                elif fn == "launch_app":
                    tool_act = {"action": "app", "data": {"app": args["app_name"], "query": args.get("query", "")}}
                    res = {"status": "success", "app": args["app_name"]}
                
                if tool_act: turn_action = tool_act if tool_act.get("action") in ("route", "add_waypoint") or not turn_action else turn_action
                turn_results.append({"role": "tool", "tool_call_id": call.id, "content": json.dumps(res, ensure_ascii=False)})
            messages.append(curr_msg)
            messages.extend(turn_results)
            if turn_action: action = turn_action
    except Exception as exc: return {"ok": False, "error": str(exc)}

    reply = " ".join(accumulated_content).strip()
    if action:
        act_type = action.get("action")
        if act_type == "route": display_text = f"Прокладвам маршрут до {action.get('destination', '')}."
        elif act_type == "show_pois":
            count = len(action.get("cards", []))
            cat = action.get("category", "")
            if cat == "truck_stop": display_text = f"Намерих {count} паркинга за камиони наблизо."
            elif cat == "fuel": display_text = f"Намерих {count} бензиностанции по маршрута."
            elif cat == "speed_camera": display_text = f"Намерих {count} камери наблизо."
            elif cat == "business": display_text = f"Намерих {count} резултата."
            else: display_text = f"Намерих {count} обекта."
        elif act_type == "show_routes": display_text = f"Намерих варианти до {action.get('destination', '')}."
        elif act_type == "add_waypoint": display_text = f"Добавена спирка: {action.get('name', '')}."
        else: display_text = reply
    else:
        display_text = reply
        reply_clean = _strip_md_fence(reply)
        if reply_clean.startswith("{"):
            try:
                parsed = json.loads(reply_clean)
                if parsed.get("action") and parsed.get("action") != "message":
                    action = parsed
                    display_text = parsed.get("message") or parsed.get("text") or ""
                else: display_text = parsed.get("text") or parsed.get("message") or reply
            except: display_text = reply_clean

    clean_dt = _strip_md_fence(display_text or "")
    if clean_dt.startswith("{"):
        try:
            p = json.loads(clean_dt)
            display_text = p.get("text") or p.get("message") or ""
        except: pass
    else: display_text = clean_dt

    _db_save_chat(user_msg, display_text)
    final_action = {**action, "message": display_text} if action else {"action": "message", "text": display_text or "Не мога да обработя заявката."}
    result = {"ok": True, "action": final_action, "reply": display_text}
    if _cache_key and action is None: _gpt_cache_set(_cache_key, result)
    return result
