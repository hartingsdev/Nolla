import { Alert, Platform, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { type Entry, type ParticipantId, M, apportion, nearestMoney, roundAll, toPrecise } from '@vst/domain';
import { categoryIcon } from '../../../src/categories';
import { formatDate, formatMoney, formatPrecise } from '../../../src/format';
import { todayLocal, uuidv7 } from '../../../src/ids';
import { useDismiss } from '../../../src/nav';
import { useEntries, useMeId, useNames, useWriteRules } from '../../../src/selectors';
import { useStore } from '../../../src/store';
import { useTheme } from '../../../src/theme';
import { Receipts } from '../../../src/components/Receipts';
import { Amount, Body, Button, Card, Chip, Divider, H1, H2, Row, Screen } from '../../../src/components/ui';

export default function EntryDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const th = useTheme();
  const router = useRouter();
  const dismiss = useDismiss();
  const entries = useEntries();
  const names = useNames();
  const meId = useMeId();
  const deleteEntry = useStore((s) => s.deleteEntry);
  const restoreEntry = useStore((s) => s.restoreEntry);
  const addEntry = useStore((s) => s.addEntry);
  const markShareSettled = useStore((s) => s.markShareSettled);
  const rules = useWriteRules();
  const e = entries.find((x) => x.id === id);
  const locale = i18n.language;
  if (!e) return <Screen><Body muted>{t('ledger.empty')}</Body></Screen>;

  const shown = roundAll(e.shares.map((s) => s.amount), e.amount, e.id);
  const live = (tid: string) => { const x = entries.find((y) => y.id === tid); return !!x && !x.deleted; };
  const isSettled = (pid: string) => { const ids = e.settled?.[pid]?.split(',') ?? []; return ids.length > 0 && ids.every(live); };
  const payerIds = e.payments.filter((p) => !M.isZero(p.amount)).map((p) => p.participantId);

  const remove = () => {
    const doIt = () => { deleteEntry(e.id); dismiss(); };
    if (Platform.OS === 'web') { if (globalThis.confirm(t('entry.confirmDelete'))) doIt(); return; }
    Alert.alert(t('entry.confirmDelete'), undefined, [{ text: t('entry.cancel'), style: 'cancel' }, { text: t('entry.delete'), style: 'destructive', onPress: doIt }]);
  };

  /** FR-7.4 / P7: settle one share by recording a payment to each payer, proportional to what they put in. */
  const settleShare = (pid: ParticipantId, share: Entry['shares'][number]) => {
    const others = e.payments.filter((p) => !M.isZero(p.amount) && p.participantId !== pid);
    if (others.length === 0 || share.amount.scaled <= 0n) return;
    const all = e.payments.filter((p) => !M.isZero(p.amount));
    const weights = all.map((p) => (p.amount.minor < 0n ? -p.amount.minor : p.amount.minor));
    const slices = apportion(share.amount, weights, `${e.id}:${pid}`);
    const ids: string[] = [];
    all.forEach((p, i) => {
      if (p.participantId === pid) return;
      const amount = nearestMoney(slices[i] ?? toPrecise(M.abs(p.amount)));
      if (amount.minor <= 0n) return;
      const tid = uuidv7();
      ids.push(tid);
      addEntry({
        id: tid, type: 'transfer', description: t('entry.sharePaymentDesc', { description: e.description }),
        amount: formatWire(amount), ccy: amount.ccy.code, date: todayLocal(),
        payments: [{ participantId: pid, amount: formatWire(amount) }],
        shares: [{ participantId: p.participantId, amount: `${formatWire(amount)}${'0'.repeat(8 - amount.ccy.exponent)}` }],
        createdAt: new Date().toISOString(),
      });
    });
    if (ids.length) markShareSettled(e.id, pid, ids);
  };

  const editable = rules.canEdit || (e.type === 'transfer' && rules.canWriteTransfer);
  const icon = categoryIcon(e.category, e.type);

  return (
    <Screen>
      <Stack.Screen options={{ title: e.description }} />
      {e.deleted && <Card><Body style={{ color: th.negative }}>{t('entry.deletedBanner')}</Body></Card>}
      <Card>
        <H1>{icon} {formatMoney(e.amount, locale)}</H1>
        <Body muted>{formatDate(e.date, locale)} · {t(`entry.type.${e.type}`)}{e.category ? ` · ${t(`category.${e.category}`)}` : ''}</Body>
        <Body muted>
          {e.type !== 'expense'
            ? t('ledger.transferTo', { from: names.get(e.payments[0]?.participantId ?? '') ?? '?', to: names.get(e.shares[0]?.participantId ?? '') ?? '?' })
            : t('ledger.paidBy', { name: e.payments.map((p) => `${names.get(p.participantId) ?? '?'}${e.payments.length > 1 ? ` (${formatMoney(p.amount, locale)})` : ''}`).join(', ') })}
        </Body>
        {e.reason && <Body muted>{t('entry.reason')}: {e.reason}</Body>}
      </Card>
      {e.type === 'expense' && (
        <Card>
          <H2>{t('entry.shares')}</H2>
          {e.shares.map((s, i) => {
            const settled = isSettled(s.participantId);
            const canSettle = !e.deleted && rules.canWriteTransfer && !settled && s.amount.scaled > 0n && payerIds.some((p) => p !== s.participantId);
            return (
              <View key={s.participantId}>
                {i > 0 && <Divider />}
                <Row style={{ justifyContent: 'space-between' }}>
                  <Body>{names.get(s.participantId) ?? '?'}{settled ? ` ✓ ${t('entry.sharePaid')}` : ''}</Body>
                  <Amount tone={settled ? 'positive' : 'neutral'}>{formatMoney(shown[i] ?? e.amount, locale)}</Amount>
                </Row>
                {shown[i] && (shown[i].minor * 10n ** BigInt(8 - e.amount.ccy.exponent)) !== s.amount.scaled && (
                  <Body muted style={{ fontSize: 12 }}>{t('entry.roundedNote', { exact: formatPrecise(s.amount, locale) })}</Body>
                )}
                {canSettle && (
                  <Row>
                    <Chip label={s.participantId === meId ? t('entry.markSharePaid') : t('entry.markPaidFor', { name: names.get(s.participantId) ?? '?' })} selected={false}
                      onPress={() => { settleShare(s.participantId, s); }} />
                  </Row>
                )}
              </View>
            );
          })}
        </Card>
      )}
      {!e.deleted && <Receipts entryId={e.id} editable={editable} />}
      {e.deleted
        ? (editable && <Button kind="secondary" label={t('entry.restore')} onPress={() => { restoreEntry(e.id); }} />)
        : (
          <>
            {e.type === 'expense' && rules.canWriteExpense && (
              <Button kind="secondary" label={t('entry.sameAgain')} onPress={() => { router.push({ pathname: '/entry/new', params: { from: e.id } }); }} />
            )}
            {editable && <Button label={t('entry.edit')} onPress={() => { router.push({ pathname: '/entry/[id]/edit', params: { id: e.id } }); }} />}
            {editable && <Button kind="danger" label={t('entry.delete')} onPress={remove} />}
          </>
        )}
    </Screen>
  );
}

/** Money → "12.34" wire string. */
function formatWire(m: { minor: bigint; ccy: { exponent: number } }): string {
  const neg = m.minor < 0n; const abs = (neg ? -m.minor : m.minor).toString().padStart(m.ccy.exponent + 1, '0');
  const i = abs.length - m.ccy.exponent;
  return `${neg ? '-' : ''}${abs.slice(0, i)}${m.ccy.exponent ? '.' + abs.slice(i) : ''}`;
}
