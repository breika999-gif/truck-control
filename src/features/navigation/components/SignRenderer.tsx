/**
 * SignRenderer — EU-style junction sign panel.
 *
 * Appears when distToTurn < SIGN_TRIGGER_M (800 m).
 * - Blue sign  → motorway / European route (A1, E80 …)
 * - Green sign → primary / secondary road
 *
 * Layout:
 *   No lanes  → full-width sign with arrow + road name + distance badge
 *   Has lanes → split: sign (left, 60 %) + lane diagram (right, 40 %)
 *               — Garmin dēzl style —
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { RouteStep, BannerComponent } from '../api/directions';

// ── Public trigger constant (re-exported so MapScreen can use it) ────────────
export const SIGN_TRIGGER_M = 800;

interface Props {
  step: RouteStep;
  nextStep?: RouteStep;
  distToTurn: number;   // metres to turn
  lanes: BannerComponent[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Blue = motorway / EU-route, Green = everything else. */
function signColor(step: RouteStep): 'blue' | 'green' {
  const name  = (step.name ?? '').toUpperCase();
  const instr = (step.maneuver?.instruction ?? '').toUpperCase();
  if (/\b[AE]\d+\b/.test(name) || /\b[AE]\d+\b/.test(instr)) return 'blue';
  if (['exit motorway', 'on ramp', 'off ramp'].includes(step.maneuver.type)) return 'blue';
  return 'green';
}

/** Unicode directional arrow from maneuver modifier. */
function signArrow(modifier?: string): string {
  switch (modifier) {
    case 'sharp left':   return '↰';
    case 'left':         return '←';
    case 'slight left':  return '↖';
    case 'straight':     return '↑';
    case 'slight right': return '↗';
    case 'right':        return '→';
    case 'sharp right':  return '↱';
    case 'uturn':        return '↩';
    default:             return '↑';
  }
}

/** Same logic for individual lane boxes. */
function laneArrow(dir?: string): string {
  switch (dir) {
    case 'sharp left':   return '↰';
    case 'left':         return '←';
    case 'slight left':  return '↖';
    case 'straight':
    case 'none':         return '↑';
    case 'slight right': return '↗';
    case 'right':        return '→';
    case 'sharp right':  return '↱';
    case 'uturn':        return '↩';
    default:             return '↑';
  }
}

/** Format metres to display string. */
function fmtDist(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} км`;
  return `${Math.round(m / 10) * 10} м`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SignRenderer({ step, nextStep, distToTurn, lanes }: Props) {
  if (distToTurn > SIGN_TRIGGER_M) return null;

  const color    = signColor(step);
  const arrow    = signArrow(step.maneuver.modifier);
  const label    = step.name || step.maneuver.instruction;
  const hasSplit = lanes.length > 0;

  const signBg  = color === 'blue' ? '#1a5fb4' : '#1e6b1e';
  const signBdr = color === 'blue' ? '#5a9fd4' : '#5abf5a';
  const accent  = color === 'blue' ? '#4a8fc4' : '#3a9f3a';

  return (
    <View style={[styles.wrap, { borderColor: signBdr }]}>

      {/* ── Left: Direction sign ── */}
      <View style={[
        styles.signPanel,
        { backgroundColor: signBg, flex: hasSplit ? 6 : 10 },
      ]}>
        {/* Top stripe — EU sign style */}
        <View style={[styles.topStripe, { backgroundColor: accent }]}>
          <Text style={styles.stripeDist}>{fmtDist(distToTurn)}</Text>
          <Text style={styles.stripeLabel} numberOfLines={1}>
            {color === 'blue' ? 'МАГИСТРАЛА' : 'ПЪТ'}
          </Text>
        </View>

        {/* Main direction row */}
        <View style={styles.mainRow}>
          <Text style={styles.bigArrow}>{arrow}</Text>
          <Text style={styles.roadLabel} numberOfLines={2}>{label}</Text>
        </View>

        {/* Next step hint */}
        {nextStep && (
          <Text style={styles.nextHint} numberOfLines={1}>
            {'▸ ' + (nextStep.name || nextStep.maneuver.instruction)}
          </Text>
        )}
      </View>

      {/* ── Right: Lane diagram (split view, Garmin dēzl style) ── */}
      {hasSplit && (
        <View style={styles.lanePanel}>
          <Text style={styles.lanePanelTitle}>ЛЕНИ</Text>

          {/* Lane boxes */}
          <View style={styles.laneRow}>
            {lanes.map((lane, i) => (
              <View
                key={i}
                style={[styles.laneBox, lane.active && styles.laneBoxActive]}
              >
                <Text style={[styles.laneArrowTxt, lane.active && styles.laneArrowActive]}>
                  {laneArrow(lane.directions?.[0])}
                </Text>
              </View>
            ))}
          </View>

          {/* Active lane underline bar */}
          <View style={styles.laneRow}>
            {lanes.map((lane, i) => (
              <View
                key={i}
                style={[styles.laneBar, lane.active && styles.laneBarActive]}
              />
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    borderWidth: 2.5,
    borderRadius: 10,
    overflow: 'hidden',
  },

  // Sign panel
  signPanel: {
    justifyContent: 'center',
    minHeight: 80,
  },
  topStripe: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  stripeDist: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  stripeLabel: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  bigArrow: {
    fontSize: 38,
    color: '#ffffff',
    lineHeight: 44,
  },
  roadLabel: {
    flex: 1,
    fontSize: 17,
    fontWeight: '800',
    color: '#ffffff',
    lineHeight: 22,
  },
  nextHint: {
    paddingHorizontal: 10,
    paddingBottom: 6,
    fontSize: 11,
    color: 'rgba(255,255,255,0.65)',
  },

  // Lane panel
  lanePanel: {
    flex: 4,
    backgroundColor: '#0d1117',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 6,
    gap: 5,
  },
  lanePanelTitle: {
    fontSize: 8,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 1.8,
    marginBottom: 2,
  },
  laneRow: {
    flexDirection: 'row',
    gap: 4,
  },
  laneBox: {
    width: 34,
    height: 44,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  laneBoxActive: {
    backgroundColor: '#00bfff',
    borderColor: '#00bfff',
  },
  laneArrowTxt: {
    fontSize: 20,
    color: 'rgba(255,255,255,0.30)',
  },
  laneArrowActive: {
    color: '#ffffff',
  },
  laneBar: {
    width: 34,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  laneBarActive: {
    backgroundColor: '#00bfff',
  },
});
