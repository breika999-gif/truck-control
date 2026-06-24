import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Dimensions,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { PanResponderGestureState } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Tts from 'react-native-tts';

import { spacing } from '../../../../shared/constants/theme';
import { isTablet, uiScale } from '../../../../shared/utils/screen';
import CallingPanel from '../../../calling/components/CallingPanel';
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
const CHAT_FAB_SIZE = 56;
const SIDE_FAB_LEFT = 14;
const SIDE_FAB_EDGE_PAD = 8;
const SIDE_FAB_TOP_LIMIT = 82;
const FAB_POSITIONS_KEY = '@truckai/map_side_fab_positions_v2';
const CHAT_FAB_POSITIONS_KEY = '@truckai/chat_fab_positions_v1';

type DraggableFabKey = 'mute' | 'calling';
type ChatFabKey = 'gemini' | 'gpt';
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

function useDraggableSideFab(
  key: DraggableFabKey,
  baseBottom: number,
  insetBottom: number,
  onTap: () => void,
) {
  const [offset, setOffset] = React.useState<FabOffset>({ x: 0, y: 0 });
  const offsetRef = React.useRef(offset);
  const dragStartRef = React.useRef(offset);
  const longPressTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragEnabledRef = React.useRef(false);
  const movedRef = React.useRef(false);
  const longPressedRef = React.useRef(false);

  React.useEffect(() => { offsetRef.current = offset; }, [offset]);

  React.useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(FAB_POSITIONS_KEY)
      .then(raw => {
        if (!raw || !mounted) return;
        const parsed = JSON.parse(raw) as Partial<Record<DraggableFabKey, unknown>>;
        const saved = parsed[key];
        if (isFabOffset(saved)) setOffset(clampFabOffset(saved, baseBottom, insetBottom));
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, [baseBottom, insetBottom, key]);

  const saveOffset = React.useCallback(async (next: FabOffset) => {
    try {
      const raw = await AsyncStorage.getItem(FAB_POSITIONS_KEY);
      const parsed = raw ? JSON.parse(raw) as Partial<Record<DraggableFabKey, FabOffset>> : {};
      parsed[key] = next;
      await AsyncStorage.setItem(FAB_POSITIONS_KEY, JSON.stringify(parsed));
    } catch {}
  }, [key]);

  const clearLongPressTimer = React.useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const finishDrag = React.useCallback((persist = false) => {
    clearLongPressTimer();
    dragEnabledRef.current = false;
    movedRef.current = false;
    longPressedRef.current = false;
    if (persist) void saveOffset(offsetRef.current);
  }, [clearLongPressTimer, saveOffset]);

  const panResponder = React.useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      dragStartRef.current = offsetRef.current;
      movedRef.current = false;
      longPressedRef.current = false;
      dragEnabledRef.current = false;
      clearLongPressTimer();
      longPressTimerRef.current = setTimeout(() => {
        longPressedRef.current = true;
        dragEnabledRef.current = true;
        dragStartRef.current = offsetRef.current;
      }, 280);
    },
    onPanResponderMove: (_e, g: PanResponderGestureState) => {
      if (!dragEnabledRef.current) {
        if (Math.abs(g.dx) > 12 || Math.abs(g.dy) > 12) {
          clearLongPressTimer();
          movedRef.current = true;
        }
        return;
      }
      if (Math.abs(g.dx) > 1 || Math.abs(g.dy) > 1) movedRef.current = true;
      const next = clampFabOffset({ x: dragStartRef.current.x + g.dx, y: dragStartRef.current.y + g.dy }, baseBottom, insetBottom);
      offsetRef.current = next;
      setOffset(next);
    },
    onPanResponderRelease: () => {
      const wasDrag = dragEnabledRef.current && movedRef.current;
      const wasTap = !longPressedRef.current && !movedRef.current;
      if (wasTap) onTap();
      finishDrag(wasDrag);
    },
    onPanResponderTerminate: () => finishDrag(dragEnabledRef.current && movedRef.current),
  }), [baseBottom, clearLongPressTimer, finishDrag, insetBottom, onTap]);

  React.useEffect(() => () => clearLongPressTimer(), [clearLongPressTimer]);

  return { offset, panHandlers: panResponder.panHandlers };
}

function clampChatFabOffset(
  offset: FabOffset,
  baseBottom: number,
  isRight: boolean,
  insetBottom: number,
): FabOffset {
  const { width, height } = Dimensions.get('window');
  const baseLeft = isRight
    ? width - CHAT_FAB_SIZE - SIDE_FAB_LEFT
    : SIDE_FAB_LEFT;
  const newLeft = clamp(baseLeft + offset.x, SIDE_FAB_EDGE_PAD, width - CHAT_FAB_SIZE - SIDE_FAB_EDGE_PAD);
  const baseTop = height - baseBottom - CHAT_FAB_SIZE;
  const newTop = clamp(baseTop + offset.y, SIDE_FAB_TOP_LIMIT, height - CHAT_FAB_SIZE - Math.max(SIDE_FAB_EDGE_PAD, insetBottom + SIDE_FAB_EDGE_PAD));
  return {
    x: Math.round(newLeft - baseLeft),
    y: Math.round(newTop - baseTop),
  };
}

function useDraggableChatFab(
  key: ChatFabKey,
  baseBottom: number,
  isRight: boolean,
  insetBottom: number,
  onTap: () => void,
) {
  const [offset, setOffset] = React.useState<FabOffset>({ x: 0, y: 0 });
  const offsetRef = React.useRef(offset);
  const dragStartRef = React.useRef(offset);
  const longPressTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragEnabledRef = React.useRef(false);
  const movedRef = React.useRef(false);
  const longPressedRef = React.useRef(false);

  React.useEffect(() => { offsetRef.current = offset; }, [offset]);

  React.useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(CHAT_FAB_POSITIONS_KEY)
      .then(raw => {
        if (!raw || !mounted) return;
        const parsed = JSON.parse(raw) as Partial<Record<ChatFabKey, unknown>>;
        const saved = parsed[key];
        if (isFabOffset(saved)) setOffset(clampChatFabOffset(saved, baseBottom, isRight, insetBottom));
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, [baseBottom, insetBottom, isRight, key]);

  const saveOffset = React.useCallback(async (next: FabOffset) => {
    try {
      const raw = await AsyncStorage.getItem(CHAT_FAB_POSITIONS_KEY);
      const parsed = raw ? JSON.parse(raw) as Partial<Record<ChatFabKey, FabOffset>> : {};
      parsed[key] = next;
      await AsyncStorage.setItem(CHAT_FAB_POSITIONS_KEY, JSON.stringify(parsed));
    } catch {}
  }, [key]);

  const clearLongPressTimer = React.useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const finishDrag = React.useCallback((persist = false) => {
    clearLongPressTimer();
    dragEnabledRef.current = false;
    movedRef.current = false;
    longPressedRef.current = false;
    if (persist) void saveOffset(offsetRef.current);
  }, [clearLongPressTimer, saveOffset]);

  const panResponder = React.useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      dragStartRef.current = offsetRef.current;
      movedRef.current = false;
      longPressedRef.current = false;
      dragEnabledRef.current = false;
      clearLongPressTimer();
      longPressTimerRef.current = setTimeout(() => {
        longPressedRef.current = true;
        dragEnabledRef.current = true;
        dragStartRef.current = offsetRef.current;
      }, 280);
    },
    onPanResponderMove: (_e, g: PanResponderGestureState) => {
      if (!dragEnabledRef.current) {
        if (Math.abs(g.dx) > 12 || Math.abs(g.dy) > 12) {
          clearLongPressTimer();
          movedRef.current = true;
        }
        return;
      }
      if (Math.abs(g.dx) > 1 || Math.abs(g.dy) > 1) movedRef.current = true;
      const next = clampChatFabOffset({ x: dragStartRef.current.x + g.dx, y: dragStartRef.current.y + g.dy }, baseBottom, isRight, insetBottom);
      offsetRef.current = next;
      setOffset(next);
    },
    onPanResponderRelease: () => {
      const wasDrag = dragEnabledRef.current && movedRef.current;
      const wasTap = !longPressedRef.current && !movedRef.current;
      if (wasTap) onTap();
      finishDrag(wasDrag);
    },
    onPanResponderTerminate: () => finishDrag(dragEnabledRef.current && movedRef.current),
  }), [baseBottom, clearLongPressTimer, finishDrag, insetBottom, isRight, onTap]);

  React.useEffect(() => () => clearLongPressTimer(), [clearLongPressTimer]);

  return { offset, panHandlers: panResponder.panHandlers };
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
  const muteBaseBottom = insetBottom + 344 + tabletFabOffset;
  const callingBaseBottom = insetBottom + 264 + tabletFabOffset;
  const handleMuteTap = React.useCallback(() => {
    setVoiceMuted((v: boolean) => !v);
    if (!voiceMuted) Tts.stop();
  }, [setVoiceMuted, voiceMuted]);

  const handleCallingTap = React.useCallback(() => {
    setCallingOpen((open: boolean) => !open);
  }, []);

  const muteDrag = useDraggableSideFab('mute', muteBaseBottom, insetBottom, handleMuteTap);
  const callingDrag = useDraggableSideFab('calling', callingBaseBottom, insetBottom, handleCallingTap);

  const chatBottomOffset = previewOpen
    ? insets.bottom + spacing.xxl + tabletFabOffset
    : insets.bottom + spacing.xl + tabletFabOffset;

  const handleGeminiTap = React.useCallback(() => {
    setGeminiChatOpen((v: boolean) => !v);
    setGptChatOpen(false);
  }, [setGeminiChatOpen, setGptChatOpen]);

  const handleGptTap = React.useCallback(() => {
    setGptChatOpen((v: boolean) => !v);
    setGeminiChatOpen(false);
  }, [setGeminiChatOpen, setGptChatOpen]);

  const geminiDrag = useDraggableChatFab('gemini', chatBottomOffset, false, insetBottom, handleGeminiTap);
  const gptDrag    = useDraggableChatFab('gpt',    chatBottomOffset, true,  insetBottom, handleGptTap);

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

      {!navigating && !previewOpen && (() => {
        const { width: sw } = Dimensions.get('window');
        const gLeft = spacing.md + geminiDrag.offset.x;
        const gBot  = chatBottomOffset - geminiDrag.offset.y;
        const pLeft = sw - CHAT_FAB_SIZE - spacing.md + gptDrag.offset.x;
        const pBot  = chatBottomOffset - gptDrag.offset.y;
        return (
          <>
            <View
              style={[styles.chatFab, { left: gLeft, bottom: gBot }, backendOnline ? styles.chatFabOnline : styles.chatFabOffline]}
              {...geminiDrag.panHandlers}
            >
              <Icon name={geminiChatOpen ? 'close' : 'message-processing-outline'} size={27} color="#FFFFFF" />
              <View style={[styles.chatDot, backendOnline ? styles.chatDotGreen : styles.chatDotGrey]} />
            </View>

            <View
              style={[styles.chatFab, { left: pLeft, bottom: pBot }, backendOnline ? styles.chatFabOnline : styles.chatFabOffline]}
              {...gptDrag.panHandlers}
            >
              <Icon name={gptChatOpen ? 'close' : 'navigation-variant-outline'} size={27} color="#FFFFFF" />
              <View style={[styles.chatDot, backendOnline ? styles.chatDotGreen : styles.chatDotGrey]} />
            </View>
          </>
        );
      })()}

      <RecenterButton
        visible={!routeUiCollapsed && navigating && !isTracking}
        bottomOffset={insets.bottom + 100}
        onPress={() => {
          suppressPanUntilRef.current = Date.now() + 1500;
          setIsTracking(true);
        }}
      />

      {!routeUiCollapsed && (
        <View
          style={muteButtonStyle}
          {...muteDrag.panHandlers}
        >
          <Text style={styles.fabIconText}>{voiceMuted ? '🔇' : '🔊'}</Text>
        </View>
      )}

      {!routeUiCollapsed && (
        <View
          style={callingButtonStyle}
          {...callingDrag.panHandlers}
        >
          <Text style={styles.fabIconText}>📞</Text>
        </View>
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
  chatFab: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 12,
    zIndex: 60,
    borderWidth: 1.5,
  },
  chatFabOnline: {
    backgroundColor: 'rgba(0,247,255,0.15)',
    borderColor: '#00f7ff',
    shadowColor: '#00f7ff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.85,
    shadowRadius: 8,
  },
  chatFabOffline: {
    backgroundColor: 'rgba(22,33,62,0.92)',
    borderColor: '#2a2a4a',
  },
  chatDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#1a1a2e',
  },
  chatDotGreen: { backgroundColor: '#22c55e' },
  chatDotGrey:  { backgroundColor: '#666688' },
});

export default MapControlsOverlay;
