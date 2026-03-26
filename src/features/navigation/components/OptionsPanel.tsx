import React, { memo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Share,
} from 'react-native';
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
  return (
    <View style={[styles.optionsContainer, { top: searchTop }]}>
      <TouchableOpacity
        style={styles.mapBtn}
        onPress={() => setOptionsOpen(v => !v)}
      >
        <Text style={styles.mapBtnText}>{optionsOpen ? '✕' : '⚙️'}</Text>
      </TouchableOpacity>

      {optionsOpen && (
        <View style={styles.optionsPanel}>
          <View style={styles.optionsRow}>
            <TouchableOpacity
              style={styles.optionBtn}
              onPress={() => { navigation.navigate('VehicleProfile'); setOptionsOpen(false); }}
            >
              <Text style={styles.mapBtnText}>🚚</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.optionBtn, !showTraffic && styles.optionBtnOff]}
              onPress={() => setShowTraffic(v => !v)}
            >
              <Text style={styles.mapBtnText}>🚦</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.optionBtn, !showRestrictions && styles.optionBtnOff]}
              onPress={() => setShowRestrictions(v => !v)}
            >
              <Text style={styles.mapBtnText}>🚧</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.optionBtn, !showStarredLayer && styles.optionBtnOff]}
              onPress={() => setShowStarredLayer(v => !v)}
            >
              <Text style={styles.mapBtnText}>⭐</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.optionsDivider} />

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
              <Text style={styles.mapBtnText}>
                {mapMode === 'vector' ? '🌍' : mapMode === 'hybrid' ? '🌐' : '🛰️'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.optionBtn, !showIncidents && styles.optionBtnOff]}
              onPress={() => setShowIncidents(v => !v)}
            >
              <Text style={styles.mapBtnText}>⚠️</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.optionBtn, !showContours && styles.optionBtnOff]}
              onPress={() => setShowContours(v => !v)}
            >
              <Text style={styles.mapBtnText}>🗻</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.optionsDivider} />

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
              <Text style={styles.mapBtnText}>🛂</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.optionBtn, voiceMuted && styles.optionBtnOff]}
              onPress={() => { setVoiceMuted(v => !v); if (!voiceMuted) Tts.stop(); }}
            >
              <Text style={styles.mapBtnText}>{voiceMuted ? '🔇' : '🔊'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.optionBtn}
              onPress={() => { setLightMode(v => !v); if (!navigating) setMapIsLoaded(false); }}
            >
              <Text style={styles.mapBtnText}>{lightMode ? '🌙' : '☀️'}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.optionsDivider} />

          {navigating && (
            <>
              <View style={[styles.optionsRow, { justifyContent: 'flex-start' }]}>
                <TouchableOpacity
                  style={[styles.optionBtn, isSearchingAlongRoute && { borderColor: '#fff' }]}
                  onPress={() => { setOptionsOpen(false); handleSearchAlongRoute(); }}
                  disabled={isSearchingAlongRoute}
                >
                  <Text style={styles.mapBtnText}>{isSearchingAlongRoute ? '⌛' : '🛰️'}</Text>
                </TouchableOpacity>
                <Text style={styles.devRowLabel}>ПО ПЪТЯ</Text>
              </View>
              <View style={styles.optionsDivider} />
            </>
          )}

          <View style={[styles.optionsRow, { justifyContent: 'flex-start' }]}>
            <TouchableOpacity
              style={[styles.optionBtn, !avoidUnpaved && styles.optionBtnOff, avoidUnpaved && styles.optionBtnActive]}
              onPress={() => setAvoidUnpaved(v => !v)}
            >
              <Text style={styles.mapBtnText}>{'🛤️'}</Text>
            </TouchableOpacity>
            <Text style={styles.devRowLabel}>АСФАЛТ</Text>
          </View>

          <View style={styles.optionsDivider} />

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

          <TouchableOpacity
            style={styles.geminiConnectBtn}
            onPress={() => {
              setOptionsOpen(false);
              navigation.navigate('POIList');
            }}
          >
            <Text style={styles.geminiConnectEmoji}>📜</Text>
            <Text style={styles.geminiConnectLabel}>
              ИСТОРИЯ {starredPOIs.length > 0 ? `(${starredPOIs.length})` : ''}
            </Text>
          </TouchableOpacity>

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
              <Text style={styles.geminiConnectEmoji}>📌</Text>
              <Text style={styles.geminiConnectLabel}>СПОДЕЛИ ПОЗИЦИЯ</Text>
            </TouchableOpacity>
          )}

          {route && (
            <>
              <View style={styles.optionsDivider} />
              <View style={styles.optionsRow}>
                <TouchableOpacity
                  style={[styles.optionBtn, simulating && styles.simBtnActive]}
                  onPress={() => { simulating ? stopSim() : startSim(); setOptionsOpen(false); }}
                >
                  <Text style={styles.mapBtnText}>{simulating ? '⏹' : '▶'}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.optionBtn, debugMode && styles.simBtnDebug]}
                  onPress={() => setDebugMode(v => !v)}
                >
                  <Text style={styles.mapBtnText}>🐛</Text>
                </TouchableOpacity>
                <Text style={styles.devRowLabel}>DEV</Text>
              </View>
            </>
          )}

          <View style={styles.optionsDivider} />
          <TouchableOpacity
            style={{
              width: '100%',
              borderRadius: 14,
              backgroundColor: '#D0021B',
              paddingVertical: 12,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onPress={() => { onReportCamera(); setOptionsOpen(false); }}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '900' }}>
              {'📷 ДОКЛАДВАЙ КАМЕРА'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
});

export default OptionsPanel;
