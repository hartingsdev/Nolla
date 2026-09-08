import { Alert, Platform, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { roundAll } from '@vst/domain';
import { formatDate, formatMoney, formatPrecise } from '../../src/format';
import { useEntries, useNames } from '../../src/selectors';
import { useStore } from '../../src/store';
import { Amount, Body, Button, Card, Divider, H1, H2, Row, Screen } from '../../src/components/ui';

export default function EntryDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const entries = useEntries();
  const names = useNames();
  const deleteEntry = useStore((s) => s.deleteEntry);
  const e = entries.find((x) => x.id === id);
  const locale = i18n.language;
  if (!e) return <Screen><Body muted>{t('ledger.empty')}</Body></Screen>;

  const shown = roundAll(e.shares.map((s) => s.amount), e.amount, e.id);
  const remove = () => {
    const doIt = () => { deleteEntry(e.id); router.back(); };
    if (Platform.OS === 'web') { if (globalThis.confirm(t('entry.confirmDelete'))) doIt(); return; }
    Alert.alert(t('entry.confirmDelete'), undefined, [{ text: t('entry.cancel'), style: 'cancel' }, { text: t('entry.delete'), style: 'destructive', onPress: doIt }]);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: e.description }} />
      <Card>
        <H1>{formatMoney(e.amount, locale)}</H1>
        <Body muted>{formatDate(e.date, locale)} · {t(`entry.type.${e.type}`)}</Body>
        <Body muted>{t('ledger.paidBy', { name: e.payments.map((p) => names.get(p.participantId) ?? '?').join(', ') })}</Body>
      </Card>
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
      {!e.deleted && <Button kind="danger" label={t('entry.delete')} onPress={remove} />}
    </Screen>
  );
}
