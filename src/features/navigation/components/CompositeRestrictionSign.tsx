/**
 * CompositeRestrictionSign — shows 1-N HGV restriction signs on one panel.
 *
 * Garmin dēzl shows multiple restrictions (height + weight + ADR) as a row
 * of stacked circular signs. This replicates that using our existing PNG assets.
 *
 * Single restriction  → large sign (72 px), same look as old RestrictionSign
 * 2 restrictions      → medium signs (54 px) side by side
 * 3+ restrictions     → small signs (44 px) in a row
 *
 * Exceeded → orange border + exceeded icon variant
 * Warning  → red border + normal icon variant
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, Image, Animated, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { RestrictionEventPayload } from '../utils/routeAheadEvents';

// ── Asset map (mirrors RestrictionSign.tsx) ───────────────────────────────────

const ICONS: Record<string, { normal: any; exceed: any; unitKey: 'meterShort' | 'tonShort' | null }> = {
  maxheight: {
    normal:  require('../../../../android/app/src/main/res/raw/restriction_height.png'),
    exceed:  require('../../../../android/app/src/main/res/raw/restriction_height_exceed.png'),
    unitKey: 'meterShort',
  },
  maxweight: {
    normal:  require('../../../../android/app/src/main/res/raw/restriction_weight.png'),
    exceed:  require('../../../../android/app/src/main/res/raw/restriction_weight_exceed.png'),
    unitKey: 'tonShort',
  },
  maxwidth: {
    normal:  require('../../../../android/app/src/main/res/raw/restriction_width.png'),
    exceed:  require('../../../../android/app/src/main/res/raw/restriction_width_exceed.png'),
    unitKey: 'meterShort',
  },
  no_trucks: {
    normal:  require('../../../../android/app/src/main/res/raw/restriction_no_trucks.png'),
    exceed:  require('../../../../android/app/src/main/res/raw/restriction_no_trucks_violated.png'),
    unitKey: null,
  },
  hazmat: {
    normal:  require('../../../../android/app/src/main/res/raw/restriction_adr.png'),
    exceed:  require('../../../../android/app/src/main/res/raw/restriction_adr_exceed.png'),
    unitKey: null,
  },
};

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  restrictions: RestrictionEventPayload[];  // sorted: exceeded first
  distanceM: number;
  anyExceeded: boolean;
}

// ── Single sign cell ──────────────────────────────────────────────────────────

interface SignCellProps {
  restriction: RestrictionEventPayload;
  size: number;
}

const SignCell: React.FC<SignCellProps> = ({ restriction, size }) => {
  const { t } = useTranslation();
  const meta = ICONS[restriction.type] ?? ICONS.no_trucks;
  const icon = restriction.exceeded ? meta.exceed : meta.normal;
  const borderColor = restriction.exceeded ? '#FF6B00' : '#D0021B';
  const showValue = restriction.type === 'maxheight' || restriction.type === 'maxweight' || restriction.type === 'maxwidth';
  const iconSize = Math.round(size * 0.50);
  const fontSize = Math.round(size * 0.22);
  const unitSize = Math.round(size * 0.13);

  return (
    <View style={[cell.wrap, {
      width: size, height: size,
      borderRadius: size / 2,
      borderColor,
      borderWidth: size > 60 ? 7 : size > 50 ? 5 : 4,
    }]}>
      <Image source={icon} style={{ width: iconSize, height: iconSize, marginBottom: -1 }} resizeMode="contain" />
      {showValue && (
        <>
          <Text style={[cell.value, { fontSize, lineHeight: fontSize + 1 }]}>
            {restriction.value_num}
          </Text>
          <Text style={[cell.unit, { fontSize: unitSize }]}>{meta.unitKey ? t(`units.${meta.unitKey}`) : ''}</Text>
        </>
      )}
    </View>
  );
};

const cell = StyleSheet.create({
  wrap: {
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.38,
    shadowRadius: 5,
  },
  value: {
    fontWeight: '900',
    color: '#1A1A1A',
    marginTop: -1,
  },
  unit: {
    fontWeight: '600',
    color: '#555',
    marginTop: 1,
  },
});

// ── Distance label ────────────────────────────────────────────────────────────

function fmtDist(m: number, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (m < 50) return t('restriction.now');
  if (m < 1000) return `${Math.round(m / 10) * 10} ${t('units.meterShort')}`;
  return `${(m / 1000).toFixed(1)} ${t('units.kilometerShort')}`;
}

// ── Main component ────────────────────────────────────────────────────────────

const CompositeRestrictionSign: React.FC<Props> = ({ restrictions, distanceM, anyExceeded }) => {
  const { t } = useTranslation();
  const opacity = useRef(new Animated.Value(0)).current;

  // Trigger animation when restrictions change
  const key = restrictions.map(r => `${r.type}:${r.value_num}`).join('|');

  useEffect(() => {
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.delay(8000),
      Animated.timing(opacity, { toValue: 0, duration: 350, useNativeDriver: true }),
    ]).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!restrictions.length) return null;

  const count = restrictions.length;
  const signSize = count === 1 ? 72 : count === 2 ? 56 : 44;
  const gap      = count === 1 ? 0  : 6;

  const distLabel   = fmtDist(distanceM, t);
  const labelColor  = anyExceeded ? '#FF6B00' : '#D0021B';
  const bgColor     = anyExceeded ? 'rgba(255,107,0,0.15)' : 'rgba(208,2,27,0.12)';

  return (
    <Animated.View style={[s.container, { opacity }]}>
      {/* Background pill */}
      <View style={[s.pill, { backgroundColor: bgColor, borderColor: labelColor }]}>

        {/* Distance badge */}
        <View style={[s.distBadge, { backgroundColor: labelColor }]}>
          <Text style={s.distText}>{distLabel}</Text>
        </View>

        {/* Signs row */}
        <View style={[s.signsRow, { gap }]}>
          {restrictions.slice(0, 4).map((r, i) => (
            <SignCell key={i} restriction={r} size={signSize} />
          ))}
        </View>

        {/* Exceeded label */}
        {anyExceeded && (
          <Text style={s.exceededLabel}>{t('restriction.exceeded')}</Text>
        )}
      </View>

      {/* Connector pin */}
      <View style={[s.pin, { backgroundColor: labelColor }]} />
    </Animated.View>
  );
};

const s = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 80,
    right: 12,
    alignItems: 'center',
    zIndex: 50,
  },
  pill: {
    borderRadius: 14,
    borderWidth: 1.5,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
    gap: 6,
  },
  distBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  distText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  signsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  exceededLabel: {
    fontSize: 9,
    fontWeight: '900',
    color: '#FF6B00',
    letterSpacing: 1.2,
    marginTop: -2,
  },
  pin: {
    width: 3,
    height: 10,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
    marginTop: -1,
  },
});

export default React.memo(CompositeRestrictionSign);
