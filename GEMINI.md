# Project Rules & Architectural Mandates (from instructions.txt)

## MapScreen Layer Stack (The "Golden Stack")
For a professional Google Maps-like experience, layers must be ordered as follows (bottom to top):

1.  **Terrain & Relief:** 3D relief and mountains.
2.  **Alternative Routes (Gray):** Below the active route.
3.  **Active Route (Blue):** Must be in `slot="middle"` or `belowLayerID="building"`. It should be above the asphalt but *under* 3D buildings and labels.
4.  **3D Buildings:** Must appear over the route line.
5.  **Truck Restrictions (Signs):** Must be above the route line to ensure visibility (e.g., low bridge signs).
6.  **Traffic Layers:** Traffic colors on all streets. MUST be in `slot="top"` for maximum visibility above everything.
7.  **Point Annotations (Pins/Markers):** Parking, gas stations, cameras (React Native views).

## Layer & Symbol Management
*   **Truck Restrictions:** Use a separate `SymbolLayer` for restriction signs to make them larger and more visible for truck drivers.
*   **Lane Guidance:** While currently a UI panel, consider adding small arrows directly on the map asphalt for a more modern feel.
*   **Traffic Bubbles:** Must be in the topmost `SymbolLayer` to avoid being covered by other elements.

## Traffic Layer Configuration (Mandatory)
*   **Layer Order:** Traffic layers (`mapbox-traffic-v1`) MUST be in `slot="top"`. This ensures they are rendered above EVERYTHING for maximum visibility.
*   **Active Route Coloring:** The active route `LineLayer` MUST use a `match` expression on the `congestion` property (e.g., `['match', ['get', 'congestion'], 'low', '#007AFF', 'moderate', '#FF9500', 'heavy', '#FF3B30', ...]`).
*   **Source Refresh:** The `VectorSource` for traffic should be keyed to a refresh counter to force tile updates periodically (e.g., every 60 seconds).
*   **Profile:** For truck-specific routing, the `mapbox/truck` profile MUST be used in conjunction with `annotations=congestion` to receive segment-level traffic data.
