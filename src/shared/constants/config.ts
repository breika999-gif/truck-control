import Config from 'react-native-config';

// Public Mapbox token — safe to commit (pk. prefix)
export const MAPBOX_PUBLIC_TOKEN =
  'pk.eyJ1IjoiYnJlaWthOTk5IiwiYSI6ImNtbHBob2xjMzE5Z3MzZ3F4Y3QybGpod3AifQ.hprmbhb8EVFSfF7cqc4lkw';

// Flask backend
// Debug builds talk to the local Flask server through adb reverse.
// Release builds use Railway.
export const BACKEND_URL = __DEV__
  ? 'http://127.0.0.1:5050'
  : 'https://truckexpoai-production.up.railway.app';

// Internal app token for backend endpoints that are not public.
export const APP_INTERNAL_TOKEN: string = Config.APP_INTERNAL_TOKEN ?? '';

// Default map center — Bulgaria
export const MAP_CENTER = {
  longitude: 25.0,
  latitude: 42.7,
  zoomLevel: 7,
};
