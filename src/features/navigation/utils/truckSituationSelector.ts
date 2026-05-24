/**
 * Truck Situation Selector — Logic Layer (Garmin SQLite equivalent)
 *
 * Takes the raw RouteAheadEvent[] list and collapses it into a single
 * TruckSituation: the one thing most important to display right now.
 *
 * Rules (in order):
 *  1. Critical restriction exceeded within 600 m → composite_restriction
 *  2. Tacho break required within 5 km → tacho_break
 *  3. Tunnel with ADR profile within 2 km → tunnel_ahead
 *  4. Speed zone change within 800 m → speed_zone
 *  5. Warning restriction (not exceeded) within 1 km → composite_restriction
 *  6. Tacho break within 15 km → tacho_break (info)
 *  7. Lane guidance (closest, any distance) → lane_guidance
 *  8. Tunnel without ADR → tunnel_ahead (info)
 *  9. Nothing → null
 *
 * Composite restriction: all restriction events at the same location
 * (within GROUP_DIST_M metres) are merged into one situation.
 */

import type {
  RouteAheadEvent,
  RestrictionEventPayload,
  LaneEventPayload,
  TunnelEventPayload,
  ParkingBreakPayload,
  SpeedEventPayload,
} from './routeAheadEvents';
import type { BannerComponent } from '../api/directions';

// ── TruckSituation output model ───────────────────────────────────────────────

export type TruckSituationKind =
  | 'composite_restriction'  // 1-N restriction signs at same location
  | 'lane_guidance'          // Lane arrows (SignRenderer already handles, but hook can drive it)
  | 'tunnel_ahead'           // Tunnel preview
  | 'tacho_break'            // Must stop before X km
  | 'speed_zone'             // Speed limit change (future)
  | 'none';

export interface CompositeRestrictionSituation {
  kind: 'composite_restriction';
  distanceM: number;
  priority: 1 | 2 | 3;
  restrictions: RestrictionEventPayload[];  // sorted: exceeded first
  anyExceeded: boolean;
}

export interface LaneGuidanceSituation {
  kind: 'lane_guidance';
  distanceM: number;
  priority: 1 | 2 | 3;
  lanes: BannerComponent[];
  maneuverType: string;
  modifier?: string;
}

export interface TunnelAheadSituation {
  kind: 'tunnel_ahead';
  distanceM: number;
  priority: 1 | 2 | 3;
  name: string;
  adrRelevant: boolean;
}

export interface TachoBreakSituation {
  kind: 'tacho_break';
  distanceM: number;
  priority: 1 | 2 | 3;
  remainingDriveSec: number;
  breakDistKm: number;
}

export interface SpeedZoneSituation {
  kind: 'speed_zone';
  distanceM: number;
  priority: 1 | 2 | 3;
  speedKmh: number;
  isCurrent: boolean;
}

export type TruckSituation =
  | CompositeRestrictionSituation
  | LaneGuidanceSituation
  | TunnelAheadSituation
  | TachoBreakSituation
  | SpeedZoneSituation
  | { kind: 'none' };

// ── Grouping constants ────────────────────────────────────────────────────────

/** Restrictions within this distance (m) of each other are shown on one sign. */
const GROUP_DIST_M = 120;

// ── Helpers ───────────────────────────────────────────────────────────────────

function groupRestrictions(
  events: RouteAheadEvent[],
): RestrictionEventPayload[][] {
  const rEvents = events.filter(e => e.type === 'restriction');
  if (!rEvents.length) return [];

  const groups: RouteAheadEvent[][] = [];

  for (const ev of rEvents) {
    const placed = groups.find(g =>
      Math.abs(g[0].distanceM - ev.distanceM) <= GROUP_DIST_M,
    );
    if (placed) {
      placed.push(ev);
    } else {
      groups.push([ev]);
    }
  }

  return groups.map(group => {
    const payloads = group.map(e => e.payload as RestrictionEventPayload);
    // Exceeded restrictions first, then by type order
    return payloads.sort((a, b) => {
      if (a.exceeded !== b.exceeded) return a.exceeded ? -1 : 1;
      return 0;
    });
  });
}

// ── Main selector ─────────────────────────────────────────────────────────────

export function selectTruckSituation(events: RouteAheadEvent[]): TruckSituation {
  if (!events.length) return { kind: 'none' };

  const restrictionGroups = groupRestrictions(events);

  // 1. Critical exceeded restriction ≤ 600 m
  for (const group of restrictionGroups) {
    const event = events.find(
      e => e.type === 'restriction' &&
        Math.abs(e.distanceM - (events.find(x => x.type === 'restriction' && (x.payload as RestrictionEventPayload).type === group[0].type)?.distanceM ?? 0)) <= GROUP_DIST_M,
    );
    if (!event) continue;
    const anyExceeded = group.some(r => r.exceeded);
    if (anyExceeded && event.distanceM <= 600) {
      return {
        kind: 'composite_restriction',
        distanceM: event.distanceM,
        priority: 1,
        restrictions: group,
        anyExceeded: true,
      };
    }
  }

  // 2. Tacho break critical (< 30 min = 1800 s)
  const critTacho = events.find(e => e.type === 'parking_break' && e.priority === 1);
  if (critTacho) {
    const p = critTacho.payload as ParkingBreakPayload;
    return {
      kind: 'tacho_break',
      distanceM: critTacho.distanceM,
      priority: 1,
      remainingDriveSec: p.remainingDriveSec,
      breakDistKm: p.breakRequiredAtKm,
    };
  }

  // 3. Tunnel with ADR ≤ 2 km
  const adrTunnel = events.find(
    e => e.type === 'tunnel' && (e.payload as TunnelEventPayload).adrRelevant && e.distanceM <= 2000,
  );
  if (adrTunnel) {
    const p = adrTunnel.payload as TunnelEventPayload;
    return {
      kind: 'tunnel_ahead',
      distanceM: adrTunnel.distanceM,
      priority: 1,
      name: p.name,
      adrRelevant: true,
    };
  }

  // 4. Speed zone change ≤ 800 m, warning priority or higher.
  const speedZone = events.find(
    e => e.type === 'hgv_speed' && e.distanceM <= 800 && e.priority <= 2,
  );
  if (speedZone) {
    const p = speedZone.payload as SpeedEventPayload;
    return {
      kind: 'speed_zone',
      distanceM: speedZone.distanceM,
      priority: speedZone.priority,
      speedKmh: p.speedKmh,
      isCurrent: speedZone.distanceM <= 20,
    };
  }

  // 5. Warning restriction (not exceeded) ≤ 1 km
  for (const group of restrictionGroups) {
    const event = events.find(
      e => e.type === 'restriction' && e.distanceM <= 1000,
    );
    if (!event) continue;
    return {
      kind: 'composite_restriction',
      distanceM: event.distanceM,
      priority: 2,
      restrictions: group,
      anyExceeded: false,
    };
  }

  // 6. Tacho break warning (any)
  const warnTacho = events.find(e => e.type === 'parking_break');
  if (warnTacho) {
    const p = warnTacho.payload as ParkingBreakPayload;
    return {
      kind: 'tacho_break',
      distanceM: warnTacho.distanceM,
      priority: 2,
      remainingDriveSec: p.remainingDriveSec,
      breakDistKm: p.breakRequiredAtKm,
    };
  }

  // 7. Lane guidance (closest)
  const laneEv = events.find(e => e.type === 'lane');
  if (laneEv) {
    const p = laneEv.payload as LaneEventPayload;
    return {
      kind: 'lane_guidance',
      distanceM: laneEv.distanceM,
      priority: laneEv.priority,
      lanes: p.lanes,
      maneuverType: p.maneuverType,
      modifier: p.modifier,
    };
  }

  // 8. Tunnel (no ADR)
  const tunnel = events.find(e => e.type === 'tunnel');
  if (tunnel) {
    const p = tunnel.payload as TunnelEventPayload;
    return {
      kind: 'tunnel_ahead',
      distanceM: tunnel.distanceM,
      priority: 3,
      name: p.name,
      adrRelevant: false,
    };
  }

  return { kind: 'none' };
}
