import type * as GeoJSON from 'geojson';

import type { VehicleProfile } from '../../../shared/types/vehicle';
import type { RestrictionPoint } from '../api/directions';
import { haversineMeters, pointToSegmentDistanceMeters } from './mapUtils';

export type TrafficSegment = {
  startFraction: number;
  endFraction: number;
  level: 'low' | 'moderate' | 'heavy';
};

const RESTRICTION_ROUTE_BUFFER_M = 90;
const ACCESS_RESTRICTION_ROUTE_BUFFER_M = 130;
export const MAX_MAP_RESTRICTION_MARKERS = 14;
const HGV_LEGAL_THRESHOLD_T = 3.5;
const TRUCK_SPEED_CAP_KMH = 90;

type TrafficLineFeature = GeoJSON.Feature<GeoJSON.LineString | GeoJSON.MultiLineString>;

function isTrafficLineFeature(feature: GeoJSON.Feature): feature is TrafficLineFeature {
  return feature.geometry?.type === 'LineString' || feature.geometry?.type === 'MultiLineString';
}

function congestionLevel(value: unknown): TrafficSegment['level'] {
  return value === 'heavy' || value === 'moderate' ? value : 'low';
}

export function trafficAlertSeverity(value: unknown): 'low' | 'moderate' | 'heavy' | 'severe' {
  if (value === 'severe' || value === 'heavy' || value === 'moderate' || value === 'low') {
    return value;
  }
  return 'moderate';
}

export function extractTrafficSegments(
  congestionGeoJSON: GeoJSON.FeatureCollection | null,
  totalDistM: number,
): TrafficSegment[] {
  if (!congestionGeoJSON?.features?.length || totalDistM <= 0) return [];
  const features = congestionGeoJSON.features.filter(isTrafficLineFeature);
  if (!features.length) return [];

  const lengths = features.map(f => {
    const coords: GeoJSON.Position[] =
      f.geometry.type === 'LineString'
        ? f.geometry.coordinates
        : f.geometry.coordinates.flat();
    let len = 0;
    for (let i = 1; i < coords.length; i++) {
      const dx = (coords[i][0] - coords[i - 1][0]) * 111320 * Math.cos(coords[i][1] * Math.PI / 180);
      const dy = (coords[i][1] - coords[i - 1][1]) * 110540;
      len += Math.sqrt(dx * dx + dy * dy);
    }
    return len;
  });

  const totalLen = lengths.reduce((sum, len) => sum + len, 0);
  if (totalLen <= 0) return [];

  let cumulative = 0;
  return features.map((feature, i) => {
    const startFraction = cumulative / totalLen;
    cumulative += lengths[i];
    const endFraction = cumulative / totalLen;
    const level = congestionLevel(feature.properties?.congestion);
    return { startFraction, endFraction, level };
  }).filter(segment => segment.level !== 'low');
}

export function isRestrictionRelevantToProfile(
  restriction: RestrictionPoint,
  profile: VehicleProfile | null,
): boolean {
  if (!profile) return true;

  const limit = Number(restriction.value_num);
  const hasLimit = Number.isFinite(limit);

  if (restriction.type === 'maxheight') {
    return hasLimit && profile.height_m + 0.2 >= limit;
  }
  if (restriction.type === 'maxwidth') {
    return hasLimit && profile.width_m + 0.05 >= limit;
  }
  if (restriction.type === 'maxweight') {
    return hasLimit && profile.weight_t + 0.05 >= limit;
  }
  if (restriction.type === 'no_trucks') {
    return profile.weight_t >= 3.5 || profile.length_m > 6.0;
  }
  if (restriction.type === 'hazmat') {
    const hazmat = String(profile.hazmat_class ?? 'none').toLowerCase();
    return hazmat !== '' && hazmat !== 'none' && hazmat !== '0' && hazmat !== 'false';
  }
  return true;
}

export function restrictionDistanceToRouteM(
  restriction: RestrictionPoint,
  coords: [number, number][],
): number {
  if (coords.length === 0) return Infinity;
  const point: [number, number] = [restriction.lng, restriction.lat];
  if (coords.length === 1) return haversineMeters(point, coords[0]);

  let best = Infinity;
  for (let i = 1; i < coords.length; i += 1) {
    const distance = pointToSegmentDistanceMeters(point, coords[i - 1], coords[i]);
    if (distance < best) best = distance;
  }
  return best;
}

export function isRestrictionCloseToRoute(
  restriction: RestrictionPoint,
  coords: [number, number][],
): boolean {
  const bufferM =
    restriction.type === 'no_trucks' || restriction.type === 'hazmat'
      ? ACCESS_RESTRICTION_ROUTE_BUFFER_M
      : RESTRICTION_ROUTE_BUFFER_M;
  return restrictionDistanceToRouteM(restriction, coords) <= bufferM;
}

export function isHighSignalMapRestriction(
  restriction: RestrictionPoint,
  profile: VehicleProfile | null,
): boolean {
  if (restriction.type === 'no_trucks' || restriction.type === 'hazmat') return true;
  if (restriction.type === 'maxheight' || restriction.type === 'maxwidth') return true;

  if (restriction.type === 'maxweight') {
    const limit = Number(restriction.value_num);
    if (!Number.isFinite(limit)) return false;
    if (limit <= HGV_LEGAL_THRESHOLD_T) return true;

    const truckWeight = profile?.weight_t;
    return (
      typeof truckWeight === 'number' &&
      Number.isFinite(truckWeight) &&
      truckWeight > limit &&
      limit >= truckWeight - 2
    );
  }

  return true;
}

export function restrictionDisplayRank(
  restriction: RestrictionPoint,
  profile: VehicleProfile | null,
): number {
  if (restriction.type === 'no_trucks') return 0;
  if (restriction.type === 'hazmat') return 1;
  if (restriction.type === 'maxheight') return 2;
  if (restriction.type === 'maxwidth') return 3;
  if (restriction.type === 'maxweight') {
    const limit = Number(restriction.value_num);
    if (Number.isFinite(limit) && limit <= HGV_LEGAL_THRESHOLD_T) return 4;
    const truckWeight = profile?.weight_t;
    if (
      typeof truckWeight === 'number' &&
      Number.isFinite(truckWeight) &&
      truckWeight > limit &&
      limit >= truckWeight - 2
    ) {
      return 5;
    }
    return 9;
  }
  return 10;
}

export function extractRequestedDriveMinutes(text: string): number | null {
  const msg = text.toLowerCase();
  let total = 0;

  for (const match of msg.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:ч|час|часа|часове|h|hr|hour|hours)\b/g)) {
    const hours = Number(match[1].replace(',', '.'));
    if (Number.isFinite(hours)) total += Math.round(hours * 60);
  }
  for (const match of msg.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:мин|минута|минути|min|mins|minutes)\b/g)) {
    const mins = Number(match[1].replace(',', '.'));
    if (Number.isFinite(mins)) total += Math.round(mins);
  }

  return total > 0 ? total : null;
}

export function isReachQuestion(text: string): boolean {
  const msg = text.toLowerCase();
  return (
    /до\s*къде|докъде|до\s*каде|докаде|къде ще стиг|каде ще стиг|къде мога да стиг|каде мога да стиг|ще стигна|ще стигнем|мога ли да стиг|стигам ли/.test(msg) ||
    /where can i|how far|reach/.test(msg)
  );
}

export function truckCappedRouteDurationS(distanceM: number, durationS: number): number {
  return Math.max(durationS, (distanceM / 1000 / TRUCK_SPEED_CAP_KMH) * 3600);
}

export function coordinateAtRouteDistance(
  coords: [number, number][],
  targetM: number,
): [number, number] | null {
  if (coords.length === 0) return null;
  if (coords.length === 1 || targetM <= 0) return coords[0];

  let travelled = 0;
  for (let i = 1; i < coords.length; i += 1) {
    const prev = coords[i - 1];
    const next = coords[i];
    const segM = haversineMeters(prev, next);
    if (travelled + segM >= targetM) {
      const t = segM > 0 ? (targetM - travelled) / segM : 0;
      return [
        prev[0] + (next[0] - prev[0]) * t,
        prev[1] + (next[1] - prev[1]) * t,
      ];
    }
    travelled += segM;
  }

  return coords[coords.length - 1];
}
