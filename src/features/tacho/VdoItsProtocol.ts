/**
 * VdoItsProtocol - Technical Specifications for VDO DTCO 4.1 (Smart 2)
 * Based on ISO 16844-7 and ITS BLE Standards
 */

export const VDO_BLE_CONFIG = {
  // Основната услуга на тахографа (ITS Service)
  SERVICE_UUID: '0000181b-0000-1000-8000-00805f9b34fb',

  // Характеристики за данни
  CHARACTERISTICS: {
    ACTIVITY: '00002a3a-0000-1000-8000-00805f9b34fb', // Текуща активност (Driving, Rest...)
    HOS_TIMES: '00002a3b-0000-1000-8000-00805f9b34fb', // Времена за каране/почивка
    VEHICLE_SPEED: '00002a3c-0000-1000-8000-00805f9b34fb', // Реална скорост от датчика
    GNSS_POS: '00002a3d-0000-1000-8000-00805f9b34fb', // Координати за граници
  },

  // Процедура за сдвояване (Pairing)
  // 1. Тахографът се пуска в режим "Pairing" от менюто Settings -> Bluetooth.
  // 2. Телефонът открива устройство с име "DTCO 4.1 - [Serial]".
  // 3. Въвежда се 6-цифрен PIN код, който се показва на дисплея на тахографа.
};

export const VdoDataInterpreter = {
  // Как да разчитаме байтовете от ACTIVITY характеристиката
  decodeActivity: (byte: number) => {
    const status = byte & 0x0F; // Първите 4 бита
    const slots = (byte >> 4) & 0x0F; // Вторите 4 бита за Карта 1 / Карта 2
    return { status, slots };
  }
};
