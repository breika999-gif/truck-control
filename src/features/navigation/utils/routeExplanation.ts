import type { RouteOption, TruckRestrictionPoint, TrafficAlert } from '../../../shared/services/backendApi';
import i18n from '../../../i18n';

export interface ExplanationBullet {
  icon: string;
  text: string;
  positive: boolean;
}

type RestrictionType = TruckRestrictionPoint['type'];

function minNumber(values: number[]): number | null {
  if (!values.length) return null;
  return Math.min(...values);
}

function totalTrafficDelayMin(alerts?: TrafficAlert[]): number {
  if (!alerts?.length) return 0;
  return alerts.reduce((sum, alert) => sum + Math.max(0, alert.delay_min), 0);
}

function formatRestrictionValue(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function firstRestriction(
  restrictions: TruckRestrictionPoint[],
  type: RestrictionType,
): TruckRestrictionPoint | undefined {
  return restrictions.find(restriction => restriction.type === type);
}

function pushRestrictionBullet(
  bullets: ExplanationBullet[],
  restrictions: TruckRestrictionPoint[],
  type: RestrictionType,
  build: (restriction: TruckRestrictionPoint) => ExplanationBullet,
): void {
  const restriction = firstRestriction(restrictions, type);
  if (restriction) {
    bullets.push(build(restriction));
  }
}

export function buildRouteExplanation(
  option: RouteOption,
  allOptions: RouteOption[],
): ExplanationBullet[] {
  const options = allOptions.length ? allOptions : [option];
  const minDuration = minNumber(options.map(routeOption => routeOption.duration));
  const minDistance = minNumber(options.map(routeOption => routeOption.distance));
  const restrictions = option.restrictions ?? [];

  const trafficAndRestrictions: ExplanationBullet[] = [];
  const comparison: ExplanationBullet[] = [];
  const labels: ExplanationBullet[] = [];

  if (option.traffic === 'low') {
    trafficAndRestrictions.push({ icon: '🟢', text: i18n.t('route.noTraffic'), positive: true });
  } else if (option.traffic === 'moderate') {
    trafficAndRestrictions.push({ icon: '🟡', text: i18n.t('route.moderateTraffic'), positive: false });
  } else if (option.traffic === 'heavy') {
    trafficAndRestrictions.push({ icon: '🔴', text: i18n.t('route.heavyTraffic'), positive: false });
  }

  const totalDelay = Math.round(totalTrafficDelayMin(option.traffic_alerts));
  if (totalDelay > 0) {
    trafficAndRestrictions.push({
      icon: '⚠️',
      text: i18n.t('route.delayMinutesPlain', { minutes: totalDelay }),
      positive: false,
    });
  }

  if (restrictions.length === 0) {
    trafficAndRestrictions.push({ icon: '✅', text: i18n.t('route.noTruckRestrictions'), positive: true });
  } else {
    pushRestrictionBullet(trafficAndRestrictions, restrictions, 'maxheight', restriction => {
      const value = formatRestrictionValue(restriction.value_num);
      return {
        icon: '⬆️',
        text: value
          ? i18n.t('route.lowBridgeValue', { value })
          : i18n.t('route.lowBridge'),
        positive: false,
      };
    });
    pushRestrictionBullet(trafficAndRestrictions, restrictions, 'maxweight', restriction => {
      const value = formatRestrictionValue(restriction.value_num);
      return {
        icon: '⚖️',
        text: value
          ? i18n.t('route.weightLimitValue', { value })
          : i18n.t('route.weightLimit'),
        positive: false,
      };
    });
    pushRestrictionBullet(trafficAndRestrictions, restrictions, 'hazmat', () => ({
      icon: '☢️',
      text: i18n.t('route.adrRestriction'),
      positive: false,
    }));
    pushRestrictionBullet(trafficAndRestrictions, restrictions, 'no_trucks', () => ({
      icon: '🚫',
      text: i18n.t('route.noTrucksSegment'),
      positive: false,
    }));
  }

  if (option.label && /тунел|без магистрала/i.test(option.label)) {
    labels.push({ icon: '🛣️', text: option.label, positive: true });
  }

  if (minDuration != null && option.duration === minDuration) {
    comparison.push({ icon: '⚡', text: i18n.t('route.fastestRoute'), positive: true });
  }

  if (minDistance != null && option.distance === minDistance) {
    comparison.push({ icon: '📏', text: i18n.t('route.shortestRoute'), positive: true });
  }

  if (minDuration != null && option.duration > minDuration) {
    const diffMin = Math.max(1, Math.round((option.duration - minDuration) / 60));
    comparison.push({
      icon: '🕐',
      text: i18n.t('route.minutesComparedFastest', { minutes: diffMin }),
      positive: false,
    });
  }

  return [
    ...trafficAndRestrictions,
    ...labels,
    ...comparison,
  ].slice(0, 5);
}
