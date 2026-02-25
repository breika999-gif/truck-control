/**
 * TruckAI Pro — Flask backend API client
 *
 * Connects to backend/app.py running on localhost:5050.
 * On a physical Android device: tunnel with `adb reverse tcp:5050 tcp:5050`
 * (Metro already does this for port 8081).
 *
 * Endpoints:
 *   GET  /api/health         — server status
 *   POST /api/chat           — GPT-4o AI assistant
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

export interface TruckParking {
  name: string;
  lat: number;
  lng: number;
  paid: boolean;
  showers: boolean;
  distance_m: number;
  opening_hours?: string;
  phone?: string;
}

export interface SpeedCamera {
  lat: number;
  lng: number;
  maxspeed?: string;
  distance_m: number;
}

export type ChatAction =
  | { type: 'navigate'; destination: string; coords: [number, number] }
  | { type: 'show_parking'; pois: TruckParking[] }
  | { type: 'show_cameras'; cameras: SpeedCamera[]; nearest_m: number }
  | { type: 'show_pois'; pois: any[] }
  | { type: 'show_fuel'; stations: any[] };

export interface ChatResponse {
  ok: boolean;
  reply?: string;
  error?: string;
  action?: ChatAction;
}

export interface ChatContext {
  lat?: number;
  lng?: number;
  driven_seconds?: number;
  speed_kmh?: number;
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
}

export interface BackendHealth {
  status: string;
  gpt4o_ready: boolean;
  db: string;
  timestamp: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 8_000;

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

// ── GPT-4o chat ───────────────────────────────────────────────────────────────

/**
 * Send a message to the GPT-4o assistant.
 * @param message  User text
 * @param history  Conversation so far (optional — pass [] for stateless calls)
 * @param context  Driver context (location, HOS, speed) for AI enrichment
 * @returns Full ChatResponse including optional action for the map
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

// ── POI CRUD ─────────────────────────────────────────────────────────────────

export async function listPOIs(category?: string): Promise<SavedPOI[]> {
  try {
    const qs = category ? `?category=${encodeURIComponent(category)}` : '';
    const res = await apiRequest<{ ok: boolean; pois: SavedPOI[] }>(
      `/api/pois${qs}`,
    );
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
