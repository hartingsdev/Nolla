import { useEffect, useState } from 'react';
import { Link, Stack, useRouter } from 'expo-router';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { uuidv7 } from '../src/ids';
import { useApi } from '../src/sync/useSync';
import { emptyTrip } from '../src/sync/merge';
import { useStore } from '../src/store';
import { space, useTheme } from '../src/theme';
import { Body, Button, Card, Chip, Divider, H2, Row, Screen } from '../src/components/ui';

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'] as const;

export default function Trips() {
  const { t } = useTranslation();
  const th = useTheme();
  const router = useRouter();
  const api = useApi();
  const auth = useStore((s) => s.auth);
  const trips = useStore((s) => s.trips);
  const setActiveTrip = useStore((s) => s.setActiveTrip);
  const upsertTrip = useStore((s) => s.upsertTrip);
  const [name, setName] = useState('');
  const [ccy, setCcy] = useState<string>('EUR');
  const [invite, setInvite] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** NFR-16: each form marks what it needs, and complains only once asked to act. */
  const [tried, setTried] = useState<'local' | 'create' | 'join' | null>(null);

  // Refresh the list of shared trips from the server (memberships may have changed elsewhere).
  useEffect(() => {
    if (!auth) return;
    void api.listTrips().then(({ trips: remote }) => {
      for (const r of remote) {
        if (!useStore.getState().trips[r.id]) upsertTrip(emptyTrip({ id: r.id, name: r.name, ccy: r.baseCcy, timezone: r.timezone, status: r.status, remote: true }));
      }
    }).catch(() => { /* offline: keep what we have */ });
  }, [auth, api, upsertTrip]);

  const open = (id: string) => { setActiveTrip(id); router.replace('/'); };
  const create = async () => {
    setError(null);
    setTried('create');
    if (!name.trim()) return;
    const id = uuidv7();
    try {
      await api.createTrip({ id, name: name.trim(), baseCcy: ccy });
      upsertTrip(emptyTrip({ id, name: name.trim(), ccy, timezone: 'Europe/Berlin', status: 'open', remote: true }));
      setName('');
      open(id);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const join = () => {
    setTried('join');
    const token = invite.trim().split('/i/')[1] ?? invite.trim();
    if (!token) return;
    router.push({ pathname: '/i/[token]', params: { token } });
  };
  const inputStyle = (bad: boolean) => ({ backgroundColor: th.bg, color: th.text, borderRadius: 10, padding: 12, fontSize: 16, borderWidth: 1, borderColor: bad ? th.negative : th.border }) as const;
  const missing = (form: 'local' | 'create' | 'join', value: string) => tried === form && !value.trim();
  const remoteTrips = Object.values(trips).filter((x) => x.meta.remote);
  const localTrips = Object.values(trips).filter((x) => !x.meta.remote);
  const createLocalTrip = useStore((s) => s.createLocalTrip);
  const [localName, setLocalName] = useState('');

  return (
    <Screen>
      <Stack.Screen options={{ headerRight: () => (
        <Link href="/settings" asChild>
          <Pressable accessibilityRole="button" accessibilityLabel={t('settings.title')} style={{ paddingHorizontal: space.lg }}>
            <Text style={{ color: th.primary, fontSize: 20 }}>{'⚙'}</Text>
          </Pressable>
        </Link>
      ) }} />
      <Card>
        <H2>{t('trips.local')}</H2>
        {localTrips.length === 0 && <Body muted>{t('trips.noLocal')}</Body>}
        {localTrips.map((x, i) => (
          <View key={x.meta.id}>
            {i > 0 && <Divider />}
            <Pressable onPress={() => { open(x.meta.id); }} accessibilityRole="button">
              <Row style={{ justifyContent: 'space-between' }}>
                <Body>{x.meta.name}</Body>
                <Body style={{ color: th.primary }}>{t('trips.open')}</Body>
              </Row>
            </Pressable>
          </View>
        ))}
        <TextInput value={localName} onChangeText={setLocalName} placeholder={t('trips.name')} placeholderTextColor={th.muted} style={inputStyle(missing('local', localName))} accessibilityLabel={t('trips.newLocal')} />
        {missing('local', localName) && <Body style={{ color: th.negative }}>{t('trips.nameRequired')}</Body>}
        <Button label={t('trips.newLocal')} onPress={() => {
          setTried('local');
          if (!localName.trim()) return;
          const id = createLocalTrip(localName.trim());
          setLocalName('');
          open(id);
        }} />
      </Card>

      <Card>
        <H2>{t('trips.shared')}</H2>
        {!auth ? (
          <>
            <Body muted>{t('trips.signInToShare')}</Body>
            <Link href="/signin" asChild><Pressable accessibilityRole="button"><Body style={{ color: th.primary }}>{t('auth.signIn')}</Body></Pressable></Link>
          </>
        ) : (
          <>
            {remoteTrips.length === 0 && <Body muted>{t('trips.empty')}</Body>}
            {remoteTrips.map((x, i) => (
              <View key={x.meta.id}>
                {i > 0 && <Divider />}
                <Pressable onPress={() => { open(x.meta.id); }} accessibilityRole="button">
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Body>{x.meta.name}</Body>
                    <Body style={{ color: th.primary }}>{t('trips.open')}</Body>
                  </Row>
                </Pressable>
              </View>
            ))}
          </>
        )}
      </Card>

      {auth && (
        <>
          <Card>
            <H2 required>{t('trips.create')}</H2>
            <TextInput value={name} onChangeText={setName} placeholder={t('trips.name')} placeholderTextColor={th.muted} style={inputStyle(missing('create', name))} accessibilityLabel={t('trips.name')} />
            {missing('create', name) && <Body style={{ color: th.negative }}>{t('trips.nameRequired')}</Body>}
            <Row>{CURRENCIES.map((c) => <Chip key={c} label={c} selected={ccy === c} onPress={() => { setCcy(c); }} />)}</Row>
            <Button label={t('trips.create')} onPress={() => { void create(); }} />
          </Card>
          <Card>
            <H2 required>{t('trips.join')}</H2>
            <TextInput value={invite} onChangeText={setInvite} placeholder={t('trips.joinPlaceholder')} placeholderTextColor={th.muted} style={inputStyle(missing('join', invite))} accessibilityLabel={t('trips.joinPlaceholder')} autoCapitalize="none" />
            {missing('join', invite) && <Body style={{ color: th.negative }}>{t('trips.inviteRequired')}</Body>}
            <Button kind="secondary" label={t('invite.join')} onPress={join} />
          </Card>
        </>
      )}
      {error && <Body style={{ color: th.negative }}>{error}</Body>}
    </Screen>
  );
}
