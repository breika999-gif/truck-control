/**
 * useTachoBluetooth — shared BLE tachograph runtime.
 *
 * Keeps the BLE connection alive across screen unmounts so the rest of the app
 * and Gemini can keep using the latest tachograph state.
 */

import { useEffect, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Device } from 'react-native-ble-plx';
import { TachoBleService, TachoLiveData, BleStatus, Se5000RawPacket } from '../TachoBleService';
import { logEvent, cleanup, ActivityCode } from '../TachoEventLog';
import { BACKEND_URL } from '../../../shared/constants/config';
import { HOS_CONTINUOUS_DRIVE_LIMIT_S } from '../../../shared/constants/hosRules';
import { loadSavedAccount } from '../../../shared/services/accountManager';
import { getBackendAuthHeaders } from '../../../shared/services/backendApi';
import i18n from '../../../i18n';

async function requestBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const granted = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  ]);
  return (
    granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED &&
    granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED
  );
}

export interface TachoBleState {
  status: BleStatus;
  statusMsg: string;
  liveData: TachoLiveData | null;
  rawPackets: Se5000RawPacket[];
  foundDevices: Device[];
  isConnected: boolean;
  deviceName: string | null;
  lastDevice: TachoSavedDevice | null;
}

export interface TachoSavedDevice {
  id: string;
  name: string;
  savedAt: string;
}

export interface BluetoothTachoState {
  connected: boolean;
  status: BleStatus;
  statusMsg: string;
  liveData: TachoLiveData | null;
  foundDevices: Device[];
  isConnected: boolean;
  deviceName: string | null;
  lastDevice: TachoSavedDevice | null;
  data: {
    continuousDrivenS: number;
    dailyDrivenS: number;
    weeklyDrivenS: number;
    activity: 'driving' | 'rest' | 'work' | 'available';
    cardInserted: boolean;
  } | null;
  startScan: () => void;
  reconnectLastDevice: () => void;
  disconnect: () => void;
}

const REST_THROTTLE_MS = 30_000;
const CONTINUOUS_DRIVE_LIMIT_S = HOS_CONTINUOUS_DRIVE_LIMIT_S;
const LAST_TACHO_DEVICE_KEY = '@truckai/last_tacho_device_v1';
const INITIAL_STATE: TachoBleState = {
  status: 'idle',
  statusMsg: i18n.t('tacho.notConnected'),
  liveData: null,
  rawPackets: [],
  foundDevices: [],
  isConnected: false,
  deviceName: null,
  lastDevice: null,
};

let sharedState: TachoBleState = INITIAL_STATE;
let sharedService: TachoBleService | null = null;
let lastActiveUpdateAt = 0;
let didCleanupOldEntries = false;
let cachedUserEmail: string | null | undefined;
const listeners = new Set<(state: TachoBleState) => void>();

function emitState(next: TachoBleState) {
  sharedState = next;
  listeners.forEach(listener => listener(sharedState));
}

function patchState(patch: Partial<TachoBleState>) {
  emitState({ ...sharedState, ...patch });
}

function addFoundDevice(device: Device) {
  if (sharedState.foundDevices.some(found => found.id === device.id)) {
    return;
  }
  patchState({ foundDevices: [...sharedState.foundDevices, device] });
}

function ensureService() {
  if (!sharedService) {
    sharedService = new TachoBleService();
  }
  if (!didCleanupOldEntries) {
    didCleanupOldEntries = true;
    cleanup().catch(() => {/* silent */});
  }
  return sharedService;
}

async function loadLastDevice(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(LAST_TACHO_DEVICE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as TachoSavedDevice;
    if (typeof parsed.id === 'string' && typeof parsed.name === 'string') {
      patchState({ lastDevice: parsed });
    }
  } catch {
    // Last device is convenience state; ignore storage failures.
  }
}

async function saveLastDevice(device: Device): Promise<void> {
  const saved: TachoSavedDevice = {
    id: device.id,
    name: device.name ?? device.localName ?? device.id,
    savedAt: new Date().toISOString(),
  };
  patchState({ lastDevice: saved });
  try {
    await AsyncStorage.setItem(LAST_TACHO_DEVICE_KEY, JSON.stringify(saved));
  } catch {
    // Ignore storage failures; active connection should continue.
  }
}

function handleStatus(status: BleStatus, msg?: string) {
  patchState({
    status,
    statusMsg: msg ?? sharedState.statusMsg,
    isConnected: status === 'connected',
  });
}

function handleData(data: TachoLiveData) {
  const isResting = data.activityCode === 0;
  if (isResting) {
    const now = Date.now();
    if (now - lastActiveUpdateAt < REST_THROTTLE_MS) {
      return;
    }
  }
  lastActiveUpdateAt = Date.now();

  patchState({ liveData: data });

  logEvent(data.activityCode as ActivityCode, data.drivingTimeLeftMin, data.dailyDrivenMin)
    .catch(() => {/* silent */});

  sendToBackend(data).catch(() => {/* silent */});
}

function handleRawPacket(pkt: Se5000RawPacket) {
  const MAX = 20;
  const next = [pkt, ...sharedState.rawPackets].slice(0, MAX);
  patchState({ rawPackets: next });
}

function connectToKnownOrSelectedDevice(device: Device) {
  patchState({ deviceName: device.name ?? device.localName ?? device.id, rawPackets: [] });
  saveLastDevice(device).catch(() => {/* silent */});
  ensureService().connectToTacho(device, handleData, handleStatus, handleRawPacket);
}

function handleDeviceFound(device: Device) {
  addFoundDevice(device);
}

async function resolveUserEmail(): Promise<string> {
  if (cachedUserEmail !== undefined) {
    return cachedUserEmail ?? '';
  }
  const account = await loadSavedAccount().catch(() => null);
  cachedUserEmail = account?.email ?? '';
  return cachedUserEmail;
}

export function useTachoBluetooth() {
  const [state, setState] = useState<TachoBleState>(sharedState);

  useEffect(() => {
    ensureService();
    loadLastDevice().catch(() => {/* silent */});
    listeners.add(setState);
    setState(sharedState);
    return () => {
      listeners.delete(setState);
    };
  }, []);

  const startScan = async () => {
    ensureService();

    const ok = await requestBlePermissions();
    if (!ok) {
      handleStatus('error', i18n.t('tacho.bluetoothPermission'));
      return;
    }

    patchState({ foundDevices: [], deviceName: null });
    sharedService?.scanForTacho(handleDeviceFound, handleStatus);
  };

  const connectToDevice = (device: Device) => {
    connectToKnownOrSelectedDevice(device);
  };

  const reconnectLastDevice = () => {
    const last = sharedState.lastDevice;
    if (!last) return;
    patchState({ deviceName: last.name, rawPackets: [] });
    ensureService().connectToDeviceId(last.id, handleData, handleStatus, handleRawPacket);
  };

  const disconnect = () => {
    sharedService?.disconnect().catch(() => {/* silent */});
    patchState({
      status: 'idle',
      statusMsg: i18n.t('tacho.disconnected'),
      isConnected: false,
      liveData: null,
      rawPackets: [],
      deviceName: null,
    });
  };

  const hasHosPayload = Boolean(
    state.liveData &&
    (state.liveData.drivingTimeLeftMin > 0 || state.liveData.dailyDrivenMin > 0),
  );
  const data = state.liveData && hasHosPayload
    ? {
      continuousDrivenS: Math.max(0, CONTINUOUS_DRIVE_LIMIT_S - state.liveData.drivingTimeLeftMin * 60),
      dailyDrivenS: Math.max(0, state.liveData.dailyDrivenMin * 60),
      // The current VDO ITS parser does not expose a weekly characteristic yet.
      // Keep this non-finite so useTacho preserves its backend weekly summary.
      weeklyDrivenS: Number.NaN,
      activity: activityFromCode(state.liveData.activityCode),
      cardInserted: true,
    }
    : null;

  return {
    ...state,
    connected: state.isConnected,
    data,
    gattDump: sharedService?.getGattDump() ?? [],
    rawPackets: state.rawPackets,
    startScan,
    connectToDevice,
    reconnectLastDevice,
    disconnect,
  };
}

function activityFromCode(activityCode: number): 'driving' | 'rest' | 'work' | 'available' {
  if (activityCode === 3) return 'driving';
  if (activityCode === 2) return 'work';
  if (activityCode === 1) return 'available';
  return 'rest';
}

async function sendToBackend(data: TachoLiveData): Promise<void> {
  const userEmail = await resolveUserEmail();
  const authHeaders = await getBackendAuthHeaders(userEmail);
  await fetch(`${BACKEND_URL}/api/tacho/live_update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({
      user_email: userEmail,
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
