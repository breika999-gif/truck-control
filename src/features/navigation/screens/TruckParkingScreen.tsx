import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  Linking,
  ScrollView,
} from 'react-native';
import { WebView } from 'react-native-webview';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import Geolocation from 'react-native-geolocation-service';

import { RootStackParamList } from '../../../shared/types/navigation';
import { spacing } from '../../../shared/constants/theme';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'TruckParking'>;
type TruckParkingRouteProp = RouteProp<RootStackParamList, 'TruckParking'>;

const NEON = '#00bfff';
const TRANSPARKING_URL = 'https://truckerapps.eu/transparking/bg/map/';

type ParkingTarget = {
  lat: number;
  lng: number;
  label: string;
};

function coordToTarget(
  coord: [number, number] | undefined,
  label: string,
): ParkingTarget | null {
  if (!coord) return null;
  return { lng: coord[0], lat: coord[1], label };
}

function distM(a: [number, number], b: [number, number]): number {
  const lat1 = a[1] * Math.PI / 180;
  const lat2 = b[1] * Math.PI / 180;
  const dLat = (b[1] - a[1]) * Math.PI / 180;
  const dLng = (b[0] - a[0]) * Math.PI / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function pointAlongRoute(coords: [number, number][] | undefined, targetS: number, durationS?: number): [number, number] | null {
  if (!coords || coords.length === 0) return null;
  if (coords.length === 1) return coords[0];

  const segments: number[] = [];
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) {
    const d = distM(coords[i - 1], coords[i]);
    segments.push(d);
    total += d;
  }
  if (total <= 0) return coords[0];

  const targetM = durationS && durationS > 0
    ? total * Math.min(1, Math.max(0, targetS / durationS))
    : Math.min(total, Math.max(0, targetS * 22.2)); // ~80 km/h fallback

  let walked = 0;
  for (let i = 1; i < coords.length; i += 1) {
    const seg = segments[i - 1] || 0;
    if (walked + seg >= targetM) {
      const t = seg === 0 ? 0 : (targetM - walked) / seg;
      const a = coords[i - 1];
      const b = coords[i];
      return [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
      ];
    }
    walked += seg;
  }
  return coords[coords.length - 1];
}

function urlWithFocus(point: ParkingTarget): string {
  const params = new URLSearchParams({
    lat: String(point.lat),
    lng: String(point.lng),
    zoom: '12',
  });
  return `${TRANSPARKING_URL}?${params.toString()}`;
}

function buildLocateScript(): string {
  return `
    (function () {
      try {
        var labels = ['locat', 'near', 'nearby', 'gps', 'position', 'позиция', 'моето', 'около'];
        var nodes = Array.prototype.slice.call(document.querySelectorAll('button,a,div[role="button"],input'));
        var target = nodes.find(function (el) {
          var txt = ((el.innerText || '') + ' ' + (el.title || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.value || '')).toLowerCase();
          return labels.some(function (label) { return txt.indexOf(label) >= 0; });
        });
        if (target && target.click) target.click();
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'tp-locate', found: !!target }));
      } catch (e) {
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'tp-error', message: String(e && e.message || e) }));
      }
      true;
    })();
  `;
}

const CAPTURE_COORDS_SCRIPT = `
  (function () {
    if (window.__truckaiParkingHooked) return true;
    window.__truckaiParkingHooked = true;
    function parseCoords(text) {
      var matches = String(text || '').match(/-?\\d{1,3}\\.\\d{4,}/g);
      if (!matches || matches.length < 2) return null;
      for (var i = 0; i < matches.length - 1; i++) {
        var a = parseFloat(matches[i]);
        var b = parseFloat(matches[i + 1]);
        if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return { lat: a, lng: b };
        if (Math.abs(a) <= 180 && Math.abs(b) <= 90) return { lat: b, lng: a };
      }
      return null;
    }
    document.addEventListener('click', function (event) {
      setTimeout(function () {
        var el = event.target;
        var chunks = [location.href];
        for (var i = 0; el && i < 6; i++, el = el.parentElement) {
          chunks.push(el.href || '', el.getAttribute && el.getAttribute('data-lat') || '', el.getAttribute && el.getAttribute('data-lng') || '', el.textContent || '');
        }
        var coords = parseCoords(chunks.join(' '));
        if (coords && window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'tp-coords', lat: coords.lat, lng: coords.lng }));
        }
      }, 250);
    }, true);
    true;
  })();
`;

const TruckParkingScreen: React.FC = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<TruckParkingRouteProp>();
  const {
    url,
    userCoords,
    selectedCoords,
    selectedName,
    routeCoords,
    routeDurationS,
    remainingDriveMin,
  } = route.params || {};
  const webViewRef = React.useRef<WebView>(null);
  const selectedTarget = React.useMemo(
    () => coordToTarget(selectedCoords, selectedName || t('parking.selectedParking')),
    [selectedCoords, selectedName, t],
  );
  const userTarget = React.useMemo(
    () => coordToTarget(userCoords, t('parking.myPosition')),
    [userCoords, t],
  );
  const [webUrl, setWebUrl] = React.useState(url ?? TRANSPARKING_URL);
  const [target, setTarget] = React.useState<ParkingTarget | null>(selectedTarget ?? userTarget);
  const [status, setStatus] = React.useState<string>('');

  React.useEffect(() => {
    setWebUrl(url ?? TRANSPARKING_URL);
  }, [url]);

  React.useEffect(() => {
    setTarget(selectedTarget ?? userTarget);
  }, [selectedTarget, userTarget]);

  const focusTarget = React.useCallback((next: ParkingTarget, reloadMap = false) => {
    setTarget(next);
    setStatus(next.label);
    if (reloadMap) setWebUrl(urlWithFocus(next));
  }, []);

  const handleAroundMe = React.useCallback(() => {
    if (userTarget) {
      focusTarget(userTarget);
      webViewRef.current?.injectJavaScript(buildLocateScript());
      return;
    }
    Geolocation.getCurrentPosition(
      pos => {
        const next = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          label: t('parking.myPosition'),
        };
        focusTarget(next);
        webViewRef.current?.injectJavaScript(buildLocateScript());
      },
      () => setStatus(t('parking.noGpsForParking')),
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 10000 },
    );
  }, [focusTarget, t, userTarget]);

  const handleRoutePoint = React.useCallback(() => {
    const minutes = remainingDriveMin && remainingDriveMin > 0 ? remainingDriveMin : 60;
    const coord = pointAlongRoute(routeCoords, minutes * 60, routeDurationS);
    if (!coord) {
      setStatus(t('parking.noRouteForParking'));
      return;
    }
    focusTarget({
      lng: coord[0],
      lat: coord[1],
      label: remainingDriveMin && remainingDriveMin > 0
        ? t('parking.tachoPointMinutes', { minutes: Math.round(minutes) })
        : t('parking.routePointMinutes', { minutes: Math.round(minutes) }),
    }, true);
  }, [focusTarget, remainingDriveMin, routeCoords, routeDurationS, t]);

  const getActionTarget = React.useCallback(() => {
    if (target) return target;
    if (userTarget) return userTarget;
    setStatus(t('parking.pickParkingTarget'));
    return null;
  }, [target, t, userTarget]);

  const openStreetView = React.useCallback(() => {
    const point = getActionTarget();
    if (!point) return;
    Linking.openURL(`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${point.lat},${point.lng}`)
      .catch(() => setStatus(t('parking.openExternalFailed')));
  }, [getActionTarget, t]);

  const openGoogleNav = React.useCallback(() => {
    const point = getActionTarget();
    if (!point) return;
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${point.lat},${point.lng}&travelmode=driving`)
      .catch(() => setStatus(t('parking.openExternalFailed')));
  }, [getActionTarget, t]);

  const handleMessage = React.useCallback((event: any) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'tp-coords' && typeof msg.lat === 'number' && typeof msg.lng === 'number') {
        focusTarget({ lat: msg.lat, lng: msg.lng, label: t('parking.selectedFromLiveMap') });
      } else if (msg.type === 'tp-locate') {
        setStatus(msg.found ? t('parking.locateTriggered') : t('parking.locateUnavailable'));
      }
    } catch {
      // ignore non-JSON WebView messages
    }
  }, [focusTarget, t]);

  const hasRoutePoint = Boolean(routeCoords && routeCoords.length > 1);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header with Back Button */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Icon name="arrow-left" size={28} color="#ffffff" />
        </TouchableOpacity>
        <View style={styles.titleContainer}>
          <Text style={styles.headerTitle}>TransParking Live</Text>
          <Text style={styles.subTitle}>{t('parking.subtitle')}</Text>
        </View>
        <Icon name="truck-parking" size={28} color={NEON} style={styles.headerIcon} />
      </View>

      {/* WebView Container */}
      <View style={styles.webviewContainer}>
        <WebView
          ref={webViewRef}
          source={{ uri: webUrl }}
          style={styles.webview}
          startInLoadingState={true}
          renderLoading={() => (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={NEON} />
              <Text style={styles.loadingText}>{t('parking.loadingMap')}</Text>
            </View>
          )}
          geolocationEnabled={true}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          onLoadEnd={() => webViewRef.current?.injectJavaScript(CAPTURE_COORDS_SCRIPT)}
          onMessage={handleMessage}
          userAgent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        />
        <View style={styles.targetPill} pointerEvents="none">
          <Text style={styles.targetPillText} numberOfLines={1}>
            {target ? `${t('parking.target')}: ${target.label}` : t('parking.noTarget')}
          </Text>
          {!!status && (
            <Text style={styles.targetStatus} numberOfLines={1}>{status}</Text>
          )}
        </View>
        <View style={styles.toolbar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.toolbarContent}
          >
            <ToolButton icon="crosshairs-gps" label={t('parking.aroundMe')} onPress={handleAroundMe} />
            <ToolButton
              icon="timer-sand"
              label={remainingDriveMin && remainingDriveMin > 0 ? t('parking.tachoPoint') : t('parking.routePoint')}
              onPress={handleRoutePoint}
              disabled={!hasRoutePoint}
            />
            <ToolButton icon="google-street-view" label={t('parking.streetView')} onPress={openStreetView} />
            <ToolButton icon="navigation-variant" label={t('parking.googleNav')} onPress={openGoogleNav} />
            <ToolButton icon="reload" label={t('parking.reload')} onPress={() => webViewRef.current?.reload()} />
          </ScrollView>
        </View>
      </View>
    </SafeAreaView>
  );
};

const ToolButton = ({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) => (
  <TouchableOpacity
    style={[styles.toolButton, disabled && styles.toolButtonDisabled]}
    onPress={onPress}
    activeOpacity={0.78}
    disabled={disabled}
  >
    <Icon name={icon} size={18} color={disabled ? 'rgba(255,255,255,0.35)' : NEON} />
    <Text style={[styles.toolButtonText, disabled && styles.toolButtonTextDisabled]}>{label}</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a1a',
  },
  header: {
    height: 70,
    backgroundColor: '#0a0a1a',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 191, 255, 0.3)',
  },
  backBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 22,
  },
  titleContainer: {
    flex: 1,
    marginLeft: spacing.md,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  subTitle: {
    color: NEON,
    fontSize: 12,
    fontWeight: '500',
    marginTop: -2,
  },
  headerIcon: {
    marginLeft: spacing.sm,
  },
  webviewContainer: {
    flex: 1,
    backgroundColor: '#0a0a1a',
  },
  webview: {
    flex: 1,
    backgroundColor: '#0a0a1a',
  },
  targetPill: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(10, 10, 26, 0.86)',
    borderWidth: 1,
    borderColor: 'rgba(0, 191, 255, 0.35)',
  },
  targetPillText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  targetStatus: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    marginTop: 2,
  },
  toolbar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingVertical: 10,
    backgroundColor: 'rgba(10, 10, 26, 0.94)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 191, 255, 0.32)',
  },
  toolbarContent: {
    paddingHorizontal: 10,
    gap: 8,
  },
  toolButton: {
    minWidth: 92,
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(0, 191, 255, 0.45)',
    backgroundColor: 'rgba(0, 191, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  toolButtonDisabled: {
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  toolButtonText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
    marginTop: 2,
  },
  toolButtonTextDisabled: {
    color: 'rgba(255,255,255,0.35)',
  },
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0a0a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#ffffff',
    marginTop: spacing.md,
    fontSize: 14,
    fontWeight: '600',
  },
});

export default TruckParkingScreen;
