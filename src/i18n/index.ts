import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { useVehicleStore, type AppLanguage } from '../store/vehicleStore';

const en = require('./locales/en.json');
const bg = require('./locales/bg.json');
const es = require('./locales/es.json');

export const DEFAULT_LANGUAGE: AppLanguage = 'en';
export const SUPPORTED_LANGUAGES: AppLanguage[] = ['en', 'bg', 'es'];

function normalizeLanguage(value: unknown): AppLanguage {
  return SUPPORTED_LANGUAGES.includes(value as AppLanguage)
    ? value as AppLanguage
    : DEFAULT_LANGUAGE;
}

async function resolveInitialLanguage(): Promise<AppLanguage> {
  const storeLanguage = normalizeLanguage(useVehicleStore.getState().language);
  if (storeLanguage !== DEFAULT_LANGUAGE) return storeLanguage;

  try {
    return normalizeLanguage(await AsyncStorage.getItem('language'));
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

void resolveInitialLanguage().then((lng) => {
  if (i18n.language !== lng) void i18n.changeLanguage(lng);
});

useVehicleStore.subscribe((state) => {
  const nextLanguage = normalizeLanguage(state.language);
  if (i18n.language !== nextLanguage) {
    void i18n.changeLanguage(nextLanguage);
  }
});

void i18n
  .use(initReactI18next)
  .init({
    compatibilityJSON: 'v4',
    resources: {
      en: { translation: en },
      bg: { translation: bg },
      es: { translation: es },
    },
    lng: useVehicleStore.getState().language || DEFAULT_LANGUAGE,
    fallbackLng: DEFAULT_LANGUAGE,
    interpolation: {
      escapeValue: false,
    },
    returnNull: false,
  });

export default i18n;
