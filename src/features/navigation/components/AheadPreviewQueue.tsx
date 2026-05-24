import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { RouteAheadEvent, RestrictionEventPayload } from '../utils/routeAheadEvents';

interface AheadPreviewQueueProps {
  events: RouteAheadEvent[];
  /** The situation already shown by TruckSituationRenderer — skip its event type+distance */
  activeSituationDistanceM?: number;
}

interface PreviewChip {
  key: string;
  icon: string;
  distance: string;
  priority: RouteAheadEvent['priority'];
}

const MAX_CHIPS = 4;
const MAX_DISTANCE_M = 15000;
const ACTIVE_SKIP_M = 80;

function formatDistance(distanceM: number): string {
  if (distanceM < 1000) {
    return `${Math.round(distanceM / 10) * 10} м`;
  }
  return `${(distanceM / 1000).toFixed(1)} км`;
}

function restrictionIcon(payload: RestrictionEventPayload): string {
  switch (payload.type) {
    case 'maxheight':
      return '⬆️';
    case 'maxweight':
      return '⚖️';
    case 'hazmat':
      return '☢️';
    case 'no_trucks':
      return '🚫';
    case 'maxwidth':
    default:
      return '↔️';
  }
}

function eventIcon(event: RouteAheadEvent): string | null {
  switch (event.type) {
    case 'restriction':
      return restrictionIcon(event.payload as RestrictionEventPayload);
    case 'tunnel':
      return '🚇';
    case 'parking_break':
      return '⏱';
    case 'traffic':
      return '🔴';
    case 'hgv_speed':
      return '🚚';
    case 'lane':
    case 'junction':
    default:
      return null;
  }
}

function shouldSkipEvent(
  event: RouteAheadEvent,
  activeSituationDistanceM?: number,
): boolean {
  if (event.type === 'lane') return true;
  if (event.distanceM < 0 || event.distanceM > MAX_DISTANCE_M) return true;
  if (
    activeSituationDistanceM != null &&
    Math.abs(event.distanceM - activeSituationDistanceM) <= ACTIVE_SKIP_M
  ) {
    return true;
  }
  return false;
}

function previewChips(
  events: RouteAheadEvent[],
  activeSituationDistanceM?: number,
): PreviewChip[] {
  return events
    .filter(event => !shouldSkipEvent(event, activeSituationDistanceM))
    .map((event, index) => {
      const icon = eventIcon(event);
      if (!icon) return null;
      return {
        key: `${event.type}-${Math.round(event.distanceM)}-${index}`,
        icon,
        distance: formatDistance(event.distanceM),
        priority: event.priority,
      } satisfies PreviewChip;
    })
    .filter((chip): chip is PreviewChip => chip != null)
    .slice(0, MAX_CHIPS);
}

function chipBorderStyle(priority: RouteAheadEvent['priority']) {
  if (priority === 1) return queueStyles.chipCritical;
  if (priority === 2) return queueStyles.chipWarning;
  return queueStyles.chipInfo;
}

function textColorStyle(priority: RouteAheadEvent['priority']) {
  if (priority === 1) return queueStyles.textCritical;
  if (priority === 2) return queueStyles.textWarning;
  return queueStyles.textInfo;
}

const AheadPreviewQueue: React.FC<AheadPreviewQueueProps> = ({
  events,
  activeSituationDistanceM,
}) => {
  const chips = React.useMemo(
    () => previewChips(events, activeSituationDistanceM),
    [events, activeSituationDistanceM],
  );

  if (!chips.length) return null;

  return (
    <View style={queueStyles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={queueStyles.content}
      >
        {chips.map(chip => (
          <View key={chip.key} style={[queueStyles.chip, chipBorderStyle(chip.priority)]}>
            <Text style={[queueStyles.icon, textColorStyle(chip.priority)]}>{chip.icon}</Text>
            <Text style={[queueStyles.distance, textColorStyle(chip.priority)]}>
              {chip.distance}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
};

const queueStyles = StyleSheet.create({
  wrap: {
    alignSelf: 'stretch',
    marginTop: 4,
  },
  content: {
    flexGrow: 1,
    gap: 6,
    paddingHorizontal: 8,
  },
  chip: {
    minWidth: 64,
    height: 30,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 9,
  },
  icon: {
    fontSize: 14,
    lineHeight: 18,
  },
  distance: {
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 16,
  },
  chipCritical: {
    borderColor: '#FF3B30',
  },
  chipWarning: {
    borderColor: '#FF9500',
  },
  chipInfo: {
    borderColor: 'rgba(255,255,255,0.5)',
  },
  textCritical: {
    color: '#FF3B30',
  },
  textWarning: {
    color: '#FF9500',
  },
  textInfo: {
    color: 'rgba(255,255,255,0.5)',
  },
});

export default React.memo(AheadPreviewQueue);
