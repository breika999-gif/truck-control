// Public Mapbox token — safe to commit (pk. prefix)
export const MAPBOX_PUBLIC_TOKEN =
  'pk.eyJ1IjoiYnJlaWthOTk5IiwiYSI6ImNtbHBob2xjMzE5Z3MzZ3F4Y3QybGpod3AifQ.hprmbhb8EVFSfF7cqc4lkw';

// Flask backend — ADB reverse tunnel (adb reverse tcp:5050 tcp:5050)
// When running on a physical Android device, Metro is already tunnelled on
// 8081. We do the same for Flask: run once → adb reverse tcp:5050 tcp:5050
export const BACKEND_URL = 'http://127.0.0.1:5050';

// Default map center — Bulgaria
export const MAP_CENTER = {
  longitude: 25.0,
  latitude: 42.7,
  zoomLevel: 7,
};
