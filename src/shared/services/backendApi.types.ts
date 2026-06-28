/**
 * TruckAI Pro — shared API types
 * Extracted from backendApi.ts — import from here for type-only usage.
 */

import type { VehicleProfile } from '../types/vehicle';

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
  category?: string;
  travel_time?: number;
  detour_time?: number;
  transparking_id?: string;
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
  voice_desc?: string;
  price?: string;
  truck_lane?: boolean;
  brand?: string;
  maxspeed?: number;
  photo_url?: string;
  review_summary?: string;
  business_status?: string;
  open_now?: boolean | null;
  needs_confirm?: boolean;
  source?: 'google' | 'tomtom' | 'osm';
  transparking_url?: string;
}

/** One traffic alert bubble on the route map */
export interface TrafficAlert {
  lat: number;
  lng: number;
  delay_min: number;
  severity: 'moderate' | 'heavy' | 'severe';
  label?: string;
  length_km?: number;
}

export interface RouteOption {
  label: string;
  color: string;
  duration: number;
  distance: number;
  traffic?: 'low' | 'moderate' | 'heavy';
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  dest_coords: [number, number];
  steps?: any[];
  maxspeeds?: any[];
  restrictions?: TruckRestrictionPoint[];
  congestion_geojson?: { type: 'FeatureCollection'; features: unknown[] };
  traffic_alerts?: TrafficAlert[];
}

export interface TruckRestrictionPoint {
  lat: number;
  lng: number;
  type: 'maxheight' | 'maxweight' | 'maxwidth' | 'no_trucks' | 'hazmat';
  value: string;
  value_num: number;
  tag?: string;
}

export interface TruckRestrictionsResult {
  ok: boolean;
  safe: boolean;
  warnings: string[];
  restrictions?: TruckRestrictionPoint[];
  restrictions_checked?: boolean;
}

export type MapAction =
  | { action: 'route'; destination: string; coords: [number, number]; waypoints?: [number, number][]; message?: string }
  | { action: 'show_pois'; category: 'truck_stop' | 'fuel' | 'speed_camera' | 'business'; center?: [number, number]; cards: POICard[]; message?: string; nearest_m?: number }
  | { action: 'show_routes'; destination: string; dest_coords: [number, number]; options: RouteOption[]; waypoints?: [number, number][]; message?: string }
  | { action: 'tachograph'; driven_hours: number; remaining_hours: number; break_needed?: boolean; suggested_stop?: { lat: number; lng: number; name: string }; message?: string }
  | { action: 'add_waypoint'; name: string; coords: [number, number]; message?: string }
  | { action: 'message'; text: string };

export interface AppIntent {
  app: string;
  query?: string;
  url?: string;
  transparking_id?: string;
}

export interface ChatResponse {
  ok: boolean;
  error?: string;
  action?: MapAction;
  reply?: string;
  app_intent?: AppIntent;
  remember?: Array<{ category: string; text: string }>;
}

export interface ChatContext {
  lat?: number;
  lng?: number;
  driven_seconds?: number;
  speed_kmh?: number;
  profile?: VehicleProfile;
  last_message?: string;
  destination?: string;
  route_distance_km?: number;
  route_duration_min?: number;
  remaining_drive_min?: number;
  current_time_iso?: string;
  eta_iso?: string;
  distance_since_rest_km?: number;
  dest_lat?: number;
  dest_lng?: number;
  shift_start_iso?: string;
  reduced_rests_remaining?: number;
  daily_driving_limit_h?: number;
  bt_connected?: boolean;
  bt_activity?: 'driving' | 'rest' | 'work' | 'available' | null;
  bt_live_activity?: string | null;
  bt_card?: boolean | null;
  bt_driving_time_left_min?: number | null;
  bt_daily_driven_min?: number | null;
  bt_speed_kmh?: number | null;
  weekly_status?: {
    drivenH: number;
    remainingH: number;
    canExtendToday: boolean;
    mustRecuperateBy: string;
    recommendedStartTomorrow: string | null;
  };
  tacho_log?: object;
  tacho_week?: object;
  parking_cards?: Array<{
    name: string;
    dist_km?: number;
    paid?: boolean;
    showers?: boolean;
    security?: boolean;
    toilets?: boolean;
    transparking_id?: string;
  }>;
  found_parking?: Array<{
    name: string;
    dist_km?: number;
    paid?: boolean;
    showers?: boolean;
    security?: boolean;
  }>;
  user_memory?: string[];
  driver_habits?: object | null;
}

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
  starred?: boolean;
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
  timestamp: string;
}

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
  continuous_driven_s: number;
  continuous_remaining_s: number;
  continuous_driven_h: number;
  continuous_remaining_h: number;
  break_needed: boolean;
  weekly_regular_rests: number;
  weekly_reduced_rests: number;
  reduced_rests_remaining: number;
  biweekly_driven_h: number;
  biweekly_remaining_h: number;
  biweekly_limit_h: number;
  daily_limit_h: number;
  weekly_limit_h: number;
  date: string;
  week_start: string;
  shift_start_iso?: string;
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
    geometry?: [number, number][] | null;
  }>;
  nearest_camera_m: number;
}

export interface TachoSessionPayload {
  user_email?: string;
  driven_seconds: number;
  date?: string;
  start_time?: string;
  end_time?: string;
  type?: 'driving' | 'break' | 'rest';
}

export type RestType = 'break_45min' | 'daily_9h' | 'daily_11h' | 'reduced_9h';
