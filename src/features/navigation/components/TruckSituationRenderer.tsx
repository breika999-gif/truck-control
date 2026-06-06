/**
 * TruckSituationRenderer — JCV layer equivalent.
 *
 * Receives a TruckSituation (output of selectTruckSituation) and renders
 * the appropriate visual component. MapScreen mounts exactly one of these.
 *
 * Situation → Component:
 *   composite_restriction → CompositeRestrictionSign
 *   tunnel_ahead          → TunnelWarningBanner (existing) or inline chip
 *   tacho_break           → inline tacho chip (future: ParkingPanel trigger)
 *   speed_zone            → HGVSpeedSign
 *   lane_guidance         → delegated to NavigationTopPanel / SignRenderer
 *   none                  → null
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import CompositeRestrictionSign from './CompositeRestrictionSign';
import HGVSpeedSign from './HGVSpeedSign';
import type {
  TruckSituation,
  CompositeRestrictionSituation,
  TunnelAheadSituation,
  TachoBreakSituation,
  SpeedZoneSituation,
} from '../utils/truckSituationSelector';

interface Props {
  situation: TruckSituation;
}

// ── Tunnel chip ───────────────────────────────────────────────────────────────

const TunnelChip: React.FC<{ s: TunnelAheadSituation }> = ({ s: sit }) => {
  const { t } = useTranslation();
  const dist = sit.distanceM < 1000
    ? `${Math.round(sit.distanceM / 10) * 10} ${t('units.meterShort')}`
    : `${(sit.distanceM / 1000).toFixed(1)} ${t('units.kilometerShort')}`;
  const color = sit.adrRelevant ? '#FF3B30' : '#4cff91';
  const bg    = sit.adrRelevant ? 'rgba(255,59,48,0.20)' : 'rgba(76,255,145,0.12)';
  const icon  = sit.adrRelevant ? '☢️' : '🚇';

  return (
    <View style={[chip.wrap, { backgroundColor: bg, borderColor: color, right: 12, top: 80 }]}>
      <Text style={[chip.icon]}>{icon}</Text>
      <View style={chip.body}>
        <Text style={[chip.title, { color }]}>
          {sit.adrRelevant ? t('truckSituation.adrForbiddenTunnel') : t('truckSituation.tunnel')}
        </Text>
        <Text style={[chip.sub, { color }]}>{sit.name} · {t('ahead.after', { distance: dist })}</Text>
      </View>
    </View>
  );
};

// ── Tacho chip ────────────────────────────────────────────────────────────────

const TachoChip: React.FC<{ s: TachoBreakSituation }> = ({ s: sit }) => {
  const { t } = useTranslation();
  const remMin = Math.round(sit.remainingDriveSec / 60);
  const critical = remMin < 30;
  const color = critical ? '#FF3B30' : '#FF9500';
  const bg    = critical ? 'rgba(255,59,48,0.20)' : 'rgba(255,149,0,0.18)';

  return (
    <View style={[chip.wrap, { backgroundColor: bg, borderColor: color, right: 12, top: 80 }]}>
      <Text style={chip.icon}>⏱</Text>
      <View style={chip.body}>
        <Text style={[chip.title, { color }]}>{t('truckSituation.pauseAfter', { km: sit.breakDistKm })}</Text>
        <Text style={[chip.sub, { color }]}>{t('truckSituation.remainingDriving', { minutes: remMin })}</Text>
      </View>
    </View>
  );
};

const chip = StyleSheet.create({
  wrap: {
    position: 'absolute',
    zIndex: 50,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1.5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    gap: 8,
    maxWidth: 220,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
  },
  icon: { fontSize: 20 },
  body: { flex: 1 },
  title: { fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  sub:   { fontSize: 11, fontWeight: '600', marginTop: 1 },
});

// ── Main renderer ─────────────────────────────────────────────────────────────

const TruckSituationRenderer: React.FC<Props> = ({ situation }) => {
  switch (situation.kind) {
    case 'composite_restriction':
      return (
        <CompositeRestrictionSign
          restrictions={(situation as CompositeRestrictionSituation).restrictions}
          distanceM={situation.distanceM}
          anyExceeded={(situation as CompositeRestrictionSituation).anyExceeded}
        />
      );

    case 'tunnel_ahead':
      return <TunnelChip s={situation as TunnelAheadSituation} />;

    case 'tacho_break':
      return <TachoChip s={situation as TachoBreakSituation} />;

    case 'speed_zone':
      return (
        <HGVSpeedSign
          speedKmh={(situation as SpeedZoneSituation).speedKmh}
          distanceM={situation.distanceM}
          isCurrent={(situation as SpeedZoneSituation).isCurrent}
        />
      );

    case 'lane_guidance':
    case 'none':
    default:
      return null;
  }
};

export default React.memo(TruckSituationRenderer);
