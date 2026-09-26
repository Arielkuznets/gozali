import type en from './locales/en.json';

// Typed translation keys: t('home.title') is checked against the English file.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
  }
}
