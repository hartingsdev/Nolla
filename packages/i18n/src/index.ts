import en from './locales/en.json';
import de from './locales/de.json';

export const resources = { en: { translation: en }, de: { translation: de } } as const;
export type Locale = keyof typeof resources;
export const locales: readonly Locale[] = ['en', 'de'];
export const defaultLocale: Locale = 'en';

/** The English catalogue is the source of truth for keys (D10). */
export type Messages = typeof en;
