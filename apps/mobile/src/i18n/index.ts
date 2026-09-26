import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from '@/i18n/locales/en.json';

// Hebrew joins at the public launch (spec section 12); adding it means adding a file here.
export const resources = { en: { translation: en } } as const;

function deviceLanguage(): keyof typeof resources {
  const code = getLocales()[0]?.languageCode;
  return code !== null && code !== undefined && code in resources ? (code as keyof typeof resources) : 'en';
}

void i18n.use(initReactI18next).init({
  resources,
  lng: deviceLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
