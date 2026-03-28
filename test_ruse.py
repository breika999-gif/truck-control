import requests
import json

URL = "http://localhost:5050/api/chat"

def test_query(msg):
    print(f"\nTesting: {msg}")
    payload = {
        "message": msg,
        "history": [],
        "context": {"lat": 42.6977, "lng": 23.3219} # Sofia
    }
    r = requests.post(URL, json=payload)
    print(json.dumps(r.json(), indent=2, ensure_ascii=False))

if __name__ == "__main__":
    test_query("Русе")
    test_query("до Русе")
