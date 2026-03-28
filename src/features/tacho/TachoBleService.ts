/**
 * TachoBleService — VDO DTCO 4.1 / Smart 2 BLE Connector
 * Based on ISO 16844-7 ITS Interface Standard
 *
 * Requires: npm install react-native-ble-plx
 * Android: add BLUETOOTH_SCAN, BLUETOOTH_CONNECT, ACCESS_FINE_LOCATION to manifest
 */

import { BleManager, Device, Characteristic, State } from 'react-native-ble-plx';
import { decode as atob } from 'base-64';
import { VDO_BLE_CONFIG, VdoDataInterpreter } from './VdoItsProtocol';
import { TachoParser } from './TachoParser';

// ── Decode helpers for React Native ──────────────────────────────
function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function readUInt16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

// ── Device name patterns that identify a VDO/Stoneridge tachograph ──
const TACHO_NAME_PATTERNS = ['DTCO', 'VDO', 'SmartLink', 'SE5000', 'Stoneridge'];

export interface TachoLiveData {
  activity: string;          // 'Шофиране' | 'Почивка' | 'Друга работа' | 'На разположение'
  activityCode: number;      // 0-3
  drivingTimeLeftMin: number;
  dailyDrivenMin: number;
  speed: number;             // km/h from tachograph sensor
  timestamp: string;
}

export type BleStatus = 'idle' | 'scanning' | 'connecting' | 'connected' | 'error';

export class TachoBleService {
  private manager: BleManager;
  private device: Device | null = null;
  private onDataCallback: ((data: TachoLiveData) => void) | null = null;
  private onStatusCallback: ((status: BleStatus, msg?: string) => void) | null = null;
  private scanTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.manager = new BleManager();
  }

  // ── 1. Check BLE state ─────────────────────────────────────────────
  async checkBleReady(): Promise<boolean> {
    const state = await this.manager.state();
    return state === State.PoweredOn;
  }

  // ── 2. Scan for VDO/Stoneridge tachograph devices ─────────────────
  scanForTacho(
    onDeviceFound: (device: Device) => void,
    onStatus: (status: BleStatus, msg?: string) => void,
    timeoutMs = 15000,
  ): void {
    this.onStatusCallback = onStatus;
    onStatus('scanning', 'Търся тахограф...');

    this.manager.startDeviceScan(
      [VDO_BLE_CONFIG.SERVICE_UUID],
      { allowDuplicates: false },
      (error, device) => {
        if (error) {
          onStatus('error', `Грешка при сканиране: ${error.message}`);
          return;
        }
        if (!device) return;

        const name = device.name ?? device.localName ?? '';
        const isVdo = TACHO_NAME_PATTERNS.some(p =>
          name.toUpperCase().includes(p.toUpperCase()),
        );

        if (isVdo) {
          this.manager.stopDeviceScan();
          if (this.scanTimeout) clearTimeout(this.scanTimeout);
          onDeviceFound(device);
        }
      },
    );

    // Auto-stop after timeout
    this.scanTimeout = setTimeout(() => {
      this.manager.stopDeviceScan();
      onStatus('idle', 'Не е намерен тахограф. Провери дали е в BLE режим.');
    }, timeoutMs);
  }

  stopScan(): void {
    this.manager.stopDeviceScan();
    if (this.scanTimeout) clearTimeout(this.scanTimeout);
  }

  // ── 3. Connect + establish ITS session ────────────────────────────
  async connectToTacho(
    device: Device,
    onData: (data: TachoLiveData) => void,
    onStatus: (status: BleStatus, msg?: string) => void,
  ): Promise<void> {
    this.onDataCallback = onData;
    this.onStatusCallback = onStatus;

    try {
      onStatus('connecting', `Свързване с ${device.name ?? device.id}...`);

      const connected = await device.connect({ timeout: 10000 });
      this.device = connected;

      await connected.discoverAllServicesAndCharacteristics();
      onStatus('connected', `Свързан с ${device.name ?? device.id}`);

      // Subscribe to live activity changes
      this._subscribeActivity(connected);
      // Subscribe to HOS time summary
      this._subscribeHosTimes(connected);
      // Subscribe to speed
      this._subscribeSpeed(connected);

    } catch (err: any) {
      onStatus('error', `Неуспешно свързване: ${err?.message ?? err}`);
    }
  }

  // ── 4a. Subscribe to Activity characteristic ──────────────────────
  private _subscribeActivity(device: Device): void {
    device.monitorCharacteristicForService(
      VDO_BLE_CONFIG.SERVICE_UUID,
      VDO_BLE_CONFIG.CHARACTERISTICS.ACTIVITY,
      (error, characteristic) => {
        if (error || !characteristic?.value) return;
        this._handleActivityUpdate(characteristic);
      },
    );
  }

  // ── 4b. Subscribe to HOS Times characteristic ────────────────────
  private _subscribeHosTimes(device: Device): void {
    device.monitorCharacteristicForService(
      VDO_BLE_CONFIG.SERVICE_UUID,
      VDO_BLE_CONFIG.CHARACTERISTICS.HOS_TIMES,
      (error, characteristic) => {
        if (error || !characteristic?.value) return;
        this._handleHosUpdate(characteristic);
      },
    );
  }

  // ── 4c. Subscribe to Speed characteristic ────────────────────────
  private _subscribeSpeed(device: Device): void {
    device.monitorCharacteristicForService(
      VDO_BLE_CONFIG.SERVICE_UUID,
      VDO_BLE_CONFIG.CHARACTERISTICS.VEHICLE_SPEED,
      (error, characteristic) => {
        if (error || !characteristic?.value) return;
        this._handleSpeedUpdate(characteristic);
      },
    );
  }

  // ── Decode Activity byte ──────────────────────────────────────────
  private _lastActivity = 0;
  private _lastHosData = { drivingTimeLeftMin: 0, dailyDrivenMin: 0 };
  private _lastSpeed = 0;

  private _handleActivityUpdate(characteristic: Characteristic): void {
    const bytes = base64ToBytes(characteristic.value!);
    const activityByte = bytes[0];
    const { status } = VdoDataInterpreter.decodeActivity(activityByte);
    this._lastActivity = status;
    this._emitUpdate();
  }

  // ── Decode HOS Times (bytes 0-1: remaining driving min, bytes 2-3: daily driven min)
  private _handleHosUpdate(characteristic: Characteristic): void {
    const bytes = base64ToBytes(characteristic.value!);
    // VDO ITS: bytes 0-1 = remaining driving time in minutes (little-endian)
    const remDrivingMin = readUInt16LE(bytes, 0);
    // bytes 2-3 = daily driven minutes (little-endian)
    const dailyDrivenMin = readUInt16LE(bytes, 2);
    this._lastHosData = { drivingTimeLeftMin: remDrivingMin, dailyDrivenMin };
    this._emitUpdate();
  }

  // ── Decode Speed (km/h, 2 bytes little-endian, value / 256) ──────
  private _handleSpeedUpdate(characteristic: Characteristic): void {
    const bytes = base64ToBytes(characteristic.value!);
    const rawSpeed = readUInt16LE(bytes, 0);
    this._lastSpeed = Math.round(rawSpeed / 256);
    this._emitUpdate();
  }

  // ── Emit combined live data ───────────────────────────────────────
  private _emitUpdate(): void {
    if (!this.onDataCallback) return;
    this.onDataCallback({
      activity: TachoParser.parseActivity(this._lastActivity.toString(16)),
      activityCode: this._lastActivity,
      drivingTimeLeftMin: this._lastHosData.drivingTimeLeftMin,
      dailyDrivenMin: this._lastHosData.dailyDrivenMin,
      speed: this._lastSpeed,
      timestamp: new Date().toISOString(),
    });
  }

  // ── 5. Disconnect ─────────────────────────────────────────────────
  async disconnect(): Promise<void> {
    if (this.device) {
      await this.device.cancelConnection();
      this.device = null;
    }
    this.onStatusCallback?.('idle', 'Прекъснато');
  }

  destroy(): void {
    this.manager.destroy();
  }
}
