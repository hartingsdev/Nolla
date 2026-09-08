import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from './locale-shim';
import { defaultLocale, locales, resources, type Locale } from '@vst/i18n';

export function detectLocale(): Locale {
  const tag = getLocales()[0]?.languageCode ?? defaultLocale;
  return (locales as readonly string[]).includes(tag) ? (tag as Locale) : defaultLocale;
}

void i18n.use(initReactI18next).init({
  resources,
  lng: detectLocale(),
  fallbackLng: defaultLocale,
  interpolation: { escapeValue: false },
});

export default i18n;
