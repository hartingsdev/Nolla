import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Switch, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  type Money, type ParticipantId, type SplitRule, DomainError, M, allocate, entryToWire, exactResidual, moneyFromString, roundAll, zeroMoney, localDate,
} from '@vst/domain';
import { formatMoney, normalizeAmountInput } from '../../src/format';
import { todayLocal, uuidv7 } from '../../src/ids';
import { useCcy } from '../../src/selectors';
import { useStore } from '../../src/store';
import { space, useTheme } from '../../src/theme';
import { Body, Button, Card, Chip, H2, Row, Screen } from '../../src/components/ui';

export default function NewEntry() {
  const { t, i18n } = useTranslation();
  const th = useTheme();
  const router = useRouter();
  const ccy = useCcy();
  const participants = useStore((s) => s.participants);
  const meId = useStore((s) => s.meId);
  const addEntry = useStore((s) => s.addEntry);
  const locale = i18n.language;

  const [amountRaw, setAmountRaw] = useState('');
  const [description, setDescription] = useState('');
  const [refund, setRefund] = useState(false);
  const [payer, setPayer] = useState<string | null>(meId);
  const [among, setAmong] = useState<Set<string>>(() => new Set(participants.map((p) => p.id)));
  const [mode, setMode] = useState<'equal' | 'exact'>('equal');
  const [exact, setExact] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const amount: Money | null = (() => {
    const n = normalizeAmountInput(amountRaw);
    if (n === null) return null;
    try { const m = moneyFromString(n, ccy); return refund ? M.neg(M.abs(m)) : M.abs(m); } catch { return null; }
  })();

  const selected = participants.filter((p) => among.has(p.id));
  const exactAmounts = selected.map((p) => { const n = normalizeAmountInput(exact[p.id] ?? ''); return n === null ? zeroMoney(ccy) : moneyFromString(n, ccy); });
  const residual = amount && mode === 'exact' ? exactResidual(amount, exactAmounts) : null;

  const preview = (() => {
    if (!amount || selected.length === 0) return null;
    try {
      const rule: SplitRule = mode === 'equal'
        ? { kind: 'equal', among: selected.map((p) => p.id as ParticipantId) }
        : { kind: 'exact', amounts: Object.fromEntries(selected.map((p, i) => [p.id, exactAmounts[i] ?? zeroMoney(ccy)])) };
      const shares = allocate(amount, rule, { seed: 'preview' });
      return roundAll(shares.map((s) => s.amount), amount, 'preview');
    } catch { return null; }
  })();

  const toggle = (id: string) => { setAmong((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };
  const assignRest = (id: string) => {
    if (!residual) return;
    const i = selected.findIndex((p) => p.id === id);
    const cur = exactAmounts[i] ?? zeroMoney(ccy);
    setExact((e) => ({ ...e, [id]: M.add(cur, residual).minor === 0n ? '0' : formatPlain(M.add(cur, residual)) }));
  };

  const save = () => {
    if (!amount) { setError(t('entry.invalid.amount')); return; }
    if (!description.trim()) { setError(t('entry.invalid.description')); return; }
    if (!payer) { setError(t('entry.invalid.payer')); return; }
    if (selected.length === 0) { setError(t('entry.invalid.split')); return; }
    const id = uuidv7();
    try {
      const rule: SplitRule = mode === 'equal'
        ? { kind: 'equal', among: selected.map((p) => p.id as ParticipantId) }
        : { kind: 'exact', amounts: Object.fromEntries(selected.map((p, i) => [p.id, exactAmounts[i] ?? zeroMoney(ccy)])) };
      const shares = allocate(amount, rule, { seed: id });
      addEntry(entryToWire({
        id, type: 'expense', description: description.trim(), amount, date: localDate(todayLocal()),
        payments: [{ participantId: payer as ParticipantId, amount }], shares, createdAt: new Date().toISOString(),
      }));
      router.back();
    } catch (e) {
      setError(e instanceof DomainError ? e.message : String(e));
    }
  };

  const inputStyle = { backgroundColor: th.bg, color: th.text, borderRadius: 10, padding: 12, fontSize: 18, borderWidth: 1, borderColor: th.border } as const;

  return (
    <Screen>
      <Card>
        <H2>{t('entry.amount')}</H2>
        <TextInput value={amountRaw} onChangeText={setAmountRaw} keyboardType="decimal-pad" autoFocus placeholder="0,00" placeholderTextColor={th.muted}
          style={[inputStyle, { fontSize: 34, fontWeight: '700', textAlign: 'center' }]} accessibilityLabel={t('entry.amount')} />
        <Row style={{ justifyContent: 'space-between' }}>
          <Body>{t('entry.refund')}</Body>
          <Switch value={refund} onValueChange={setRefund} />
        </Row>
        <H2>{t('entry.description')}</H2>
        <TextInput value={description} onChangeText={setDescription} placeholder={t('entry.descriptionPlaceholder')} placeholderTextColor={th.muted} style={inputStyle} accessibilityLabel={t('entry.description')} />
      </Card>

      <Card>
        <H2>{t('entry.paidBy')}</H2>
        <Row>{participants.map((p) => <Chip key={p.id} label={p.name} selected={payer === p.id} onPress={() => { setPayer(p.id); }} />)}</Row>
      </Card>

      <Card>
        <H2>{t('entry.splitAmong')}</H2>
        <Row>{participants.map((p) => <Chip key={p.id} label={p.name} selected={among.has(p.id)} onPress={() => { toggle(p.id); }} />)}</Row>
        <Row>
          <Chip label={t('entry.split.equal')} selected={mode === 'equal'} onPress={() => { setMode('equal'); }} />
          <Chip label={t('entry.split.exact')} selected={mode === 'exact'} onPress={() => { setMode('exact'); }} />
        </Row>
        {mode === 'equal' && preview?.[0] && (
          <Body muted>{t('entry.perPerson', { amount: formatMoney(preview[0], locale) })}</Body>
        )}
        {mode === 'exact' && selected.map((p) => (
          <Row key={p.id} style={{ justifyContent: 'space-between' }}>
            <Body style={{ flex: 1 }}>{p.name}</Body>
            <TextInput value={exact[p.id] ?? ''} onChangeText={(v) => { setExact((e) => ({ ...e, [p.id]: v })); }} keyboardType="decimal-pad" placeholder="0,00" placeholderTextColor={th.muted}
              style={[inputStyle, { width: 120, textAlign: 'right' }]} accessibilityLabel={p.name} />
          </Row>
        ))}
        {residual && !M.isZero(residual) && (
          <View style={{ gap: space.sm }}>
            <Body style={{ color: th.negative }}>
              {residual.minor > 0n ? t('entry.residual', { amount: formatMoney(residual, locale) }) : t('entry.residualNegative', { amount: formatMoney(M.abs(residual), locale) })}
            </Body>
            <Row>{selected.map((p) => <Chip key={p.id} label={t('entry.assignRest', { name: p.name })} selected={false} onPress={() => { assignRest(p.id); }} />)}</Row>
          </View>
        )}
      </Card>

      {error && <Body style={{ color: th.negative }}>{error}</Body>}
      <Button label={t('entry.save')} onPress={save} disabled={!amount || selected.length === 0 || (residual !== null && !M.isZero(residual))} />
      <Button kind="secondary" label={t('entry.cancel')} onPress={() => { router.back(); }} />
    </Screen>
  );
}

function formatPlain(m: Money): string {
  const s = (m.minor < 0n ? -m.minor : m.minor).toString().padStart(m.ccy.exponent + 1, '0');
  const i = s.length - m.ccy.exponent;
  return `${m.minor < 0n ? '-' : ''}${s.slice(0, i)}${m.ccy.exponent ? '.' + s.slice(i) : ''}`;
}
