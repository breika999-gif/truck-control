import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';

import type { AppIntent } from '../../../shared/services/backendApi';
import type { MapHandlers } from '../screens/useMapHandlers';
import { useWakeWord } from './useWakeWord';

interface UseMapAlertsArgs {
  mapHandlersRef: MutableRefObject<MapHandlers | null>;
  navigating: boolean;
}

export function useMapAlerts({ mapHandlersRef, navigating }: UseMapAlertsArgs) {
  const [borderCrossings, setBorderCrossings] = useState<Array<{
    name: string;
    flag: string;
    status: string;
    url: string;
  }>>([]);
  const [showBorderPanel, setShowBorderPanel] = useState(false);
  const [longPressCoord, setLongPressCoord] = useState<[number, number] | null>(null);
  const [wakeWordHeard, setWakeWordHeard] = useState(false);
  const wakeWordFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onEndOfDay = useCallback(async () => {
    await mapHandlersRef.current?.handleEndOfDay();
  }, [mapHandlersRef]);
  const onAppIntent = useCallback((intent: AppIntent) => {
    mapHandlersRef.current?.handleAppIntent(intent);
  }, [mapHandlersRef]);
  const onWakeCommand = useCallback((cmd: string) => {
    mapHandlersRef.current?.handleWakeCommand(cmd);
  }, [mapHandlersRef]);

  useEffect(() => () => {
    if (wakeWordFlashTimerRef.current) clearTimeout(wakeWordFlashTimerRef.current);
  }, []);
  useWakeWord({ active: navigating, onCommand: onWakeCommand });

  return {
    borderCrossings,
    longPressCoord,
    onAppIntent,
    onEndOfDay,
    setBorderCrossings,
    setLongPressCoord,
    setShowBorderPanel,
    setWakeWordHeard,
    showBorderPanel,
    wakeWordFlashTimerRef,
    wakeWordHeard,
  };
}
