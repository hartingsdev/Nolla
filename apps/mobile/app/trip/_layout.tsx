import { Redirect, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../src/store';
import { useTheme } from '../../src/theme';

/**
 * Trip-scoped screens require an open trip. Rather than teaching every selector
 * and every screen to survive its absence, the two layouts that host them
 * redirect to the trip list — which is where you land after deleting the trip
 * you were in (#12).
 *
 * `hydrated` matters: before rehydration `activeTripId` still holds its initial
 * value, and redirecting on that would bounce people off their own trip on
 * every cold start.
 */
export default function TripLayout() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const hydrated = useStore((s) => s.hydrated);
  const missing = useStore((s) => s.activeTripId === null || !s.trips[s.activeTripId]);
  if (hydrated && missing) return <Redirect href="/trips" />;
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: t.card }, headerTintColor: t.text, contentStyle: { backgroundColor: t.bg } }}>
      <Stack.Screen name="settings" options={{ title: tr('trip.settings') }} />
      <Stack.Screen name="participants" options={{ title: tr('participants.title') }} />
    </Stack>
  );
}
