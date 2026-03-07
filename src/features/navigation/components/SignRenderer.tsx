/**
 * SignRenderer — EU-style junction sign panel.
 *
 * Appears when distToTurn < SIGN_TRIGGER_M (800 m).
 * - Blue sign  → motorway / European route (A1, E80 …)
 * - Green sign → primary / secondary road
 *
 * Layout:
 *   No lanes  → full-width sign with arrow + exit number + destinations + distance
 *   Has lanes → split: sign (left, 60 %) + lane diagram (right, 40 %)
 *               — Garmin dēzl style —
 */
import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import type { RouteStep, BannerInstruction, BannerComponent } from '../api/directions';

// ── Public trigger constant (re-exported so MapScreen can use it) ────────────
export const SIGN_TRIGGER_M = 800;

interface Props {
  step: RouteStep;
  nextStep?: RouteStep;
  distToTurn: number;        // metres to turn
  lanes: BannerComponent[];
  banner?: BannerInstruction; // full Mapbox banner — for exit number + destinations
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

/**
 * Extract exit number from banner primary components.
 * Mapbox returns components like: [{type:'exit',text:'Exit'}, {type:'exit-number',text:'42'}, ...]
 */
function extractExitNumber(banner?: BannerInstruction): string | null {
  const comps = banner?.primary?.components ?? [];
  const exitNum = comps.find(c => c.type === 'exit-number');
  return exitNum?.text ?? null;
}

/**
 * Extract destination names from banner primary components (type === 'text').
 * Returns up to 2 destination strings (e.g. ['Sofia', 'Plovdiv']).
 */
function extractDestinations(banner?: BannerInstruction): string[] {
  const comps = banner?.primary?.components ?? [];
  return comps
    .filter(c => c.type === 'text' && c.text.trim().length > 0)
    .map(c => c.text.trim())
    .slice(0, 2);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SignRenderer({ step, nextStep, distToTurn, lanes, banner }: Props) {
  // ── Pulsing glow for active lane boxes ─────────────────────────────────────
  const laneGlowAnim = useRef(new Animated.Value(0)).current;
  const laneGlowLoop = useRef<Animated.CompositeAnimation | null>(null);

  const hasActiveLane = lanes.some(l => l.active);
  useEffect(() => {
    if (hasActiveLane) {
      laneGlowLoop.current?.stop();
      laneGlowLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(laneGlowAnim, { toValue: 1, duration: 600, useNativeDriver: false }),
          Animated.timing(laneGlowAnim, { toValue: 0, duration: 600, useNativeDriver: false }),
        ]),
      );
      laneGlowLoop.current.start();
    } else {
      laneGlowLoop.current?.stop();
      laneGlowAnim.setValue(0);
    }
    return () => { laneGlowLoop.current?.stop(); };
  // laneGlowAnim is a stable ref
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasActiveLane]);

  const laneGlowBg     = laneGlowAnim.interpolate({
    inputRange:  [0, 1],
    outputRange: ['rgba(0,191,255,0.25)', 'rgba(0,191,255,0.65)'],
  });
  const laneGlowShadow = laneGlowAnim.interpolate({
    inputRange:  [0, 1],
    outputRange: [0.6, 1.0],
  });

  if (distToTurn > SIGN_TRIGGER_M) return null;

  const color        = signColor(step);
  const arrow        = signArrow(step.maneuver.modifier);
  const hasSplit     = lanes.length > 0;
  const exitNumber   = extractExitNumber(banner);
  const destinations = extractDestinations(banner);
  // Fallback to step.name if no destinations from banner components
  const primaryLabel = destinations.length > 0 ? destinations[0] : (step.name || step.maneuver.instruction);
  const secondaryLabel = destinations.length > 1
    ? destinations[1]
    : (banner?.secondary?.text ?? null);

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
        {/* Top stripe — distance + road type + exit number */}
        <View style={[styles.topStripe, { backgroundColor: accent }]}>
          <Text style={styles.stripeDist}>{fmtDist(distToTurn)}</Text>
          <Text style={styles.stripeLabel} numberOfLines={1}>
            {color === 'blue' ? 'МАГИСТРАЛА' : 'ПЪТ'}
          </Text>
          {exitNumber != null && (
            <View style={styles.exitBadge}>
              <Text style={styles.exitBadgeText}>⬡ {exitNumber}</Text>
            </View>
          )}
        </View>

        {/* Main direction row — arrow + primary destination */}
        <View style={styles.mainRow}>
          <Text style={styles.bigArrow}>{arrow}</Text>
          <View style={styles.destColumn}>
            <Text style={styles.roadLabel} numberOfLines={1}>{primaryLabel}</Text>
            {secondaryLabel != null && (
              <Text style={styles.roadLabelSub} numberOfLines={1}>{secondaryLabel}</Text>
            )}
          </View>
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

          {/* Lane boxes — active ones pulse with neon glow + scale pop */}
          <View style={styles.laneRow}>
            {lanes.map((lane, i) =>
              lane.active ? (
                <Animated.View
                  key={i}
                  style={[
                    styles.laneBox,
                    styles.laneBoxActive,
                    { backgroundColor: laneGlowBg, shadowOpacity: laneGlowShadow },
                  ]}
                >
                  <Text style={[styles.laneArrowTxt, styles.laneArrowActive]}>
                    {laneArrow(lane.directions?.[0])}
                  </Text>
                </Animated.View>
              ) : (
                <View key={i} style={styles.laneBox}>
                  <Text style={styles.laneArrowTxt}>
                    {laneArrow(lane.directions?.[0])}
                  </Text>
                </View>
              ),
            )}
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
    gap: 6,
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
    flex: 1,
    textAlign: 'center',
  },
  // Google Maps-style exit number badge — yellow hexagon shape
  exitBadge: {
    backgroundColor: '#f5c518',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  exitBadgeText: {
    color: '#000',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.5,
  },

  // Main direction row
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
  destColumn: {
    flex: 1,
    gap: 2,
  },
  roadLabel: {
    fontSize: 17,
    fontWeight: '800',
    color: '#ffffff',
    lineHeight: 22,
  },
  // Secondary destination (e.g. "A1 / E80" under main name)
  roadLabelSub: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.80)',
    lineHeight: 17,
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
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  laneBoxActive: {
    // backgroundColor + shadowOpacity animated via laneGlowBg / laneGlowShadow
    borderColor: '#00bfff',
    borderWidth: 3,
    shadowColor: '#00bfff',
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 12,
    elevation: 10,
    transform: [{ scale: 1.12 }],   // 3D "pop-out" — active lane appears closer
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
