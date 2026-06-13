import json
import os
import time
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
from openai import AzureOpenAI, OpenAI
from config import (
    AZURE_OPENAI_API_KEY, AZURE_OPENAI_API_VERSION, AZURE_OPENAI_CHAT_DEPLOYMENT,
    AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_MINI_DEPLOYMENT, OPENAI_API_KEY,
    OPENAI_CHAT_MODEL, OPENAI_MINI_MODEL, OPENAI_PROVIDER, _SYSTEM_PROMPT, _TOOLS
)
from utils.helpers import (
    _strip_md_fence, _extract_location_from_message, _build_voice_desc,
    maybe_reach_answer, _haversine_m,
)
from database import _db_save_chat
from services.tomtom_service import (
    _tool_navigate_to, _tool_suggest_routes, _get_avoidance_waypoints,
    _tool_check_traffic, _adr_to_tunnel_code, _tomtom_search
)

_COUNTRY_BOXES = {
    "DE": (47.3, 5.9, 55.0, 15.0),
    "AT": (46.4, 9.5, 49.0, 17.2),
    "FR": (42.3, -4.8, 51.1, 8.2),
    "ES": (36.0, -9.3, 43.8, 3.3),
    "CH": (45.8, 6.0, 47.8, 10.5),
    "IT": (36.6, 6.6, 47.1, 18.5),
    "PL": (49.0, 14.1, 54.9, 24.2),
    "BG": (41.2, 22.4, 44.2, 28.6),
    "RO": (43.6, 20.2, 48.3, 29.7),
    "HU": (45.7, 16.1, 48.6, 22.9),
    "GR": (34.8, 19.4, 41.7, 28.2),
}
_TRUCK_BANS_CACHE: dict | None = None

def _load_truck_bans() -> dict:
    global _TRUCK_BANS_CACHE
    if _TRUCK_BANS_CACHE is None:
        bans_path = os.path.join(os.path.dirname(__file__), "..", "data", "truck_bans.json")
        try:
            with open(bans_path, encoding="utf-8") as f:
                _TRUCK_BANS_CACHE = json.load(f)
        except Exception:
            _TRUCK_BANS_CACHE = {}
    return _TRUCK_BANS_CACHE

def _get_truck_ban_warning(lat, lng):
    """Return ban warning string or '' based on rough country bounding boxes."""
    try:
        lat = float(lat)
        lng = float(lng)
    except (TypeError, ValueError):
        return ""

    bans = _load_truck_bans()

    country = None
    for cc, (lat_min, lng_min, lat_max, lng_max) in _COUNTRY_BOXES.items():
        if lat_min <= lat <= lat_max and lng_min <= lng <= lng_max:
            country = cc
            break
    if not country or not bans.get(country, {}).get("weekend"):
        return ""

    now = datetime.now(timezone.utc)
    weekday = now.weekday()
    if weekday not in (5, 6):
        return ""

    label = "Saturday" if weekday == 5 else "Sunday"
    end_key = "sat_end" if weekday == 5 else "sun_end"
    end_time = bans[country].get(end_key, "22:00")
    if end_time == "00:00":
        return f" [TRUCK_BAN: {country} full {label} ban - trucks forbidden all day]"
    return f" [TRUCK_BAN: {country} {label} ban until {end_time} local - trucks forbidden]"

# ── Setup ────────────────────────────────────────────────────────────────────
client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None
azure_client = (
    AzureOpenAI(
        api_key=AZURE_OPENAI_API_KEY,
        api_version=AZURE_OPENAI_API_VERSION,
        azure_endpoint=AZURE_OPENAI_ENDPOINT,
    )
    if AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT else None
)
_azure_ready = bool(azure_client and (AZURE_OPENAI_CHAT_DEPLOYMENT or AZURE_OPENAI_MINI_DEPLOYMENT))
_gpt4o_ready = bool(client or _azure_ready)

def _azure_deployment_for(model: str) -> str:
    if "mini" in (model or "").lower():
        return AZURE_OPENAI_MINI_DEPLOYMENT or AZURE_OPENAI_CHAT_DEPLOYMENT
    return AZURE_OPENAI_CHAT_DEPLOYMENT or AZURE_OPENAI_MINI_DEPLOYMENT

def _chat_completion_create(**kwargs):
    model = kwargs.get("model", OPENAI_MINI_MODEL)
    prefer_azure = OPENAI_PROVIDER == "azure"
    if prefer_azure and _azure_ready:
        kwargs["model"] = _azure_deployment_for(str(model))
        return azure_client.chat.completions.create(**kwargs)  # type: ignore[union-attr]
    if client:
        return client.chat.completions.create(**kwargs)
    if _azure_ready:
        kwargs["model"] = _azure_deployment_for(str(model))
        return azure_client.chat.completions.create(**kwargs)  # type: ignore[union-attr]
    raise RuntimeError("GPT-4o не е конфигуриран.")

# ── Cache ────────────────────────────────────────────────────────────────────
_gpt_cache: dict[str, tuple[dict, float]] = {}
_GPT_CACHE_TTL = 600

FIND_PARKING_BREAK_TOOL = {
    "type": "function",
    "function": {
        "name": "find_parking_break",
        "description": (
            "Find truck parking spots along the route before the driver's mandatory tacho break. "
            "Use when driver asks about parking, rest stop, or where to stop before time runs out."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "lat": {"type": "number", "description": "Driver current latitude"},
                "lng": {"type": "number", "description": "Driver current longitude"},
                "break_dist_km": {
                    "type": "number",
                    "description": "Distance in km until mandatory break required",
                },
            },
            "required": ["lat", "lng"],
        },
    },
}

ALL_TOOLS = [*_TOOLS, FIND_PARKING_BREAK_TOOL]
NAV_TOOL_NAMES = {
    "set_route", "navigate_to", "suggest_routes", "add_waypoint",
    "get_route_info", "check_traffic_route", "avoid_area", "clear_route",
    "get_eta", "calculate_hos_reach",
}
SEARCH_TOOL_NAMES = {
    "search_pois", "search_business", "geocode_location",
    "get_nearby_parking", "find_truck_parking", "find_parking_break",
    "get_nearby_fuel", "find_fuel_stations", "find_speed_cameras",
}
NAV_TOOLS = [
    tool for tool in ALL_TOOLS
    if tool.get("function", {}).get("name") in NAV_TOOL_NAMES
]
SEARCH_TOOLS = [
    tool for tool in ALL_TOOLS
    if tool.get("function", {}).get("name") in SEARCH_TOOL_NAMES
]
NAV_KEYWORDS_FOR_TOOLS = [
    "маршрут", "навигирай", "карай до", "стигни до", "route", "navigate",
]
SEARCH_KEYWORDS_FOR_TOOLS = [
    "намери", "търси", "близо", "parking", "гориво", "fuel", "паркинг",
    "почивка", "спирка", "rest", "stop", "пауза", "камера", "камери",
    "радар", "радари", "camera", "cameras", "speed camera", "speed trap",
]

def pick_tools(msg: str) -> list:
    text = (msg or "").lower()
    has_nav = any(keyword in text for keyword in NAV_KEYWORDS_FOR_TOOLS)
    has_search = any(keyword in text for keyword in SEARCH_KEYWORDS_FOR_TOOLS)
    if has_nav and has_search:
        return NAV_TOOLS + SEARCH_TOOLS
    if has_nav:
        return NAV_TOOLS or ALL_TOOLS
    if has_search:
        return SEARCH_TOOLS or ALL_TOOLS
    return []  # no tools for general chat

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
        resp = _chat_completion_create(model=OPENAI_MINI_MODEL, messages=messages, max_tokens=80, temperature=0)
        return json.loads(_strip_md_fence(resp.choices[0].message.content or ""))
    except Exception: return None

def _approach_point(context: dict, fallback_lat, fallback_lng) -> tuple[float, float]:
    """Search parking before destination when current and destination coordinates are known."""
    try:
        cur_lat = float(context.get("lat"))
        cur_lng = float(context.get("lng"))
        dest_lat = float(context.get("dest_lat"))
        dest_lng = float(context.get("dest_lng"))
        return (
            cur_lat + 0.82 * (dest_lat - cur_lat),
            cur_lng + 0.82 * (dest_lng - cur_lng),
        )
    except (TypeError, ValueError):
        return float(fallback_lat), float(fallback_lng)

def _run_gpt4o_internal(user_msg: str, history: list, context: dict, user_email: str = "") -> dict:
    if not _gpt4o_ready: return {"ok": False, "error": "GPT-4o не е конфигуриран."}
    _cache_key = user_msg.strip().lower() if not history and not context.get("lat") else None
    if _cache_key:
        cached = _gpt_cache_get(_cache_key)
        if cached: return cached

    reach = maybe_reach_answer(user_msg, context)
    if reach:
        _db_save_chat(user_msg, reach, user_email=user_email)
        return {
            "ok": True,
            "text": reach,
            "action": None,
            "reply": reach,
        }

    _PROFILE_KEYWORDS = {"маршрут", "навигирай", "карай до", "стигни до", "route", "navigate",
                         "avoid", "restriction", "height", "weight", "adr", "hazmat",
                         "тегло", "височина", "опасни"}
    system_txt = _SYSTEM_PROMPT + (
        "\nTRUCK PARKING: When finding truck parking near a destination, search at 82% "
        "of the route from current position toward destination, not at the destination itself. "
        "Calculate approach_lat = cur_lat + 0.82*(dest_lat-cur_lat), same for lng."
    )
    if context:
        driven_h = context.get("driven_seconds", 0) / 3600
        prof = context.get("profile", {})
        need_profile = any(kw in user_msg.lower() for kw in _PROFILE_KEYWORDS)
        profile_part = (
            f" Truck Profile: {prof.get('height_m', 4.0)}m height, {prof.get('weight_t', 18)}t weight, "
            f"{prof.get('width_m', 2.55)}m width, {prof.get('length_m', 12)}m length, "
            f"{prof.get('axle_count', 3)} axles, hazmat={prof.get('hazmat_class', 'none')}."
            if need_profile else ""
        )
        route_part = ""
        if context.get("destination"):
            facts = []
            if context.get("route_distance_km") is not None:
                facts.append(f"distance={context.get('route_distance_km')}km")
            if context.get("route_duration_min") is not None:
                facts.append(f"duration={context.get('route_duration_min')}min")
            if context.get("remaining_drive_min") is not None:
                facts.append(f"drive_left={context.get('remaining_drive_min')}min")
            route_part = f" Active route to {context.get('destination')}: {', '.join(facts)}." if facts else f" Active route to {context.get('destination')}."

        timing_part = ""
        timing_bits = []
        if context.get("current_time_iso"):
            timing_bits.append(f"now={context.get('current_time_iso')}")
        if context.get("eta_iso"):
            timing_bits.append(f"eta={context.get('eta_iso')}")
        if context.get("distance_since_rest_km") is not None:
            timing_bits.append(f"since_rest={context.get('distance_since_rest_km')}km")
        if timing_bits:
            timing_part = " Timing: " + ", ".join(timing_bits) + "."

        tacho_part = ""
        if context.get("bt_connected") is not None:
            live_left = context.get("bt_driving_time_left_min")
            tacho_left = live_left if live_left is not None else context.get("remaining_drive_min")
            tacho_bits = [
                f"bt={'connected' if context.get('bt_connected') else 'off'}",
                f"activity={context.get('bt_live_activity') or context.get('bt_activity') or 'unknown'}",
            ]
            if tacho_left is not None:
                tacho_bits.append(f"left={tacho_left}min")
            if context.get("bt_daily_driven_min") is not None:
                tacho_bits.append(f"daily_driven={context.get('bt_daily_driven_min')}min")
            if context.get("bt_card") is not None:
                tacho_bits.append(f"card={'in' if context.get('bt_card') else 'out'}")
            tacho_part = " Tacho: " + ", ".join(tacho_bits) + "."

        parking_part = ""
        if context.get("found_parking"):
            spots = context["found_parking"]
            lines = []
            for sp in spots:
                line = sp.get("name", "?")
                if sp.get("dist_km") is not None:
                    line += f" ({sp['dist_km']}km)"
                tags = [k for k in ("paid", "showers", "security") if sp.get(k)]
                if tags:
                    line += " [" + ",".join(tags) + "]"
                lines.append(line)
            parking_part = " OnMap: " + "; ".join(lines) + "."

        system_txt += (
            f"\n\nDriver GPS: lat={context.get('lat', '?')}, lng={context.get('lng', '?')}, "
            f"driven={driven_h:.1f}h, speed={context.get('speed_kmh', 0):.0f}km/h."
            f"{profile_part}{route_part}{timing_part}{tacho_part}{parking_part}"
        )
        if context.get("lat") is not None and context.get("lng") is not None:
            ban_warn = _get_truck_ban_warning(context.get("lat"), context.get("lng"))
            if ban_warn:
                system_txt += ban_warn

    messages = [{"role": "system", "content": system_txt}]
    MAX_HISTORY = 4
    if len(history) > MAX_HISTORY:
        history = history[-MAX_HISTORY:]
    for h in history: messages.append({"role": "assistant" if h.get("role") == "model" else "user", "content": h.get("text", "")})
    messages.append({"role": "user", "content": user_msg})
    tools = pick_tools(user_msg)

    action, accumulated_content = None, []
    _model = OPENAI_CHAT_MODEL if _classify_task_complexity(user_msg, []) == "full" else OPENAI_MINI_MODEL
    try:
        for turn in range(4):
            _kwargs: dict = {"model": _model, "messages": messages, "temperature": 0.4, "timeout": 30}
            if tools:
                _kwargs["tools"] = tools
                _kwargs["parallel_tool_calls"] = False
            resp = _chat_completion_create(**_kwargs)
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
                    search_lat, search_lng = _approach_point(context, args["lat"], args["lng"])
                    raw = [dict(p) for p in _tool_find_truck_parking(search_lat, search_lng, args.get("radius_m", 5000))]
                    driver_lat = context.get("lat")
                    driver_lng = context.get("lng")
                    if driver_lat is not None and driver_lng is not None:
                        for p in raw:
                            if p.get("lat") is not None and p.get("lng") is not None:
                                p["distance_m"] = _haversine_m(
                                    float(driver_lat), float(driver_lng),
                                    float(p["lat"]), float(p["lng"])
                                )
                    res = raw
                    cards = [{"name": p["name"], "lat": p["lat"], "lng": p["lng"], "distance_m": p["distance_m"],
                              "paid": p.get("paid", False), "showers": p.get("showers", False),
                              "toilets": p.get("toilets", False), "wifi": p.get("wifi", False),
                              "security": p.get("security", False), "lighting": p.get("lighting", False),
                              "capacity": p.get("capacity"), "website": p.get("website"),
                              "transparking_id": p.get("transparking_id"),
                              "opening_hours": p.get("opening_hours"), "phone": p.get("phone"),
                              "voice_desc": _build_voice_desc(p)} for p in raw[:5]]
                    tool_act = {"action": "show_pois", "category": "truck_stop", "cards": cards}
                elif fn == "find_parking_break":
                    from routes.misc import _search_parking_tomtom

                    driver_lat = args.get("lat") if args.get("lat") is not None else context.get("lat")
                    driver_lng = args.get("lng") if args.get("lng") is not None else context.get("lng")
                    break_dist_arg = args.get("break_dist_km")
                    try:
                        break_dist_km = float(break_dist_arg) if break_dist_arg is not None else (
                            float(context.get("remaining_drive_min") or 120)
                            * float(context.get("speed_kmh") or 80)
                            / 60
                        )
                    except (TypeError, ValueError):
                        break_dist_km = 160.0

                    if driver_lat is not None and driver_lng is not None:
                        radius_m = int(min(max(break_dist_km, 1.0), 50.0) * 1000)
                        spots = [dict(p) for p in _search_parking_tomtom(float(driver_lat), float(driver_lng), radius_m=radius_m)]
                        for p in spots:
                            if p.get("lat") is not None and p.get("lng") is not None:
                                p["distance_m"] = _haversine_m(
                                    float(driver_lat), float(driver_lng),
                                    float(p["lat"]), float(p["lng"])
                                )
                        cards = []
                        for p in spots[:5]:
                            if p.get("lat") is None or p.get("lng") is None:
                                continue
                            cards.append({
                                "name": p.get("name", "Паркинг за камиони"),
                                "lat": p["lat"],
                                "lng": p["lng"],
                                "distance_m": p.get("distance_m", 0),
                                "paid": p.get("paid", False),
                                "showers": p.get("showers", False),
                                "toilets": p.get("toilets", False),
                                "wifi": p.get("wifi", False),
                                "security": p.get("security", False),
                                "lighting": p.get("lighting", False),
                                "capacity": p.get("capacity"),
                                "website": p.get("website"),
                                "transparking_id": p.get("transparking_id"),
                                "opening_hours": p.get("opening_hours"),
                                "phone": p.get("phone"),
                                "voice_desc": _build_voice_desc(p),
                            })
                        res = {
                            "found": len(spots),
                            "spots": [s.get("name", "Паркинг за камиони") for s in spots[:5]],
                            "break_dist_km": round(break_dist_km, 1),
                        }
                        if cards:
                            tool_act = {
                                "action": "show_pois",
                                "category": "truck_stop",
                                "cards": cards,
                                "reason": "tacho_break",
                                "break_dist_km": round(break_dist_km, 1),
                                "message": (
                                    f"Намерих {len(cards)} паркинга преди тахо паузата "
                                    f"(~{round(break_dist_km, 1)} км)."
                                ),
                            }
                    else:
                        res = {"error": "missing driver coordinates"}
                elif fn == "find_fuel_stations":
                    from services.poi_service import _tool_find_fuel
                    fuel_lat = args.get("lat", args.get("dest_lat"))
                    fuel_lng = args.get("lng", args.get("dest_lng"))
                    raw = _tool_find_fuel(fuel_lat, fuel_lng, args.get("radius_m", 50000))
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

    _db_save_chat(user_msg, display_text, user_email=user_email)
    final_action = {**action, "message": display_text} if action else {"action": "message", "text": display_text or "Не мога да обработя заявката."}
    result = {"ok": True, "action": final_action, "reply": display_text}
    if _cache_key and action is None: _gpt_cache_set(_cache_key, result)
    return result

chat_with_gpt = _run_gpt4o_internal
