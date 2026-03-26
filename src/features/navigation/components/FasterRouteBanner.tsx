import React, { useEffect, useRef, memo } from 'react';
import { View, Text, TouchableOpacity, Animated, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { FasterRouteOffer } from '../hooks/useFasterRouteCheck';
import { fmtDistance } from '../api/directions';

interface Props {
  offer: FasterRouteOffer | null;
  onAccept: () => void;
  onDismiss: () => void;
  top: number;
}

const FasterRouteBanner: React.FC<Props> = memo(({ offer, onAccept, onDismiss, top }) => {
  const translateY = useRef(new Animated.Value(-120)).current;
  const prevOffer  = useRef<FasterRouteOffer | null>(null);

  useEffect(() => {
    if (offer && !prevOffer.current) {
      // Slide in
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        tension: 80,
        friction: 10,
      }).start();
    } else if (!offer && prevOffer.current) {
      // Slide out
      Animated.timing(translateY, {
        toValue: -120,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
    prevOffer.current = offer;
  }, [offer, translateY]);

  if (!offer && !prevOffer.current) return null;

  const distKm = offer ? Math.round(offer.route.distance / 1000) : 0;

  return (
    <Animated.View style={[styles.banner, { top, transform: [{ translateY }] }]}>
      <View style={styles.iconWrap}>
        <Icon name="lightning-bolt" size={22} color="#FFD700" />
      </View>
      <View style={styles.content}>
        <Text style={styles.title}>По-бърз маршрут</Text>
        <Text style={styles.subtitle}>
          Спести <Text style={styles.highlight}>{offer?.saveMin ?? 0} мин</Text>
          {'  ·  '}{fmtDistance(distKm * 1000)}
        </Text>
      </View>
      <TouchableOpacity style={styles.btnAccept} onPress={onAccept}>
        <Text style={styles.btnAcceptText}>Използвай</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.btnDismiss} onPress={onDismiss}>
        <Icon name="close" size={18} color="rgba(255,255,255,0.5)" />
      </TouchableOpacity>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(10,20,40,0.97)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#00BFFF',
    paddingVertical: 12,
    paddingHorizontal: 14,
    zIndex: 60,
    elevation: 30,
    shadowColor: '#00BFFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    gap: 10,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,215,0,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12,
    marginTop: 2,
  },
  highlight: {
    color: '#00BFFF',
    fontWeight: '700',
  },
  btnAccept: {
    backgroundColor: '#00BFFF',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  btnAcceptText: {
    color: '#000',
    fontSize: 13,
    fontWeight: '800',
  },
  btnDismiss: {
    padding: 4,
  },
});

export default FasterRouteBanner;
