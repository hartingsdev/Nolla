import { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { TextInput } from 'react-native';
import { useTranslation } from 'react-i18next';
import { uuidv7 } from '../../src/ids';
import { useApi } from '../../src/sync/useSync';
import { emptyTrip } from '../../src/sync/merge';
import { useStore } from '../../src/store';
import { useTheme } from '../../src/theme';
import { Body, Button, Card, Chip, H2, Row, Screen } from '../../src/components/ui';

/** Universal-link target of an invite: /i/<token>. Redeemed only after sign-in (FR-1.2). */
export default function Invite() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { t } = useTranslation();
  const th = useTheme();
  const router = useRouter();
  const api = useApi();
  const auth = useStore((s) => s.auth);
  const setPendingInvite = useStore((s) => s.setPendingInvite);
  const upsertTrip = useStore((s) => s.upsertTrip);
  const setActiveTrip = useStore((s) => s.setActiveTrip);
  const setTrip = useStore((s) => s.setTrip);
  const [state, setState] = useState<{ tripId: string; participantId: string | null; unclaimed: { id: string; displayName: string }[] } | 'loading' | 'invalid'>('loading');
  const [chosen, setChosen] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (!auth) { setPendingInvite(token); router.replace('/signin'); return; }
    let cancelled = false;
    void api.acceptInvite(token).then((r) => { if (!cancelled) { setPendingInvite(null); setState(r); } }).catch(() => { if (!cancelled) setState('invalid'); });
    return () => { cancelled = true; };
  }, [auth, token, api, router, setPendingInvite]);

  const finish = async (tripId: string, meId: string) => {
    const info = await api.getTrip(tripId);
    const meta = info.trip;
    if (meta) upsertTrip({ ...emptyTrip({ id: tripId, name: meta.name, ccy: meta.baseCcy, timezone: meta.timezone, status: meta.status, remote: true }), meId });
    setTrip(tripId, (s) => ({ ...s, meId }));
    setActiveTrip(tripId);
    router.replace('/');
  };
  const claim = async () => {
    if (state === 'loading' || state === 'invalid') return;
    if (chosen) { await api.claimParticipant(state.tripId, chosen); await finish(state.tripId, chosen); return; }
    const id = uuidv7();
    await api.addParticipant(state.tripId, { id, displayName: newName.trim() });
    await api.claimParticipant(state.tripId, id);
    await finish(state.tripId, id);
  };

  if (state === 'loading') return <Screen><Card><Body muted>{t('invite.accepting')}</Body></Card></Screen>;
  if (state === 'invalid') return <Screen><Card><Body>{t('invite.invalid')}</Body><Button label={t('trips.title')} onPress={() => { router.replace('/trips'); }} /></Card></Screen>;
  if (state.participantId) { void finish(state.tripId, state.participantId); return <Screen><Card><Body muted>{t('invite.accepting')}</Body></Card></Screen>; }

  return (
    <Screen>
      <Card>
        <H2>{t('invite.whoAreYou')}</H2>
        <Row>{state.unclaimed.map((p) => <Chip key={p.id} label={p.displayName} selected={chosen === p.id} onPress={() => { setChosen(chosen === p.id ? null : p.id); setNewName(''); }} />)}</Row>
        <H2>{t('invite.newParticipant')}</H2>
        <TextInput value={newName} onChangeText={(v) => { setNewName(v); setChosen(null); }} placeholder={t('invite.namePlaceholder')} placeholderTextColor={th.muted}
          style={{ backgroundColor: th.bg, color: th.text, borderRadius: 10, padding: 12, fontSize: 16, borderWidth: 1, borderColor: th.border }} accessibilityLabel={t('invite.namePlaceholder')} />
        <Button label={t('invite.join')} onPress={() => { void claim(); }} disabled={!chosen && !newName.trim()} />
      </Card>
    </Screen>
  );
}
