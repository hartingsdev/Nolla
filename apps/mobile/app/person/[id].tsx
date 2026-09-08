import { Pressable, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { type ParticipantId, M, nearestMoney, participantTotals, roundAll, zeroMoney } from '@vst/domain';
import { formatDate, formatMoney } from '../../src/format';
import { useBalances, useCcy, useEntries, useLiveEntries, useNames } from '../../src/selectors';
import { Amount, Body, Card, Divider, H1, H2, Row, Screen } from '../../src/components/ui';

export default function PersonDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const ccy = useCcy();
  const all = useEntries();
  const live = useLiveEntries();
  const names = useNames();
  const { shown } = useBalances();
  const pid = id as ParticipantId;
  const locale = i18n.language;
  const totals = participantTotals(all, ccy).get(pid);
  const balance = shown.get(pid) ?? zeroMoney(ccy);
  const mine = live.filter((e) => e.payments.some((p) => p.participantId === pid) || e.shares.some((s) => s.participantId === pid));

  return (
    <Screen>
      <Stack.Screen options={{ title: names.get(pid) ?? '?' }} />
      <Card>
        <H1 style={{ color: balance.minor < 0n ? '#B91C1C' : balance.minor > 0n ? '#15803D' : undefined }}>
          {M.isZero(balance) ? t('person.settled') : balance.minor < 0n ? t('person.owes', { amount: formatMoney(M.abs(balance), locale) }) : t('person.getsBack', { amount: formatMoney(balance, locale) })}
        </H1>
        <Row style={{ justifyContent: 'space-between' }}><Body muted>{t('person.paid')}</Body><Amount>{formatMoney(totals?.paid ?? zeroMoney(ccy), locale)}</Amount></Row>
        <Row style={{ justifyContent: 'space-between' }}><Body muted>{t('person.owed')}</Body><Amount>{formatMoney(totals ? nearestMoney(totals.owed) : zeroMoney(ccy), locale)}</Amount></Row>
      </Card>
      <Card>
        <H2>{t('person.entries')}</H2>
        {mine.length === 0 ? <Body muted>{t('ledger.empty')}</Body> : mine.map((e, i) => {
          const pay = e.payments.find((p) => p.participantId === pid);
          const shareIdx = e.shares.findIndex((s) => s.participantId === pid);
          const share = shareIdx >= 0 ? roundAll(e.shares.map((s) => s.amount), e.amount, e.id)[shareIdx] : undefined;
          const parts: string[] = [];
          if (e.type === 'transfer') parts.push(pay ? t('person.sent', { amount: formatMoney(pay.amount, locale) }) : t('person.received', { amount: formatMoney(e.amount, locale) }));
          else {
            if (pay) parts.push(t('person.paidAmount', { amount: formatMoney(pay.amount, locale) }));
            if (share) parts.push(t('person.share', { amount: formatMoney(share, locale) }));
          }
          return (
            <Pressable key={e.id} onPress={() => { router.push({ pathname: '/entry/[id]', params: { id: e.id } }); }}>
              {i > 0 && <Divider />}
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Body numberOfLines={1}>{e.description}</Body>
                  <Body muted style={{ fontSize: 13 }}>{formatDate(e.date, locale)} · {parts.join(' · ')}</Body>
                </View>
                <Amount>{formatMoney(e.amount, locale)}</Amount>
              </Row>
            </Pressable>
          );
        })}
      </Card>
    </Screen>
  );
}
