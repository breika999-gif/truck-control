import React, { memo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Share,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Tts from 'react-native-tts';
import { styles } from '../screens/MapScreen.styles';
import { POI_META, type POICategory } from '../api/poi';
import { POI_CATEGORIES } from '../utils/mapUtils';
import type { RouteResult } from '../api/directions';
import type { GoogleAccount } from '../../../shared/services/accountManager';
import type { MapMode } from '../hooks/useMapUIState';

interface OptionsPanelProps {
  optionsOpen: boolean;
  setOptionsOpen: (open: boolean | ((v: boolean) => boolean)) => void;
  mapMode: MapMode;
  setMapMode: (mode: MapMode | ((v: MapMode) => MapMode)) => void;
  lightMode: boolean;
  setLightMode: (light: boolean | ((v: boolean) => boolean)) => void;
  voiceMuted: boolean;
  setVoiceMuted: (muted: boolean | ((v: boolean) => boolean)) => void;
  showTraffic: boolean;
  setShowTraffic: (show: boolean | ((v: boolean) => boolean)) => void;
  showIncidents: boolean;
  setShowIncidents: (show: boolean | ((v: boolean) => boolean)) => void;
  showRestrictions: boolean;
  setShowRestrictions: (show: boolean | ((v: boolean) => boolean)) => void;
  showContours: boolean;
  setShowContours: (show: boolean | ((v: boolean) => boolean)) => void;
  avoidUnpaved: boolean;
  setAvoidUnpaved: (value: boolean | ((v: boolean) => boolean)) => void;
  showStarredLayer: boolean;
  setShowStarredLayer: (show: boolean | ((v: boolean) => boolean)) => void;
  navigating: boolean;
  route: RouteResult | null;
  simulating: boolean;
  startSim: () => void;
  stopSim: () => void;
  debugMode: boolean;
  setDebugMode: (debug: boolean | ((v: boolean) => boolean)) => void;
  poiCategory: POICategory | null;
  handlePOISearch: (cat: POICategory) => void;
  sarMode: boolean;
  handleSARSearch: (cat: POICategory) => void;
  googleUser: GoogleAccount | null;
  setShowAccountModal: (show: boolean) => void;
  starredPOIs: any[];
  navigation: any;
  setBorderCrossings: (crossings: any[]) => void;
  setShowBorderPanel: (show: boolean) => void;
  searchTop: number;
  isSearchingAlongRoute?: boolean;
  handleSearchAlongRoute: () => void;
  setMapIsLoaded: (loaded: boolean) => void;
  userCoords: [number, number] | null;
  onReportCamera: () => void;
}

// Icon color constants
const C_ON  = '#FFFFFF';
const C_OFF = '#4A5568';
const C_ACT = '#00BFFF';
const C_RED = '#FF4444';
const ICON_SIZE = 22;

const OptionsPanel: React.FC<OptionsPanelProps> = memo(({
  optionsOpen,
  setOptionsOpen,
  mapMode,
  setMapMode,
  lightMode,
  setLightMode,
  voiceMuted,
  setVoiceMuted,
  showTraffic,
  setShowTraffic,
  showIncidents,
  setShowIncidents,
  showRestrictions,
  setShowRestrictions,
  showContours,
  setShowContours,
  avoidUnpaved,
  setAvoidUnpaved,
  showStarredLayer,
  setShowStarredLayer,
  navigating,
  route,
  simulating,
  startSim,
  stopSim,
  debugMode,
  setDebugMode,
  poiCategory,
  handlePOISearch,
  sarMode,
  handleSARSearch,
  googleUser,
  setShowAccountModal,
  starredPOIs,
  navigation,
  setBorderCrossings,
  setShowBorderPanel,
  searchTop,
  isSearchingAlongRoute,
  handleSearchAlongRoute,
  setMapIsLoaded,
  userCoords,
  onReportCamera,
}) => {
  const mapModeIcon = mapMode === 'vector' ? 'earth' : mapMode === 'hybrid' ? 'layers' : 'satellite-variant';

  return (
    <View style={[styles.optionsContainer, { top: searchTop }]}>
      <TouchableOpacity
        style={styles.mapBtn}
        onPress={() => setOptionsOpen(v => !v)}
      >
        <Icon name={optionsOpen ? 'close' : 'tune-variant'} size={ICON_SIZE} color={C_ON} />
      </TouchableOpacity>

      {optionsOpen && (
        <View style={styles.optionsPanel}>

          {/* ── Ред 1: Маршрут ── */}
          <View style={styles.optionsRow}>
            <TouchableOpacity
              style={styles.optionBtn}
              onPress={() => { navigation.navigate('VehicleProfile'); setOptionsOpen(false); }}
            >
              <Icon name="truck" size={ICON_SIZE} color={C_ON} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.optionBtn, !showTraffic && styles.optionBtnOff]}
              onPress={() => setShowTraffic(v => !v)}
            >
              <Icon name="traffic-light" size={ICON_SIZE} color={showTraffic ? C_ON : C_OFF} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.optionBtn, !showRestrictions && styles.optionBtnOff]}
              onPress={() => setShowRestrictions(v => !v)}
            >
              <Icon name="truck-alert" size={ICON_SIZE} color={showRestrictions ? C_ON : C_OFF} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.optionBtn, !showStarredLayer && styles.optionBtnOff]}
              onPress={() => setShowStarredLayer(v => !v)}
            >
              <Icon name="star" size={ICON_SIZE} color={showStarredLayer ? '#FFD700' : C_OFF} />
            </TouchableOpacity>
          </View>

          <View style={styles.optionsDivider} />

          {/* ── Ред 2: Слоеве ── */}
          <View style={styles.optionsRow}>
            <TouchableOpacity
              style={styles.optionBtn}
              onPress={() => {
                setMapMode(prev => {
                  const next: MapMode = prev === 'vector' ? 'hybrid' : prev === 'hybrid' ? 'satellite' : 'vector';
                  if (!navigating) setMapIsLoaded(false);
                  return next;
                });
              }}
            >
              <Icon name={mapModeIcon} size={ICON_SIZE} color={C_ACT} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.optionBtn, !showIncidents && styles.optionBtnOff]}
              onPress={() => setShowIncidents(v => !v)}
            >
              <Icon name="alert-octagon" size={ICON_SIZE} color={showIncidents ? '#FFBC40' : C_OFF} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.optionBtn, !showContours && styles.optionBtnOff]}
              onPress={() => setShowContours(v => !v)}
            >
              <Icon name="terrain" size={ICON_SIZE} color={showContours ? C_ON : C_OFF} />
            </TouchableOpacity>
          </View>

          <View style={styles.optionsDivider} />

          {/* ── Ред 3: Система ── */}
          <View style={styles.optionsRow}>
            <TouchableOpacity
              style={styles.optionBtn}
              onPress={() => {
                setOptionsOpen(false);
                setBorderCrossings([
                  { name: 'Капитан Андреево', flag: '🇧🇬🇹🇷', status: 'Виж на живо', url: 'https://granici.mvr.bg/' },
                  { name: 'Кулата', flag: '🇧🇬🇬🇷', status: 'Виж на живо', url: 'https://granici.mvr.bg/' },
                  { name: 'Дунав мост 2', flag: '🇧🇬🇷🇴', status: 'Виж на живо', url: 'https://granici.mvr.bg/' },
                  { name: 'Дунав мост 1', flag: '🇧🇬🇷🇴', status: 'Виж на живо', url: 'https://granici.mvr.bg/' },
                  { name: 'Малко Търново', flag: '🇧🇬🇹🇷', status: 'Виж на живо', url: 'https://granici.mvr.bg/' },
                  { name: 'Гюешево', flag: '🇧🇬🇲🇰', status: 'Виж на живо', url: 'https://granici.mvr.bg/' },
                ]);
                setShowBorderPanel(true);
              }}
            >
              <Icon name="passport" size={ICON_SIZE} color={C_ON} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.optionBtn, voiceMuted && styles.optionBtnOff]}
              onPress={() => { setVoiceMuted(v => !v); if (!voiceMuted) Tts.stop(); }}
            >
              <Icon name={voiceMuted ? 'volume-off' : 'volume-high'} size={ICON_SIZE} color={voiceMuted ? C_OFF : C_ON} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.optionBtn}
              onPress={() => { setLightMode(v => !v); if (!navigating) setMapIsLoaded(false); }}
            >
              <Icon name={lightMode ? 'weather-night' : 'weather-sunny'} size={ICON_SIZE} color={lightMode ? '#A78BFA' : '#FCD34D'} />
            </TouchableOpacity>
          </View>

          <View style={styles.optionsDivider} />

          {/* ── Avoid unpaved ── */}
          <View style={[styles.optionsRow, { justifyContent: 'flex-start' }]}>
            <TouchableOpacity
              style={[styles.optionBtn, !avoidUnpaved && styles.optionBtnOff, avoidUnpaved && styles.optionBtnActive]}
              onPress={() => setAvoidUnpaved(v => !v)}
            >
              <Icon name="road-variant" size={ICON_SIZE} color={avoidUnpaved ? C_ACT : C_OFF} />
            </TouchableOpacity>
            <Text style={styles.devRowLabel}>АСФАЛТ</Text>
          </View>

          <View style={styles.optionsDivider} />

          {/* ── Search along route (само при навигация) ── */}
          {navigating && (
            <>
              <View style={[styles.optionsRow, { justifyContent: 'flex-start' }]}>
                <TouchableOpacity
                  style={[styles.optionBtn, isSearchingAlongRoute && { borderColor: '#fff' }]}
                  onPress={() => { setOptionsOpen(false); handleSearchAlongRoute(); }}
                  disabled={isSearchingAlongRoute}
                >
                  <Icon name={isSearchingAlongRoute ? 'timer-sand' : 'map-search'} size={ICON_SIZE} color={C_ON} />
                </TouchableOpacity>
                <Text style={styles.devRowLabel}>ПО ПЪТЯ</Text>
              </View>
              <View style={styles.optionsDivider} />
            </>
          )}

          {/* ── POI nearby (само без маршрут) ── */}
          {!navigating && !route && (
            <>
              <View style={styles.optionsRow}>
                {POI_CATEGORIES.map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.optionBtn, !sarMode && poiCategory === cat && styles.optionBtnActive]}
                    onPress={() => { handlePOISearch(cat); setOptionsOpen(false); }}
                  >
                    <Text style={styles.mapBtnText}>{POI_META[cat].emoji}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.optionsDivider} />
            </>
          )}

          {/* ── SAR (само с маршрут) ── */}
          {route && (
            <>
              <View style={styles.optionsRow}>
                <Text style={styles.sarRowLabel}>SAR</Text>
                {POI_CATEGORIES.map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.optionBtn, sarMode && poiCategory === cat && styles.sarBtnActive]}
                    onPress={() => { handleSARSearch(cat); setOptionsOpen(false); }}
                  >
                    <Text style={styles.mapBtnText}>{POI_META[cat].emoji}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.optionsDivider} />
            </>
          )}

          {/* ── Google акаунт ── */}
          <TouchableOpacity
            style={styles.geminiConnectBtn}
            onPress={() => { setShowAccountModal(true); setOptionsOpen(false); }}
          >
            <Text style={styles.geminiConnectEmoji}>G</Text>
            <Text style={styles.geminiConnectLabel} numberOfLines={1}>
              {googleUser ? googleUser.email : 'Google акаунт'}
            </Text>
            {googleUser && <View style={styles.geminiDot} />}
          </TouchableOpacity>

          {/* ── История ── */}
          <TouchableOpacity
            style={styles.geminiConnectBtn}
            onPress={() => { setOptionsOpen(false); navigation.navigate('POIList'); }}
          >
            <Icon name="history" size={18} color={C_ACT} style={{ marginRight: 8 }} />
            <Text style={styles.geminiConnectLabel}>
              ИСТОРИЯ {starredPOIs.length > 0 ? `(${starredPOIs.length})` : ''}
            </Text>
          </TouchableOpacity>

          {/* ── Сподели позиция ── */}
          {userCoords && (
            <TouchableOpacity
              style={styles.geminiConnectBtn}
              onPress={() => {
                setOptionsOpen(false);
                Share.share({
                  message: `Моята позиция (TruckAI): https://www.google.com/maps/?q=${userCoords[1]},${userCoords[0]}`,
                });
              }}
            >
              <Icon name="map-marker-radius" size={18} color={C_ACT} style={{ marginRight: 8 }} />
              <Text style={styles.geminiConnectLabel}>СПОДЕЛИ ПОЗИЦИЯ</Text>
            </TouchableOpacity>
          )}

          {/* ── DEV: симулация ── */}
          {route && (
            <>
              <View style={styles.optionsDivider} />
              <View style={styles.optionsRow}>
                <TouchableOpacity
                  style={[styles.optionBtn, simulating && styles.simBtnActive]}
                  onPress={() => { simulating ? stopSim() : startSim(); setOptionsOpen(false); }}
                >
                  <Icon name={simulating ? 'stop' : 'play'} size={ICON_SIZE} color={simulating ? C_RED : '#4CAF50'} />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.optionBtn, debugMode && styles.simBtnDebug]}
                  onPress={() => setDebugMode(v => !v)}
                >
                  <Icon name="bug" size={ICON_SIZE} color={debugMode ? '#FF9100' : C_OFF} />
                </TouchableOpacity>
                <Text style={styles.devRowLabel}>DEV</Text>
              </View>
            </>
          )}

          {/* ── Докладвай камера ── */}
          <View style={styles.optionsDivider} />
          <TouchableOpacity
            style={{
              width: '100%',
              borderRadius: 14,
              backgroundColor: '#D0021B',
              paddingVertical: 12,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
            onPress={() => { onReportCamera(); setOptionsOpen(false); }}
          >
            <Icon name="speed-camera" size={18} color="#FFFFFF" />
            <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '900' }}>
              ДОКЛАДВАЙ КАМЕРА
            </Text>
          </TouchableOpacity>

        </View>
      )}
    </View>
  );
});

export default OptionsPanel;
