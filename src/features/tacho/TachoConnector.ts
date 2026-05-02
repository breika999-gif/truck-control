/**
 * TachoConnector — unified scanner for ALL tachograph types in Europe.
 *
 * Track A — Stoneridge SE5000 / SE5000 Smart (Classic Bluetooth SPP)
 *   Uses react-native-bluetooth-classic
 *   UUID: 00001101-0000-1000-8000-00805f9b34fb (standard SPP)
 *
 * Track B — VDO DTCO 4.1 Smart 2 (BLE)
 *   Uses react-native-ble-plx
 *   UUIDs: proprietary (discovered via nRF Connect scan)
 */

import { PermissionsAndroid, Platform } from 'react-native';
import RNBluetoothClassic, {
  BluetoothDevice as ClassicDevice,
} from 'react-native-bluetooth-classic';
import { BleManager, Device as BleDevice } from 'react-native-ble-plx';

// ── Stoneridge device name patterns (Classic BT) ──────────────────────────
const STONERIDGE_PATTERNS = ['SE5000', 'Stoneridge', 'OPTAC', 'SG5', 'TachoLink', 'Tacho Link'];

// ── VDO / DTCO device name patterns (BLE) ─────────────────────────────────
const VDO_PATTERNS = ['DTCO', 'VDO', 'SmartLink', 'Smart 2'];

// ── SPP UUID for Classic BT (Stoneridge) ─────────────────────────────────
export const SPP_UUID = '00001101-0000-1000-8000-00805f9b34fb';

export type TachoType = 'stoneridge_classic' | 'vdo_ble' | 'unknown';

export interface TachoDevice {
  id: string;
  name: string;
  type: TachoType;
  // One of these will be set depending on type
  classicDevice?: ClassicDevice;
  bleDevice?: BleDevice;
}

export type ScanStatus = 'idle' | 'scanning' | 'connecting' | 'connected' | 'error';

export interface ScanCallbacks {
  onDevice: (device: TachoDevice) => void;
  onStatus: (status: ScanStatus, msg?: string) => void;
}

export class TachoConnector {
  private bleManager = new BleManager();
  private scanTimeout: ReturnType<typeof setTimeout> | null = null;
  private foundIds = new Set<string>();

  // ── Permissions ───────────────────────────────────────────────────────────
  async requestPermissions(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    const granted = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ]);
    return (
      granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN]    === PermissionsAndroid.RESULTS.GRANTED &&
      granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED
    );
  }

  // ── Scan both Classic BT (Stoneridge) and BLE (VDO) ──────────────────────
  async startScan(cb: ScanCallbacks, timeoutMs = 15000): Promise<void> {
    this.foundIds.clear();
    cb.onStatus('scanning', 'Търся тахографи (Stoneridge + VDO)...');

    // Track A: Classic Bluetooth (Stoneridge)
    this._scanClassic(cb);

    // Track B: BLE (VDO DTCO Smart 2)
    this._scanBle(cb, timeoutMs);

    this.scanTimeout = setTimeout(() => {
      this.stopScan();
      cb.onStatus('idle', 'Сканирането приключи.');
    }, timeoutMs);
  }

  stopScan(): void {
    this.bleManager.stopDeviceScan();
    if (this.scanTimeout) clearTimeout(this.scanTimeout);
    RNBluetoothClassic.cancelDiscovery().catch(() => {});
  }

  // ── Classic BT scan ───────────────────────────────────────────────────────
  private async _scanClassic(cb: ScanCallbacks): Promise<void> {
    try {
      // First check already-paired devices (Stoneridge shows up as paired)
      const paired: ClassicDevice[] = await RNBluetoothClassic.getBondedDevices();
      for (const dev of paired) {
        const name = dev.name ?? '';
        const type = this._classifyName(name);
        if (!this.foundIds.has(dev.address)) {
          this.foundIds.add(dev.address);
          cb.onDevice({ id: dev.address, name, type, classicDevice: dev });
        }
      }

      // Then do active discovery for unpaired devices
      const discovered: ClassicDevice[] = await RNBluetoothClassic.startDiscovery();
      for (const dev of discovered) {
        if (!this.foundIds.has(dev.address)) {
          this.foundIds.add(dev.address);
          const name = dev.name ?? '';
          const type = this._classifyName(name);
          cb.onDevice({ id: dev.address, name, type, classicDevice: dev });
        }
      }
    } catch {
      // Classic BT not available — skip silently
    }
  }

  // ── BLE scan ──────────────────────────────────────────────────────────────
  private _scanBle(cb: ScanCallbacks, _timeoutMs: number): void {
    this.bleManager.startDeviceScan(null, { allowDuplicates: false }, (err, device) => {
      if (err || !device) return;
      const name = device.name ?? device.localName ?? '';
      if (!name) return;
      if (this.foundIds.has(device.id)) return;
      this.foundIds.add(device.id);
      const type = this._classifyName(name);
      cb.onDevice({ id: device.id, name, type, bleDevice: device });
    });
  }

  // ── Connect to a specific device ─────────────────────────────────────────
  async connect(
    device: TachoDevice,
    onStatus: (status: ScanStatus, msg?: string) => void,
  ): Promise<'classic' | 'ble' | null> {
    onStatus('connecting', `Свързване с ${device.name}...`);

    if (device.classicDevice) {
      return this._connectClassic(device, onStatus);
    }
    if (device.bleDevice) {
      return this._connectBle(device, onStatus);
    }
    return null;
  }

  private async _connectClassic(
    device: TachoDevice,
    onStatus: (status: ScanStatus, msg?: string) => void,
  ): Promise<'classic'> {
    const connected = await device.classicDevice!.connect();
    if (connected) {
      onStatus('connected', `Свързан с ${device.name} (Classic BT)`);
    } else {
      onStatus('error', `Неуспешно свързване с ${device.name}`);
    }
    return 'classic';
  }

  private async _connectBle(
    device: TachoDevice,
    onStatus: (status: ScanStatus, msg?: string) => void,
  ): Promise<'ble'> {
    const connected = await device.bleDevice!.connect({ timeout: 10000 });
    await connected.discoverAllServicesAndCharacteristics();
    onStatus('connected', `Свързан с ${device.name} (BLE)`);
    return 'ble';
  }

  // ── Classify device by name ───────────────────────────────────────────────
  private _classifyName(name: string): TachoType {
    const upper = name.toUpperCase();
    if (STONERIDGE_PATTERNS.some(p => upper.includes(p.toUpperCase()))) return 'stoneridge_classic';
    if (VDO_PATTERNS.some(p => upper.includes(p.toUpperCase()))) return 'vdo_ble';
    return 'unknown';
  }

  destroy(): void {
    this.bleManager.destroy();
  }
}
