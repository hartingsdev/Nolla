import { useRouter } from 'expo-router';
import { FlatList, Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatDate, formatMoney } from '../../src/format';
import { useLiveEntries, useNames } from '../../src/selectors';
import { space, useTheme } from '../../src/theme';
import { Amount, Body, Card, Row, Screen } from '../../src/components/ui';

export default function Ledger() {
  const { t, i18n } = useTranslation();
  const th = useTheme();
  const router = useRouter();
  const entries = useLiveEntries();
  const names = useNames();
  const locale = i18n.language;
  return (
    <Screen scroll={false}>
      <FlatList
        data={entries}
        keyExtractor={(e) => e.id}
        contentContainerStyle={{ padding: space.lg, gap: space.sm }}
        ListEmptyComponent={<Body muted>{t('ledger.empty')}</Body>}
        renderItem={({ item: e }) => (
          <Pressable onPress={() => { router.push({ pathname: '/entry/[id]', params: { id: e.id } }); }}>
            <Card style={{ paddingVertical: space.md }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Body numberOfLines={1}>{e.description}</Body>
                  <Body muted style={{ fontSize: 13 }}>
                    {formatDate(e.date, locale)} · {t(`entry.type.${e.type}`)} · {e.type === 'transfer'
                      ? t('ledger.transferTo', { from: names.get(e.payments[0]?.participantId ?? '') ?? '?', to: names.get(e.shares[0]?.participantId ?? '') ?? '?' })
                      : t('ledger.paidBy', { name: e.payments.map((p) => names.get(p.participantId) ?? '?').join(', ') })}
                  </Body>
                </View>
                <Amount tone={e.amount.minor < 0n ? 'positive' : 'neutral'}>{formatMoney(e.amount, locale)}</Amount>
              </Row>
              <Body muted style={{ fontSize: 12, color: th.muted }}>{e.shares.map((s) => names.get(s.participantId) ?? '?').join(' · ')}</Body>
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}
