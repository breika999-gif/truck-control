import requests
import json

BASE_URL = "http://localhost:5050"

def test_health():
    print("--- Testing Health ---")
    try:
        r = requests.get(f"{BASE_URL}/api/health")
        print(f"Status: {r.status_code}")
        print(json.dumps(r.json(), indent=2, ensure_ascii=False))
    except Exception as e:
        print(f"Error: {e}")

def test_gemini():
    print("\n--- Testing Gemini Chat ---")
    payload = {
        "message": "Здравей, колега! Как си?",
        "history": [],
        "context": {"lat": 42.6977, "lng": 23.3219}
    }
    try:
        r = requests.post(f"{BASE_URL}/api/gemini/chat", json=payload)
        print(f"Status: {r.status_code}")
        print(json.dumps(r.json(), indent=2, ensure_ascii=False))
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_health()
    test_gemini()
