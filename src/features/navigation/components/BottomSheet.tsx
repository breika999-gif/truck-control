import React, { useRef, useCallback, useEffect } from 'react';
import {
  View,
  Animated,
  PanResponder,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
} from 'react-native';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const HANDLE_H = 48;

interface BottomSheetProps {
  children: React.ReactNode;
  visible: boolean;
  snapHeight: number; // expanded height
  onClose?: () => void;
}

const BottomSheet: React.FC<BottomSheetProps> = ({
  children,
  visible,
  snapHeight,
  onClose,
}) => {
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const expandedRef = useRef(false);

  const snapTo = useCallback((expanded: boolean) => {
    const collapsedValue = snapHeight - HANDLE_H;
    Animated.spring(translateY, {
      toValue: expanded ? 0 : collapsedValue,
      useNativeDriver: true,
      damping: 22,
      stiffness: 220,
    }).start();
    expandedRef.current = expanded;
  }, [snapHeight, translateY]);

  useEffect(() => {
    if (visible) {
      // Initial animation from bottom
      translateY.setValue(snapHeight);
      snapTo(false); // start collapsed
    } else {
      Animated.timing(translateY, {
        toValue: SCREEN_HEIGHT,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, snapHeight, snapTo, translateY]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dy) > 8 && Math.abs(gs.dy) > Math.abs(gs.dx),
      onPanResponderMove: (_, gs) => {
        const base = expandedRef.current ? 0 : snapHeight - HANDLE_H;
        const next = Math.max(0, Math.min(snapHeight - HANDLE_H, base + gs.dy));
        translateY.setValue(next);
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.vy < -0.3 || gs.dy < -40) {
          snapTo(true);
        } else if (gs.vy > 0.3 || gs.dy > 40) {
          snapTo(false);
        } else {
          snapTo(expandedRef.current);
        }
      },
    })
  ).current;

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        { height: snapHeight, transform: [{ translateY }] },
      ]}
    >
      {/* Handle / Pan Area */}
      <View {...panResponder.panHandlers} style={styles.handleArea}>
        <View style={styles.handle} />
      </View>

      {/* Content */}
      <View style={styles.content}>
        {children}
      </View>

      {/* Close button (optional, for explicit close) */}
      {onClose && (
        <TouchableOpacity style={styles.closeBtn} onPress={onClose} />
      )}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(10, 12, 28, 0.95)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    overflow: 'hidden',
    zIndex: 1000,
  },
  handleArea: {
    width: '100%',
    height: HANDLE_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  content: {
    flex: 1,
  },
  closeBtn: {
    position: 'absolute',
    top: 12,
    right: 16,
    width: 24,
    height: 24,
  },
});

export default BottomSheet;
