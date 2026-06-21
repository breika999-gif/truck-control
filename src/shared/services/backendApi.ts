/**
 * TruckAI Pro — Flask backend API client
 *
 * Connects to backend/app.py running on localhost:5050.
 * On a physical Android device: tunnel with `adb reverse tcp:5050 tcp:5050`
 *
 * Architecture: GPT-4o responds ONLY with JSON map actions.
 * Every response is a MapAction object that the frontend executes directly.
 *
 * Endpoints:
 *   GET  /api/health         — server status
 *   POST /api/chat           — GPT-4o AI assistant (returns MapAction)
 *   GET  /api/pois           — list saved POIs
 *   POST /api/pois           — save a POI
 *   DELETE /api/pois/:id     — delete a POI
 */

import { APP_INTERNAL_TOKEN, BACKEND_URL } from '../constants/config';
import { loadSavedAccount } from './accountManager';
import type {
  POICard as _POICard,
  BackendHealth,
  TruckRestrictionsResult,
  ChatMessage,
  ChatContext,
  ChatResponse,
  SavedPOI,
  POIPayload,
  RestType,
  TachoSessionPayload,
  TachoSummary,
  ProximityAlerts,
  POICard,
} from './backendApi.types';

// All types live in backendApi.types.ts — re-exported here for backward compat
export type {
  ChatMessage,
  POICard,
  TrafficAlert,
  RouteOption,
  TruckRestrictionPoint,
  TruckRestrictionsResult,
  MapAction,
  AppIntent,
  ChatResponse,
  ChatContext,
  TruckParking,
  SavedPOI,
  POIPayload,
  BackendHealth,
  TachoSummary,
  ProximityAlerts,
  TachoSessionPayload,
  RestType,
} from './backendApi.types';

/** Global flag to track backend availability for UI banners */
export let backendReachable = true;

const updateReachable = (ok: boolean) => { backendReachable = ok; };

interface NearbyParkingCard extends _POICard { distance?: number; }
interface NearbyParkingResponse { ok?: boolean; spots?: NearbyParkingCard[]; pois?: NearbyParkingCard[]; cards?: NearbyParkingCard[]; }

// ── Helpers ──────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 45_000; // Gemini 2.0-flash + optional GPT-4o nav forward can take 20-35s
const jwtTokens = new Map<string, string>();
const jwtRequests = new Map<string, Promise<string>>();

function requiresJwt(path: string): boolean {
  return [
    '/api/pois',
    '/api/parking/',
    '/api/poi-along-route',
    '/api/cameras',
    '/api/proximity-alerts',
    '/api/places/',
    '/api/tacho/',
    '/api/rest/log',
    '/api/chat',
    '/api/gemini/chat',
  ].some(prefix => path.startsWith(prefix));
}

async function fetchJwt(userEmail?: string): Promise<string> {
  const savedEmail = userEmail?.trim() || (await loadSavedAccount())?.email;
  const email = savedEmail?.trim().toLowerCase();
  if (!email) throw new Error('Google account required');

  const cached = jwtTokens.get(email);
  if (cached) return cached;

  const pending = jwtRequests.get(email);
  if (pending) return pending;

  const request = fetch(`${BACKEND_URL}/api/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_email: email, app_token: APP_INTERNAL_TOKEN }),
  }).then(async response => {
    if (!response.ok) throw new Error(`Auth HTTP ${response.status}`);
    const data = await response.json() as { token?: string };
    if (!data.token) throw new Error('Auth token missing');
    jwtTokens.set(email, data.token);
    return data.token;
  }).finally(() => {
    jwtRequests.delete(email);
  });

  jwtRequests.set(email, request);
  return request;
}

export async function getBackendAuthHeaders(userEmail?: string): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await fetchJwt(userEmail)}` };
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  authEmail?: string,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const headers = new Headers(options.headers);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    if (requiresJwt(path)) {
      const authHeaders = await getBackendAuthHeaders(authEmail === '__retry__' ? undefined : authEmail);
      Object.entries(authHeaders).forEach(([name, value]) => headers.set(name, value));
    } else {
      headers.set('X-App-Token', APP_INTERNAL_TOKEN);
    }

    const res = await fetch(`${BACKEND_URL}${path}`, {
      signal: controller.signal,
      ...options,
      headers,
    });

    if (!res.ok) {
      if (res.status === 401 && requiresJwt(path) && authEmail !== '__retry__') {
        // Token may be expired — clear cache and retry once
        const email = authEmail?.trim().toLowerCase()
          || (await loadSavedAccount())?.email?.trim().toLowerCase();
        if (email) jwtTokens.delete(email);
        return apiRequest<T>(path, options, '__retry__');
      }
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
    }

    const data = await res.json();
    updateReachable(true);
    return data as T;
  } catch (err) {
    updateReachable(false);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── Health ───────────────────────────────────────────────────────────────────

export async function fetchHealth(): Promise<BackendHealth | null> {
  try {
    const data = await apiRequest<BackendHealth>('/api/health');
    updateReachable(true);
    return data;
  } catch {
    updateReachable(false);
    return null;
  }
}

/** Fire-and-forget wake-up ping — call on app start to warm Railway/Render cold starts. */
export async function pingBackend(): Promise<void> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/health`, { method: 'GET' });
    updateReachable(res.ok);
  } catch {
    updateReachable(false);
  }
}

// ── Truck restriction checker ────────────────────────────────────────────────

export async function checkTruckRestrictions(
  profile: Partial<{ weight_t: number; height_m: number; width_m: number; length_m: number; hazmat_class: string }>,
  coords?: [number, number][],
): Promise<TruckRestrictionsResult> {
  try {
    return await apiRequest<TruckRestrictionsResult>('/api/check-truck-restrictions', {
      method: 'POST',
      body: JSON.stringify({ profile, coords }),
    });
  } catch {
    return {
      ok: false,
      safe: false,
      warnings: ['Проверката за ограничения по маршрута не успя. Не приемай маршрута като проверен за камион.'],
      restrictions: [],
      restrictions_checked: false,
    };
  }
}

// ── GPT-4o chat (direct — internal/legacy) ────────────────────────────────────

/**
 * Send a message directly to GPT-4o map engine.
 * Prefer sendGeminiMessage() for normal chat — this is kept for internal use.
 */
export async function sendChatMessage(
  message: string,
  history: ChatMessage[] = [],
  context?: ChatContext,
): Promise<ChatResponse> {
  try {
    return await apiRequest<ChatResponse>('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message, history, context }),
    });
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── Gemini key validation ─────────────────────────────────────────────────────

export async function validateGeminiKey(
  apiKey: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    return await apiRequest<{ ok: boolean; error?: string }>('/api/gemini/validate', {
      method: 'POST',
      body: JSON.stringify({ api_key: apiKey }),
    });
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── Gemini AI command chain ────────────────────────────────────────────────────

/**
 * Send a message to Gemini (primary voice assistant).
 * Gemini processes conversationally; if navigation intent detected,
 * it auto-forwards to GPT-4o map engine and returns the MapAction.
 */
export async function sendGeminiMessage(
  message: string,
  history: ChatMessage[] = [],
  context?: ChatContext,
  userEmail?: string,
  role?: string,
): Promise<ChatResponse> {
  try {
    return await apiRequest<ChatResponse>('/api/gemini/chat', {
      method: 'POST',
      body: JSON.stringify({
        message,
        history,
        context,
        user_email: userEmail,
        role,
      }),
    });
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── Whisper transcription ─────────────────────────────────────────────────────

/** Transcribe audio through the backend transcription endpoint. */
export async function transcribeGemini(
  audioPath: string,
  userEmail?: string,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const form = new FormData();
    form.append('audio', {
      uri:  audioPath.startsWith('file://') ? audioPath : `file://${audioPath}`,
      type: 'audio/m4a',
      name: 'recording.m4a',
    } as unknown as Blob);
    if (userEmail)  form.append('user_email',  userEmail);

    const res = await fetch(`${BACKEND_URL}/api/transcribe`, {
      method: 'POST',
      headers: { 'X-App-Token': APP_INTERNAL_TOKEN },
      body:   form,
      signal: controller.signal,
    });
    const data = (await res.json()) as { ok: boolean; text?: string; error?: string };
    return data.ok && data.text ? data.text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Transcribe audio through the backend. */
export async function transcribeAudio(audioPath: string): Promise<string | null> {
  const uri = audioPath.startsWith('file://') ? audioPath : `file://${audioPath}`;

  const tryEndpoint = async (endpoint: string): Promise<string | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const form = new FormData();
      form.append('audio', { uri, type: 'audio/m4a', name: 'recording.m4a' } as unknown as Blob);
      const res = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'X-App-Token': APP_INTERNAL_TOKEN },
        body: form,
        signal: controller.signal,
      });
      const data = (await res.json()) as { ok: boolean; text?: string; error?: string };
      return data.ok && data.text ? data.text : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  return tryEndpoint('/api/transcribe');
}

// ── POI CRUD ─────────────────────────────────────────────────────────────────

export async function listPOIs(category?: string, userEmail?: string): Promise<SavedPOI[]> {
  try {
    const params = new URLSearchParams();
    if (category)   params.set('category',   category);
    if (userEmail)  params.set('user_email', userEmail);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await apiRequest<{ ok: boolean; pois: SavedPOI[] }>(`/api/pois${qs}`, {}, userEmail);
    return res.ok ? res.pois : [];
  } catch {
    return [];
  }
}

export async function savePOI(poi: POIPayload): Promise<SavedPOI | null> {
  try {
    const res = await apiRequest<{ ok: boolean; poi: SavedPOI }>('/api/pois', {
      method: 'POST',
      body: JSON.stringify(poi),
    }, poi.user_email);
    return res.ok ? res.poi : null;
  } catch {
    return null;
  }
}

export async function deletePOI(id: number, userEmail?: string): Promise<boolean> {
  try {
    const qs = userEmail ? `?user_email=${encodeURIComponent(userEmail)}` : '';
    const res = await apiRequest<{ ok: boolean }>(`/api/pois/${id}${qs}`, {
      method: 'DELETE',
    }, userEmail);
    return res.ok;
  } catch {
    return false;
  }
}

// ── Route / rest history ─────────────────────────────────────────────────────

export async function startRouteLog(data: {
  userEmail?: string;
  originName: string;
  destinationName: string;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  waypointsJson: string;
  distanceM: number;
  durationS: number;
}): Promise<number | null> {
  try {
    const res = await apiRequest<{ ok: boolean; route_id?: number }>('/api/routes/start', {
      method: 'POST',
      body: JSON.stringify({
        user_email: data.userEmail,
        origin_name: data.originName,
        destination_name: data.destinationName,
        origin_lat: data.originLat,
        origin_lng: data.originLng,
        dest_lat: data.destLat,
        dest_lng: data.destLng,
        waypoints_json: data.waypointsJson,
        distance_m: data.distanceM,
        duration_s: data.durationS,
      }),
    });
    return res.ok && Number.isFinite(res.route_id) ? res.route_id! : null;
  } catch {
    return null;
  }
}

export async function completeRouteLog(routeId: number): Promise<void> {
  try {
    await apiRequest<{ ok: boolean }>('/api/routes/complete', {
      method: 'POST',
      body: JSON.stringify({ route_id: routeId }),
    });
  } catch {
    // Route history is best-effort and must never interrupt navigation.
  }
}

export async function logRestStop(data: {
  userEmail?: string;
  lat: number;
  lng: number;
  restType: RestType;
  durationMin: number;
  startedAt: string;
}): Promise<void> {
  try {
    await apiRequest<{ ok: boolean }>('/api/rest/log', {
      method: 'POST',
      body: JSON.stringify({
        user_email: data.userEmail,
        lat: data.lat,
        lng: data.lng,
        rest_type: data.restType,
        duration_min: data.durationMin,
        started_at: data.startedAt,
      }),
    }, data.userEmail);
  } catch {
    // Rest history is best-effort and must never interrupt tachograph state.
  }
}

// ── Starred / Favorites ───────────────────────────────────────────────────────

/** Save a location as a starred favourite (category='starred'). */
export async function starPlace(
  name: string,
  lat: number,
  lng: number,
  address?: string,
  userEmail?: string,
): Promise<SavedPOI | null> {
  return savePOI({ name, lat, lng, address, category: 'starred', user_email: userEmail });
}

/** List all starred places, optionally filtered by Google account email. */
export async function listStarred(userEmail?: string): Promise<SavedPOI[]> {
  return listPOIs('starred', userEmail);
}

// ── TachoEngine v2 — EU HOS 561/2006 ─────────────────────────────────────────

/** Save a completed driving session and get updated daily/weekly summary. */
export async function saveTachoSession(
  session: TachoSessionPayload,
  signal?: AbortSignal,
): Promise<TachoSummary | null> {
  try {
    const res = await apiRequest<TachoSummary>('/api/tacho/session', {
      method: 'POST',
      body: JSON.stringify(session),
      signal,
    }, session.user_email);
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

/** Fetch daily + weekly HOS summary for a user. */
export async function fetchTachoSummary(userEmail?: string): Promise<TachoSummary | null> {
  try {
    const params = userEmail ? `?user_email=${encodeURIComponent(userEmail)}` : '';
    const res = await apiRequest<TachoSummary>(`/api/tacho/summary${params}`, {}, userEmail);
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

/** Fetch speed cameras and overtaking restrictions within a radius (default 10km). */
export async function fetchProximityAlerts(
  lat: number,
  lng: number,
  radius_m: number = 10000,
): Promise<ProximityAlerts | null> {
  try {
    const res = await apiRequest<ProximityAlerts>(
      `/api/proximity-alerts?lat=${lat}&lng=${lng}&radius_m=${radius_m}`,
    );
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

/** Fetch all user-reported speed cameras from the POI store. */
export async function fetchReportedCameras(userEmail?: string): Promise<POICard[]> {
  const pois = await listPOIs('speed_camera', userEmail);
  return pois.map(p => ({
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    distance_m: 0,
    category: 'speed_camera' as const,
  }));
}

/** Report a new speed camera. */
export async function reportCamera(
  lat: number,
  lng: number,
  userEmail?: string,
): Promise<boolean> {
  try {
    const res = await apiRequest<{ ok: boolean }>('/api/cameras/report', {
      method: 'POST',
      body: JSON.stringify({ lat, lng, user_email: userEmail }),
    }, userEmail);
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchCamerasAlongRoute(
  coords: [number, number][],
  signal?: AbortSignal,
): Promise<POICard[]> {
  try {
    const data = await apiRequest<{ cameras?: POICard[] }>('/api/cameras-along-route', {
      method: 'POST',
      body: JSON.stringify({ coords }),
      signal,
    });
    return (data.cameras ?? []) as POICard[];
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    return [];
  }
}

export async function fetchPOIsAlongRoute(
  coords: [number, number][],
  category: 'truck_stop' | 'fuel',
  signal?: AbortSignal,
): Promise<POICard[]> {
  // Pre-sample to max 400 points — backend samples again, but this keeps payload small
  const MAX_SEND = 400;
  const sampled: [number, number][] = coords.length <= MAX_SEND
    ? coords
    : [
        coords[0],
        ...coords.slice(1, -1).filter((_, i) => i % Math.ceil((coords.length - 2) / (MAX_SEND - 2)) === 0),
        coords[coords.length - 1],
      ];
  try {
    const data = await apiRequest<{ pois?: POICard[] }>('/api/poi-along-route', {
      method: 'POST',
      body: JSON.stringify({ coords: sampled, category }),
      signal,
    });
    return (data.pois ?? []) as POICard[];
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    return [];
  }
}

export async function searchNearbyParking(
  lat: number,
  lng: number,
  radiusM: number = 20000,
): Promise<POICard[]> {
  try {
    const params = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
      radius: String(radiusM),
    });
    const data = await apiRequest<NearbyParkingResponse>(`/api/parking/nearby?${params.toString()}`);
    const items = data.spots ?? data.pois ?? data.cards ?? [];
    return items.map(({ distance, ...item }) => ({
      ...item,
      distance_m: item.distance_m ?? distance ?? 0,
    }));
  } catch {
    return [];
  }
}

