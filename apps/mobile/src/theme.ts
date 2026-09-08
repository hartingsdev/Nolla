import { useColorScheme } from 'react-native';

const light = {
  bg: '#F6F7F9', card: '#FFFFFF', text: '#111418', muted: '#6B7280', border: '#E5E7EB',
  primary: '#2563EB', onPrimary: '#FFFFFF', positive: '#15803D', negative: '#B91C1C', chip: '#EEF2FF', chipOn: '#2563EB', danger: '#B91C1C',
};
const dark: typeof light = {
  bg: '#0F1115', card: '#181B22', text: '#F3F4F6', muted: '#9CA3AF', border: '#2A2F3A',
  primary: '#60A5FA', onPrimary: '#0B1220', positive: '#4ADE80', negative: '#F87171', chip: '#1F2937', chipOn: '#60A5FA', danger: '#F87171',
};
export type Theme = typeof light;
export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
