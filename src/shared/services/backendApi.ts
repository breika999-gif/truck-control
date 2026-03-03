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

/** One route option inside show_routes action */
export interface RouteOption {
  label: string;
  color: string;
  duration: number;
  distance: number;
  traffic?: 'low' | 'moderate' | 'heavy';
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  dest_coords: [number, number];
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
}

/** Backward-compat alias — parking cards now use POICard */
export type TruckParking = POICard;

export interface SpeedCamera {
  lat: number;
  lng: number;
  maxspeed?: string;
  distance_m: number;
}

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

// ── Helpers ──────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 20_000; // GPT-4o + tool calls can take up to ~15s

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
  userApiKey?: string,
): Promise<ChatResponse> {
  try {
    return await apiRequest<ChatResponse>('/api/gemini/chat', {
      method: 'POST',
      body: JSON.stringify({ message, history, context, user_api_key: userApiKey }),
    });
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── Whisper transcription ─────────────────────────────────────────────────────

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
