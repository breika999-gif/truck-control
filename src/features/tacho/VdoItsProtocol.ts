/**
 * VdoItsProtocol - BLE configs for supported tachograph models
 */

// VDO DTCO 4.1 / Smart 2 — ISO 16844-7 ITS service (standard UUIDs)
export const VDO_BLE_CONFIG = {
  SERVICE_UUID: '0000181b-0000-1000-8000-00805f9b34fb',
  CHARACTERISTICS: {
    ACTIVITY:      '00002a3a-0000-1000-8000-00805f9b34fb',
    HOS_TIMES:     '00002a3b-0000-1000-8000-00805f9b34fb',
    VEHICLE_SPEED: '00002a3c-0000-1000-8000-00805f9b34fb',
    GNSS_POS:      '00002a3d-0000-1000-8000-00805f9b34fb',
  },
};

// Stoneridge SE5000 — proprietary BLE services (discovered from live GATT scan)
// Protocol not yet decoded — subscribing raw and logging packets until mapping is known
export const SE5000_BLE_CONFIG = {
  SERVICES: [
    {
      uuid: 'eef90782-55dd-4388-b80b-695aba7a69b5',
      characteristics: [
        '29d3a479-1592-47df-80a4-afa742d369bb',
        'db9c4128-bff3-41fe-a306-fb6f9a8aeb2d',
      ],
    },
    {
      uuid: 'fa213def-aef4-475c-bcea-0a8d69073efc',
      characteristics: [
        'e413960c-75ba-4ca9-8a67-99bc052a1b13',
        'e168d1a6-304f-42b4-ab96-4cd1d4efebd9',
      ],
    },
  ],
};

export function isSE5000Device(deviceName: string | null): boolean {
  const name = (deviceName ?? '').toUpperCase();
  return name.includes('SE5000') || name.includes('STONERIDGE');
}

export const VdoDataInterpreter = {
  decodeActivity: (byte: number) => {
    const status = byte & 0x0F;
    const slots = (byte >> 4) & 0x0F;
    return { status, slots };
  },
};
