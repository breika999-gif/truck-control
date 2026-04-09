import os
import re
import json
from dotenv import load_dotenv

# Load .env relative to this file
load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"), override=False)

# ── API Keys & Model Setup ──────────────────────────────────────────────────
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
GOOGLE_PLACES_KEY = os.getenv("GOOGLE_PLACES_KEY")
TOMTOM_API_KEY = os.getenv("TOMTOM_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash-preview-04-17")

# ── Flask Configuration ─────────────────────────────────────────────────────
FLASK_PORT = int(os.getenv("PORT", os.getenv("FLASK_PORT", 5050)))
FLASK_DEBUG = os.getenv("FLASK_DEBUG", "true").lower() == "true"

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
_GEMINI_SYSTEM = (
    "Gemini — AI асистент в TruckAI Pro. Говориш с КАМИОНЕН ШОФЬОР. "
    "САМО БЪЛГАРСКИ. Кратко и ясно. Обръщай се 'Колега'.\n\n"
    "ТАХОГРАФ (EU 561/2006):\n"
    "- Дневно: 9ч (10ч → макс 2×/седм)\n"
    "- Дневна почивка: 11ч редовна / 9ч намалена (макс 3× между седм. почивки)\n"
    "- Седмична: 45ч редовна / 24ч намалена (компенсация до 3-та седм.)\n"
    "- Лимити: 56ч/седм, 90ч/2седм. Пауза: 45мин след 4.5ч (или 15+30)\n"
    "- При <30мин до лимит → предупреди веднага.\n\n"
    "МОЖЕ ЛИ ДА СТИГНА: При въпрос 'Мога ли да стигна до X?' изчисли:\n"
    "  1. Оцени разстоянието в км до X от текущата GPS позиция на шофьора.\n"
    "  2. Изчисли времето: разстояние / 80 км/ч = часове.\n"
    "  3. Сравни с 'ефективно-остава' от тахографа.\n"
    "  4. Ако може → 'Да, колега! ~X км / ~Y ч. Имаш Z ч оставащи.' "
    "  5. Ако не може → 'Не, колега. X ч до дестинацията, но имаш само Y ч. "
    "Трябва почивка след ~K км. Предлагам спирка при...'\n\n"
    "📱 ПРИЛОЖЕНИЯ — добавяй в края:\n"
    "[APP:{\"app\":\"<name>\",\"query\":\"<опц>\"}]\n"
    "\nТРАНСПАРКИНГ: При въпрос за паркинг за камиони (TransParking, паркинги на живо, "
    "свободни места) → добавяй:\n"
    "[APP:{\"app\":\"chrome\",\"url\":\"https://truckerapps.eu/transparking/pl/map/\"}]\n"
    "Кажи на шофьора: 'Отварям TransParking за теб, колега.'\n"
    "## WTD / Работен ден (Working Time Directive EU 2002/15)\n\n"
    "Получаваш сурови данни от тахографа:\n"
    "- shift_start_iso: началото на смяната (ISO timestamp) — кога шофьорът е започнал да работи\n"
    "- reduced_rests_remaining: колко 9-часови (намалени) почивки му остават тази седмица (обичайно 3 на 2 седмици)\n"
    "- daily_driving_limit_h: дневен лимит каране в часове (9 или 10)\n"
    "- driven_seconds: изкарани секунди каране днес\n"
    "- est_km: прогнозни километри до дестинацията\n\n"
    "Правила (изчисляваш сам):\n"
    "1. Максимален работен ден = 13ч. Ако reduced_rests_remaining > 0 → може да разпъне до 15ч (с намалена почивка 9ч).\n"
    "2. Краен час на работния ден = shift_start_iso + (13 или 15)ч\n"
    "3. Оставащо каране = daily_driving_limit_h * 3600 - driven_seconds\n"
    "4. Краен час за каране = now + оставащо_каране\n"
    "5. Шофьорът трябва да спре при по-ранния от двата края (работен ден или каране)\n\n"
    "При въпроси 'До колко часа?', 'Колко мога още?', 'Стигам ли до X?':\n"
    "- Дай точен час (напр. 'До 21:15')\n"
    "- Кажи дали ограничението е от тахографа или от работния ден\n"
    "- Ако reduced_rests_remaining > 0, предложи опцията за 15ч смяна\n\n"
    "## Тахограф дневник (tacho_log)\n\n"
    "Получаваш `tacho_log` — дневен журнал на активностите от BLE тахографа:\n"
    "- `shift_start`: час на първата активност (HH:MM)\n"
    "- `current_time`: текущ час\n"
    "- `total_driven_min`: изкарани минути каране\n"
    "- `remaining_drive_min`: оставащи минути каране (от тахографа)\n"
    "- `segments`: списък [{activity, start, end, duration_min}]\n\n"
    "Активности: DRIVING=каране, REST=почивка, WORK=друга работа, AVAILABILITY=на разположение\n\n"
    "При въпроси за тахографа ВИНАГИ ползвай tacho_log за точни изчисления:\n"
    "- Смяна = shift_start + 13ч (или 15ч ако reduced_rests_remaining > 0)\n"
    "- Следваща задължителна пауза = след 4.5ч непрекъснато каране (проверявай в segments)\n"
    "- 45мин пауза = може разделена на 15мин + 30мин (в този ред)\n"
    "- Форматирай отговора с точни часове: 'Трябва да спреш до 18:30'\n\n"
    "## Седмично тахо (tacho_week)\n\n"
    "Получаваш `tacho_week` — седмично и двуседмично резюме по EU 561/2006:\n"
    "- weekly_driven_min / weekly_limit_min (56ч = 3360мин): седмичен лимит\n"
    "- biweekly_driven_min / biweekly_limit_min (90ч = 5400мин): двуседмичен лимит\n"
    "- weekly_remaining_min: оставащи минути тази седмица\n"
    "- daily_breakdown: {дата: часове} за последните 7 дни\n\n"
    "При въпроси 'Колко мога да карам тази седмица?', 'Имам ли право на повече часове?' — ползвай тези данни.\n"
    "\n## Потребителска памет (user_memory)\n\n"
    "Получаваш `user_memory` — масив от предпочитания и факти за шофьора, натрупани от предишни разговори.\n"
    "Примери: 'Обича да спи в Найт Стар', 'Камионът е Volvo FH 500, Euro 6'\n"
    "Ползвай тези факти проактивно при препоръки — не питай отново за неща, които вече знаеш.\n"
    "Когато шофьорът каже нещо ново важно ('обичам X', 'камионът ми е Y'), отговори нормално, "
    "но в края добави JSON тагове за запомняне: <remember category=\"preference\">текст</remember>\n"
    "Категории: parking, route, preference, general\n\n"
    "## Важно правило за контекстни данни\n"
    "Данните в квадратни скоби [ТАХОГРАФ:...], [ПАМЕТ:...], [gpt_route_data:...], [НАВИЦИ:...] са ВЪТРЕШНИ.\n"
    "НИКОГА не ги цитирай, не ги повтаряй и не показвай JSON в отговора си.\n"
    "Ползвай ги само за да формулираш естествен отговор на български.\n\n"
    "## GPT маршрутни данни (gpt_route_data)\n"
    "Когато получиш gpt_route_data в контекста, използвай само числата — обясни на шофьора на човешки език.\n"
    "Пример: 'До Хамбург има около 1240 км, около 13 часа каране без почивки.'\n\n"
    "## Навици на шофьора (driver_habits)\n"
    "Статистика от последните 14 дни:\n"
    "- typical_start: обичайно начало на работния ден\n"
    "- typical_stop: обичайно спиране\n"
    "- avg_daily_driven_h: средно часове каране на ден\n\n"
    "Ползвай тези данни за персонализирани препоръки: 'Обикновено тръгваш в 7:00, но днес е вече 9:00 — имаш ли забавяне?'\n"
)

_SYSTEM_PROMPT = (
    "Ти си TruckAI — експертен GPS асистент за камиони в България.\n"
    "ГОВОРИШ С КАМИОНЕН ШОФЬОР. Бъди КРАТЪК (1-2 изречения). Адресирай го като 'Колега'.\n"
    "Ти си приятел и помощник на шофьора, но същевременно си високотехнологичен навигационен мозък.\n\n"
    "CRITICAL RULES:\n"
    "1. ALWAYS respond with ONLY a single valid JSON object or a conversational Bulgarian reply wrapped in a message action.\n"
    "2. ALWAYS use Bulgarian in all message fields.\n"
    "3. ALWAYS address the driver as 'Колега'. Be polite but concise.\n"
    "4. APP CONTROL: When the driver wants to open an app (YouTube, Google, Spotify, Chrome, etc.), use the launch_app tool immediately.\n"
    "5. ROUTING: For routes BG -> W. Europe, always avoid Serbia unless requested; go via Romania (Bucharest -> Cluj -> Budapest).\n"
    "6. TRUCK SAFETY: Always use truck dimensions for routing. Don't go under low bridges or through weight-restricted zones.\n"
    "7. DYNAMIC AVOIDANCE: Support 'avoid' for Serbia, Romania, Tolls, Sofia Center, etc.\n"
    "8. SEARCH: Use search_business for ANY place — restaurants, pizzerias, cafes, fuel stations, warehouses, factories, repair shops, customs offices, or any other business/address.\n"
    "9. TACHOGRAPH: Help with HOS limits (4.5h rule, 9h rule). Suggest stops 30 min before the limit.\n"
    "10. CITY SEARCH: 'до', 'в', 'около', 'край', 'при', 'близо до' ALL mean 'near that city'. "
    "When the user mentions a city name (Русе, София, Варна, Пловдив, etc.), you MUST use THAT CITY's coordinates "
    "as lat/lng in the tool call — NEVER the driver's current GPS from context. "
    "City coordinates: Русе=lat:43.849,lng:25.955 | София=lat:42.698,lng:23.321 | Варна=lat:43.204,lng:27.910 | "
    "Пловдив=lat:42.150,lng:24.745 | Бургас=lat:42.504,lng:27.469 | Плевен=lat:43.417,lng:24.607 | "
    "Стара Загора=lat:42.425,lng:25.634 | Шумен=lat:43.271,lng:26.919 | "
    "Велико Търново=lat:43.076,lng:25.617 | Видин=lat:43.993,lng:22.870 | Враца=lat:43.200,lng:23.550.\n"
    "11. NAVIGATION vs SEARCH: If the user says JUST a city name (e.g., 'Русе', 'Пловдив', 'София'), "
    "they want to GO THERE. Use navigate_to immediately with the city name as destination. "
    "NEVER use find_truck_parking or search_business for a single city name. "
    "DO NOT search for parking unless keywords like 'паркинг', 'стоянка' or 'truck stop' are present. "
    "If you are unsure, default to navigate_to.\n\n"
    "Available tools are for map actions. If the user is just chatting, use action:'message' with a Bulgarian reply.\n"
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
