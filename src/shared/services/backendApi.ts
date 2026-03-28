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

import { BACKEND_URL } from '../constants/config';
import type { VehicleProfile } from '../types/vehicle';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

/** Universal POI card — covers truck stops, fuel stations, speed cameras */
export interface POICard {
  name: string;
  lat: number;
  lng: number;
  distance_m: number;
  // truck_stop fields
  paid?: boolean;
  showers?: boolean;
  toilets?: boolean;
  wifi?: boolean;
  security?: boolean;
  lighting?: boolean;
  capacity?: number;
  website?: string;
  safe?: boolean;
  info?: string;
  opening_hours?: string;
  phone?: string;
  /** Bulgarian TTS voice description of parking pros/cons */
  voice_desc?: string;
  // fuel fields
  price?: string;
  truck_lane?: boolean;
  brand?: string;
  // camera fields
  maxspeed?: number;
  // business / Google Places enrichment fields
  photo_url?: string;
  review_summary?: string;
  business_status?: string;
  open_now?: boolean | null;
  needs_confirm?: boolean;
}

/** One traffic alert bubble on the route map */
export interface TrafficAlert {
  lat: number;
  lng: number;
  delay_min: number;
  severity: 'moderate' | 'heavy' | 'severe';
  label?: string;    // pre-formatted Bulgarian label, e.g. "🛑 +12 мин"
  length_km?: number; // estimated congestion zone length in km
}

/** One route option inside show_routes action */
export interface RouteOption {
  label: string;
  color: string;
  duration: number;
  distance: number;
  traffic?: 'low' | 'moderate' | 'heavy';
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  dest_coords: [number, number];
  /** Per-segment FeatureCollection tagged with congestion level for line coloring */
  congestion_geojson?: { type: 'FeatureCollection'; features: unknown[] };
  /** Clusters of heavy/severe congestion with delay estimates */
  traffic_alerts?: TrafficAlert[];
}

/** Result from /api/check-truck-restrictions */
export interface TruckRestrictionsResult {
  ok: boolean;
  safe: boolean;
  warnings: string[];
}

/** All possible map actions GPT-4o can return */
export type MapAction =
  | { action: 'route'; destination: string; coords: [number, number]; waypoints?: [number, number][]; message?: string }
  | { action: 'show_pois'; category: 'truck_stop' | 'fuel' | 'speed_camera' | 'business'; center?: [number, number]; cards: POICard[]; message?: string; nearest_m?: number }
  | { action: 'show_routes'; destination: string; dest_coords: [number, number]; options: RouteOption[]; waypoints?: [number, number][]; message?: string }
  | { action: 'tachograph'; driven_hours: number; remaining_hours: number; break_needed?: boolean; suggested_stop?: { lat: number; lng: number; name: string }; message?: string }
  | { action: 'add_waypoint'; name: string; coords: [number, number]; message?: string }
  | { action: 'message'; text: string };

export interface AppIntent {
  app: string;    // 'youtube' | 'spotify' | 'whatsapp' | 'maps' | ...
  query?: string; // optional search/navigation query
}

export interface ChatResponse {
  ok: boolean;
  error?: string;
  action?: MapAction;
  reply?: string; // kept for backward compat — use action.message instead
  app_intent?: AppIntent;
}

export interface ChatContext {
  lat?: number;
  lng?: number;
  driven_seconds?: number;
  speed_kmh?: number;
  profile?: VehicleProfile;
  last_message?: string;
}

/** Backward-compat alias — parking cards now use POICard */
export type TruckParking = POICard;

export interface SavedPOI {
  id: number;
  name: string;
  address: string;
  category: string;
  lat: number;
  lng: number;
  notes: string;
  created_at: string;
}

export interface POIPayload {
  name: string;
  address?: string;
  category?: string;
  lat: number;
  lng: number;
  notes?: string;
  user_email?: string;
}

export interface BackendHealth {
  status: string;
  gpt4o_ready: boolean;
  db: string;
  timestamp: string;
}

/** EU HOS 561/2006 daily + weekly summary */
export interface TachoSummary {
  ok: boolean;
  daily_driven_s: number;
  daily_remaining_s: number;
  daily_driven_h: number;
  daily_remaining_h: number;
  weekly_driven_s: number;
  weekly_remaining_s: number;
  weekly_driven_h: number;
  weekly_remaining_h: number;
  /** Continuous driving since last 45-min break (EU 4.5 h rule) */
  continuous_driven_s: number;
  continuous_remaining_s: number;
  continuous_driven_h: number;
  continuous_remaining_h: number;
  /** true when continuous_driven_s >= 16200 (4.5 h) */
  break_needed: boolean;
  /** Weekly daily-rest counts (EU 561/2006: max 3 reduced rests per week) */
  weekly_regular_rests: number;    // gaps >= 11 h
  weekly_reduced_rests: number;    // gaps >= 9 h but < 11 h
  reduced_rests_remaining: number; // how many 9h rests are still allowed (3 - used)
  /** Bi-weekly totals (EU 561/2006: max 90 h in any two consecutive weeks) */
  biweekly_driven_h: number;
  biweekly_remaining_h: number;
  biweekly_limit_h: number;
  daily_limit_h: number;
  weekly_limit_h: number;
  date: string;
  week_start: string;
}

export interface ProximityAlerts {
  ok: boolean;
  cameras: POICard[];
  overtaking: Array<{
    lat: number;
    lng: number;
    type: 'overtaking_no';
    hgv_only: boolean;
    distance_m: number;
  }>;
  nearest_camera_m: number;
}

export interface TachoSessionPayload {
  user_email?: string;
  driven_seconds: number;
  date?: string;       // YYYY-MM-DD, defaults to today on backend
  start_time?: string; // ISO string
  end_time?: string;   // ISO string
  type?: 'driving' | 'break' | 'rest'; // defaults to 'driving' on backend
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 45_000; // Gemini 2.0-flash + optional GPT-4o nav forward can take 20-35s

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      ...options,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
    }

    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timer);
  }
}

// ── Health ───────────────────────────────────────────────────────────────────

export async function fetchHealth(): Promise<BackendHealth | null> {
  try {
    return await apiRequest<BackendHealth>('/api/health');
  } catch {
    return null;
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
    return { ok: false, safe: true, warnings: [] };
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
): Promise<ChatResponse> {
  try {
    return await apiRequest<ChatResponse>('/api/gemini/chat', {
      method: 'POST',
      body: JSON.stringify({
        message,
        history,
        context,
        user_email: userEmail,
      }),
    });
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── Whisper transcription ─────────────────────────────────────────────────────

/** Transcribe audio via Gemini 2.0 Flash multimodal (preferred — no Whisper quota needed). */
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

    const res = await fetch(`${BACKEND_URL}/api/gemini/transcribe`, {
      method: 'POST',
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

/** Transcribe audio via OpenAI Whisper (fallback). */
export async function transcribeAudio(audioPath: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const form = new FormData();
    form.append('audio', {
      uri:  audioPath.startsWith('file://') ? audioPath : `file://${audioPath}`,
      type: 'audio/m4a',
      name: 'recording.m4a',
    } as unknown as Blob);

    const res = await fetch(`${BACKEND_URL}/api/transcribe`, {
      method:  'POST',
      body:    form,
      signal:  controller.signal,
    });
    const data = (await res.json()) as { ok: boolean; text?: string; error?: string };
    return data.ok && data.text ? data.text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── POI CRUD ─────────────────────────────────────────────────────────────────

export async function listPOIs(category?: string, userEmail?: string): Promise<SavedPOI[]> {
  try {
    const params = new URLSearchParams();
    if (category)   params.set('category',   category);
    if (userEmail)  params.set('user_email', userEmail);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await apiRequest<{ ok: boolean; pois: SavedPOI[] }>(`/api/pois${qs}`);
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
    });
    return res.ok ? res.poi : null;
  } catch {
    return null;
  }
}

export async function deletePOI(id: number): Promise<boolean> {
  try {
    const res = await apiRequest<{ ok: boolean }>(`/api/pois/${id}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch {
    return false;
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
export async function saveTachoSession(session: TachoSessionPayload): Promise<TachoSummary | null> {
  try {
    const res = await apiRequest<TachoSummary>('/api/tacho/session', {
      method: 'POST',
      body: JSON.stringify(session),
    });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

/** Fetch daily + weekly HOS summary for a user. */
export async function fetchTachoSummary(userEmail?: string): Promise<TachoSummary | null> {
  try {
    const params = userEmail ? `?user_email=${encodeURIComponent(userEmail)}` : '';
    const res = await apiRequest<TachoSummary>(`/api/tacho/summary${params}`);
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

export async function fetchCamerasAlongRoute(
  coords: [number, number][],
): Promise<POICard[]> {
  try {
    const { BACKEND_URL } = await import('../constants/config');
    const res = await fetch(`${BACKEND_URL}/api/cameras-along-route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coords }),
    });
    const data = await res.json();
    return (data.cameras ?? []) as POICard[];
  } catch {
    return [];
  }
}

export async function fetchPOIsAlongRoute(
  coords: [number, number][],
  category: 'truck_stop' | 'fuel',
): Promise<POICard[]> {
  try {
    const { BACKEND_URL } = await import('../constants/config');
    const res = await fetch(`${BACKEND_URL}/api/poi-along-route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coords, category }),
    });
    const data = await res.json();
    return (data.pois ?? []) as POICard[];
  } catch {
    return [];
  }
}

