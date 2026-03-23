import urllib.request, json

data = json.dumps({
    'message': 'show routes to Plovdiv',
    'history': [],
    'context': {'lat': 42.70, 'lng': 23.32}
}).encode()

req = urllib.request.Request(
    'http://127.0.0.1:5050/api/chat',
    data=data,
    headers={'Content-Type': 'application/json'}
)
try:
    resp = urllib.request.urlopen(req, timeout=30)
    d = json.loads(resp.read())
except urllib.error.HTTPError as e:
    body = e.read().decode('utf-8', errors='replace')
    print('HTTP', e.code, e.reason)
    print(body[:2000])
