import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { categoryIcon } from '../../src/categories';
import { formatDate, formatMoney } from '../../src/format';
import { useEntries, useLiveEntries, useNames, useParticipants } from '../../src/selectors';
import { space, useTheme } from '../../src/theme';
import { Amount, Body, Card, Chip, Row, Screen } from '../../src/components/ui';

type TypeFilter = 'all' | 'expense' | 'transfer';

export default function Ledger() {
  const { t, i18n } = useTranslation();
  const th = useTheme();
  const router = useRouter();
  const live = useLiveEntries();
  const all = useEntries();
  const participants = useParticipants();
  const [showDeleted, setShowDeleted] = useState(false);
  const [query, setQuery] = useState('');
  const [type, setType] = useState<TypeFilter>('all');
  const [person, setPerson] = useState<string | null>(null);
  const deletedCount = all.filter((e) => e.deleted).length;
  const names = useNames();
  const locale = i18n.language;

  const entries = useMemo(() => {
    const base = showDeleted ? [...all].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.createdAt < b.createdAt ? 1 : -1)) : live;
    const q = query.trim().toLowerCase();
    return base.filter((e) =>
      (type === 'all' || e.type === type)
      && (!person || e.payments.some((p) => p.participantId === person) || e.shares.some((s) => s.participantId === person))
      && (!q || e.description.toLowerCase().includes(q) || (e.category ? t(`category.${e.category}`).toLowerCase().includes(q) : false)
        || e.payments.some((p) => (names.get(p.participantId) ?? '').toLowerCase().includes(q))));
  }, [showDeleted, all, live, query, type, person, names, t]);

  const header = (
    <View style={{ gap: space.sm, marginBottom: space.sm }}>
      <TextInput value={query} onChangeText={setQuery} placeholder={t('ledger.search')} placeholderTextColor={th.muted} accessibilityLabel={t('ledger.search')}
        style={{ backgroundColor: th.card, color: th.text, borderRadius: 10, padding: 12, fontSize: 16, borderWidth: 1, borderColor: th.border }} />
      <Row>
        {(['all', 'expense', 'transfer'] as const).map((k) => (
          <Chip key={k} label={k === 'all' ? t('ledger.all') : t(`entry.type.${k}`)} selected={type === k} onPress={() => { setType(k); }} />
        ))}
        {deletedCount > 0 && <Chip label={showDeleted ? t('ledger.hideDeleted') : `${t('ledger.showDeleted')} (${String(deletedCount)})`} selected={showDeleted} onPress={() => { setShowDeleted((v) => !v); }} />}
      </Row>
      {participants.length > 0 && (
        <Row>{participants.map((p) => <Chip key={p.id} label={p.name} selected={person === p.id} onPress={() => { setPerson(person === p.id ? null : p.id); }} />)}</Row>
      )}
    </View>
  );

  return (
    <Screen scroll={false}>
      <FlatList
        data={entries}
        keyExtractor={(e) => e.id}
        contentContainerStyle={{ padding: space.lg, gap: space.sm }}
        ListHeaderComponent={header}
        ListEmptyComponent={<Body muted>{all.length === 0 ? t('ledger.empty') : t('ledger.noMatch')}</Body>}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item: e }) => (
          <Pressable onPress={() => { router.push({ pathname: '/entry/[id]', params: { id: e.id } }); }}>
            <Card style={{ paddingVertical: space.md, opacity: e.deleted ? 0.5 : 1 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Body numberOfLines={1} style={{ textDecorationLine: e.deleted ? 'line-through' : 'none' }}>{categoryIcon(e.category, e.type)} {e.description}{e.deleted ? ` · ${t('ledger.deleted')}` : ''}</Body>
                  <Body muted style={{ fontSize: 13 }}>
                    {formatDate(e.date, locale)} · {t(`entry.type.${e.type}`)} · {e.type === 'transfer'
                      ? t('ledger.transferTo', { from: names.get(e.payments[0]?.participantId ?? '') ?? '?', to: names.get(e.shares[0]?.participantId ?? '') ?? '?' })
                      : t('ledger.paidBy', { name: e.payments.map((p) => names.get(p.participantId) ?? '?').join(', ') })}
                  </Body>
                </View>
                <Amount tone={e.amount.minor < 0n ? 'positive' : 'neutral'}>{formatMoney(e.amount, locale)}</Amount>
              </Row>
              {e.type !== 'transfer' && <Body muted style={{ fontSize: 12, color: th.muted }}>{e.shares.map((s) => names.get(s.participantId) ?? '?').join(' · ')}</Body>}
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}
