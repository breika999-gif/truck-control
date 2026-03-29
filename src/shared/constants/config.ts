// Public Mapbox token — safe to commit (pk. prefix)
export const MAPBOX_PUBLIC_TOKEN =
  'pk.eyJ1IjoiYnJlaWthOTk5IiwiYSI6ImNtbHBob2xjMzE5Z3MzZ3F4Y3QybGpod3AifQ.hprmbhb8EVFSfF7cqc4lkw';

// TomTom API key — geocoding + POI search (client-side)
// Routing calls go through backend/.env TOMTOM_API_KEY
export const TOMTOM_API_KEY = 'ZHxLBBp74UwTtWXXEhAx7RZNBgeLxv8K';

// Flask backend — Render cloud deploy
export const BACKEND_URL = 'https://truckexpoai.onrender.com';

// Default map center — Bulgaria
export const MAP_CENTER = {
  longitude: 25.0,
  latitude: 42.7,
  zoomLevel: 7,
};
