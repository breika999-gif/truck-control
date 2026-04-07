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
                elif fn == "search_business":
                    from services.poi_service import _enrich_business_with_places
                    from config import GOOGLE_PLACES_KEY
                    res = _tomtom_search(f"{args['query']} {args.get('city', '')}".strip(), args["lat"], args["lng"])
                    cards = [{"name": b.get("name", ""), "lat": b["lat"], "lng": b["lng"], "distance_m": b.get("distance_m", 0), "info": b.get("address", "")} for b in res[:6]]
                    tool_act = {"action": "show_pois", "category": "business", "cards": cards}
                elif fn == "add_waypoint":
                    from services.poi_service import _tool_add_waypoint
                    res = _tool_add_waypoint(args["query"], args["lat"], args["lng"])
                    if "coords" in res: tool_act = {"action": "add_waypoint", "name": res["name"], "coords": res["coords"]}
                elif fn == "calculate_hos_reach":
                    from services.tacho_service import _tool_calculate_hos_reach
                    res = _tool_calculate_hos_reach(args["driven_seconds"], args["speed_kmh"])
                    tool_act = {"action": "tachograph", "driven_hours": round(args.get("driven_seconds", 0)/3600, 1), "remaining_hours": round(res["remaining_h"] + res["remaining_min"]/60, 2), "break_needed": res["break_needed"]}
                elif fn == "launch_app":
                    tool_act = {"action": "app", "data": {"app": args["app_name"], "query": args.get("query", "")}}
                
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
        elif act_type == "show_pois": display_text = f"Намерих {len(action.get('cards', []))} резултата."
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
