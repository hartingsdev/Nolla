import { Tabs } from 'expo-router';
import { type ColorValue, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../src/store';
import { useTheme } from '../../src/theme';

const icon = (glyph: string) => ({ color }: { color: ColorValue }) => <Text style={{ fontSize: 20, color }}>{glyph}</Text>;

export default function TabsLayout() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const tripName = useStore((s) => s.trips[s.activeTripId]?.meta.name ?? '');
  return (
    <Tabs screenOptions={{
      headerStyle: { backgroundColor: t.card }, headerTintColor: t.text,
      tabBarStyle: { backgroundColor: t.card, borderTopColor: t.border }, tabBarActiveTintColor: t.primary, tabBarInactiveTintColor: t.muted,
    }}>
      <Tabs.Screen name="index" options={{ title: tr('tabs.overview'), headerTitle: tripName, tabBarIcon: icon('◎') }} />
      <Tabs.Screen name="ledger" options={{ title: tr('tabs.ledger'), tabBarIcon: icon('☰') }} />
      <Tabs.Screen name="settle" options={{ title: tr('tabs.settle'), tabBarIcon: icon('⇄') }} />
    </Tabs>
  );
}
