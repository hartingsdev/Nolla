import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useTranslation } from 'react-i18next';
import i18n from '../src/i18n';
import { useStore } from '../src/store';
import { useTheme } from '../src/theme';

export default function RootLayout() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const locale = useStore((s) => s.locale);
  useEffect(() => { if (locale && i18n.language !== locale) void i18n.changeLanguage(locale); }, [locale]);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerStyle: { backgroundColor: t.card }, headerTintColor: t.text, contentStyle: { backgroundColor: t.bg } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="entry/new" options={{ presentation: 'modal', title: tr('entry.new') }} />
        <Stack.Screen name="entry/[id]" options={{ title: tr('entry.shares') }} />
        <Stack.Screen name="participants" options={{ title: tr('participants.title') }} />
        <Stack.Screen name="settings" options={{ title: tr('settings.title') }} />
      </Stack>
    </GestureHandlerRootView>
  );
}
