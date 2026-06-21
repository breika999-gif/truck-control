import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Dimensions,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
} from 'react-native';
import type { PanResponderGestureState } from 'react-native';
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

const SIDE_FAB_SIZE = 44;
const SIDE_FAB_LEFT = 14;
const SIDE_FAB_EDGE_PAD = 8;
const SIDE_FAB_TOP_LIMIT = 82;
const FAB_POSITIONS_KEY = '@truckai/map_side_fab_positions_v1';

type DraggableFabKey = 'mute' | 'calling';
type FabOffset = { x: number; y: number };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isFabOffset(value: unknown): value is FabOffset {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<FabOffset>;
  return (
    typeof candidate.x === 'number' &&
    Number.isFinite(candidate.x) &&
    typeof candidate.y === 'number' &&
    Number.isFinite(candidate.y)
  );
}

function clampFabOffset(offset: FabOffset, baseBottom: number, insetBottom: number): FabOffset {
  const { width, height } = Dimensions.get('window');
  const maxLeft = Math.max(SIDE_FAB_EDGE_PAD, width - SIDE_FAB_SIZE - SIDE_FAB_EDGE_PAD);
  const maxTop = Math.max(SIDE_FAB_TOP_LIMIT, height - SIDE_FAB_SIZE - Math.max(SIDE_FAB_EDGE_PAD, insetBottom + SIDE_FAB_EDGE_PAD));
  const baseTop = height - baseBottom - SIDE_FAB_SIZE;
  const left = clamp(SIDE_FAB_LEFT + offset.x, SIDE_FAB_EDGE_PAD, maxLeft);
  const top = clamp(baseTop + offset.y, SIDE_FAB_TOP_LIMIT, maxTop);
  return {
    x: Math.round(left - SIDE_FAB_LEFT),
    y: Math.round(top - baseTop),
  };
}

function useDraggableSideFab(key: DraggableFabKey, baseBottom: number, insetBottom: number) {
  const [offset, setOffset] = React.useState<FabOffset>({ x: 0, y: 0 });
  const offsetRef = React.useRef(offset);
  const dragStartRef = React.useRef(offset);
  const dragEnabledRef = React.useRef(false);
  const panActiveRef = React.useRef(false);
  const ignorePressRef = React.useRef(false);

  React.useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  React.useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(FAB_POSITIONS_KEY)
      .then(raw => {
        if (!raw || !mounted) return;
        const parsed = JSON.parse(raw) as Partial<Record<DraggableFabKey, unknown>>;
        const saved = parsed[key];
        if (isFabOffset(saved)) {
          setOffset(clampFabOffset(saved, baseBottom, insetBottom));
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [baseBottom, insetBottom, key]);

  const saveOffset = React.useCallback(async (next: FabOffset) => {
    try {
      const raw = await AsyncStorage.getItem(FAB_POSITIONS_KEY);
      const parsed = raw
        ? JSON.parse(raw) as Partial<Record<DraggableFabKey, FabOffset>>
        : {};
      parsed[key] = next;
      await AsyncStorage.setItem(FAB_POSITIONS_KEY, JSON.stringify(parsed));
    } catch {
      // Drag position is convenience state; ignore storage failures.
    }
  }, [key]);

  const finishDrag = React.useCallback((persist = false) => {
    dragEnabledRef.current = false;
    panActiveRef.current = false;
    if (persist) {
      void saveOffset(offsetRef.current);
    }
  }, [saveOffset]);

  const panResponder = React.useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture: PanResponderGestureState) => (
      dragEnabledRef.current &&
      (Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2)
    ),
    onPanResponderGrant: () => {
      panActiveRef.current = true;
      dragStartRef.current = offsetRef.current;
    },
    onPanResponderMove: (_event, gesture: PanResponderGestureState) => {
      if (!dragEnabledRef.current) return;
      const next = clampFabOffset({
        x: dragStartRef.current.x + gesture.dx,
        y: dragStartRef.current.y + gesture.dy,
      }, baseBottom, insetBottom);
      offsetRef.current = next;
      setOffset(next);
    },
    onPanResponderRelease: () => finishDrag(true),
    onPanResponderTerminate: () => finishDrag(true),
  }), [baseBottom, finishDrag, insetBottom]);

  const onLongPress = React.useCallback(() => {
    dragEnabledRef.current = true;
    ignorePressRef.current = true;
    dragStartRef.current = offsetRef.current;
  }, []);

  const onPressOut = React.useCallback(() => {
    if (panActiveRef.current) return;
    finishDrag(false);
    if (ignorePressRef.current) {
      setTimeout(() => {
        ignorePressRef.current = false;
      }, 160);
    }
  }, [finishDrag]);

  const shouldIgnorePress = React.useCallback(() => {
    if (!ignorePressRef.current) return false;
    ignorePressRef.current = false;
    return true;
  }, []);

  return {
    offset,
    panHandlers: panResponder.panHandlers,
    onLongPress,
    onPressOut,
    shouldIgnorePress,
  };
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
  const [cameraZoomed, setCameraZoomed] = React.useState(false);
  const zoomTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const tabletFabOffset = isTablet ? 20 * uiScale : 0;
  const previewOpen = routeOptions.length > 0 && navPhase === 'ROUTE_PREVIEW';
  const insetBottom = Number(insets?.bottom ?? 0);
  const muteBaseBottom = insetBottom + 314 + tabletFabOffset;
  const callingBaseBottom = insetBottom + 260 + tabletFabOffset;
  const muteDrag = useDraggableSideFab('mute', muteBaseBottom, insetBottom);
  const callingDrag = useDraggableSideFab('calling', callingBaseBottom, insetBottom);

  const chatBottomOffset = previewOpen
    ? insets.bottom + spacing.xxl + tabletFabOffset
    : insets.bottom + spacing.xl + tabletFabOffset;

  const muteButtonStyle = React.useMemo(
    () => [
      styles.sideFab,
      styles.leftFab,
      {
        bottom: muteBaseBottom,
        backgroundColor: voiceMuted ? 'rgba(255,80,80,0.85)' : 'rgba(0,0,0,0.6)',
        transform: [
          { translateX: muteDrag.offset.x },
          { translateY: muteDrag.offset.y },
        ],
      },
    ],
    [muteBaseBottom, muteDrag.offset.x, muteDrag.offset.y, voiceMuted],
  );

  const callingButtonStyle = React.useMemo(
    () => [
      styles.sideFab,
      styles.leftFab,
      {
        bottom: callingBaseBottom,
        backgroundColor: callingOpen ? 'rgba(76,175,80,0.85)' : 'rgba(0,0,0,0.6)',
        transform: [
          { translateX: callingDrag.offset.x },
          { translateY: callingDrag.offset.y },
        ],
      },
    ],
    [callingBaseBottom, callingDrag.offset.x, callingDrag.offset.y, callingOpen],
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

  const handleCameraZoom = React.useCallback(() => {
    if (cameraAlert?.lat == null || cameraAlert?.lng == null) return;
    if (cameraZoomed) return;
    cameraRef.current?.animateCamera(
      { centerCoordinate: [cameraAlert.lng, cameraAlert.lat], zoomLevel: 17, pitch: 0 },
      { duration: 800 },
    );
    setCameraZoomed(true);
    if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current);
    zoomTimerRef.current = setTimeout(() => {
      cameraRef.current?.animateCamera(
        { zoomLevel: 15, pitch: 45 },
        { duration: 800 },
      );
      setCameraZoomed(false);
    }, 3000);
  }, [cameraAlert, cameraRef, cameraZoomed]);

  React.useEffect(() => () => {
    if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current);
  }, []);

  return (
    <>
      <SpeedCameraHUD
        visible={!routeUiCollapsed && navigating && !!cameraAlert}
        distM={cameraAlert?.dist ?? 0}
        bottomOffset={320 + insets.bottom}
        flashAnim={cameraFlashAnim}
        onZoom={handleCameraZoom}
        isZoomed={cameraZoomed}
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
          onPress={() => {
            if (muteDrag.shouldIgnorePress()) return;
            setVoiceMuted((v: boolean) => !v);
            if (!voiceMuted) Tts.stop();
          }}
          onLongPress={muteDrag.onLongPress}
          onPressOut={muteDrag.onPressOut}
          style={muteButtonStyle}
          activeOpacity={0.75}
          delayLongPress={260}
          {...muteDrag.panHandlers}
        >
          <Text style={styles.fabIconText}>{voiceMuted ? '🔇' : '🔊'}</Text>
        </TouchableOpacity>
      )}

      {!routeUiCollapsed && (
        <TouchableOpacity
          onPress={() => {
            if (callingDrag.shouldIgnorePress()) return;
            setCallingOpen((open: boolean) => !open);
          }}
          onLongPress={callingDrag.onLongPress}
          onPressOut={callingDrag.onPressOut}
          style={callingButtonStyle}
          activeOpacity={0.75}
          delayLongPress={260}
          {...callingDrag.panHandlers}
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
    zIndex: 70,
    elevation: 30,
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
