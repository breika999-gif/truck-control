import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import type { RouteStep } from '../api/directions';
import { fmtDistance, maneuverEmoji } from '../api/directions';
import SignRenderer, { SIGN_TRIGGER_M } from './SignRenderer';
import AheadPreviewQueue from './AheadPreviewQueue';
import JunctionViewImage from './JunctionViewImage';
import { styles } from '../screens/MapScreen.styles';
import { MAPBOX_PUBLIC_TOKEN } from '../../../shared/constants/config';
import type { RouteAheadEvent, RestrictionEventPayload, TunnelEventPayload, ParkingBreakPayload } from '../utils/routeAheadEvents';

interface NavigationTopPanelProps {
  visible: boolean;
  step: RouteStep;
  nextStep: RouteStep | null;
  distToTurn: number | null;
  lanes: any[];
  topOffset: number;
  /** Upcoming guidance events sorted by priority+distance. First non-lane event shown as "ahead" chip. */
  aheadEvents?: RouteAheadEvent[];
  /** Full queue for compact upcoming-event chips below the banner. */
  aheadQueue?: RouteAheadEvent[];
  /** Distance of the situation already rendered elsewhere, so the queue can skip it. */
  activeSituationDistanceM?: number;
}

// ── Ahead chip: one-liner preview of the next important event ─────────────────

function AheadChip({ event }: { event: RouteAheadEvent }) {
  const dist = event.distanceM < 1000
    ? `${Math.round(event.distanceM / 10) * 10} м`
    : `${(event.distanceM / 1000).toFixed(1)} км`;

  let icon = '';
  let label = '';
  let chipColor = 'rgba(255,165,0,0.20)';
  let textColor = '#FF9500';

  if (event.type === 'restriction') {
    const p = event.payload as RestrictionEventPayload;
    const exceeded = p.exceeded;
    chipColor = exceeded ? 'rgba(255,59,48,0.22)' : 'rgba(255,149,0,0.18)';
    textColor = exceeded ? '#FF3B30' : '#FF9500';
    icon = p.type === 'maxheight' ? '⬆️' : p.type === 'maxweight' ? '⚖️' : p.type === 'hazmat' ? '☢️' : '🚫';
    const valueStr = p.value_num ? ` ${p.value_num}` : '';
    label = `${icon}${valueStr} след ${dist}`;
  } else if (event.type === 'tunnel') {
    const p = event.payload as TunnelEventPayload;
    chipColor = p.adrRelevant ? 'rgba(255,59,48,0.22)' : 'rgba(30,107,30,0.25)';
    textColor = p.adrRelevant ? '#FF3B30' : '#4cff91';
    label = `🚇 ${p.name} след ${dist}`;
  } else if (event.type === 'parking_break') {
    const p = event.payload as ParkingBreakPayload;
    const remMin = Math.round(p.remainingDriveSec / 60);
    chipColor = remMin < 30 ? 'rgba(255,59,48,0.22)' : 'rgba(255,149,0,0.18)';
    textColor = remMin < 30 ? '#FF3B30' : '#FF9500';
    label = `⏱ Пауза след ${dist} (${remMin} мин таход)`;
  } else if (event.type === 'traffic') {
    chipColor = 'rgba(255,59,48,0.15)';
    textColor = '#FF6B35';
    label = `🔴 Трафик след ${dist}`;
  } else {
    return null;
  }

  return (
    <View style={[aheadStyles.chip, { backgroundColor: chipColor, borderColor: textColor }]}>
      <Text style={[aheadStyles.chipText, { color: textColor }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const NavigationTopPanel: React.FC<NavigationTopPanelProps> = ({
  visible,
  step,
  nextStep,
  distToTurn,
  lanes,
  topOffset,
  aheadEvents = [],
  aheadQueue = [],
  activeSituationDistanceM,
}) => {
  const junctionViewURL = React.useMemo(() => {
    const comps = step.bannerInstructions?.[0]?.primary?.components ?? [];
    const guidanceView = comps.find(c => c.type === 'guidance-view' && c.imageBaseURL);
    return guidanceView?.imageBaseURL ?? null;
  }, [step]);

  // Top non-lane event for the "ahead" chip
  const aheadEvent = aheadEvents.find(e => e.type !== 'lane') ?? null;

  if (!visible) return null;

  return (
    <View style={[styles.signWrap, { top: topOffset }]}>
      {distToTurn != null && distToTurn < SIGN_TRIGGER_M ? (
        <>
          {junctionViewURL && (
            <JunctionViewImage
              imageBaseURL={junctionViewURL}
              accessToken={MAPBOX_PUBLIC_TOKEN}
            />
          )}
          <SignRenderer
            step={step}
            nextStep={nextStep ?? undefined}
            distToTurn={distToTurn}
            lanes={lanes}
            banner={step.bannerInstructions?.[0]}
          />
          {aheadEvent && <AheadChip event={aheadEvent} />}
          {aheadQueue.length > 0 && (
            <AheadPreviewQueue
              events={aheadQueue}
              activeSituationDistanceM={activeSituationDistanceM}
            />
          )}
        </>
      ) : (
        <>
          <View style={styles.navBanner}>
            <Text style={styles.navArrow}>
              {maneuverEmoji(step.maneuver.type, step.maneuver.modifier)}
            </Text>
            <View style={styles.navBannerBody}>
              {distToTurn != null && (
                <Text style={[styles.navDistText, {
                  fontSize: distToTurn > 20000 ? 28
                          : distToTurn > 10000 ? 24
                          : distToTurn > 5000  ? 22
                          : distToTurn > 2000  ? 20
                          : 18,
                }]}>
                  {fmtDistance(distToTurn)}
                </Text>
              )}
              <Text style={styles.navStreet} numberOfLines={1}>
                {step.name || step.maneuver.instruction}
              </Text>
              {nextStep && (
                <Text style={styles.navNext} numberOfLines={1}>
                  после:{' '}
                  {maneuverEmoji(nextStep.maneuver.type, nextStep.maneuver.modifier)}{' '}
                  {nextStep.name || nextStep.maneuver.instruction}
                </Text>
              )}
            </View>
          </View>
          {aheadEvent && <AheadChip event={aheadEvent} />}
          {aheadQueue.length > 0 && (
            <AheadPreviewQueue
              events={aheadQueue}
              activeSituationDistanceM={activeSituationDistanceM}
            />
          )}
        </>
      )}
    </View>
  );
};

const aheadStyles = StyleSheet.create({
  chip: {
    marginTop: 4,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'stretch',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700',
  },
});

export default React.memo(NavigationTopPanel);
