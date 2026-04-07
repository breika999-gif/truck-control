import requests
url = "https://truckerapps.eu/transparking/points.php?action=list"
r = requests.get(url, timeout=10)
print(f"Status: {r.status_code}")
print(f"Type: {type(r.json())}")
print(f"Content preview: {str(r.json())[:500]}")
