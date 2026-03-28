/**
 * useTachoBluetooth — React hook за BLE тахограф
 *
 * Управлява целия lifecycle: scan → connect → live data → Gemini context
 * Използва TachoBleService под капака.
 *
 * Requires: npm install react-native-ble-plx
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Device } from 'react-native-ble-plx';
import { TachoBleService, TachoLiveData, BleStatus } from './TachoBleService';
import { BACKEND_URL } from '../../src/shared/constants/config';

export interface TachoBleState {
  status: BleStatus;
  statusMsg: string;
  liveData: TachoLiveData | null;
  foundDevices: Device[];
  isConnected: boolean;
}

export function useTachoBluetooth() {
  const serviceRef = useRef<TachoBleService | null>(null);

  const [state, setState] = useState<TachoBleState>({
    status: 'idle',
    statusMsg: 'Не е свързан',
    liveData: null,
    foundDevices: [],
    isConnected: false,
  });

  // ── Init BLE service once ──────────────────────────────────────────
  useEffect(() => {
    serviceRef.current = new TachoBleService();
    return () => {
      serviceRef.current?.destroy();
    };
  }, []);

  // ── Status callback ────────────────────────────────────────────────
  const handleStatus = useCallback((status: BleStatus, msg?: string) => {
    setState(prev => ({
      ...prev,
      status,
      statusMsg: msg ?? '',
      isConnected: status === 'connected',
    }));
  }, []);

  // ── Live data callback — update state + send to backend ───────────
  const handleData = useCallback((data: TachoLiveData) => {
    setState(prev => ({ ...prev, liveData: data }));

    // Push live context to backend → Gemini system prompt gets updated
    _sendToBackend(data).catch(() => {/* silent — не блокираме UI */});
  }, []);

  // ── Scan ──────────────────────────────────────────────────────────
  const startScan = useCallback(() => {
    if (!serviceRef.current) return;
    setState(prev => ({ ...prev, foundDevices: [] }));

    serviceRef.current.scanForTacho(
      (device) => {
        // Auto-connect when VDO device found
        setState(prev => ({ ...prev, foundDevices: [...prev.foundDevices, device] }));
        connectToDevice(device);
      },
      handleStatus,
    );
  }, [handleStatus]);

  // ── Connect ───────────────────────────────────────────────────────
  const connectToDevice = useCallback((device: Device) => {
    serviceRef.current?.connectToTacho(device, handleData, handleStatus);
  }, [handleData, handleStatus]);

  // ── Disconnect ────────────────────────────────────────────────────
  const disconnect = useCallback(() => {
    serviceRef.current?.disconnect();
    setState(prev => ({ ...prev, isConnected: false, liveData: null }));
  }, []);

  return {
    ...state,
    startScan,
    connectToDevice,
    disconnect,
  };
}

// ── Send live data to Flask backend ───────────────────────────────────
async function _sendToBackend(data: TachoLiveData): Promise<void> {
  await fetch(`${BACKEND_URL}/api/tacho/live_update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tacho_live_context: {
        current_activity: data.activity,
        activity_code: data.activityCode,
        driving_time_left_min: data.drivingTimeLeftMin,
        daily_driven_min: data.dailyDrivenMin,
        speed_kmh: data.speed,
        timestamp: data.timestamp,
      },
    }),
  });
}
