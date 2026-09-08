/** Minimal stand-in for expo-localization until M10 wires the native module. */
export function getLocales(): { languageCode: string; languageTag: string }[] {
  const tag = Intl.DateTimeFormat().resolvedOptions().locale || 'en';
  return [{ languageCode: tag.split('-')[0] ?? 'en', languageTag: tag }];
}
