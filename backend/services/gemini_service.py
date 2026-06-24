import json
import re
import threading
from collections import OrderedDict
from google import genai as _google_genai
from config import (
    GEMINI_API_KEY, GEMINI_MODEL, _GEMINI_WORKER_SYSTEM
)

try:
    _gemini_client = _google_genai.Client(api_key=GEMINI_API_KEY)
    _gemini_ready = bool(GEMINI_API_KEY)
except Exception:
    _gemini_client = None
    _gemini_ready = False

class _LRUCache(OrderedDict):
    def __init__(self, maxsize=50):
        self.maxsize = maxsize
        self._lock = threading.Lock()
        super().__init__()
    def __getitem__(self, key):
        with self._lock:
            value = super().__getitem__(key)
            self.move_to_end(key)
            return value
    def __setitem__(self, key, value):
        with self._lock:
            if super().__contains__(key): self.move_to_end(key)
            super().__setitem__(key, value)
            if len(self) > self.maxsize: self.popitem(last=False)
    def __contains__(self, key):
        with self._lock:
            return super().__contains__(key)

_personal_gemini_clients = _LRUCache(maxsize=50)

SIMPLE_KEYWORDS = [
    "мерси", "благодаря", "ок", "добре", "разбрах", "чао", "да", "не",
    "ok", "thanks", "yes", "no",
]

TACHO_RE = re.compile(
    r"\b(тахограф|остава|стигам|стигна|докъде|до къде|докаде|до каде|каране|"
    r"шофиране|почивка|пауза|смяна|лимит|седмично|driving|drive|reach|remain|"
    r"hours|break|weekly|shift)\b",
    re.IGNORECASE,
)

NAV_RE = re.compile(
    r"\b(карай до|маршрут|навигир|навигация|отиди до|закарай|добави спирка|"
    r"паркинг|гориво|бензиностанция|дизел|route|navigate|navigation|waypoint|"
    r"parking|fuel|diesel|gas station|ruta|navega|navegar|aparcamiento|"
    r"gasolinera|combustible)\b",
    re.IGNORECASE,
)

def is_simple_message(msg: str) -> bool:
    text = (msg or "").strip().lower().strip("!?.")
    if not text:
        return True
    # Exact keyword match OR very short (≤10 chars: "ок", "да", "не", "ok")
    return len(text) <= 10 or text in SIMPLE_KEYWORDS

def classify_intent(msg: str) -> str:
    text = (msg or "").strip().lower()
    if not text:
        return "general"
    if TACHO_RE.search(text):
        return "tacho"
    if NAV_RE.search(text):
        return "nav"
    return "general"

def build_gemini_system(intent: str, has_memory: bool) -> str:
    from config import GEMINI_BASE, GEMINI_TACHO_RULES, GEMINI_MEMORY_RULES
    system = GEMINI_BASE
    if intent == "tacho":
        system += GEMINI_TACHO_RULES
    if has_memory:
        system += GEMINI_MEMORY_RULES
    return system

def _run_gemini_worker(task: str, context: str) -> str:
    if not _gemini_ready: return "(Gemini не е конфигуриран)"
    prompt = f"Задача: {task}\nКонтекст: {context}"
    try:
        resp = _gemini_client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=_google_genai.types.GenerateContentConfig(
                system_instruction=_GEMINI_WORKER_SYSTEM,
                max_output_tokens=300,
            ),
        )
        return resp.text or "(без отговор)"
    except Exception as exc:
        return f"(грешка: {str(exc)[:250]})"
