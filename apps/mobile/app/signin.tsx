import { useState } from 'react';
import { useRouter } from 'expo-router';
import { TextInput } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useApi } from '../src/sync/useSync';
import { useStore } from '../src/store';
import { useTheme } from '../src/theme';
import { Body, Button, Card, H2, Screen } from '../src/components/ui';

export default function SignIn() {
  const { t } = useTranslation();
  const th = useTheme();
  const router = useRouter();
  const api = useApi();
  const apiUrl = useStore((s) => s.apiUrl);
  const setApiUrl = useStore((s) => s.setApiUrl);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isDev = /localhost|127\.0\.0\.1/.test(apiUrl);

  const send = async () => {
    setError(null);
    try { await api.requestMagicLink(email.trim()); setSent(email.trim()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  /** Local development only: the dev API records the links it would have mailed. */
  const devOpen = async () => {
    const { links } = await api.devMagicLinks();
    const last = links.at(-1);
    if (!last) return;
    const token = new URL(last.url).searchParams.get('token') ?? '';
    router.replace({ pathname: '/auth/email', params: { token } });
  };
  const inputStyle = { backgroundColor: th.bg, color: th.text, borderRadius: 10, padding: 12, fontSize: 16, borderWidth: 1, borderColor: th.border } as const;

  return (
    <Screen>
      <Card>
        <H2>{t('auth.email')}</H2>
        <TextInput value={email} onChangeText={setEmail} placeholder="name@example.com" placeholderTextColor={th.muted} style={inputStyle} keyboardType="email-address" autoCapitalize="none" autoComplete="email" accessibilityLabel={t('auth.email')} />
        <Button label={t('auth.sendLink')} onPress={() => { void send(); }} disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())} />
        {sent && <Body>{t('auth.sent', { email: sent })}</Body>}
        {sent && isDev && <Button kind="secondary" label={t('auth.devFetchLink')} onPress={() => { void devOpen(); }} />}
        {error && <Body style={{ color: th.negative }}>{error}</Body>}
      </Card>
      {isDev && (
        <Card>
          <H2>{t('auth.apiUrl')}</H2>
          <TextInput value={apiUrl} onChangeText={setApiUrl} style={inputStyle} autoCapitalize="none" accessibilityLabel={t('auth.apiUrl')} />
        </Card>
      )}
    </Screen>
  );
}
