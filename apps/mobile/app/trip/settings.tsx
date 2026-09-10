import { useState } from 'react';
import { Alert, Platform, Pressable, TextInput } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { transition } from '@vst/domain';
import { useCsvFile, saveCsv } from '../../src/export';
import { useAllSettled, useLiveEntries, useParticipants, useTrip } from '../../src/selectors';
import { useApi } from '../../src/sync/useSync';
import { useStore } from '../../src/store';
import { useTheme } from '../../src/theme';
import { Body, Button, Card, Chip, H2, Row, Screen } from '../../src/components/ui';

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'DKK', 'SEK', 'NOK', 'PLN', 'CZK', 'JPY'] as const;

/**
 * Trip settings: everything that changes when you switch trips.
 *
 * Ordered by when in a trip's life you touch it — participants and currency at
 * setup, status and export at the end, destruction last. Participants come
 * first because in the first ten minutes they are the only setting anyone
 * needs, and because this screen is the unconditional route to them (#11): it
 * hangs off a header action that renders in every state, unlike the Balances
 * card shortcut it replaces, which is hidden exactly when there is nobody yet.
 */
export default function TripSettings() {
  const { t } = useTranslation();
  const th = useTheme();
  const router = useRouter();
  const api = useApi();
  const trip = useTrip();
  const participants = useParticipants();
  const setTripMeta = useStore((s) => s.setTripMeta);
  const setStatus = useStore((s) => s.setStatus);
  const removeTrip = useStore((s) => s.removeTrip);
  const entries = useLiveEntries();
  const hasEntries = entries.length > 0;
  const allSettled = useAllSettled();
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const csvFile = useCsvFile();
  const meta = trip.meta;
  const ctx = { isAdmin: true, allBalancesZero: allSettled };
  const can = (action: 'freeze' | 'reopen' | 'close') => transition(meta.status, action, ctx).ok;

  const apply = async (action: 'freeze' | 'reopen' | 'close') => {
    setError(null);
    const r = transition(meta.status, action, ctx);
    if (!r.ok) return;
    if (meta.remote) {
      try { const res = await api.transition(meta.id, action); setStatus(res.status); }
      catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    } else setStatus(r.status);
  };
  const rename = (name: string) => { setTripMeta({ name }); if (meta.remote) void api.patchTrip(meta.id, { name }).catch(() => { /* next sync pulls the truth */ }); };
  const createInvite = async () => {
    setError(null);
    try { const r = await api.createInvite(meta.id); setInviteUrl(r.url); setCopied(false); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const copy = async () => {
    if (!inviteUrl) return;
    try { await navigator.clipboard.writeText(inviteUrl); setCopied(true); } catch { /* shown as text anyway */ }
  };
  const confirm = (msg: string, onYes: () => void) => {
    if (Platform.OS === 'web') { if (globalThis.confirm(msg)) onYes(); return; }
    Alert.alert(msg, undefined, [{ text: t('common.no'), style: 'cancel' }, { text: t('common.yes'), style: 'destructive', onPress: onYes }]);
  };
  const exportCsv = async () => {
    setError(null);
    try { const f = csvFile(); await saveCsv(f.filename, f.text); setExported(f.filename); }
    catch (e) { setError(t('export.failed', { message: e instanceof Error ? e.message : String(e) })); }
  };
  /** Deleting the open trip leaves none open; the layout guard lands you on the list (#12). */
  const deleteTrip = () => {
    confirm(t('trip.deleteConfirm', { name: meta.name, count: entries.length }), () => {
      removeTrip(meta.id);
      router.replace('/trips');
    });
  };
  const inputStyle = { backgroundColor: th.bg, color: th.text, borderRadius: 10, padding: 12, fontSize: 18, borderWidth: 1, borderColor: th.border } as const;

  return (
    <Screen>
      <Body muted style={{ fontSize: 13 }}>{t('trip.scopeHint')}</Body>

      <Card>
        <Link href="/trip/participants" asChild>
          <Pressable accessibilityRole="button">
            <Row style={{ justifyContent: 'space-between' }}>
              <Body>{t('participants.title')}</Body>
              <Body style={{ color: th.primary }}>{participants.length > 0 ? t('participants.count', { count: participants.length }) : t('participants.add')}</Body>
            </Row>
          </Pressable>
        </Link>
        {participants.length === 0 && <Body muted style={{ fontSize: 13 }}>{t('participants.none')}</Body>}
      </Card>

      <Card>
        <H2>{t('trip.name')}</H2>
        <TextInput value={meta.name} onChangeText={rename} accessibilityLabel={t('trip.name')} style={inputStyle} />
        <H2>{t('trip.currency')}</H2>
        <Row>{CURRENCIES.map((c) => <Chip key={c} label={c} selected={meta.ccy === c} onPress={() => { setTripMeta({ ccy: c }); }} disabled={hasEntries || meta.remote} />)}</Row>
        {hasEntries && <Body muted style={{ fontSize: 13 }}>{t('trip.currencyLocked')}</Body>}
      </Card>

      <Card>
        <H2>{t('trip.sharing')}</H2>
        {meta.remote ? (
          <>
            <Button label={t('invite.create')} onPress={() => { void createInvite(); }} />
            {inviteUrl && (
              <>
                <Body muted style={{ fontSize: 13 }}>{t('invite.created')}</Body>
                <Body selectable style={{ fontSize: 13 }}>{inviteUrl}</Body>
                <Row><Chip label={copied ? t('invite.copied') : t('invite.copy')} selected={copied} onPress={() => { void copy(); }} /></Row>
              </>
            )}
          </>
        ) : <Body muted style={{ fontSize: 13 }}>{t('trip.localOnly')}</Body>}
      </Card>

      <Card>
        <H2>{t(`trip.status.${meta.status}`)}</H2>
        <Body muted>{t(`trip.statusHint.${meta.status}`)}</Body>
        <Row>
          {can('freeze') && <Button label={t('trip.freeze')} onPress={() => { void apply('freeze'); }} />}
          {meta.status === 'settling' && <Button label={t('trip.close')} onPress={() => { void apply('close'); }} disabled={!can('close')} />}
          {can('reopen') && <Button kind="secondary" label={t('trip.reopen')} onPress={() => { void apply('reopen'); }} />}
        </Row>
        {meta.status === 'settling' && !allSettled && <Body muted style={{ fontSize: 13 }}>{t('trip.closeBlocked')}</Body>}
      </Card>

      <Card>
        <H2>{t('export.title')}</H2>
        <Body muted style={{ fontSize: 13 }}>{t('export.hint')}</Body>
        <Button kind="secondary" label={t('export.csv')} onPress={() => { void exportCsv(); }} disabled={!hasEntries} />
        {exported && <Body muted style={{ fontSize: 13 }}>{t('export.done', { filename: exported })}</Body>}
      </Card>

      <Card>
        <Body muted style={{ fontSize: 13 }}>{meta.remote ? t('trip.removeDeviceHint') : t('trip.deleteHint')}</Body>
        <Button kind="danger" label={meta.remote ? t('trip.removeDevice') : t('trip.delete')} onPress={deleteTrip} />
      </Card>

      {error && <Body style={{ color: th.negative }}>{error}</Body>}
    </Screen>
  );
}
