import { useState } from 'react';
import { Switch, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  type Entry, type Money, type ParticipantId, type Payment, type SplitRule, DomainError, M, allocate, exactResidual, localDate, moneyFromString, moneyToString, roundAll, toPrecise, validateEntry, zeroMoney,
} from '@vst/domain';
import { formatMoney, normalizeAmountInput } from '../format';
import { todayLocal, uuidv7 } from '../ids';
import { useCcy, useMeId, useParticipants } from '../selectors';
import { space, useTheme } from '../theme';
import { Body, Button, Card, Chip, H2, Row, Screen } from './ui';
import { CATEGORIES, CATEGORY_ICON } from '../categories';

type Kind = 'expense' | 'transfer';

interface Props {
  readonly initial?: Entry;
  /** Use `initial` as a template only: new id, today's date (FR-2.7 "same again"). */
  readonly clone?: boolean;
  /** Restrict the form to one kind (e.g. transfers only while settling). */
  readonly allowed: readonly Kind[];
  readonly onSave: (e: Entry) => void;
  readonly onCancel: () => void;
}

/** "12.34" / "12,34" for inputs: locale decimal separator, no grouping. */
const plainFor = (locale: string) => (m: Money) => { const s = moneyToString(M.abs(m)); return locale.startsWith('de') ? s.replace('.', ',') : s; };

export function EntryForm({ initial, clone = false, allowed, onSave, onCancel }: Props) {
  const { t, i18n } = useTranslation();
  const th = useTheme();
  const ccy = useCcy();
  const participants = useParticipants();
  const meId = useMeId();
  const locale = i18n.language;
  const plain = plainFor(locale);

  const initKind: Kind = initial?.type === 'transfer' ? 'transfer' : 'expense';
  const [kind, setKind] = useState<Kind>(allowed.includes(initKind) ? initKind : (allowed[0] ?? 'expense'));
  const [amountRaw, setAmountRaw] = useState(initial ? plain(initial.amount) : '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [refund, setRefund] = useState(initial ? initial.amount.minor < 0n : false);
  const [date, setDate] = useState<string>(initial && !clone ? initial.date : todayLocal());
  const [category, setCategory] = useState<string | null>(initial?.category ?? null);
  // expense: payers (1..n) with per-payer amounts when several
  const [payers, setPayers] = useState<string[]>(initial && initial.type !== 'transfer' ? initial.payments.map((p) => p.participantId) : meId ? [meId] : []);
  const [payerAmounts, setPayerAmounts] = useState<Record<string, string>>(
    initial && initial.type !== 'transfer' && initial.payments.length > 1 ? Object.fromEntries(initial.payments.map((p) => [p.participantId, plain(p.amount)])) : {});
  const [among, setAmong] = useState<Set<string>>(() => new Set(initial && initial.type !== 'transfer' ? initial.shares.map((s) => s.participantId) : participants.map((p) => p.id)));
  const [mode, setMode] = useState<'equal' | 'exact'>(() => {
    if (!initial || initial.type === 'transfer') return 'equal';
    const first = initial.shares[0]?.amount.scaled ?? 0n;
    return initial.shares.every((s) => { const d = s.amount.scaled - first; return d >= -1n && d <= 1n; }) ? 'equal' : 'exact';
  });
  const [exact, setExact] = useState<Record<string, string>>(() => {
    if (!initial || initial.type === 'transfer') return {};
    const shown = roundAll(initial.shares.map((s) => s.amount), initial.amount, initial.id);
    return Object.fromEntries(initial.shares.map((s, i) => [s.participantId, plain(shown[i] ?? zeroMoney(ccy))]));
  });
  // transfer
  const [from, setFrom] = useState<string | null>(initial?.type === 'transfer' ? initial.payments[0]?.participantId ?? null : meId);
  const [to, setTo] = useState<string | null>(initial?.type === 'transfer' ? initial.shares[0]?.participantId ?? null : null);
  const [error, setError] = useState<string | null>(null);

  const amount: Money | null = (() => {
    const n = normalizeAmountInput(amountRaw);
    if (n === null) return null;
    try { const m = M.abs(moneyFromString(n, ccy)); return kind === 'expense' && refund ? M.neg(m) : m; } catch { return null; }
  })();
  const parse = (raw: string | undefined): Money => { const n = normalizeAmountInput(raw ?? ''); return n === null ? zeroMoney(ccy) : moneyFromString(n, ccy); };

  const selected = participants.filter((p) => among.has(p.id));
  const exactAmounts = selected.map((p) => parse(exact[p.id]));
  const shareResidual = amount && kind === 'expense' && mode === 'exact' ? exactResidual(amount, exactAmounts) : null;
  const multiPayer = payers.length > 1;
  const payerResidual = amount && kind === 'expense' && multiPayer
    ? M.sub(amount, M.sum(payers.map((id) => { const m = parse(payerAmounts[id]); return amount.minor < 0n ? M.neg(m) : m; }), ccy))
    : null;

  const preview = (() => {
    if (kind !== 'expense' || !amount || selected.length === 0 || mode !== 'equal') return null;
    try { return roundAll(allocate(amount, { kind: 'equal', among: selected.map((p) => p.id as ParticipantId) }, { seed: 'preview' }).map((s) => s.amount), amount, 'preview')[0] ?? null; } catch { return null; }
  })();

  const toggleAmong = (id: string) => { setAmong((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };
  const togglePayer = (id: string) => { setPayers((ps) => (ps.includes(id) ? ps.filter((x) => x !== id) : [...ps, id])); };
  const assignRest = (id: string) => {
    if (!shareResidual) return;
    setExact((e) => ({ ...e, [id]: plain(M.add(parse(e[id]), shareResidual)) }));
  };
  const assignPayerRest = (id: string) => {
    if (!payerResidual) return;
    setPayerAmounts((e) => ({ ...e, [id]: plain(M.add(parse(e[id]), M.abs(payerResidual))) }));
  };

  const save = () => {
    setError(null);
    if (!amount || M.isZero(amount)) { setError(t('entry.invalid.amount')); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setError(t('entry.invalid.date')); return; }
    const id = initial && !clone ? initial.id : uuidv7();
    const createdAt = initial && !clone ? initial.createdAt : new Date().toISOString();
    try {
      let entry: Entry;
      if (kind === 'transfer') {
        if (!from || !to || from === to) { setError(t('entry.invalid.transfer')); return; }
        entry = {
          id, type: 'transfer', description: description.trim() || t('entry.paymentDefault'), amount, date: localDate(date),
          payments: [{ participantId: from as ParticipantId, amount }],
          shares: [{ participantId: to as ParticipantId, amount: toPrecise(amount) }],
          createdAt, deleted: false,
        };
      } else {
        if (!description.trim()) { setError(t('entry.invalid.description')); return; }
        if (payers.length === 0) { setError(t('entry.invalid.payer')); return; }
        if (selected.length === 0) { setError(t('entry.invalid.split')); return; }
        if (payerResidual && !M.isZero(payerResidual)) { setError(t('entry.invalid.payers')); return; }
        const payments: Payment[] = multiPayer
          ? payers.map((pid) => { const m = parse(payerAmounts[pid]); return { participantId: pid as ParticipantId, amount: amount.minor < 0n ? M.neg(m) : m }; })
          : [{ participantId: payers[0] as ParticipantId, amount }];
        const rule: SplitRule = mode === 'equal'
          ? { kind: 'equal', among: selected.map((p) => p.id as ParticipantId) }
          : { kind: 'exact', amounts: Object.fromEntries(selected.map((p, i) => [p.id, exactAmounts[i] ?? zeroMoney(ccy)])) };
        entry = { id, type: 'expense', description: description.trim(), amount, date: localDate(date), payments, shares: allocate(amount, rule, { seed: id }), createdAt, deleted: false, ...(category ? { category } : {}) };
      }
      validateEntry(entry);
      onSave(entry);
    } catch (e) {
      setError(e instanceof DomainError ? e.message : String(e));
    }
  };

  const inputStyle = { backgroundColor: th.bg, color: th.text, borderRadius: 10, padding: 12, fontSize: 18, borderWidth: 1, borderColor: th.border } as const;
  const disabled = !amount || (kind === 'expense' && (selected.length === 0 || (shareResidual !== null && !M.isZero(shareResidual)) || (payerResidual !== null && !M.isZero(payerResidual)))) || (kind === 'transfer' && (!from || !to || from === to));

  return (
    <Screen>
      {allowed.length > 1 && (
        <Row>
          <Chip label={t('entry.type.expense')} selected={kind === 'expense'} onPress={() => { setKind('expense'); }} />
          <Chip label={t('entry.type.transfer')} selected={kind === 'transfer'} onPress={() => { setKind('transfer'); }} />
        </Row>
      )}

      <Card>
        <H2>{t('entry.amount')}</H2>
        <TextInput value={amountRaw} onChangeText={setAmountRaw} keyboardType="decimal-pad" autoFocus={!initial} placeholder="0,00" placeholderTextColor={th.muted}
          style={[inputStyle, { fontSize: 34, fontWeight: '700', textAlign: 'center' }]} accessibilityLabel={t('entry.amount')} />
        {kind === 'expense' && (
          <Row style={{ justifyContent: 'space-between' }}>
            <Body>{t('entry.refund')}</Body>
            <Switch value={refund} onValueChange={setRefund} />
          </Row>
        )}
        <H2>{t('entry.description')}</H2>
        <TextInput value={description} onChangeText={setDescription} placeholder={kind === 'transfer' ? t('entry.paymentDefault') : t('entry.descriptionPlaceholder')} placeholderTextColor={th.muted} style={inputStyle} accessibilityLabel={t('entry.description')} />
        {kind === 'expense' && (
          <>
            <H2>{t('category.label')}</H2>
            <Row>{CATEGORIES.map((c) => <Chip key={c} label={`${CATEGORY_ICON[c]} ${t(`category.${c}`)}`} selected={category === c} onPress={() => { setCategory(category === c ? null : c); }} />)}</Row>
          </>
        )}
        <H2>{t('entry.date')}</H2>
        <Row>
          <TextInput value={date} onChangeText={setDate} placeholder={t('entry.dateHint')} placeholderTextColor={th.muted} style={[inputStyle, { flex: 1 }]} accessibilityLabel={t('entry.date')} autoCapitalize="none" />
          <Chip label={t('entry.today')} selected={false} onPress={() => { setDate(todayLocal()); }} />
        </Row>
      </Card>

      {kind === 'transfer' ? (
        <Card>
          <H2>{t('entry.from')}</H2>
          <Row>{participants.map((p) => <Chip key={p.id} label={p.name} selected={from === p.id} onPress={() => { setFrom(p.id); }} />)}</Row>
          <H2>{t('entry.to')}</H2>
          <Row>{participants.map((p) => <Chip key={p.id} label={p.name} selected={to === p.id} onPress={() => { setTo(p.id); }} disabled={from === p.id} />)}</Row>
        </Card>
      ) : (
        <>
          <Card>
            <H2>{multiPayer ? t('entry.payers') : t('entry.paidBy')}</H2>
            <Row>{participants.map((p) => <Chip key={p.id} label={p.name} selected={payers.includes(p.id)} onPress={() => { togglePayer(p.id); }} />)}</Row>
            {multiPayer && payers.map((pid) => {
              const p = participants.find((x) => x.id === pid);
              return (
                <Row key={pid} style={{ justifyContent: 'space-between' }}>
                  <Body style={{ flex: 1 }}>{p?.name ?? '?'}</Body>
                  <TextInput value={payerAmounts[pid] ?? ''} onChangeText={(v) => { setPayerAmounts((e) => ({ ...e, [pid]: v })); }} keyboardType="decimal-pad" placeholder="0,00" placeholderTextColor={th.muted}
                    style={[inputStyle, { width: 120, textAlign: 'right' }]} accessibilityLabel={`${t('entry.paidBy')} ${p?.name ?? ''}`} />
                </Row>
              );
            })}
            {payerResidual && !M.isZero(payerResidual) && (
              <View style={{ gap: space.sm }}>
                <Body style={{ color: th.negative }}>{t('entry.payerResidual', { amount: formatMoney(M.abs(payerResidual), locale) })}</Body>
                <Row>{payers.map((pid) => <Chip key={pid} label={t('entry.assignRest', { name: participants.find((x) => x.id === pid)?.name ?? '?' })} selected={false} onPress={() => { assignPayerRest(pid); }} />)}</Row>
              </View>
            )}
          </Card>

          <Card>
            <H2>{t('entry.splitAmong')}</H2>
            <Row>{participants.map((p) => <Chip key={p.id} label={p.name} selected={among.has(p.id)} onPress={() => { toggleAmong(p.id); }} />)}</Row>
            <Row>
              <Chip label={t('entry.split.equal')} selected={mode === 'equal'} onPress={() => { setMode('equal'); }} />
              <Chip label={t('entry.split.exact')} selected={mode === 'exact'} onPress={() => { setMode('exact'); }} />
            </Row>
            {mode === 'equal' && preview && <Body muted>{t('entry.perPerson', { amount: formatMoney(preview, locale) })}</Body>}
            {mode === 'exact' && selected.map((p) => (
              <Row key={p.id} style={{ justifyContent: 'space-between' }}>
                <Body style={{ flex: 1 }}>{p.name}</Body>
                <TextInput value={exact[p.id] ?? ''} onChangeText={(v) => { setExact((e) => ({ ...e, [p.id]: v })); }} keyboardType="decimal-pad" placeholder="0,00" placeholderTextColor={th.muted}
                  style={[inputStyle, { width: 120, textAlign: 'right' }]} accessibilityLabel={p.name} />
              </Row>
            ))}
            {shareResidual && !M.isZero(shareResidual) && (
              <View style={{ gap: space.sm }}>
                <Body style={{ color: th.negative }}>
                  {shareResidual.minor > 0n ? t('entry.residual', { amount: formatMoney(shareResidual, locale) }) : t('entry.residualNegative', { amount: formatMoney(M.abs(shareResidual), locale) })}
                </Body>
                <Row>{selected.map((p) => <Chip key={p.id} label={t('entry.assignRest', { name: p.name })} selected={false} onPress={() => { assignRest(p.id); }} />)}</Row>
              </View>
            )}
          </Card>
        </>
      )}

      {error && <Body style={{ color: th.negative }}>{error}</Body>}
      <Button label={t('entry.save')} onPress={save} disabled={disabled} />
      <Button kind="secondary" label={t('entry.cancel')} onPress={onCancel} />
    </Screen>
  );
}
