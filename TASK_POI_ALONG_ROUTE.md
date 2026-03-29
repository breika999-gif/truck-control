# ЗАДАЧА: POI по маршрута — TomTom стил

## Контекст

Приложението е React Native 0.84 + TypeScript трак навигатор.
Backendе Flask 3.1 (`backend/app.py`).
Картата е Mapbox (`@rnmapbox/maps` v10).

## Какво имаме вече (НЕ пипай)

### Backend — ТТ Along Route API (работи)
`backend/app.py` → функция `_tomtom_along_route(coords, query)`:
- Вика TomTom `/search/2/alongRouteSearch/` с POST body от route points
- Параметри: `spreadingMode: "auto"`, `vehicleType: "Truck"`, `maxDetourTime: 600`
- Endpoint: `POST /api/poi-along-route` — връща `{ pois: [...] }`
- Endpoint: `POST /api/cameras-along-route` — върва `{ cameras: [...] }`

### Frontend — fetch при старт на маршут
`src/features/navigation/hooks/useRouteOrchestrator.ts`:
- При нов маршрут вика `fetchPOIsAlongRoute(routeCoords, 'truck_stop', signal)`
- При нов маршрут вика `fetchPOIsAlongRoute(routeCoords, 'fuel', signal)`
- При нов маршрут вика `fetchCamerasAlongRoute(routeCoords, signal)`
- Резултатите отиват в state: `parkingResults`, `fuelResults`, `cameraResults`

### Frontend — пинове на картата
`src/features/navigation/components/MapLayers.tsx`:
- `parking-source` → SymbolLayer с текст "P" (работи + onPress → детайли)
- `fuel-source` → SymbolLayer с "⛽" (работи но **НЕМа onPress!**)
- `camera-source` → SymbolLayer с "📷"

### Parking вече има детайли панел
`src/features/navigation/components/ParkingPanel.tsx` — показва детайли при tap на паркинг.

## КОЕ ЛИПСВА — Имплементирай следното:

### 1. `distance_m` — позиция по маршрута

**Проблем**: Backendот връща `distance_m: 0` за всички POI от TomTom Along Route.
TomTom API не дава директно разстоянието от старта, но POI-те вече са
сортирани по позиция по маршрута.

**Решение** в `backend/app.py`, функция `_tomtom_along_route()`:

За всеки POI намери най-близката точка от `sampled` route и изчисли
кумулативното разстояние до нея:

```python
import math

def _haversine_m(lat1, lon1, lat2, lon2):
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlam/2)**2
    return 2 * R * math.asin(math.sqrt(a))

# За всеки poi намери nearest route index и сумирай разстоянията до него
# Резултатът → distance_m полето в POICard
```

Добави `_haversine_m` в `backend/app.py` и я използвай в `_tomtom_along_route`.

### 2. Fuel tap → детайли bubble (като Parking)

**Проблем**: `fuel-source` ShapeSource в `MapLayers.tsx` НЯМА `onPress`.
Tap на бензиностанция не прави нищо.

**Решение**:

**a) В `MapLayers.tsx`** — добави `onPress` на `fuel-source` (точно като parking-source):
```tsx
<Mapbox.ShapeSource
  id="fuel-source"
  shape={fuelGeoJSON}
  onPress={(e) => {
    const feat = e.features[0];
    if (!feat) return;
    const idx = feat.properties?.index;
    const f = fuelResults[idx];
    if (f) setSelectedFuel(f);
  }}
>
```

Добави `index` в `properties` на fuelGeoJSON (аналогично на parkingGeoJSON в MapScreen.tsx):
```tsx
const fuelGeoJSON = useMemo(() => ({
  type: 'FeatureCollection',
  features: fuelResults.filter(f => f.lat && f.lng).map((f, i) => ({
    type: 'Feature',
    id: i,
    geometry: { type: 'Point', coordinates: [f.lng, f.lat] },
    properties: { index: i, name: f.name },
  })),
}), [fuelResults]);
```

**b) MapLayers props** — добави:
```tsx
fuelResults: POICard[];            // вече е там
setSelectedFuel: (f: POICard) => void;  // НОВО
```

**c) MapScreen.tsx** — добави state:
```tsx
const [selectedFuel, setSelectedFuel] = useState<POICard | null>(null);
```

Подай `setSelectedFuel` на `MapLayers`.

### 3. FuelPanel компонент (нов файл)

Създай `src/features/navigation/components/FuelPanel.tsx`.

Модел: копирай структурата на `ParkingPanel.tsx` и адаптирай за гориво.

Показва при `selectedFuel !== null`:
- Ред: **Бранд** (ако има) + Име на станцията
- Ред: **Цена** (ако има `price` поле) или "Цена неизвестна"
- Ред: **Камион лента** — "✅ Има" / "❌ Няма" (от `truck_lane` поле)
- Ред: **Разстояние**: `${(distance_m / 1000).toFixed(1)} km по маршрута` (ако distance_m > 0)
- **Бутон "Добави спирка"** → извиква `addWaypoint([fuel.lng, fuel.lat], fuel.name)`
- **Бутон "Затвори"** → `setSelectedFuel(null)`

### 4. "X km" лейбъл на пиновете

В `MapLayers.tsx`, за `fuel-symbols` SymbolLayer — добави лейбъл отдолу:

```tsx
<Mapbox.SymbolLayer
  id="fuel-symbols"
  slot="top"
  style={{
    textField: ['concat', '⛽', '\n', ['case',
      ['>', ['get', 'distance_m'], 0],
      ['concat', ['to-string', ['round', ['/', ['get', 'distance_m'], 1000]]], ' km'],
      ''
    ]],
    textSize: 13,
    textAnchor: 'top',
    textOffset: [0, 0.5],
    textHaloColor: '#1a1a2e',
    textHaloWidth: 2,
    textColor: '#ffffff',
    textAllowOverlap: false,
    iconAllowOverlap: true,
  }}
/>
```

Добави `distance_m` в `properties` на fuelGeoJSON (от стъпка 2а).

Аналогично за `parking-symbols` — добави "X km" лейбъл отдолу на "P".

### 5. "X km" лейбъл в poi-along-route backend response

Уверете се, че `distance_m` вече е изчислено (стъпка 1) и се включва в отговора за фронтенда.

---

## Файлове за промяна

| Файл | Промяна |
|------|---------|
| `backend/app.py` | Добави `_haversine_m()`, попълни `distance_m` в `_tomtom_along_route()` |
| `src/features/navigation/components/MapLayers.tsx` | onPress на fuel-source, нови props, distance_m лейбъли |
| `src/features/navigation/screens/MapScreen.tsx` | selectedFuel state, подаване на setSelectedFuel и addWaypoint към MapLayers |
| `src/features/navigation/components/FuelPanel.tsx` | НОВ компонент |

## Файлове само за четене (НЕ промени)

- `ParkingPanel.tsx` — ползвай за модел на FuelPanel
- `useRouteOrchestrator.ts` — вече прави fetch
- `backendApi.ts` — fetchPOIsAlongRoute вече работи
- `POICard` тип в `backendApi.ts` — вече има price, truck_lane, brand, distance_m полета

## Забележки

- Не добавяй нови state hooks в MapLayers — само props
- FuelPanel е fixed bottom panel (като ParkingPanel) — НЕ Modal
- addWaypoint е вече в MapScreen, само го подай надолу
- Не пипай логиката на poisFetchedRef / AbortController в useRouteOrchestrator
