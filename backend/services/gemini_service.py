import json
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
        super().__init__()
    def __getitem__(self, key):
        value = super().__getitem__(key)
        self.move_to_end(key)
        return value
    def __setitem__(self, key, value):
        if key in self: self.move_to_end(key)
        super().__setitem__(key, value)
        if len(self) > self.maxsize: self.popitem(last=False)

_personal_gemini_clients = _LRUCache(maxsize=50)

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
