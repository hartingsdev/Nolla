import { Link, useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { type ParticipantId, M, zeroMoney } from '@vst/domain';
import { categoryIcon } from '../../src/categories';
import { formatDate, formatMoney } from '../../src/format';
import { useBalances, useCcy, useLiveEntries, useMeId, useNames, useOffline, useParticipants, useTrip, useWriteRules } from '../../src/selectors';
import { requestSync, useSyncing } from '../../src/sync/useSync';
import { useStore } from '../../src/store';
import { space, useTheme } from '../../src/theme';
import { Amount, Body, Card, Chip, Divider, H1, H2, Row, Screen } from '../../src/components/ui';

export default function Overview() {
  const { t, i18n } = useTranslation();
  const th = useTheme();
  const router = useRouter();
  const ccy = useCcy();
  const participants = useParticipants();
  const meId = useMeId();
  const setMe = useStore((s) => s.setMe);
  const trip = useTrip();
  const syncing = useSyncing();
  const offline = useOffline();
  const dismissConflict = useStore((s) => s.dismissConflict);
  const hydrated = useStore((s) => s.hydrated);
  const { shown, cost } = useBalances();
  const rules = useWriteRules();
  const entries = useLiveEntries();
  const names = useNames();
  const locale = i18n.language;
  /** Hand-booked corrections deserve their own line in the summary (FR-6.2). */
  const adjustments = entries.filter((e) => e.type === 'adjustment');

  if (!hydrated) return <Screen scroll={false}><View /></Screen>;

  const mine = meId ? shown.get(meId as ParticipantId) ?? zeroMoney(ccy) : null;
  const headline = mine === null ? null
    : M.isZero(mine) ? t('overview.settled')
    : mine.minor < 0n ? t('overview.youOwe', { amount: formatMoney(M.abs(mine), locale) })
    : t('overview.youGetBack', { amount: formatMoney(mine, locale) });

  return (
    <Screen>
      {trip.meta.remote && (
        <Card style={{ paddingVertical: space.sm }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Body muted style={{ fontSize: 13, flex: 1 }}>
              {offline ? t('sync.offline')
                : trip.syncError ? t('sync.error', { message: trip.syncError })
                : trip.outbox.length > 0 ? t('sync.pending', { count: trip.outbox.length })
                : trip.lastSyncAt ? t('sync.synced') : t('sync.never')}
            </Body>
            <Pressable onPress={() => { void requestSync(); }} disabled={syncing} accessibilityRole="button"><Body style={{ color: th.primary, fontSize: 13 }}>{t('sync.now')}</Body></Pressable>
          </Row>
        </Card>
      )}
      {Object.entries(trip.conflicts).map(([id, mine]) => (
        <Card key={id}>
          <Body style={{ color: th.negative }}>{t('sync.conflict')}</Body>
          <Body muted style={{ fontSize: 13 }}>{t('sync.conflictMine')} {mine.description} · {mine.amount} {mine.ccy}</Body>
          <Row><Chip label={t('sync.dismiss')} selected={false} onPress={() => { dismissConflict(id); }} /></Row>
        </Card>
      ))}
      {rules.status !== 'open' && (
        <Card>
          <H2>{t(`trip.status.${rules.status}`)}</H2>
          <Body muted>{t(`trip.statusHint.${rules.status}`)}</Body>
        </Card>
      )}
      <Card>
        {participants.length === 0 ? (
          <Body muted>{t('overview.empty')}</Body>
        ) : mine === null ? (
          <>
            <H2>{t('overview.whoAreYou')}</H2>
            <Row>{participants.map((p) => <Chip key={p.id} label={p.name} selected={false} onPress={() => { setMe(p.id); }} />)}</Row>
          </>
        ) : (
          <>
            <H1 style={{ color: mine.minor < 0n ? th.negative : mine.minor > 0n ? th.positive : th.text }}>{headline}</H1>
            <Row style={{ justifyContent: 'space-between' }}>
              <Body muted>{t('overview.tripCost')}</Body>
              <Amount>{formatMoney(cost, locale)}</Amount>
            </Row>
          </>
        )}
      </Card>

      {participants.length > 0 && (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <H2>{t('overview.balances')}</H2>
            <Link href="/participants" asChild><Pressable accessibilityRole="button"><Body style={{ color: th.primary }}>{t('participants.title')}</Body></Pressable></Link>
          </Row>
          {participants.map((p, i) => {
            const b = shown.get(p.id as ParticipantId) ?? zeroMoney(ccy);
            const tone = b.minor < 0n ? 'negative' : b.minor > 0n ? 'positive' : 'neutral';
            const label = M.isZero(b) ? t('person.settled') : b.minor < 0n ? t('person.owes', { amount: formatMoney(M.abs(b), locale) }) : t('person.getsBack', { amount: formatMoney(b, locale) });
            return (
              <Pressable key={p.id} onPress={() => { router.push({ pathname: '/person/[id]', params: { id: p.id } }); }} accessibilityRole="button">
                {i > 0 && <Divider />}
                <Row style={{ justifyContent: 'space-between' }}>
                  <Body>{p.name}{p.id === meId ? ` (${t('participants.you')})` : ''}</Body>
                  <Amount tone={tone}>{label}</Amount>
                </Row>
              </Pressable>
            );
          })}
        </Card>
      )}

      {adjustments.length > 0 && (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <H2>{t('overview.adjustments')}</H2>
            <Amount>{formatMoney(M.sum(adjustments.map((e) => e.amount), ccy), locale)}</Amount>
          </Row>
          <Body muted style={{ fontSize: 13 }}>{t('overview.adjustmentsHint')}</Body>
          {adjustments.map((e, i) => (
            <Pressable key={e.id} onPress={() => { router.push({ pathname: '/entry/[id]', params: { id: e.id } }); }} accessibilityRole="button">
              {i > 0 && <Divider />}
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Body numberOfLines={1}>{t('ledger.transferTo', { from: names.get(e.payments[0]?.participantId ?? '') ?? '?', to: names.get(e.shares[0]?.participantId ?? '') ?? '?' })}</Body>
                  {e.reason && <Body muted numberOfLines={1} style={{ fontSize: 13 }}>{e.reason}</Body>}
                </View>
                <Amount>{formatMoney(e.amount, locale)}</Amount>
              </Row>
            </Pressable>
          ))}
        </Card>
      )}

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <H2>{t('overview.recent')}</H2>
          <Link href="/trips" asChild><Pressable accessibilityRole="button"><Body style={{ color: th.primary }}>{t('trips.title')}</Body></Pressable></Link>
          <Link href="/settings" asChild><Pressable accessibilityRole="button"><Body style={{ color: th.primary }}>{t('settings.title')}</Body></Pressable></Link>
        </Row>
        {entries.length === 0 ? <Body muted>{t('ledger.empty')}</Body> : entries.slice(0, 5).map((e, i) => (
          <Pressable key={e.id} onPress={() => { router.push({ pathname: '/entry/[id]', params: { id: e.id } }); }}>
            {i > 0 && <Divider />}
            <Row style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Body numberOfLines={1}>{categoryIcon(e.category, e.type)} {e.description}</Body>
                {e.dispute && <Body style={{ fontSize: 12, color: th.negative }}>{t('dispute.flag')}</Body>}
                <Body muted style={{ fontSize: 13 }}>
                  {formatDate(e.date, locale)} · {e.type !== 'expense'
                    ? t('ledger.transferTo', { from: names.get(e.payments[0]?.participantId ?? '') ?? '?', to: names.get(e.shares[0]?.participantId ?? '') ?? '?' })
                    : t('ledger.paidBy', { name: e.payments.map((p) => names.get(p.participantId) ?? '?').join(', ') })}
                </Body>
              </View>
              <Amount tone={e.amount.minor < 0n ? 'positive' : 'neutral'}>{formatMoney(e.amount, locale)}</Amount>
            </Row>
          </Pressable>
        ))}
      </Card>

      {rules.canWriteTransfer && participants.length > 0 && (
        <Link href={{ pathname: '/entry/new', params: { kind: 'transfer' } }} asChild>
          <Pressable accessibilityRole="button"><Body style={{ color: th.primary, textAlign: 'center' }}>{t('overview.addPayment')}</Body></Pressable>
        </Link>
      )}
      {rules.canWriteTransfer && (
      <Pressable onPress={() => { router.push(rules.canWriteExpense ? '/entry/new' : { pathname: '/entry/new', params: { kind: 'transfer' } }); }} accessibilityRole="button" accessibilityLabel={rules.canWriteExpense ? t('overview.add') : t('overview.addPayment')}
        style={({ pressed }) => ({ position: 'absolute', right: space.lg, bottom: space.lg, width: 60, height: 60, borderRadius: 30, backgroundColor: th.primary, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1, elevation: 4 })}>
        <Text style={{ color: th.onPrimary, fontSize: 32, lineHeight: 36 }}>{'+'}</Text>
      </Pressable>
      )}
    </Screen>
  );
}
