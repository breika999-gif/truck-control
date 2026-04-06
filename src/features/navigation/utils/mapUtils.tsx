import React from 'react';
import { Platform, Linking } from 'react-native';
import Tts from 'react-native-tts';
import Mapbox, { type CameraPadding } from '@rnmapbox/maps';

import { MAP_CENTER } from '../../../shared/constants/config';
import type { MapAction } from '../../../shared/services/backendApi';
import type { POICategory } from '../api/poi';

// ── Asset requires ────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const NAV_ARROW = require('../../../shared/assets/nav_arrow.png') as number;
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const SIGN_CLOSED  = require('../../../shared/assets/sign_closed.png') as number;
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const SIGN_DANGER0 = require('../../../shared/assets/sign_danger_0.png') as number;
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const STAR_ICON    = require('../../../shared/assets/star_icon.png') as number;
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const ICON_PARKING       = require('../../../shared/assets/icon_parking.png') as number;
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const ICON_FUEL          = require('../../../shared/assets/icon_fuel.png') as number;
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const ICON_CAMERA        = require('../../../shared/assets/icon_camera.png') as number;
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const ICON_DESTINATION   = require('../../../shared/assets/icon_destination.png') as number;
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const ICON_START         = require('../../../shared/assets/icon_start.png') as number;
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const ICON_WAYPOINT      = require('../../../shared/assets/icon_waypoint.png') as number;
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const ICON_BIZ           = require('../../../shared/assets/icon_biz.png') as number;
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const ICON_NO_OVERTAKING = require('../../../shared/assets/icon_no_overtaking.png') as number;

// ── Maneuver arrow icons (TomTom originals) ───────────────────────────────────
export const ARROW_STRAIGHT      = require('../../../shared/assets/maneuver/arrow_straight.png') as number;
export const ARROW_RIGHT         = require('../../../shared/assets/maneuver/arrow_right.png') as number;
export const ARROW_LEFT          = require('../../../shared/assets/maneuver/arrow_left.png') as number;
export const ARROW_SLIGHT_RIGHT  = require('../../../shared/assets/maneuver/arrow_slight_right.png') as number;
export const ARROW_SLIGHT_LEFT   = require('../../../shared/assets/maneuver/arrow_slight_left.png') as number;
export const ARROW_SHARP_RIGHT   = require('../../../shared/assets/maneuver/arrow_sharp_right.png') as number;
export const ARROW_SHARP_LEFT    = require('../../../shared/assets/maneuver/arrow_sharp_left.png') as number;
export const ARROW_UTURN         = require('../../../shared/assets/maneuver/arrow_uturn.png') as number;
export const ARROW_ROUNDABOUT    = require('../../../shared/assets/maneuver/arrow_roundabout.png') as number;

// ── Camera padding constants ──────────────────────────────────────────────────
export const NAV_PADDING: CameraPadding  = { paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 280 };
export const ZERO_PADDING: CameraPadding = { paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0 };

// ── App deep-link URL builders ────────────────────────────────────────────────
export const APP_URL_MAP: Record<string, (query?: string) => string> = {
  youtube:    q => q
    ? `intent://www.youtube.com/results?search_query=${encodeURIComponent(q)}#Intent;scheme=https;package=com.google.android.youtube;end`
    : `vnd.youtube://`,
  spotify:    q => q ? `spotify://search/${encodeURIComponent(q)}` : `spotify://`,
  whatsapp:   q => q ? `https://wa.me/?text=${encodeURIComponent(q)}` : `whatsapp://`,
  telegram:   () => `tg://`,
  viber:      () => `viber://`,
  maps:       q => `geo:0,0?q=${encodeURIComponent(q ?? '')}`,
  settings:   () => `intent:#Intent;action=android.settings.SETTINGS;end`,
  phone:      q => q ? `tel:${q.replace(/\D/g, '')}` : `tel://`,
  camera:     () => `intent:#Intent;action=android.media.action.IMAGE_CAPTURE;end`,
  calculator: () => `intent:#Intent;action=android.intent.action.MAIN;package=com.google.android.calculator;end`,
  chrome:     q => q
    ? `intent://${q.replace(/^https?:\/\//, '')}#Intent;scheme=https;package=com.android.chrome;end`
    : `intent://google.com#Intent;scheme=https;package=com.android.chrome;end`,
  facebook:   () => `fb://`,
  instagram:  () => `instagram://`,
};

// ── Constants ─────────────────────────────────────────────────────────────────
export const HOS_LIMIT_S = 16200; // EU 4.5 h = 16 200 s
export const POI_CATEGORIES: POICategory[] = [
  'gas_station',
  'parking',
  'rest_area',
  'truck_stop',
];

export const DEPART_LABELS = ['СЕГА', '+1 ч', '+2 ч', 'Утре 08:00'] as const;
export type DepartLabel = (typeof DEPART_LABELS)[number];

// ── Helper functions ──────────────────────────────────────────────────────────

/** ISO 8601 timestamp N minutes from now. */
export function addMinutes(m: number): string {
  return new Date(Date.now() + m * 60_000).toISOString();
}

/** ISO 8601 timestamp for tomorrow at 08:00 local time. */
export function tomorrowAt8(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  return d.toISOString();
}

/** Departure ISO timestamp from a DepartLabel selection. */
export function departIso(label: DepartLabel): string | null {
  if (label === '+1 ч')        return addMinutes(60);
  if (label === '+2 ч')        return addMinutes(120);
  if (label === 'Утре 08:00')  return tomorrowAt8();
  return null; // 'СЕГА'
}

/** Emoji arrow for a lane direction string from Mapbox banner_instructions. */
export function laneDirectionEmoji(dir?: string): string {
  if (!dir || dir === 'none' || dir === 'straight') return '⬆️';
  if (dir === 'sharp left')  return '⬅️';
  if (dir === 'left')        return '⬅️';
  if (dir === 'slight left') return '↖️';
  if (dir === 'slight right')return '↗️';
  if (dir === 'right')       return '➡️';
  if (dir === 'sharp right') return '➡️';
  if (dir === 'uturn')       return '🔄';
  return '⬆️';
}

/** Safe TTS speak — swallows errors when TTS engine is not ready. */
export function ttsSpeak(text: string): void {
  try { Tts.speak(text); } catch { /* TTS engine not initialised */ }
}

// ── Truck speed limits lookup ─────────────────────────────────────────────────

/** Truck speed limits (km/h) by country code and road type.
 *  road_type: 'motorway' | 'trunk' | 'primary' | 'other'
 */
const TRUCK_LIMITS: Record<string, Record<string, number>> = {
  BG:      { motorway: 100, trunk: 80,  primary: 70, other: 50 },
  DE:      { motorway: 80,  trunk: 80,  primary: 60, other: 50 },
  FR:      { motorway: 90,  trunk: 80,  primary: 80, other: 50 },
  RO:      { motorway: 110, trunk: 90,  primary: 80, other: 50 },
  TR:      { motorway: 90,  trunk: 80,  primary: 70, other: 50 },
  GR:      { motorway: 80,  trunk: 80,  primary: 70, other: 50 },
  RS:      { motorway: 80,  trunk: 80,  primary: 70, other: 50 },
  AT:      { motorway: 80,  trunk: 70,  primary: 60, other: 50 },
  HU:      { motorway: 80,  trunk: 70,  primary: 70, other: 50 },
  DEFAULT: { motorway: 80,  trunk: 70,  primary: 60, other: 50 },
};

/** Return the legal truck speed limit (km/h) for a given country + road type. */
export function getTruckSpeedLimit(countryCode: string, roadType: string): number {
  const country = TRUCK_LIMITS[countryCode.toUpperCase()] ?? TRUCK_LIMITS.DEFAULT;
  return country[roadType] ?? (country.other ?? 50);
}

/** Convert a raw backend string to clean chat-bubble text. */
export function parseBubbleText(raw: string): string {
  if (!raw) return '';
  let s = raw.trim();

  // 1. Strip common prefixes like "action:xxx\n" or Markdown code blocks
  s = s.replace(/^action:\w+\n/i, '');
  s = s.replace(/^```json\n?/, '').replace(/\n?```$/, '');

  // 2. Try to parse as JSON
  const tryParse = (str: string): Record<string, any> | null => {
    try {
      // Clean leading/trailing junk that might surround the JSON object
      const start = str.indexOf('{');
      const end = str.lastIndexOf('}');
      if (start !== -1 && end !== -1 && end > start) {
        return JSON.parse(str.substring(start, end + 1));
      }
      return JSON.parse(str);
    } catch {
      return null;
    }
  };

  let obj = tryParse(s);

  // 3. If failed but looks like partial JSON (e.g. "action": "message"...), wrap it
  if (!obj && s.includes('"action"') && (s.includes('"text"') || s.includes('"message"'))) {
    obj = tryParse(`{${s}}`);
  }

  if (obj) {
    // Priority: text -> message -> reply -> reply.text
    const explicit = String(obj.text ?? obj.message ?? obj.reply?.text ?? obj.reply ?? '').trim();
    if (explicit && explicit !== '[object Object]') return explicit;

    const dest = String(obj.destination ?? obj.dest_name ?? 'дестинацията');
    const action = String(obj.action ?? '');

    switch (action) {
      case 'route':       return `Пътуваме към ${dest}. Приятен път!`;
      case 'show_routes': return `Варианти за маршрут до ${dest}.`;
      case 'show_pois':   return `Търся ${obj.category === 'fuel' ? 'бензиностанции' : 'места за спиране'} наблизо…`;
      case 'tachograph':  return 'Проверка на тахографа и времето за почивка.';
      case 'add_waypoint': return `Добавям ${obj.name ?? 'спирка'} към маршрута.`;
      default:
        // If it's a message action but text was missing
        if (action === 'message' && !explicit) return 'Как мога да помогна?';
        return s;
    }
  }

  return s;
}

/** Build clean, emoji-free TTS confirmation for each GPT action. */
export function voiceText(act: MapAction): string {
  switch (act.action) {
    case 'show_pois': {
      const count = act.cards?.length ?? 0;
      const nearest =
        'nearest_m' in act && typeof act.nearest_m === 'number' && act.nearest_m > 0
          ? `, най-близката на ${Math.round(act.nearest_m)} метра`
          : '';
      switch (act.category) {
        case 'truck_stop':   return `Намерих ${count} паркинга за камиони.`;
        case 'fuel':         return `Намерих ${count} горивни станции.`;
        case 'speed_camera': return `Внимание, ${count} камери в района${nearest}.`;
        case 'business':     return `Намерих ${count} места. Показвам на картата.`;
        default:             return `Намерих ${count} резултата.`;
      }
    }
    case 'add_waypoint':
      return `Добавена спирка ${act.name}. Преизчислявам маршрута.`;
    case 'route':
      return `Прокладвам маршрут до ${act.destination}.`;
    case 'show_routes': {
      const count = act.options?.length ?? 0;
      return `Намерих ${count} варианта за ${act.destination}. Избери маршрут.`;
    }
    case 'tachograph': {
      const rem = act.remaining_hours ?? 0;
      if (act.break_needed) return 'Достигнат лимит. Задължителна 45-минутна почивка.';
      if (rem < 0.5)         return `${Math.round(rem * 60)} минути до почивка. Спри скоро.`;
      return `Остават ${rem.toFixed(1)} часа до задължителна почивка.`;
    }
    case 'message':
      return act.text ?? '';
    default:
      return '';
  }
}

/** Format distance in meters to human-readable string (e.g. "1.2 km", "350 м") */
export function fmtDistance(m: number | null | undefined): string {
  if (m == null) return '';
  if (m >= 1000) return `${(m / 1000).toFixed(1)} км`;
  return `${Math.round(m)} м`;
}

/** Remaining HOS time formatted as H:MM */
export function fmtHOS(drivenSeconds: number): string {
  const rem = Math.max(0, HOS_LIMIT_S - drivenSeconds);
  const h = Math.floor(rem / 3600);
  const m = Math.floor((rem % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** Straight-line distance between two [lng, lat] points in metres (Haversine). */
export function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const x =
    sinLat * sinLat +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * sinLon * sinLon;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/** Open-Meteo WMO weather code → emoji string. */
export function weatherEmoji(code: number): string {
  if (code === 0)  return '☀️';
  if (code <= 3)   return '⛅';
  if (code <= 48)  return '🌫️';
  if (code <= 67)  return '🌧️';
  if (code <= 77)  return '🌨️';
  if (code <= 82)  return '🌦️';
  if (code <= 95)  return '⛈️';
  return '🌩️';
}

/** Detect ISO-2 country code from GPS coordinates (EU trucking countries). */
export function detectCountryCode(lat: number, lng: number): string {
  if (lat > 41.2 && lat < 44.2 && lng > 22.4 && lng < 28.6) return 'bg';
  if (lat > 43.6 && lat < 48.3 && lng > 20.3 && lng < 30.0) return 'ro';
  if (lat > 49.0 && lat < 54.9 && lng > 14.1 && lng < 24.2) return 'pl';
  if (lat > 47.3 && lat < 55.1 && lng >  6.0 && lng < 15.0) return 'de';
  if (lat > 46.4 && lat < 49.0 && lng >  9.5 && lng < 17.2) return 'at';
  if (lat > 45.7 && lat < 48.6 && lng > 16.1 && lng < 22.9) return 'hu';
  if (lat > 41.3 && lat < 51.1 && lng > -5.2 && lng <  9.6) return 'fr';
  if (lat > 36.6 && lat < 47.1 && lng >  6.6 && lng < 18.6) return 'it';
  if (lat > 35.9 && lat < 43.9 && lng > -9.3 && lng <  4.3) return 'es';
  if (lat > 50.7 && lat < 53.6 && lng >  3.3 && lng <  7.2) return 'nl';
  if (lat > 49.5 && lat < 51.5 && lng >  2.5 && lng <  6.4) return 'be';
  if (lat > 48.5 && lat < 51.1 && lng > 12.1 && lng < 18.9) return 'cz';
  if (lat > 47.7 && lat < 49.6 && lng > 16.8 && lng < 22.6) return 'sk';
  if (lat > 45.3 && lat < 47.0 && lng > 13.4 && lng < 19.8) return 'hr';
  if (lat > 44.0 && lat < 46.9 && lng > 19.3 && lng < 23.0) return 'rs';
  if (lat > 49.0 && lat < 54.0 && lng > 22.0 && lng < 32.7) return 'ua';
  return 'eu';
}

/** Open a URL in the external browser, forcing Chrome on Android if available. */
export function openInBrowser(url: string): void {
  if (Platform.OS === 'android') {
    Linking.openURL(
      `intent://${url.replace(/^https?:\/\//, '')}#Intent;scheme=https;`
      + `action=android.intent.action.VIEW;`
      + `category=android.intent.category.BROWSABLE;`
      + `package=com.android.chrome;end`,
    ).catch(() => Linking.openURL(url).catch(() => null));
  } else {
    Linking.openURL(url).catch(() => null);
  }
}

// ── StableCamera ──────────────────────────────────────────────────────────────
interface StableCameraProps {
  cameraRef: React.RefObject<Mapbox.Camera | null>;
  navigating: boolean;
  mapLoaded: boolean;
  speed?: number;
  isTracking?: boolean;
}

export const StableCamera = React.memo(
  ({ cameraRef, navigating, mapLoaded, speed, isTracking }: StableCameraProps) => {
    // Issue 1: Speed-based zoom level
    let targetZoom = 17;
    if (speed !== undefined && speed > 0) {
      if (speed < 30) targetZoom = 17;
      else if (speed < 70) targetZoom = 16;
      else if (speed < 110) targetZoom = 15;
      else targetZoom = 14;
    }

    const adaptivePitch = !navigating ? 0 : (speed ?? 0) >= 80 ? 30 : (speed ?? 0) >= 50 ? 45 : 60;

    return (
      <Mapbox.Camera
        ref={cameraRef}
        defaultSettings={{
          centerCoordinate: [MAP_CENTER.longitude, MAP_CENTER.latitude],
          zoomLevel: MAP_CENTER.zoomLevel,
        }}
        // Issue 2/3: Pause follow if not tracking
        followUserLocation={navigating && mapLoaded && isTracking !== false}
        followUserMode={Mapbox.UserTrackingMode.FollowWithCourse}
        followZoomLevel={targetZoom}
        followPitch={adaptivePitch}
        followPadding={navigating ? NAV_PADDING : ZERO_PADDING}
      />
    );
  },
  (prev, next) =>
    prev.navigating === next.navigating &&
    prev.mapLoaded === next.mapLoaded &&
    prev.speed === next.speed &&
    prev.isTracking === next.isTracking,
);
