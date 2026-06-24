import Config from 'react-native-config';

// Sentry DSN — set SENTRY_DSN in .env (never commit the real value)
export const SENTRY_DSN: string = Config.SENTRY_DSN ?? '';
export const SENTRY_ENVIRONMENT: string = Config.SENTRY_ENVIRONMENT ?? (__DEV__ ? 'development' : 'production');

// Public Mapbox token — safe to commit (pk. prefix)
export const MAPBOX_PUBLIC_TOKEN =
  'pk.eyJ1IjoiYnJlaWthOTk5IiwiYSI6ImNtbHBob2xjMzE5Z3MzZ3F4Y3QybGpod3AifQ.hprmbhb8EVFSfF7cqc4lkw';

// Flask backend
// Debug builds talk to the local Flask server through adb reverse.
// Release builds use Railway.
export const BACKEND_URL = __DEV__
  ? 'http://127.0.0.1:5050'
  : 'https://truckexpoai-production.up.railway.app';

// Google OAuth web client ID. Required for backend-verified login.
export const GOOGLE_WEB_CLIENT_ID: string = Config.GOOGLE_WEB_CLIENT_ID ?? '';

// Temporary beta fallback. Do not ship this once GOOGLE_WEB_CLIENT_ID is configured.
export const APP_INTERNAL_TOKEN: string = Config.APP_INTERNAL_TOKEN ?? '';

// RevenueCat Android public SDK key — set REVENUECAT_ANDROID_API_KEY in .env.
export const REVENUECAT_ANDROID_API_KEY: string = Config.REVENUECAT_ANDROID_API_KEY ?? '';

// Default map center — Bulgaria
export const MAP_CENTER = {
  longitude: 25.0,
  latitude: 42.7,
  zoomLevel: 7,
};
