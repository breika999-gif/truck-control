import requests
import json

url = "http://localhost:5050/api/chat"
payload = {
    "message": "до Русе",
    "history": [],
    "context": {"lat": 42.69, "lng": 23.32}
}
headers = {"Content-Type": "application/json"}

try:
    response = requests.post(url, json=payload, headers=headers)
    print(json.dumps(response.json(), indent=2, ensure_ascii=False))
except Exception as e:
    print(f"Error: {e}")
