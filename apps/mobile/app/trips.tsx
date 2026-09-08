import { useEffect, useState } from 'react';
import { Link, useRouter } from 'expo-router';
import { Pressable, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { uuidv7 } from '../src/ids';
import { useApi } from '../src/sync/useSync';
import { emptyTrip } from '../src/sync/merge';
import { LOCAL_TRIP_ID, useStore } from '../src/store';
import { useTheme } from '../src/theme';
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
    const id = uuidv7();
    try {
      await api.createTrip({ id, name: name.trim(), baseCcy: ccy });
      upsertTrip(emptyTrip({ id, name: name.trim(), ccy, timezone: 'Europe/Berlin', status: 'open', remote: true }));
      setName('');
      open(id);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const join = () => {
    const token = invite.trim().split('/i/')[1] ?? invite.trim();
    if (!token) return;
    router.push({ pathname: '/i/[token]', params: { token } });
  };
  const inputStyle = { backgroundColor: th.bg, color: th.text, borderRadius: 10, padding: 12, fontSize: 16, borderWidth: 1, borderColor: th.border } as const;
  const remoteTrips = Object.values(trips).filter((x) => x.meta.remote);

  return (
    <Screen>
      <Card>
        <H2>{t('trips.local')}</H2>
        <Pressable onPress={() => { open(LOCAL_TRIP_ID); }} accessibilityRole="button">
          <Row style={{ justifyContent: 'space-between' }}>
            <Body>{trips[LOCAL_TRIP_ID]?.meta.name ?? ''}</Body>
            <Body style={{ color: th.primary }}>{t('trips.open')}</Body>
          </Row>
        </Pressable>
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
            <H2>{t('trips.create')}</H2>
            <TextInput value={name} onChangeText={setName} placeholder={t('trips.name')} placeholderTextColor={th.muted} style={inputStyle} accessibilityLabel={t('trips.name')} />
            <Row>{CURRENCIES.map((c) => <Chip key={c} label={c} selected={ccy === c} onPress={() => { setCcy(c); }} />)}</Row>
            <Button label={t('trips.create')} onPress={() => { void create(); }} disabled={!name.trim()} />
          </Card>
          <Card>
            <H2>{t('trips.join')}</H2>
            <TextInput value={invite} onChangeText={setInvite} placeholder={t('trips.joinPlaceholder')} placeholderTextColor={th.muted} style={inputStyle} accessibilityLabel={t('trips.joinPlaceholder')} autoCapitalize="none" />
            <Button kind="secondary" label={t('invite.join')} onPress={join} disabled={!invite.trim()} />
          </Card>
        </>
      )}
      {error && <Body style={{ color: th.negative }}>{error}</Body>}
    </Screen>
  );
}
