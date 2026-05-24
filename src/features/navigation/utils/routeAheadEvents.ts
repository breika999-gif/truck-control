/**
 * RouteAheadEvent — unified guidance event model.
 *
 * Garmin analogy:
 *   SID layer    → this file: scans route and builds the event list
 *   SQLite layer → event payloads: lane config, restriction data, speed zones
 *   JCV layer    → SignRenderer / LaneArrow: renders the top event
 *
 * Event types: lane, junction, restriction, hgv_speed, tunnel, parking_break, traffic
 *
 * Usage:
 *   const events = buildRouteAheadEvents(route, currentStepIdx, userCoords, profile);
 *   const top = events[0]; // highest priority event ahead
 */

import type { RouteStep, BannerComponent, RestrictionPoint, MaxspeedEntry } from '../api/directions';
import type { VehicleProfile } from '../../../shared/types/vehicle';

// ── Event types ───────────────────────────────────────────────────────────────

export type RouteAheadEventType =
  | 'lane'          // Lane guidance: which lanes to take
  | 'junction'      // Junction / exit preview
  | 'restriction'   // HGV restriction (height/weight/adr/no_trucks)
  | 'hgv_speed'     // Truck-specific speed zone change
  | 'tunnel'        // Tunnel ahead (ADR/height implications)
  | 'parking_break' // Tacho-driven: must stop before this point
  | 'traffic';      // Traffic slowdown / congestion ahead

/** Priority: 1 = critical (must act), 2 = warning, 3 = info */
export type EventPriority = 1 | 2 | 3;

export interface LaneEventPayload {
  lanes: BannerComponent[];
  maneuverType: string;
  modifier?: string;
  roadName: string;
}

export interface RestrictionEventPayload {
  type: 'maxheight' | 'maxweight' | 'maxwidth' | 'no_trucks' | 'hazmat';
  value_num: number;
  exceeded: boolean;
  lat: number;
  lng: number;
}

export interface SpeedEventPayload {
  speedKmh: number;
  isHgvLimit: boolean; // true if this is a truck-specific limit lower than general
  roadName: string;
}

export interface TunnelEventPayload {
  name: string;
  adrRelevant: boolean;
  hasAdrProfile: boolean;
}

export interface ParkingBreakPayload {
  remainingDriveSec: number;
  breakRequiredAtKm: number;
}

export interface TrafficEventPayload {
  delayMin: number;
  severity: 'low' | 'moderate' | 'heavy';
  roadName: string;
}

export interface RouteAheadEvent {
  type: RouteAheadEventType;
  distanceM: number;    // metres from current position
  priority: EventPriority;
  payload:
    | LaneEventPayload
    | RestrictionEventPayload
    | SpeedEventPayload
    | TunnelEventPayload
    | ParkingBreakPayload
    | TrafficEventPayload;
}

// ── Tunnel detection ──────────────────────────────────────────────────────────

const TUNNEL_KEYWORDS = /tunnel|тунел|tunnel|galerie|tunel|alagút|puente|ponte|viadukt/i;

function isTunnelStep(step: RouteStep): boolean {
  return TUNNEL_KEYWORDS.test(step.name ?? '');
}

// ── Restriction exceeded check ────────────────────────────────────────────────

function restrictionExceeded(
  r: RestrictionPoint,
  profile?: VehicleProfile | null,
): boolean {
  if (!profile) return false;
  if (r.type === 'maxheight') return (profile.height_m ?? 0) > r.value_num;
  if (r.type === 'maxweight') return (profile.weight_t ?? 0) > r.value_num;
  if (r.type === 'maxwidth')  return (profile.width_m  ?? 0) > r.value_num;
  if (r.type === 'no_trucks') return true;
  if (r.type === 'hazmat') {
    const h = String(profile.hazmat_class ?? 'none').toLowerCase();
    return h !== '' && h !== 'none' && h !== '0' && h !== 'false';
  }
  return false;
}

// ── Cumulative distance along steps ──────────────────────────────────────────

/** Returns cumulative distances (m) from step[fromIdx] to each subsequent step. */
function cumulativeDistances(steps: RouteStep[], fromIdx: number): number[] {
  const result: number[] = [];
  let cumDist = 0;
  for (let i = fromIdx; i < steps.length; i++) {
    result.push(cumDist);
    cumDist += steps[i].distance ?? 0;
  }
  return result;
}

// ── Main builder ──────────────────────────────────────────────────────────────

export interface BuildEventsInput {
  steps: RouteStep[];
  currentStepIdx: number;
  distToTurn: number | null;        // metres to current maneuver
  restrictions?: RestrictionPoint[] | null;
  maxspeeds?: MaxspeedEntry[] | null;
  userCoords?: [number, number] | null;
  profile?: VehicleProfile | null;
  /** Remaining continuous driving seconds before HOS break (hosLimit - driven) */
  remainingTachoSec?: number;
  totalRouteDistM?: number;
  routeDurationSec?: number;
}

const LOOKAHEAD_M = 5000; // only surface events within 5 km

export function buildRouteAheadEvents(input: BuildEventsInput): RouteAheadEvent[] {
  const {
    steps,
    currentStepIdx,
    distToTurn,
    restrictions,
    profile,
    remainingTachoSec,
    totalRouteDistM,
    routeDurationSec,
    maxspeeds,
  } = input;

  const events: RouteAheadEvent[] = [];
  const cumDists = cumulativeDistances(steps, currentStepIdx);

  // ── 1. Lane events (from bannerInstructions.sub) ─────────────────────────
  for (let i = 0; i < steps.length && i < cumDists.length; i++) {
    const step = steps[currentStepIdx + i];
    if (!step) break;

    const stepDist = (i === 0 ? (distToTurn ?? cumDists[i]) : cumDists[i]);
    if (stepDist > LOOKAHEAD_M) break;

    const banner = step.bannerInstructions?.[0];
    const laneComponents = banner?.sub?.components?.filter(c => c.type === 'lane') ?? [];

    if (laneComponents.length > 0) {
      events.push({
        type: 'lane',
        distanceM: stepDist,
        priority: stepDist < 300 ? 1 : 2,
        payload: {
          lanes: laneComponents,
          maneuverType: step.maneuver.type,
          modifier: step.maneuver.modifier,
          roadName: step.name ?? '',
        } satisfies LaneEventPayload,
      });
    }

    // ── 2. Tunnel events ────────────────────────────────────────────────────
    if (isTunnelStep(step)) {
      const hc = profile?.hazmat_class ?? 'none';
      const hasAdr = hc !== 'none';
      events.push({
        type: 'tunnel',
        distanceM: stepDist,
        priority: hasAdr ? 1 : 3,
        payload: {
          name: step.name ?? 'Тунел',
          adrRelevant: hasAdr,
          hasAdrProfile: hasAdr,
        } satisfies TunnelEventPayload,
      });
    }
  }

  // ── 3. Restriction events ──────────────────────────────────────────────────
  if (restrictions?.length && input.userCoords) {
    for (const r of restrictions) {
      // Approximate distance using Haversine
      const dist = haversineM(input.userCoords, [r.lng, r.lat]);
      if (dist > LOOKAHEAD_M) continue;

      events.push({
        type: 'restriction',
        distanceM: dist,
        priority: restrictionExceeded(r, profile) ? 1 : 2,
        payload: {
          type: r.type as RestrictionEventPayload['type'],
          value_num: r.value_num,
          exceeded: restrictionExceeded(r, profile),
          lat: r.lat,
          lng: r.lng,
        } satisfies RestrictionEventPayload,
      });
    }
  }

  // ── 4. Tacho parking-break event ──────────────────────────────────────────
  if (
    remainingTachoSec != null &&
    totalRouteDistM != null &&
    routeDurationSec != null &&
    routeDurationSec > 0 &&
    remainingTachoSec < routeDurationSec
  ) {
    const breakDistM = totalRouteDistM * (remainingTachoSec / routeDurationSec);
    if (breakDistM < LOOKAHEAD_M) {
      events.push({
        type: 'parking_break',
        distanceM: breakDistM,
        priority: remainingTachoSec < 1800 ? 1 : 2, // critical if < 30 min
        payload: {
          remainingDriveSec: remainingTachoSec,
          breakRequiredAtKm: Math.round(breakDistM / 1000),
        } satisfies ParkingBreakPayload,
      });
    }
  }

  // ── 5. Speed zone changes ahead ────────────────────────────────────────────
  if (maxspeeds?.length && totalRouteDistM != null && totalRouteDistM > 0) {
    const currentSpeed = speedAtDistance(maxspeeds, totalRouteDistM, 0);
    let emitted = 0;
    let lastSeenSpeed = currentSpeed;
    let cumulativeDistM = 0;

    if (currentSpeed != null) {
      for (let i = currentStepIdx; i < steps.length; i++) {
        const step = steps[i];
        if (!step) break;

        const stepDistance = i === currentStepIdx && distToTurn != null
          ? Math.max(0, distToTurn)
          : Math.max(0, step.distance ?? 0);
        cumulativeDistM += stepDistance;

        if (cumulativeDistM <= 0) continue;
        if (cumulativeDistM > LOOKAHEAD_M) break;

        const speedAtBoundary = speedAtDistance(maxspeeds, totalRouteDistM, cumulativeDistM);
        if (speedAtBoundary == null) continue;
        if (speedAtBoundary === lastSeenSpeed) continue;
        lastSeenSpeed = speedAtBoundary;
        if (currentSpeed - speedAtBoundary < 10) continue;

        events.push({
          type: 'hgv_speed',
          distanceM: cumulativeDistM,
          priority: speedAtBoundary <= 50 ? 2 : 3,
          payload: {
            speedKmh: speedAtBoundary,
            isHgvLimit: false,
            roadName: step.name ?? '',
          } satisfies SpeedEventPayload,
        });

        emitted += 1;
        if (emitted >= 3) break;
      }
    }
  }

  // ── Sort: priority first, then distance ───────────────────────────────────
  events.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.distanceM - b.distanceM;
  });

  return events;
}

function speedAtDistance(
  maxspeeds: MaxspeedEntry[],
  totalRouteDistM: number,
  distanceM: number,
): number | null {
  if (!maxspeeds.length || totalRouteDistM <= 0) return null;
  const ratio = Math.max(0, Math.min(1, distanceM / totalRouteDistM));
  const pointIdx = Math.min(
    maxspeeds.length - 1,
    Math.max(0, Math.round(ratio * maxspeeds.length)),
  );
  const entry = maxspeeds[pointIdx];
  if (!entry || entry.unknown || entry.none || entry.speed == null) return null;
  const speed = entry.unit === 'mph' ? entry.speed * 1.609344 : entry.speed;
  return Math.round(speed);
}

// ── Simple Haversine distance (metres) ────────────────────────────────────────

function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const lat1 = a[1] * Math.PI / 180;
  const lat2 = b[1] * Math.PI / 180;
  const dLat = (b[1] - a[1]) * Math.PI / 180;
  const dLon = (b[0] - a[0]) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
