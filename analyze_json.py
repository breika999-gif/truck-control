import json
with open('sofia_barcelona.json') as f:
    data = json.load(f)

print(f"Total points: {len(data['geometry']['coordinates'])}")
print(f"Congestion features: {len(data['congestionGeoJSON']['features'])}")

# Check for jumps in congestion segments
max_jump = 0
for feature in data['congestionGeoJSON']['features']:
    coords = feature['geometry']['coordinates']
    for i in range(1, len(coords)):
        d = ((coords[i][0] - coords[i-1][0])**2 + (coords[i][1] - coords[i-1][1])**2)**0.5
        if d > max_jump:
            max_jump = d

print(f"Max jump in congestion segments: {max_jump:.6f}")
