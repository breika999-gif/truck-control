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
import i18n from '../../i18n';

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
const NO_LIVE_DATA_TIMEOUT_MS = 10000;

export interface TachoLiveData {
  activity: string;
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
  private noLiveDataTimeout: ReturnType<typeof setTimeout> | null = null;
  private hasReceivedLiveData = false;
  private reportedMonitorErrors = new Set<string>();

  constructor() {
    this.manager = new BleManager();
  }

  // ── 1. Check BLE state ─────────────────────────────────────────────
  async checkBleReady(): Promise<boolean> {
    const state = await this.manager.state();
    return state === State.PoweredOn;
  }

  // ── 2. Scan for VDO/Stoneridge tachograph devices ─────────────────
  // All discovered devices during scan (for manual selection)
  private _foundDevices: Device[] = [];

  scanForTacho(
    onDeviceFound: (device: Device) => void,
    onStatus: (status: BleStatus, msg?: string) => void,
    timeoutMs = 15000,
  ): void {
    this.onStatusCallback = onStatus;
    this._foundDevices = [];
    onStatus('scanning', i18n.t('tacho.scanBle'));

    // Scan ALL devices (null = no UUID filter) — VDO uses proprietary UUIDs
    // that are not advertised, so filtering by UUID never finds anything.
    this.manager.startDeviceScan(
      null,
      { allowDuplicates: false },
      (error, device) => {
        if (error) {
          onStatus('error', i18n.t('tacho.scanError', { error: error.message }));
          return;
        }
        if (!device) return;

        const name = device.name ?? device.localName ?? '';
        if (!name) return; // skip unnamed devices

        // Known VDO/tachograph name patterns — auto-connect if matched
        const isKnownTacho = TACHO_NAME_PATTERNS.some(p =>
          name.toUpperCase().includes(p.toUpperCase()),
        );

        if (isKnownTacho) {
          this.manager.stopDeviceScan();
          if (this.scanTimeout) clearTimeout(this.scanTimeout);
          onDeviceFound(device);
          return;
        }

        // Collect all named devices so TachoScreen can show a picker
        if (!this._foundDevices.find(d => d.id === device.id)) {
          this._foundDevices.push(device);
          // Re-emit the first found device to trigger UI update (list mode)
          onDeviceFound(this._foundDevices[0]);
        }
      },
    );

    // Auto-stop after timeout
    this.scanTimeout = setTimeout(() => {
      this.manager.stopDeviceScan();
      onStatus('idle', this._foundDevices.length > 0
        ? i18n.t('tacho.foundDevicesManual', { count: this._foundDevices.length })
        : i18n.t('tacho.noDevices'),
      );
    }, timeoutMs);
  }

  /** Returns all devices found during the last scan (for manual picker). */
  getFoundDevices(): Device[] {
    return this._foundDevices;
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
    this.reportedMonitorErrors.clear();

    try {
      const deviceName = device.name ?? device.id;
      onStatus('connecting', i18n.t('tacho.connectingDevice', { device: deviceName }));

      const connected = await device.connect({ timeout: 10000 });
      this.device = connected;

      await connected.discoverAllServicesAndCharacteristics();
      const gattSummary = await this._describeGatt(connected);
      onStatus('connected', `${i18n.t('tacho.connectedDevice', { device: deviceName })} · ${gattSummary}`);
      this._startNoLiveDataTimer();

      // Subscribe to live activity changes
      this._subscribeActivity(connected);
      // Subscribe to HOS time summary
      this._subscribeHosTimes(connected);
      // Subscribe to speed
      this._subscribeSpeed(connected);

    } catch (err: any) {
      onStatus('error', i18n.t('tacho.connectionFailed', { error: err?.message ?? err }));
    }
  }

  // ── 4a. Subscribe to Activity characteristic ──────────────────────
  private _subscribeActivity(device: Device): void {
    device.monitorCharacteristicForService(
      VDO_BLE_CONFIG.SERVICE_UUID,
      VDO_BLE_CONFIG.CHARACTERISTICS.ACTIVITY,
      (error, characteristic) => {
        if (error) {
          this._reportMonitorError('activity', error.message);
          return;
        }
        if (!characteristic?.value) return;
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
        if (error) {
          this._reportMonitorError('hos', error.message);
          return;
        }
        if (!characteristic?.value) return;
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
        if (error) {
          this._reportMonitorError('speed', error.message);
          return;
        }
        if (!characteristic?.value) return;
        this._handleSpeedUpdate(characteristic);
      },
    );
  }

  private _gattDump: string[] = [];

  getGattDump(): string[] {
    return this._gattDump;
  }

  private async _describeGatt(device: Device): Promise<string> {
    try {
      const services = await device.services();
      const serviceIds = services.map(s => s.uuid.toLowerCase());
      const hasVdoService = serviceIds.includes(VDO_BLE_CONFIG.SERVICE_UUID.toLowerCase());

      const dump: string[] = [];
      await Promise.all(
        services.map(async service => {
          const chars = await device.characteristicsForService(service.uuid).catch(() => []);
          const flags = chars.map(c => {
            const f = [];
            if (c.isNotifiable) f.push('N');
            if (c.isIndicatable) f.push('I');
            if (c.isReadable) f.push('R');
            return `  ${c.uuid} [${f.join('')}]`;
          });
          dump.push(`SVC ${service.uuid}`);
          dump.push(...flags);
        }),
      );

      this._gattDump = dump;
      return hasVdoService
        ? i18n.t('tacho.gattVdoFound', { count: services.length })
        : i18n.t('tacho.gattVdoMissing', { count: services.length });
    } catch (err: any) {
      const error = err?.message ?? String(err);
      this._gattDump = [`error: ${error}`];
      return i18n.t('tacho.gattInspectFailed', { error });
    }
  }

  private _startNoLiveDataTimer(): void {
    this._clearNoLiveDataTimer();
    this.hasReceivedLiveData = false;
    this.noLiveDataTimeout = setTimeout(() => {
      if (!this.hasReceivedLiveData) {
        this._reportConnectedDiagnostic(i18n.t('tacho.waitingLiveDataStatus'));
      }
    }, NO_LIVE_DATA_TIMEOUT_MS);
  }

  private _clearNoLiveDataTimer(): void {
    if (this.noLiveDataTimeout) {
      clearTimeout(this.noLiveDataTimeout);
      this.noLiveDataTimeout = null;
    }
  }

  private _reportMonitorError(channel: string, message?: string): void {
    if (this.reportedMonitorErrors.has(channel)) return;
    this.reportedMonitorErrors.add(channel);
    this._reportConnectedDiagnostic(i18n.t('tacho.liveReadFailed', {
      channel,
      error: message ?? i18n.t('common.error'),
    }));
  }

  private _reportConnectedDiagnostic(message: string): void {
    console.warn('[tacho]', message);
    this.onStatusCallback?.('connected', message);
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
    this.hasReceivedLiveData = true;
    this._clearNoLiveDataTimer();
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
    this._clearNoLiveDataTimer();
    this.onStatusCallback?.('idle', i18n.t('tacho.disconnected'));
  }

  destroy(): void {
    this._clearNoLiveDataTimer();
    this.manager.destroy();
  }
}
