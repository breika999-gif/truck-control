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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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

type StatusTone = 'neutral' | 'good' | 'warn' | 'bad';

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

function buildFocusScript(point: ParkingTarget): string {
  const label = JSON.stringify(point.label);
  return `
    (function () {
      try {
        var tries = 0;
        var lat = ${point.lat};
        var lng = ${point.lng};
        var label = ${label};
        function post(payload) {
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(payload));
        }
        function focus() {
          if (window.google && window.google.maps && window.map && window.map.setCenter) {
            var pos = { lat: lat, lng: lng };
            window.map.setCenter(pos);
            window.map.setZoom(12);
            if (window.__truckaiTargetMarker) window.__truckaiTargetMarker.setMap(null);
            window.__truckaiTargetMarker = new window.google.maps.Marker({
              position: pos,
              map: window.map,
              title: label
            });
            post({ type: 'tp-focused', ok: true, label: label });
            return;
          }
          if (tries++ < 30) {
            setTimeout(focus, 250);
          } else {
            post({ type: 'tp-focused', ok: false });
          }
        }
        focus();
      } catch (e) {
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'tp-error', message: String(e && e.message || e) }));
      }
      true;
    })();
  `;
}

function buildNightModeScript(enabled: boolean): string {
  return `
    (function () {
      try {
        var id = 'truckai-night-mode-style';
        var existing = document.getElementById(id);
        if (${enabled ? 'true' : 'false'}) {
          if (!existing) {
            var style = document.createElement('style');
            style.id = id;
            style.textContent = 'html { filter: invert(0.88) hue-rotate(180deg) !important; } img, video, [class*="logo"] { filter: invert(1) hue-rotate(180deg) !important; }';
            document.head.appendChild(style);
          }
        } else if (existing) {
          existing.remove();
        }
      } catch (e) {}
      true;
    })();
  `;
}

const CAPTURE_COORDS_SCRIPT = `
  (function () {
    try {
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

      function autoDismissDialogs() {
        try {
          var labels = ['accept', 'ok', 'agree', 'got it', 'close', 'приемам', 'съглас', 'добре', 'затвори'];
          var nodes = Array.prototype.slice.call(document.querySelectorAll('button,a,input,[role="button"]'));
          nodes.some(function (el) {
            var txt = String((el.innerText || '') + ' ' + (el.value || '') + ' ' + (el.title || '') + ' ' + (el.getAttribute('aria-label') || '')).replace(/\\s+/g, ' ').trim().toLowerCase();
            if (txt.length > 42) return false;
            var hit = labels.some(function (label) { return txt.indexOf(label) >= 0; });
            if (hit && el.click) {
              el.click();
              return true;
            }
            return false;
          });
        } catch (e) {}
      }

      document.addEventListener('click', function (event) {
        setTimeout(function () {
          try {
            var el = event.target;
            var chunks = [location.href];
            for (var i = 0; el && i < 6; i++, el = el.parentElement) {
              chunks.push(el.href || '', el.getAttribute && el.getAttribute('data-lat') || '', el.getAttribute && el.getAttribute('data-lng') || '', el.textContent || '');
            }
            var coords = parseCoords(chunks.join(' '));
            if (coords && window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'tp-coords', lat: coords.lat, lng: coords.lng }));
            }
          } catch (e) {}
        }, 250);
      }, true);

      var dismissQueued = false;
      function scheduleAutoDismiss() {
        if (dismissQueued) return;
        dismissQueued = true;
        setTimeout(function () {
          dismissQueued = false;
          autoDismissDialogs();
        }, 600);
      }

      autoDismissDialogs();
      new MutationObserver(scheduleAutoDismiss).observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'tp-error', message: String(e && e.message || e) }));
      }
    }
    true;
  })();
`;

const CLEAN_TRANSPARKING_POPUPS_SCRIPT = `
  (function () {
    try {
      if (window.__truckaiPopupCleanupHooked) return true;
      window.__truckaiPopupCleanupHooked = true;

      function installStyle() {
        if (document.getElementById('truckai-transparking-clean-style')) return;
        var style = document.createElement('style');
        style.id = 'truckai-transparking-clean-style';
        style.textContent = [
          'header, nav, .navbar, .header, #header, #header-box, #download_app, #back_to_home { display: none !important; visibility: hidden !important; }',
          '.cookie, .gdpr, .banner, .cc-banner, [class*="cookie"], [class*="consent"], .ad, .ads, [class*="advert"], .promo, [class*="promo"] { display: none !important; visibility: hidden !important; }',
          '.gm-style-iw button, .gm-style-iw a { max-width: 100% !important; }',
          'img[src*="shower"], [title*="душ"], [aria-label*="душ"], [title*="shower"], [aria-label*="shower"] { filter: hue-rotate(165deg) saturate(1.8) !important; }',
          'img[src*="security"], img[src*="guard"], [title*="охрана"], [aria-label*="охрана"], [title*="security"], [aria-label*="security"] { filter: hue-rotate(95deg) saturate(1.8) !important; }'
        ].join('\\n');
        document.head.appendChild(style);
      }

      function cleanText(value) {
        return String(value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      }

      function hide(el) {
        if (!el || el.__truckaiHidden) return;
        el.__truckaiHidden = true;
        el.style.setProperty('display', 'none', 'important');
      }

      function hideCompact(el) {
        if (!el) return;
        var txt = cleanText(el.innerText || el.textContent || '');
        if (txt.length < 260) hide(el);
      }

      function hideFilterDrawer() {
        var selectors = 'div,section,form,aside';
        Array.prototype.slice.call(document.querySelectorAll(selectors)).forEach(function (el) {
          if (!el || el.__truckaiHidden) return;
          var tag = String(el.tagName || '').toLowerCase();
          if (tag === 'html' || tag === 'body') return;

          var txt = cleanText(el.innerText || el.textContent || '');
          var isFilterDrawer =
            txt.indexOf('вид паркинг') >= 0 &&
            txt.indexOf('избор на удобства') >= 0 &&
            (txt.indexOf('безопасност') >= 0 || txt.indexOf('комфорт') >= 0);
          if (!isFilterDrawer) return;

          var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
          var looksLikeDrawer = !rect || (
            rect.width >= window.innerWidth * 0.35 &&
            rect.width <= window.innerWidth * 0.96 &&
            rect.height >= 220
          );
          if (looksLikeDrawer) hide(el);
        });
      }

      function shareText(el) {
        return cleanText(
          (el && el.href || '') + ' ' +
          (el && el.action || '') + ' ' +
          (el && el.innerText || '') + ' ' +
          (el && el.textContent || '') + ' ' +
          (el && el.value || '') + ' ' +
          (el && el.title || '') + ' ' +
          (el && el.getAttribute && el.getAttribute('aria-label') || '') + ' ' +
          (el && el.getAttribute && el.getAttribute('onclick') || '')
        );
      }

      function isShareNode(el) {
        var txt = shareText(el);
        return (
          txt.indexOf('facebook') >= 0 ||
          txt.indexOf('fb.com') >= 0 ||
          txt.indexOf('mailto:') >= 0 ||
          txt.indexOf('sms:') >= 0 ||
          txt.indexOf('изпращане sms') >= 0 ||
          txt.indexOf('e-mail') >= 0 ||
          txt === 'email'
        );
      }

      function findShareNode(start) {
        var el = start;
        for (var i = 0; el && i < 6; i += 1, el = el.parentElement) {
          if (isShareNode(el)) return el;
        }
        return null;
      }

      function blockShareEvent(event) {
        try {
          var node = findShareNode(event.target);
          if (!node) return;
          event.preventDefault();
          event.stopPropagation();
          if (event.stopImmediatePropagation) event.stopImmediatePropagation();
          hideCompact(node.closest && node.closest('a,button,li,p,div') || node);
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'tp-share-blocked' }));
        } catch (e) {}
      }

      ['pointerdown', 'touchstart', 'click'].forEach(function (eventName) {
        document.addEventListener(eventName, blockShareEvent, true);
      });

      function cleanup() {
        installStyle();
        hideFilterDrawer();
        var buttonLabels = [
          'изпращане sms',
          'facebook',
          'e-mail',
          'email',
          'send sms'
        ];
        Array.prototype.slice.call(document.querySelectorAll('a,button,input,[role="button"],.button,.btn')).forEach(function (el) {
          var txt = cleanText((el.innerText || '') + ' ' + (el.value || '') + ' ' + (el.title || '') + ' ' + (el.getAttribute('aria-label') || ''));
          if (buttonLabels.some(function (label) { return txt.indexOf(label) >= 0; }) || isShareNode(el)) {
            if (el.removeAttribute) {
              el.removeAttribute('href');
              el.removeAttribute('target');
              el.removeAttribute('onclick');
            }
            hideCompact(el.closest('a,button,li,p,div') || el);
          }
        });

        Array.prototype.slice.call(document.querySelectorAll('p,section')).forEach(function (el) {
          var txt = cleanText(el.innerText || el.textContent || '');
          if (
            txt.indexOf('изпратете на вашият шофьор') >= 0 ||
            txt.indexOf('безплатен sms') >= 0 ||
            txt.indexOf('координатите на паркинга') >= 0 ||
            txt.indexOf('send a free sms') >= 0 ||
            txt.indexOf('parking coordinates') >= 0
          ) {
            hideCompact(el);
          }
        });
      }

      var cleanupQueued = false;
      function scheduleCleanup() {
        if (cleanupQueued) return;
        cleanupQueued = true;
        setTimeout(function () {
          cleanupQueued = false;
          cleanup();
        }, 700);
      }

      cleanup();
      new MutationObserver(scheduleCleanup).observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
    true;
  })();
`;

function parkingStatusForTarget(
  point: ParkingTarget,
  userCoords: [number, number] | undefined,
  remainingDriveMin: number | undefined,
): { text: string; tone: StatusTone } | null {
  if (!userCoords) return null;
  const distKm = distM(userCoords, [point.lng, point.lat]) / 1000;
  const etaMin = Math.max(1, Math.ceil((distKm / 80) * 60));
  const distText = distKm < 10 ? distKm.toFixed(1) : String(Math.round(distKm));
  if (remainingDriveMin && remainingDriveMin > 0) {
    const reserveMin = Math.round(remainingDriveMin - etaMin);
    if (reserveMin >= 30) {
      return { text: `${distText} км · пристигаш с ${reserveMin} мин резерв ✓`, tone: 'good' };
    }
    if (reserveMin >= 0) {
      return { text: `${distText} км · пристигаш с ${reserveMin} мин резерв ⚠`, tone: 'warn' };
    }
    return { text: `${distText} км · недостатъчно тахо ✗`, tone: 'bad' };
  }
  return { text: `${distText} км · ~${etaMin} мин`, tone: 'neutral' };
}

function parkingMapPayload(
  point: ParkingTarget,
  userCoords: [number, number] | undefined,
): Record<string, unknown> {
  const distanceM = userCoords ? Math.round(distM(userCoords, [point.lng, point.lat])) : 0;
  const travelTime = distanceM > 0 ? Math.max(60, Math.round(distanceM / 22.2)) : undefined;
  return {
    name: point.label,
    lat: point.lat,
    lng: point.lng,
    distance_m: distanceM,
    travel_time: travelTime,
    info: 'TransParking Live',
  };
}

const TruckParkingScreen: React.FC = () => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
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
  const [statusTone, setStatusTone] = React.useState<StatusTone>('neutral');
  const [nightMode, setNightMode] = React.useState(false);

  React.useEffect(() => {
    setWebUrl(url ?? TRANSPARKING_URL);
  }, [url]);

  React.useEffect(() => {
    setTarget(selectedTarget ?? userTarget);
  }, [selectedTarget, userTarget]);

  const focusTarget = React.useCallback((next: ParkingTarget, focusWebMap = false) => {
    setTarget(next);
    setStatus(next.label);
    setStatusTone('neutral');
    if (focusWebMap) webViewRef.current?.injectJavaScript(buildFocusScript(next));
  }, []);

  const handleAroundMe = React.useCallback(() => {
    if (userTarget) {
      focusTarget(userTarget, true);
      return;
    }
    Geolocation.getCurrentPosition(
      pos => {
        const next = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          label: t('parking.myPosition'),
        };
        focusTarget(next, true);
      },
      () => {
        setStatus(t('parking.noGpsForParking'));
        setStatusTone('neutral');
      },
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 10000 },
    );
  }, [focusTarget, t, userTarget]);

  const handleRoutePoint = React.useCallback(() => {
    const minutes = remainingDriveMin && remainingDriveMin > 0 ? remainingDriveMin : 60;
    const coord = pointAlongRoute(routeCoords, minutes * 60, routeDurationS);
    if (!coord) {
      setStatus(t('parking.noRouteForParking'));
      setStatusTone('neutral');
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
    setStatusTone('neutral');
    return null;
  }, [target, t, userTarget]);

  const openStreetView = React.useCallback(() => {
    const point = getActionTarget();
    if (!point) return;
    Linking.openURL(`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${point.lat},${point.lng}`)
      .catch(() => {
        setStatus(t('parking.openExternalFailed'));
        setStatusTone('neutral');
      });
  }, [getActionTarget, t]);

  const openGoogleNav = React.useCallback(() => {
    const point = getActionTarget();
    if (!point) return;
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${point.lat},${point.lng}&travelmode=driving`)
      .catch(() => {
        setStatus(t('parking.openExternalFailed'));
        setStatusTone('neutral');
      });
  }, [getActionTarget, t]);

  const handleShouldStartLoad = React.useCallback((request: { url?: string }) => {
    const nextUrl = (request.url || '').toLowerCase();
    if (
      nextUrl.includes('facebook.com') ||
      nextUrl.includes('fb.com') ||
      nextUrl.startsWith('mailto:') ||
      nextUrl.startsWith('sms:')
    ) {
      setStatus(t('parking.shareBlocked'));
      setStatusTone('neutral');
      return false;
    }
    return true;
  }, [t]);

  const toggleNightMode = React.useCallback(() => {
    setNightMode(prev => {
      const next = !prev;
      webViewRef.current?.injectJavaScript(buildNightModeScript(next));
      return next;
    });
  }, []);

  const handleOpenTruckMap = React.useCallback(() => {
    const point = getActionTarget();
    if (!point) return;
    navigation.navigate('Map', {
      initialCenter: [point.lng, point.lat],
      selectedPOI: parkingMapPayload(point, userCoords),
    });
  }, [getActionTarget, navigation, userCoords]);

  const handleMessage = React.useCallback((event: any) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'tp-coords' && typeof msg.lat === 'number' && typeof msg.lng === 'number') {
        const next = { lat: msg.lat, lng: msg.lng, label: t('parking.selectedFromLiveMap') };
        setTarget(next);
        const richStatus = parkingStatusForTarget(next, userCoords, remainingDriveMin);
        if (richStatus) {
          setStatus(richStatus.text);
          setStatusTone(richStatus.tone);
        } else {
          setStatus(t('parking.selectedFromLiveMap'));
          setStatusTone('neutral');
        }
      } else if (msg.type === 'tp-focused') {
        setStatus(msg.ok ? t('parking.focusedInTransParking') : t('parking.focusUnavailable'));
        setStatusTone('neutral');
      }
    } catch {
      // ignore non-JSON WebView messages
    }
  }, [remainingDriveMin, t, userCoords]);

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
          onLoadEnd={() => {
            webViewRef.current?.injectJavaScript(CAPTURE_COORDS_SCRIPT);
            webViewRef.current?.injectJavaScript(CLEAN_TRANSPARKING_POPUPS_SCRIPT);
            if (nightMode) webViewRef.current?.injectJavaScript(buildNightModeScript(true));
            if (target) webViewRef.current?.injectJavaScript(buildFocusScript(target));
          }}
          onMessage={handleMessage}
          onShouldStartLoadWithRequest={handleShouldStartLoad}
          setSupportMultipleWindows={false}
          userAgent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        />
        <View style={styles.targetPill} pointerEvents="none">
          <Text style={styles.targetPillText} numberOfLines={1}>
            {target ? `${t('parking.target')}: ${target.label}` : t('parking.noTarget')}
          </Text>
          {!!status && (
            <Text
              style={[
                styles.targetStatus,
                statusTone === 'good' && styles.targetStatusGood,
                statusTone === 'warn' && styles.targetStatusWarn,
                statusTone === 'bad' && styles.targetStatusBad,
              ]}
              numberOfLines={1}
            >
              {status}
            </Text>
          )}
        </View>
        <View style={[styles.toolbar, { paddingBottom: Math.max(insets.bottom + 14, 24) }]}>
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
            <ToolButton icon="map-marker-radius" label={t('parking.showOnMap')} onPress={handleOpenTruckMap} disabled={!target} />
            <ToolButton icon="navigation-variant" label={t('parking.googleNav')} onPress={openGoogleNav} />
            <ToolButton icon="reload" label={t('parking.reload')} onPress={() => webViewRef.current?.reload()} />
            <ToolButton icon="weather-night" label="Нощен" onPress={toggleNightMode} active={nightMode} />
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
  active,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
}) => (
  <TouchableOpacity
    style={[styles.toolButton, active && styles.toolButtonActive, disabled && styles.toolButtonDisabled]}
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
  targetStatusGood: {
    color: '#00ff88',
  },
  targetStatusWarn: {
    color: '#ffb020',
  },
  targetStatusBad: {
    color: '#ff4d6d',
  },
  toolbar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 10,
    backgroundColor: 'rgba(10, 10, 26, 0.94)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 191, 255, 0.32)',
  },
  toolbarContent: {
    paddingHorizontal: 10,
    gap: 8,
  },
  toolButton: {
    minWidth: 104,
    height: 54,
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
  toolButtonActive: {
    borderColor: '#b58cff',
    backgroundColor: 'rgba(181, 140, 255, 0.22)',
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
