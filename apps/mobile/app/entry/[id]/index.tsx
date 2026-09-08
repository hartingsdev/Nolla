import { Alert, Platform, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { roundAll } from '@vst/domain';
import { formatDate, formatMoney, formatPrecise } from '../../../src/format';
import { useEntries, useNames, useWriteRules } from '../../../src/selectors';
import { useStore } from '../../../src/store';
import { useTheme } from '../../../src/theme';
import { Amount, Body, Button, Card, Divider, H1, H2, Row, Screen } from '../../../src/components/ui';

export default function EntryDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const th = useTheme();
  const router = useRouter();
  const entries = useEntries();
  const names = useNames();
  const deleteEntry = useStore((s) => s.deleteEntry);
  const restoreEntry = useStore((s) => s.restoreEntry);
  const rules = useWriteRules();
  const e = entries.find((x) => x.id === id);
  const locale = i18n.language;
  if (!e) return <Screen><Body muted>{t('ledger.empty')}</Body></Screen>;

  const shown = roundAll(e.shares.map((s) => s.amount), e.amount, e.id);
  const remove = () => {
    const doIt = () => { deleteEntry(e.id); router.back(); };
    if (Platform.OS === 'web') { if (globalThis.confirm(t('entry.confirmDelete'))) doIt(); return; }
    Alert.alert(t('entry.confirmDelete'), undefined, [{ text: t('entry.cancel'), style: 'cancel' }, { text: t('entry.delete'), style: 'destructive', onPress: doIt }]);
  };
  const editable = rules.canEdit || (e.type === 'transfer' && rules.canWriteTransfer);

  return (
    <Screen>
      <Stack.Screen options={{ title: e.description }} />
      {e.deleted && <Card><Body style={{ color: th.negative }}>{t('entry.deletedBanner')}</Body></Card>}
      <Card>
        <H1>{formatMoney(e.amount, locale)}</H1>
        <Body muted>{formatDate(e.date, locale)} · {t(`entry.type.${e.type}`)}</Body>
        <Body muted>
          {e.type === 'transfer'
            ? t('ledger.transferTo', { from: names.get(e.payments[0]?.participantId ?? '') ?? '?', to: names.get(e.shares[0]?.participantId ?? '') ?? '?' })
            : t('ledger.paidBy', { name: e.payments.map((p) => `${names.get(p.participantId) ?? '?'}${e.payments.length > 1 ? ` (${formatMoney(p.amount, locale)})` : ''}`).join(', ') })}
        </Body>
      </Card>
      {e.type !== 'transfer' && (
        <Card>
          <H2>{t('entry.shares')}</H2>
          {e.shares.map((s, i) => (
            <View key={s.participantId}>
              {i > 0 && <Divider />}
              <Row style={{ justifyContent: 'space-between' }}>
                <Body>{names.get(s.participantId) ?? '?'}</Body>
                <Amount>{formatMoney(shown[i] ?? e.amount, locale)}</Amount>
              </Row>
              {shown[i] && (shown[i].minor * 10n ** BigInt(8 - e.amount.ccy.exponent)) !== s.amount.scaled && (
                <Body muted style={{ fontSize: 12 }}>{t('entry.roundedNote', { exact: formatPrecise(s.amount, locale) })}</Body>
              )}
            </View>
          ))}
        </Card>
      )}
      {e.deleted
        ? (editable && <Button kind="secondary" label={t('entry.restore')} onPress={() => { restoreEntry(e.id); }} />)
        : editable && (
          <>
            <Button label={t('entry.edit')} onPress={() => { router.push({ pathname: '/entry/[id]/edit', params: { id: e.id } }); }} />
            <Button kind="danger" label={t('entry.delete')} onPress={remove} />
          </>
        )}
    </Screen>
  );
}
