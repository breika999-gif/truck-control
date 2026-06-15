import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import Tts from 'react-native-tts';

import { spacing } from '../../../../shared/constants/theme';
import { isTablet, uiScale } from '../../../../shared/utils/screen';
import CallingPanel from '../../../calling/components/CallingPanel';
import ChatFABs from '../ChatFABs';
import RecenterButton from '../RecenterButton';
import SpeedCameraHUD from '../SpeedCameraHUD';
import TiltControls from '../TiltControls';
import type { Loose } from './types';

interface MapControlsOverlayProps {
  routeUiCollapsed: boolean;
  navigating: boolean;
  route: Loose;
  routeOptions: Loose[];
  navPhase: Loose;
  insets: Loose;
  mapPitch: number;
  setMapPitch: Loose;
  cameraRef: React.MutableRefObject<any>;
  geminiChatOpen: boolean;
  gptChatOpen: boolean;
  setGeminiChatOpen: Loose;
  setGptChatOpen: Loose;
  backendOnline: boolean;
  isTracking: boolean;
  setIsTracking: Loose;
  suppressPanUntilRef: React.MutableRefObject<number>;
  voiceMuted: boolean;
  setVoiceMuted: Loose;
  handleReportCamera: Loose;
  cameraAlert: Loose;
  cameraFlashAnim: Loose;
}

const MapControlsOverlay: React.FC<MapControlsOverlayProps> = ({
  routeUiCollapsed,
  navigating,
  route,
  routeOptions,
  navPhase,
  insets,
  mapPitch,
  setMapPitch,
  cameraRef,
  geminiChatOpen,
  gptChatOpen,
  setGeminiChatOpen,
  setGptChatOpen,
  backendOnline,
  isTracking,
  setIsTracking,
  suppressPanUntilRef,
  voiceMuted,
  setVoiceMuted,
  handleReportCamera,
  cameraAlert,
  cameraFlashAnim,
}) => {
  const [callingOpen, setCallingOpen] = React.useState(false);
  const tabletFabOffset = isTablet ? 20 * uiScale : 0;
  const previewOpen = routeOptions.length > 0 && navPhase === 'ROUTE_PREVIEW';

  const chatBottomOffset = previewOpen
    ? insets.bottom + spacing.xxl + tabletFabOffset
    : insets.bottom + spacing.xl + tabletFabOffset;

  const muteButtonStyle = React.useMemo(
    () => [
      styles.sideFab,
      styles.leftFab,
      {
        bottom: insets.bottom + 214 + tabletFabOffset,
        backgroundColor: voiceMuted ? 'rgba(255,80,80,0.85)' : 'rgba(0,0,0,0.6)',
      },
    ],
    [insets.bottom, tabletFabOffset, voiceMuted],
  );

  const callingButtonStyle = React.useMemo(
    () => [
      styles.sideFab,
      styles.leftFab,
      {
        bottom: insets.bottom + 160 + tabletFabOffset,
        backgroundColor: callingOpen ? 'rgba(76,175,80,0.85)' : 'rgba(0,0,0,0.6)',
      },
    ],
    [callingOpen, insets.bottom, tabletFabOffset],
  );

  const reportButtonStyle = React.useMemo(
    () => [
      styles.sideFab,
      styles.rightFab,
      styles.reportFab,
      { bottom: insets.bottom + 214 + tabletFabOffset },
    ],
    [insets.bottom, tabletFabOffset],
  );

  return (
    <>
      <SpeedCameraHUD
        visible={!routeUiCollapsed && navigating && !!cameraAlert}
        distM={cameraAlert?.dist ?? 0}
        bottomOffset={320 + insets.bottom}
        flashAnim={cameraFlashAnim}
      />

      <TiltControls
        visible={!navigating}
        mapPitch={mapPitch}
        bottomOffset={insets.bottom + 100}
        position="middleLeft"
        onTiltUp={() => {
          const next = Math.min(mapPitch + 15, 60);
          setMapPitch(next);
          cameraRef.current?.animateCamera({ pitch: next });
        }}
        onTiltDown={() => {
          const next = Math.max(mapPitch - 15, 0);
          setMapPitch(next);
          cameraRef.current?.animateCamera({ pitch: next });
        }}
      />

      <ChatFABs
        visible={!navigating && !previewOpen}
        backendOnline={backendOnline}
        geminiChatOpen={geminiChatOpen}
        gptChatOpen={gptChatOpen}
        bottomOffset={chatBottomOffset}
        onToggleGemini={() => {
          setGeminiChatOpen((v: boolean) => !v);
          setGptChatOpen(false);
        }}
        onToggleGPT={() => {
          setGptChatOpen((v: boolean) => !v);
          setGeminiChatOpen(false);
        }}
      />

      <RecenterButton
        visible={!routeUiCollapsed && navigating && !isTracking}
        bottomOffset={insets.bottom + 100}
        onPress={() => {
          suppressPanUntilRef.current = Date.now() + 1500;
          setIsTracking(true);
        }}
      />

      {!routeUiCollapsed && (
        <TouchableOpacity
          onPress={() => { setVoiceMuted((v: boolean) => !v); if (!voiceMuted) Tts.stop(); }}
          style={muteButtonStyle}
          activeOpacity={0.75}
        >
          <Text style={styles.fabIconText}>{voiceMuted ? '🔇' : '🔊'}</Text>
        </TouchableOpacity>
      )}

      {!routeUiCollapsed && (
        <TouchableOpacity
          onPress={() => setCallingOpen((open: boolean) => !open)}
          style={callingButtonStyle}
          activeOpacity={0.75}
        >
          <Text style={styles.fabIconText}>📞</Text>
        </TouchableOpacity>
      )}

      {!routeUiCollapsed && !!route && (
        <TouchableOpacity
          onPress={handleReportCamera}
          style={reportButtonStyle}
          activeOpacity={0.75}
        >
          <Text style={styles.fabIconText}>📷</Text>
        </TouchableOpacity>
      )}

      {!routeUiCollapsed && <CallingPanel visible={callingOpen} onClose={() => setCallingOpen(false)} />}
    </>
  );
};

const styles = StyleSheet.create({
  sideFab: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leftFab: {
    left: 14,
  },
  rightFab: {
    right: 14,
  },
  reportFab: {
    backgroundColor: 'rgba(192,2,26,0.85)',
    elevation: 5,
  },
  fabIconText: {
    fontSize: 20,
  },
});

export default MapControlsOverlay;
