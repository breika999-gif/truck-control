import requests
import json
import time

url = "https://truckexpoai-production.up.railway.app/api/routes/calculate"
payload = {
    "origin": [23.3219, 42.6977],
    "destination": [-2.1734, 41.6488],
    "truck": {}
}
headers = {"Content-Type": "application/json"}

start_time = time.time()
try:
    response = requests.post(url, json=payload, headers=headers, timeout=60)
    end_time = time.time()
    
    if response.status_code == 200:
        data = response.json()
        with open('sofia_barcelona.json', 'w') as f:
            json.dump(data, f)
        print(f"Status: {response.status_code}")
        print(f"Time: {end_time - start_time:.2f}s")
        
        # Initial analysis
        if 'geometry' in data and 'coordinates' in data['geometry']:
            coords = data['geometry']['coordinates']
            print(f"Count: {len(coords)}")
            
            # Check for large jumps
            max_jump = 0
            max_idx = -1
            for i in range(1, len(coords)):
                d = ((coords[i][0] - coords[i-1][0])**2 + (coords[i][1] - coords[i-1][1])**2)**0.5
                if d > max_jump:
                    max_jump = d
                    max_idx = i
            
            print(f"Max jump: {max_jump:.6f} at index {max_idx}")
            if max_idx != -1:
                start = max(0, max_idx - 2)
                end = min(len(coords), max_idx + 3)
                print(f"  Surrounding points:")
                for i in range(start, end):
                    print(f"    {i}: {coords[i]}")
            
            # Duplicates or NaN
            dups = sum(1 for i in range(1, len(coords)) if coords[i] == coords[i-1])
            nans = sum(1 for p in coords if any(v is None or str(v) == 'nan' for v in p))
            print(f"Duplicates: {dups}")
            print(f"NaNs: {nans}")
            
            # Check around jump_idx if any
            if jump_idx != -1:
                start = max(0, jump_idx - 2)
                end = min(len(coords), jump_idx + 3)
                print(f"AroundJump: {coords[start:end]}")
        else:
            print("No geometry/coordinates found in response.")
    else:
        print(f"Error: {response.status_code}")
        print(response.text)
except Exception as e:
    print(f"Exception: {e}")
