import { Link, Redirect, Tabs } from 'expo-router';
import { type ColorValue, Pressable, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { activeTrip } from '../../src/selectors';
import { useStore } from '../../src/store';
import { space, useTheme } from '../../src/theme';

const icon = (glyph: string) => ({ color }: { color: ColorValue }) => <Text style={{ fontSize: 20, color }}>{glyph}</Text>;

/**
 * Our own label, because the default one is a 10px box with overflow:hidden —
 * it cut the dots off "Übersicht" and rendered it as "Ubersicht" on the web
 * build, and German is a shipping language (D10). Line box gets room here.
 */
const label = (text: string) => ({ color }: { color: ColorValue }) => (
  <Text style={{ fontSize: 12, lineHeight: 16, color }}>{text}</Text>
);

/**
 * The tab bar is the open trip; the header is how you leave it (#6).
 *
 * Left goes up to the app — the trip list, and from there app settings. Right
 * configures the level you are on. Both are header actions rather than links
 * inside a card, so they render in every state, including the cold start where
 * the trip has no participants and most cards are not drawn at all (#11, #4).
 *
 * The title stays a heading and does not become the trip switcher: it is the
 * screen's only heading landmark, and four e2e assertions locate the trip by
 * `getByRole('heading')`.
 */
export default function TabsLayout() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const tripName = useStore((s) => activeTrip(s)?.meta.name ?? '');
  const hydrated = useStore((s) => s.hydrated);
  // No open trip — the state after deleting the one you were in (#12).
  const missing = useStore((s) => s.activeTripId === null || !s.trips[s.activeTripId]);

  if (hydrated && missing) return <Redirect href="/trips" />;

  const headerLeft = () => (
    <Link href="/trips" asChild>
      <Pressable accessibilityRole="button" style={{ paddingHorizontal: space.lg }}>
        <Text style={{ color: t.primary, fontSize: 16 }}>{tr('trips.title')}</Text>
      </Pressable>
    </Link>
  );
  const headerRight = () => (
    <Link href="/trip/settings" asChild>
      <Pressable accessibilityRole="button" accessibilityLabel={tr('trip.settings')} style={{ paddingHorizontal: space.lg }}>
        <Text style={{ color: t.primary, fontSize: 20 }}>{'⚙'}</Text>
      </Pressable>
    </Link>
  );

  return (
    <Tabs screenOptions={{
      headerStyle: { backgroundColor: t.card }, headerTintColor: t.text,
      headerTitle: tripName, headerLeft, headerRight,
      tabBarStyle: { backgroundColor: t.card, borderTopColor: t.border }, tabBarActiveTintColor: t.primary, tabBarInactiveTintColor: t.muted,
    }}>
      <Tabs.Screen name="index" options={{ title: tr('tabs.overview'), tabBarIcon: icon('◎'), tabBarLabel: label(tr('tabs.overview')) }} />
      <Tabs.Screen name="ledger" options={{ title: tr('tabs.ledger'), tabBarIcon: icon('☰'), tabBarLabel: label(tr('tabs.ledger')) }} />
      <Tabs.Screen name="settle" options={{ title: tr('tabs.settle'), tabBarIcon: icon('⇄'), tabBarLabel: label(tr('tabs.settle')) }} />
    </Tabs>
  );
}
