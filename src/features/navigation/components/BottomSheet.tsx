import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  Animated,
  PanResponder,
  StyleSheet,
  Dimensions,
  Keyboard,
} from 'react-native';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const HANDLE_H = 48;

interface BottomSheetProps {
  children: React.ReactNode;
  visible: boolean;
  snapHeight: number;
  initialHeight?: number;
  kbHeight?: number; // Pass from parent for better sync
  onClose?: () => void;
}

const BottomSheet: React.FC<BottomSheetProps> = ({
  children,
  visible,
  snapHeight,
  initialHeight,
  kbHeight = 0,
  onClose,
}) => {
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const bottomOffset = useRef(new Animated.Value(0)).current;
  
  // Dynamic maxHeight to stay within screen when keyboard is up
  const maxHeight = SCREEN_HEIGHT * 0.85;
  const availableHeight = SCREEN_HEIGHT - (kbHeight > 0 ? kbHeight + 60 : 80);
  const actualMaxHeight = Math.min(maxHeight, availableHeight);

  const [currentHeight, setCurrentHeight] = useState(Math.min(initialHeight ?? snapHeight, actualMaxHeight));
  const dragStartHeightRef = useRef(currentHeight);

  // Sync bottomOffset with kbHeight from props
  useEffect(() => {
    // Instant adjustment for a snappier feel
    Animated.timing(bottomOffset, {
      toValue: kbHeight > 0 ? kbHeight : 0,
      duration: 150,
      useNativeDriver: false,
    }).start();

    // If keyboard is up, ensure we don't exceed available screen space
    if (kbHeight > 0) {
      const targetHeight = Math.min(currentHeight, actualMaxHeight);
      if (currentHeight > actualMaxHeight) {
        setCurrentHeight(targetHeight);
      }
    }
  }, [kbHeight, bottomOffset, actualMaxHeight, currentHeight]);

  const prevVisibleRef = useRef(visible);
  useEffect(() => {
    const wasVisible = prevVisibleRef.current;
    prevVisibleRef.current = visible;

    if (visible) {
      const nextHeight = Math.min(initialHeight ?? snapHeight, actualMaxHeight);
      setCurrentHeight(nextHeight);
      dragStartHeightRef.current = nextHeight;
      translateY.setValue(SCREEN_HEIGHT);
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 22,
        stiffness: 220,
      }).start();
    } else {
      // Only dismiss keyboard when sheet is actually closing (true → false)
      if (wasVisible) Keyboard.dismiss();
      Animated.timing(translateY, {
        toValue: SCREEN_HEIGHT,
        duration: 220,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, translateY, initialHeight, snapHeight, actualMaxHeight]);

  const currentHeightRef = useRef(currentHeight);
  useEffect(() => { currentHeightRef.current = currentHeight; }, [currentHeight]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dy) > 8 && Math.abs(gs.dy) > Math.abs(gs.dx),
      onPanResponderGrant: () => {
        dragStartHeightRef.current = currentHeightRef.current;
      },
      onPanResponderMove: (_, gs) => {
        const nextHeight = Math.min(actualMaxHeight, Math.max(120, dragStartHeightRef.current - gs.dy));
        setCurrentHeight(nextHeight);
      },
      onPanResponderRelease: (_, gs) => {
        const releasedHeight = dragStartHeightRef.current - gs.dy;
        if ((gs.dy > 80 && releasedHeight <= 180) || releasedHeight < 180) {
          onClose?.();
          return;
        }

        setCurrentHeight(Math.min(actualMaxHeight, Math.max(180, releasedHeight)));
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          damping: 22,
          stiffness: 220,
        }).start();
      },
    })
  ).current;

  if (!visible) return null;

  return (
    <Animated.View style={[styles.outer, { bottom: bottomOffset }]}>
      <Animated.View
        style={[styles.container, { height: currentHeight, transform: [{ translateY }] }]}
      >
        <View {...panResponder.panHandlers} style={styles.handleArea}>
          <View style={styles.handle} />
        </View>

        <View style={styles.content}>
          {children}
        </View>
      </Animated.View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  outer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
    elevation: 20,
  },
  container: {
    backgroundColor: 'rgba(10, 12, 28, 0.95)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
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
});

export default BottomSheet;
