import os
import re
import json
from dotenv import load_dotenv

# Load repo-local development secrets without overriding Railway environment variables.
load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"), override=False)
load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env"), override=False)

# ── API Keys & Model Setup ──────────────────────────────────────────────────
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_PROVIDER = os.getenv("OPENAI_PROVIDER", "openai").strip().lower()
OPENAI_CHAT_MODEL = os.getenv("OPENAI_CHAT_MODEL", "gpt-4o")
OPENAI_MINI_MODEL = os.getenv("OPENAI_MINI_MODEL", "gpt-4o-mini")
AZURE_OPENAI_API_KEY = os.getenv("AZURE_OPENAI_API_KEY", "")
AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT", "")
AZURE_OPENAI_API_VERSION = os.getenv("AZURE_OPENAI_API_VERSION", "2024-10-21")
AZURE_OPENAI_CHAT_DEPLOYMENT = os.getenv("AZURE_OPENAI_CHAT_DEPLOYMENT", "")
AZURE_OPENAI_MINI_DEPLOYMENT = os.getenv("AZURE_OPENAI_MINI_DEPLOYMENT", AZURE_OPENAI_CHAT_DEPLOYMENT)
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
GOOGLE_PLACES_KEY = os.getenv("GOOGLE_PLACES_KEY")
TOMTOM_API_KEY = os.getenv("TOMTOM_API_KEY")
MAPBOX_PUBLIC_TOKEN = os.getenv("MAPBOX_PUBLIC_TOKEN", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash-preview-04-17")

# ── Flask Configuration ─────────────────────────────────────────────────────
FLASK_PORT = int(os.getenv("PORT", os.getenv("FLASK_PORT", 5050)))
FLASK_DEBUG = os.getenv("FLASK_DEBUG", "false").lower() == "true"

# ── EU Regulation (EC) 561/2006 — Hours of Service limits (seconds) ───────────
# Single source of truth for backend HOS math. Mirrors src/shared/constants/hosRules.ts.
HOS_CONTINUOUS_DRIVE_LIMIT_S = 16_200   # 4.5 h continuous driving before a break
HOS_DAILY_DRIVE_LIMIT_S = 32_400        # 9 h standard daily limit
HOS_DAILY_DRIVE_EXTENDED_S = 36_000     # 10 h extended (max 2×/week)
HOS_WEEKLY_DRIVE_LIMIT_S = 201_600      # 56 h weekly
HOS_BIWEEKLY_DRIVE_LIMIT_S = 324_000    # 90 h fortnightly
HOS_BREAK_FULL_S = 2_700                # 45 min full break (resets continuous counter)
HOS_BREAK_SPLIT_FIRST_S = 900           # 15 min first part of split break
HOS_BREAK_SPLIT_SECOND_S = 1_800        # 30 min second part of split break

# ── Truck Routing Constants ─────────────────────────────────────────────────
# EU/Balkans truck speed limits (km/h) by ISO-3166-1 alpha-3 country code
_TRUCK_SPEED_LIMITS: dict[str, tuple[int, int, int]] = {
    "BGR": (50, 80, 100),   # Bulgaria
    "DEU": (50, 80,  80),   # Germany
    "AUT": (50, 70,  80),   # Austria
    "ROU": (50, 80, 110),   # Romania
    "HUN": (50, 70,  80),   # Hungary
    "HRV": (50, 80,  90),   # Croatia
    "SRB": (50, 70, 100),   # Serbia
    "GRC": (50, 80,  85),   # Greece
    "TUR": (50, 70,  90),   # Turkey
    "POL": (50, 70,  80),   # Poland
    "CZE": (50, 80,  80),   # Czechia
    "SVK": (50, 90,  90),   # Slovakia
    "SVN": (50, 80,  90),   # Slovenia
    "ITA": (50, 80, 100),   # Italy
    "FRA": (50, 80,  90),   # France
    "ESP": (50, 80,  90),   # Spain
    "NLD": (50, 80,  80),   # Netherlands
    "BEL": (50, 90,  90),   # Belgium
    "CHE": (50, 80,  80),   # Switzerland
    "GBR": (48, 50,  70),   # UK (mph: 30/50/60 → approx km/h 48/80/96, but Sygic stores mph)
    "UKR": (50, 80,  90),   # Ukraine
    "MKD": (50, 80,  80),   # North Macedonia
    "ALB": (50, 80,  90),   # Albania
    "BIH": (50, 80,  80),   # Bosnia
    "MNE": (50, 80,  80),   # Montenegro
    "SWE": (50, 80,  80),   # Sweden
    "NOR": (50, 80,  80),   # Norway
    "DNK": (50, 70,  80),   # Denmark
    "FIN": (50, 80,  80),   # Finland
    "PRT": (50, 80,  90),   # Portugal
    "LUX": (50, 75,  90),   # Luxembourg
}

# ── Forced Waypoints [lng, lat] ──────────────────────────────────────────────
_BUCHAREST_WP = [26.1025, 44.4268]
_CLUJ_WP      = [23.5890, 46.7690]
_BUDAPEST_WP  = [19.0402, 47.4979]
_BELGRADE_WP  = [20.4568, 44.8176]
_ZAGREB_WP    = [15.9799, 45.8150]
_SOFIA_BYPASS = [[23.2600, 42.7400], [23.4300, 42.7100]]

# ── AI System Prompts ───────────────────────────────────────────────────────
GEMINI_BASE = (
    "TruckAI асистент за камионджии. САМО БЪЛГАРСКИ. Обръщай се 'Колега'. "
    "Данните в [...] са вътрешни — не ги цитирай. "
    "При конкретен паркинг с PARKING_CARDS в контекст → "
    "[APP:{\"app\":\"transparking\",\"transparking_id\":\"<id от PARKING_CARDS>\"}]. "
    "При общ въпрос за паркинг → "
    "[APP:{\"app\":\"transparking\"}]"
)

GEMINI_TACHO_RULES = (
    "\nEU 561: 4.5ч каране → 45мин пауза (или 15+30мин). "
    "Дневно: 9ч (10ч макс 2×/седм). Почивка: 11ч/9ч намалена (макс 3×). "
    "Седм: 56ч, 2седм: 90ч. При <30мин → предупреди.\n"
    "WTD: краен=shift_start+(13 или 15ч ако reduced_rests>0)ч. "
    "Спри при по-ранния от тахо/работен ден.\n"
    "МАРШРУТ контекст: dist=реално разстояние, ест=реално времетраене, остава=оставащо шофьорско. "
    "При 'Мога ли до X': сравни ест с остава. Да→'~Xкм/~Yч, имаш Zмин'. Не→'нужна почивка, стигаш след Kкм.'\n"
    "tacho_log: ползвай remaining_drive_min и segments за точни часове.\n"
    "tacho_week: weekly_remaining_min за седмичен лимит.\n"
    "driver_habits: ползвай за персонализирани препоръки."
)

GEMINI_MEMORY_RULES = (
    "\nПолзвай user_memory проактивно — не питай повторно за известни факти. "
    "Ново важно → <remember category=\"preference\">текст</remember>. "
    "Категории: parking, route, preference, general."
)

# Compatibility aliases for existing imports. New code should use build_gemini_system().
_GEMINI_SYSTEM = GEMINI_BASE
GEMINI_SYSTEM_TACHO = GEMINI_BASE + GEMINI_TACHO_RULES
GEMINI_SYSTEM_NAV = GEMINI_BASE
GEMINI_SYSTEM_SHORT = GEMINI_BASE

_SYSTEM_PROMPT = (
    "Ти си TruckAI — GPS асистент за камиони. Отговаряй САМО на български, бъди КРАТЪК, казвай 'Колега'.\n"
    "Отговаряй с JSON action или conversational reply.\n\n"
    "RULES:\n"
    "1. APP CONTROL: launch_app при YouTube, Spotify, Google, Chrome и т.н.\n"
    "2. AVOIDANCE: По подразбиране избягвай Сърбия (ползвай Румъния → Букурещ → Клуж → Будапеща). "
    "Поддържай: serbia, romania, tolls, sofia_center, motorway, ferry.\n"
    "3. SEARCH: search_business за ВСЯКО място — ресторант, сервиз, митница, склад. "
    "За гориво ползвай find_fuel_stations; за камери ползвай find_speed_cameras.\n"
    "4. CITY SEARCH: 'до/в/около/край' + град = търси около ТОЗИ ГРАД. "
    "Ползвай navigate_to(градско_име) — TomTom геокодира автоматично.\n"
    "5. NAVIGATION vs SEARCH: само градско име → navigate_to веднага. "
    "НИКОГА search_business/find_truck_parking за самотно градско име. "
    "Без 'паркинг'/'стоянка' в съобщението — не търси паркинг.\n\n"
    "Ако шофьорът просто говори → action:'message' на български.\n"
)

_ORCHESTRATOR_SYSTEM = (
    "Ти си оркестратор в multi-agent pipeline за камионни шофьори.\n"
    "Получаваш заявка от шофьор и я разбиваш на максимум 3 подзадачи.\n"
    "Всяка подзадача ще бъде изпълнена от Gemini AI работник.\n\n"
    "Отговаряй САМО с валиден JSON масив, без обяснения:\n"
    "[\n"
    "  {\"task\": \"<конкретна подзадача>\", \"context\": \"<допълнителен контекст>\"},\n"
    "  ...\n"
    "]\n\n"
    "Примери за декомпозиция:\n"
    "- 'Безопасно ли е да карам до Германия утре?' →\n"
    "  [{\"task\": \"Провери времеви ограничения за камиони в Германия\", \"context\": \"неделя/почивен ден\"},\n"
    "   {\"task\": \"Провери метеорологични условия по маршрута\", \"context\": \"зима/лошо време\"},\n"
    "   {\"task\": \"Провери HOS лимити за дълго пътуване\", \"context\": \"EU 561/2006\"}]\n"
    "- 'Имам ли нужда от ADR за гориво?' →\n"
    "  [{\"task\": \"Обясни ADR изисквания за горива\", \"context\": \"клас 3 запалими течности\"}]\n"
)

_SYNTHESIZER_SYSTEM = (
    "Ти си финален синтезатор в multi-agent pipeline за камионни шофьори.\n"
    "Получаваш резултати от няколко Gemini AI работника и ги комбинираш.\n"
    "Говори САМО на БЪЛГАРСКИ. Бъди КРАТЪК и ПРАКТИЧЕН (3-5 изречения).\n"
    "Адресирай шофьора като 'Колега'. Фокусирай се върху практичните изводи.\n"
)

_GEMINI_WORKER_SYSTEM = (
    "Ти си специализиран AI работник в multi-agent pipeline за камионни шофьори.\n"
    "Отговаряй САМО на БЪЛГАРСКИ. Бъди точен и конкретен (2-4 изречения).\n"
    "Фокусирак се САМО върху зададената подзадача — не разширявай отговора.\n"
)

# ── GPT-4o tool definitions ────────────────────────────────────────────────────
_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "navigate_to",
            "description": "Start navigation to a city, address, or landmark. Use this for single city names like 'Sofia' or 'Ruse'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "destination": {
                        "type": "string",
                        "description": "The destination name (city, street, or company)",
                    },
                    "avoid": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": (
                            "Regions/roads to avoid. Options: "
                            "'serbia', 'romania', 'greece', 'turkey', 'sofia_center', "
                            "'motorway', 'toll', 'ferry'"
                        ),
                    },
                    "truck_profile": {
                        "type": "object",
                        "properties": {
                            "height_m": {"type": "number"},
                            "weight_t": {"type": "number"},
                            "width_m": {"type": "number"},
                            "length_m": {"type": "number"},
                            "axle_count": {"type": "integer"},
                            "hazmat_class": {"type": "string"}
                        },
                        "description": "Truck dimensions/load"
                    }
                },
                "required": ["destination"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "suggest_routes",
            "description": "Show 2-3 route alternatives. Use when user wants to compare routes or asks for options.",
            "parameters": {
                "type": "object",
                "properties": {
                    "destination": {"type": "string", "description": "City or address"},
                    "origin_lat":  {"type": "number"},
                    "origin_lng":  {"type": "number"},
                    "avoid": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": (
                            "Regions/roads to avoid: "
                            "'serbia', 'romania', 'greece', 'turkey', 'sofia_center', "
                            "'motorway', 'toll', 'ferry'"
                        ),
                    },
                    "truck_profile": {
                        "type": "object",
                        "properties": {
                            "height_m": {"type": "number"},
                            "weight_t": {"type": "number"},
                            "width_m": {"type": "number"},
                            "length_m": {"type": "number"},
                            "axle_count": {"type": "integer"},
                            "hazmat_class": {"type": "string"}
                        },
                        "description": "Truck dimensions/load"
                    }
                },
                "required": ["destination", "origin_lat", "origin_lng"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "calculate_hos_reach",
            "description": "Calculate remaining drive time before mandatory 45-min break (EU 4.5h rule).",
            "parameters": {
                "type": "object",
                "properties": {
                    "driven_seconds": {"type": "integer"},
                    "speed_kmh":      {"type": "number"},
                },
                "required": ["driven_seconds", "speed_kmh"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_business",
            "description": (
                "Search for ANY place: restaurant, pizzeria, cafe, fuel station, "
                "warehouse, repair shop, factory, customs, or any address. "
                "Translate query to English before calling."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "city":  {"type": "string"},
                    "lat":   {"type": "number"},
                    "lng":   {"type": "number"},
                },
                "required": ["query", "lat", "lng"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_truck_parking",
            "description": (
                "Find truck parking lots near a city or coordinates. "
                "Use when user asks for parking, truck stop, overnight stop, rest area. "
                "Always geocode city name to lat/lng before calling."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "lat":      {"type": "number"},
                    "lng":      {"type": "number"},
                    "radius_m": {"type": "integer", "default": 5000},
                },
                "required": ["lat", "lng"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_fuel_stations",
            "description": (
                "Find HGV-friendly fuel stations near coordinates. "
                "Use for diesel, fuel, gas station, бензиностанция, гориво requests."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "lat":      {"type": "number"},
                    "lng":      {"type": "number"},
                    "radius_m": {"type": "integer", "default": 50000},
                },
                "required": ["lat", "lng"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_speed_cameras",
            "description": (
                "Find speed cameras near coordinates. "
                "Use when the driver asks for cameras, radars, speed traps, камери or радари."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "lat":      {"type": "number"},
                    "lng":      {"type": "number"},
                    "radius_m": {"type": "integer", "default": 10000},
                },
                "required": ["lat", "lng"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_traffic_route",
            "description": "Check traffic on active route.",
            "parameters": {
                "type": "object",
                "properties": {
                    "origin_lng": {"type": "number"},
                    "origin_lat": {"type": "number"},
                    "dest_lng":   {"type": "number"},
                    "dest_lat":   {"type": "number"},
                },
                "required": ["origin_lng", "origin_lat", "dest_lng", "dest_lat"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_waypoint",
            "description": (
                "Add an intermediate stop/waypoint to the current active route. "
                "Use when user says 'добави X към маршрута', 'спри при X', 'мини през X', "
                "'добави спирка X', 'add X to route', or names a specific POI to insert as a stop. "
                "Searches for the named place and returns its coordinates."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Place name or address (in English)"},
                    "lat":   {"type": "number"},
                    "lng":   {"type": "number"},
                },
                "required": ["query", "lat", "lng"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "calculate_travel_matrix",
            "description": "Find optimal order for multiple stops/deliveries. Returns best route order with travel times.",
            "parameters": {
                "type": "object",
                "properties": {
                    "points": {
                        "type": "array",
                        "description": "Points to visit (max 10), each with lat, lng, label.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "lat":   {"type": "number"},
                                "lng":   {"type": "number"},
                                "label": {"type": "string", "description": "Human-readable name"},
                            },
                            "required": ["lat", "lng", "label"],
                        },
                    },
                    "profile": {
                        "type": "string",
                        "enum": ["driving-traffic", "driving"],
                        "default": "driving-traffic",
                    },
                },
                "required": ["points"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "launch_app",
            "description": "Open a mobile app like YouTube, Spotify, Google, etc.",
            "parameters": {
                "type": "object",
                "properties": {
                    "app_name": {
                        "type": "string",
                        "enum": ["youtube", "spotify", "google", "whatsapp", "viber", "facebook", "chrome", "settings"],
                        "description": "Name of the app to launch"
                    },
                    "query": {
                        "type": "string",
                        "description": "Optional search query for the app"
                    }
                },
                "required": ["app_name"]
            }
        }
    },
]

# ── Regex Patterns ──────────────────────────────────────────────────────────
NAV_RE = re.compile(r'\[NAV:\s*(\{.*?\})\s*\]', re.DOTALL)
APP_RE = re.compile(r'\[APP:\s*(\{.*?\})\s*\]', re.DOTALL)
NAV_KEYWORDS = [
    'маршрут', 'route', 'навигация', 'stiga', 'стигам', 'пристигане',
    'разстояние', 'км', 'километ', 'път до', 'как да стигна', 'колко дълго',
]
NAV_HINTS = ["карай до", "навигирай", "маршрут до", "отиди до", "паркинг за камион",
              "намери паркинг", "намери гориво", "гориво наблизо", "бензиностанция",
              "дизел наблизо", "добави спирка", "заобиколи", "тунел",
              "navigate to", "route to", "go to", "find parking", "find fuel", "avoid"]

LOCATION_STOP_WORDS = {
    "до", "в", "на", "от", "при", "около", "край", "близо", "близо до",
    "намери", "намерете", "търси", "покажи", "покажете", "паркинг", "гориво",
    "бензиностанция", "ресторант", "хотел", "спирка", "почивка", "мол",
}
