import { useState } from 'react';
import { Switch, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  type Entry, type Money, type ParticipantId, type Payment, type SplitRule, type Surcharge, BPS_TOTAL, DomainError, M, allocate, exactResidual, localDate, moneyFromString, moneyToString, roundAll, toPrecise, validateEntry, zeroMoney,
} from '@vst/domain';
import { formatMoney, normalizeAmountInput } from '../format';
import { bpsToText, parseBps, parseWeight, seedPercents } from '../split-input';
import { todayLocal, uuidv7 } from '../ids';
import { useCcy, useMeId, useParticipants } from '../selectors';
import { space, useTheme } from '../theme';
import { Body, Button, Card, Chip, H2, Row, Screen } from './ui';
import { CATEGORIES, CATEGORY_ICON } from '../categories';

type Kind = 'expense' | 'transfer' | 'adjustment';
/** How the amount is divided (FR-3.1–3.5). The rule is applied at save time, not stored. */
type Mode = 'equal' | 'weights' | 'percent' | 'exact';

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

  const initKind: Kind = initial?.type ?? 'expense';
  const [kind, setKind] = useState<Kind>(allowed.includes(initKind) ? initKind : (allowed[0] ?? 'expense'));
  const [amountRaw, setAmountRaw] = useState(initial ? plain(initial.amount) : '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [refund, setRefund] = useState(initial ? initial.amount.minor < 0n : false);
  /** Mandatory on an adjustment (FR-6.1): a correction nobody can explain is worse than none. */
  const [reason, setReason] = useState(initial?.reason ?? '');
  const [date, setDate] = useState<string>(initial && !clone ? initial.date : todayLocal());
  const [category, setCategory] = useState<string | null>(initial?.category ?? null);
  // expense: payers (1..n) with per-payer amounts when several
  const [payers, setPayers] = useState<string[]>(initial?.type === 'expense' ? initial.payments.map((p) => p.participantId) : meId ? [meId] : []);
  const [payerAmounts, setPayerAmounts] = useState<Record<string, string>>(
    initial?.type === 'expense' && initial.payments.length > 1 ? Object.fromEntries(initial.payments.map((p) => [p.participantId, plain(p.amount)])) : {});
  const [among, setAmong] = useState<Set<string>>(() => new Set(initial?.type === 'expense' ? initial.shares.map((s) => s.participantId) : participants.map((p) => p.id)));
  // Only equal and exact can be recovered from stored shares; a weighted entry
  // reopens as the exact amounts it produced, which is lossless if not literal.
  const [mode, setMode] = useState<Mode>(() => {
    if (initial?.type !== 'expense') return 'equal';
    const first = initial.shares[0]?.amount.scaled ?? 0n;
    return initial.shares.every((s) => { const d = s.amount.scaled - first; return d >= -1n && d <= 1n; }) ? 'equal' : 'exact';
  });
  const [exact, setExact] = useState<Record<string, string>>(() => {
    if (initial?.type !== 'expense') return {};
    const shown = roundAll(initial.shares.map((s) => s.amount), initial.amount, initial.id);
    return Object.fromEntries(initial.shares.map((s, i) => [s.participantId, plain(shown[i] ?? zeroMoney(ccy))]));
  });
  /** Per-person tip carved out of the amount (FR-3.7, the sheet's `Trinkgeld p.P.`). */
  const [tipRaw, setTipRaw] = useState('');
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [percents, setPercents] = useState<Record<string, string>>({});
  // transfer
  const [from, setFrom] = useState<string | null>(initial && initial.type !== 'expense' ? initial.payments[0]?.participantId ?? null : meId);
  const [to, setTo] = useState<string | null>(initial && initial.type !== 'expense' ? initial.shares[0]?.participantId ?? null : null);
  const [error, setError] = useState<string | null>(null);

  const amount: Money | null = (() => {
    const n = normalizeAmountInput(amountRaw);
    if (n === null) return null;
    try { const m = M.abs(moneyFromString(n, ccy)); return kind === 'expense' && refund ? M.neg(m) : m; } catch { return null; }
  })();
  const parse = (raw: string | undefined): Money => { const n = normalizeAmountInput(raw ?? ''); return n === null ? zeroMoney(ccy) : moneyFromString(n, ccy); };

  const selected = participants.filter((p) => among.has(p.id));
  const exactAmounts = selected.map((p) => parse(exact[p.id]));
  // The tip is part of what was paid, so it comes off the top and the rest is split by the rule.
  const tip = refund ? zeroMoney(ccy) : parse(tipRaw);
  const surcharges: Surcharge[] = M.isZero(tip) ? [] : selected.map((p) => ({ participantId: p.id as ParticipantId, amount: tip }));
  const tipTotal = M.sum(surcharges.map((x) => x.amount), ccy);
  const tipTooBig = amount !== null && M.cmp(tipTotal, M.abs(amount)) > 0;
  const shareResidual = amount && kind === 'expense' && mode === 'exact' ? exactResidual(amount, exactAmounts, surcharges) : null;
  const multiPayer = payers.length > 1;
  const payerResidual = amount && kind === 'expense' && multiPayer
    ? M.sub(amount, M.sum(payers.map((id) => { const m = parse(payerAmounts[id]); return amount.minor < 0n ? M.neg(m) : m; }), ccy))
    : null;

  const weightSum = selected.reduce((acc, p) => acc + parseWeight(weights[p.id]), 0n);
  const bpsResidual = mode === 'percent' ? BPS_TOTAL - selected.reduce((acc, p) => acc + parseBps(percents[p.id]), 0n) : 0n;

  /** The rule the current inputs describe. `allocate` decides whether it is usable. */
  const rule: SplitRule | null = (() => {
    const ids = selected.map((p) => p.id as ParticipantId);
    if (kind !== 'expense' || ids.length === 0) return null;
    switch (mode) {
      case 'equal': return { kind: 'equal', among: ids };
      case 'weights': return { kind: 'weights', weights: Object.fromEntries(selected.map((p) => [p.id, parseWeight(weights[p.id])])) };
      case 'percent': return { kind: 'percent', bps: Object.fromEntries(selected.map((p) => [p.id, parseBps(percents[p.id])])) };
      case 'exact': return { kind: 'exact', amounts: Object.fromEntries(selected.map((p, i) => [p.id, exactAmounts[i] ?? zeroMoney(ccy)])) };
    }
  })();

  /** What each person would owe, in the order of `selected`. Null while the inputs don't add up. */
  const previewShares: Money[] | null = (() => {
    if (!amount || !rule) return null;
    try { return roundAll(allocate(amount, rule, { seed: 'preview', surcharges }).map((s) => s.amount), amount, 'preview'); } catch { return null; }
  })();
  const preview = mode === 'equal' ? previewShares?.[0] ?? null : null;

  const toggleAmong = (id: string) => { setAmong((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };
  const togglePayer = (id: string) => { setPayers((ps) => (ps.includes(id) ? ps.filter((x) => x !== id) : [...ps, id])); };
  const assignRest = (id: string) => {
    if (!shareResidual) return;
    setExact((e) => ({ ...e, [id]: plain(M.add(parse(e[id]), shareResidual)) }));
  };
  const assignRestPercent = (id: string) => {
    setPercents((e) => ({ ...e, [id]: bpsToText(parseBps(e[id]) + bpsResidual, locale) }));
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
      if (kind !== 'expense') {
        if (!from || !to || from === to) { setError(t('entry.invalid.transfer')); return; }
        if (kind === 'adjustment' && !reason.trim()) { setError(t('entry.invalid.reason')); return; }
        entry = {
          id, type: kind, description: description.trim() || t(kind === 'adjustment' ? 'entry.adjustmentDefault' : 'entry.paymentDefault'), amount, date: localDate(date),
          payments: [{ participantId: from as ParticipantId, amount }],
          shares: [{ participantId: to as ParticipantId, amount: toPrecise(amount) }],
          createdAt, deleted: false,
          ...(kind === 'adjustment' ? { reason: reason.trim() } : {}),
        };
      } else {
        if (!description.trim()) { setError(t('entry.invalid.description')); return; }
        if (payers.length === 0) { setError(t('entry.invalid.payer')); return; }
        if (selected.length === 0) { setError(t('entry.invalid.split')); return; }
        if (payerResidual && !M.isZero(payerResidual)) { setError(t('entry.invalid.payers')); return; }
        const payments: Payment[] = multiPayer
          ? payers.map((pid) => { const m = parse(payerAmounts[pid]); return { participantId: pid as ParticipantId, amount: amount.minor < 0n ? M.neg(m) : m }; })
          : [{ participantId: payers[0] as ParticipantId, amount }];
        if (mode === 'weights' && weightSum === 0n) { setError(t('entry.invalid.weights')); return; }
        if (mode === 'percent' && bpsResidual !== 0n) { setError(t('entry.invalid.percent')); return; }
        if (!rule) { setError(t('entry.invalid.split')); return; }
        if (tipTooBig) { setError(t('entry.invalid.tip')); return; }
        entry = { id, type: 'expense', description: description.trim(), amount, date: localDate(date), payments, shares: allocate(amount, rule, { seed: id, surcharges }), createdAt, deleted: false, ...(category ? { category } : {}) };
      }
      validateEntry(entry);
      onSave(entry);
    } catch (e) {
      setError(e instanceof DomainError ? e.message : String(e));
    }
  };

  const inputStyle = { backgroundColor: th.bg, color: th.text, borderRadius: 10, padding: 12, fontSize: 18, borderWidth: 1, borderColor: th.border } as const;
  const splitIncomplete = tipTooBig
    || (shareResidual !== null && !M.isZero(shareResidual))
    || (mode === 'weights' && weightSum === 0n)
    || (mode === 'percent' && bpsResidual !== 0n);
  const disabled = !amount
    || (kind === 'expense' && (selected.length === 0 || splitIncomplete || (payerResidual !== null && !M.isZero(payerResidual))))
    || (kind !== 'expense' && (!from || !to || from === to))
    || (kind === 'adjustment' && !reason.trim());

  return (
    <Screen>
      {allowed.length > 1 && (
        <Row>
          {allowed.map((k) => <Chip key={k} label={t(`entry.type.${k}`)} selected={kind === k} onPress={() => { setKind(k); }} />)}
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
        <TextInput value={description} onChangeText={setDescription} placeholder={kind === 'expense' ? t('entry.descriptionPlaceholder') : t(kind === 'adjustment' ? 'entry.adjustmentDefault' : 'entry.paymentDefault')} placeholderTextColor={th.muted} style={inputStyle} accessibilityLabel={t('entry.description')} />
        {kind === 'expense' && (
          <>
            <H2>{t('category.label')}</H2>
            <Row>{CATEGORIES.map((c) => <Chip key={c} label={`${CATEGORY_ICON[c]} ${t(`category.${c}`)}`} selected={category === c} onPress={() => { setCategory(category === c ? null : c); }} />)}</Row>
          </>
        )}
        {kind === 'adjustment' && (
          <>
            <H2>{t('entry.reason')}</H2>
            <TextInput value={reason} onChangeText={setReason} placeholder={t('entry.reasonPlaceholder')} placeholderTextColor={th.muted} style={inputStyle} accessibilityLabel={t('entry.reason')} />
            <Body muted style={{ fontSize: 13 }}>{t('entry.reasonHint')}</Body>
          </>
        )}
        <H2>{t('entry.date')}</H2>
        <Row>
          <TextInput value={date} onChangeText={setDate} placeholder={t('entry.dateHint')} placeholderTextColor={th.muted} style={[inputStyle, { flex: 1 }]} accessibilityLabel={t('entry.date')} autoCapitalize="none" />
          <Chip label={t('entry.today')} selected={false} onPress={() => { setDate(todayLocal()); }} />
        </Row>
      </Card>

      {kind !== 'expense' ? (
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
            {!refund && (
              <Row style={{ justifyContent: 'space-between' }}>
                <Body style={{ flex: 1 }}>{t('entry.tipPerPerson')}</Body>
                <TextInput value={tipRaw} onChangeText={setTipRaw} keyboardType="decimal-pad" placeholder="0,00" placeholderTextColor={th.muted}
                  style={[inputStyle, { width: 120, textAlign: 'right' }]} accessibilityLabel={t('entry.tipPerPerson')} />
              </Row>
            )}
            {!M.isZero(tipTotal) && !tipTooBig && <Body muted style={{ fontSize: 13 }}>{t('entry.tipTotal', { amount: formatMoney(tipTotal, locale) })}</Body>}
            {tipTooBig && <Body style={{ color: th.negative }}>{t('entry.invalid.tip')}</Body>}
            <Row>
              <Chip label={t('entry.split.equal')} selected={mode === 'equal'} onPress={() => { setMode('equal'); }} />
              <Chip label={t('entry.split.weights')} selected={mode === 'weights'} onPress={() => { setMode('weights'); }} />
              <Chip label={t('entry.split.percent')} selected={mode === 'percent'} onPress={() => { setMode('percent'); setPercents(seedPercents(selected.map((p) => p.id), locale)); }} />
              <Chip label={t('entry.split.exact')} selected={mode === 'exact'} onPress={() => { setMode('exact'); }} />
            </Row>
            {mode === 'equal' && preview && <Body muted>{t('entry.perPerson', { amount: formatMoney(preview, locale) })}</Body>}
            {mode === 'weights' && <Body muted style={{ fontSize: 13 }}>{t('entry.split.weightsHint')}</Body>}
            {(mode === 'weights' || mode === 'percent') && selected.map((p, i) => (
              <Row key={p.id} style={{ justifyContent: 'space-between' }}>
                <Body style={{ flex: 1 }}>{p.name}</Body>
                {previewShares && <Body muted>{formatMoney(previewShares[i] ?? zeroMoney(ccy), locale)}</Body>}
                <TextInput
                  value={mode === 'weights' ? weights[p.id] ?? '1' : percents[p.id] ?? ''}
                  onChangeText={(v) => { if (mode === 'weights') setWeights((e) => ({ ...e, [p.id]: v })); else setPercents((e) => ({ ...e, [p.id]: v })); }}
                  keyboardType={mode === 'weights' ? 'number-pad' : 'decimal-pad'} placeholder={mode === 'weights' ? '1' : '0'} placeholderTextColor={th.muted}
                  style={[inputStyle, { width: 90, textAlign: 'right' }]} accessibilityLabel={p.name} />
              </Row>
            ))}
            {mode === 'weights' && weightSum === 0n && <Body style={{ color: th.negative }}>{t('entry.invalid.weights')}</Body>}
            {mode === 'percent' && bpsResidual !== 0n && (
              <View style={{ gap: space.sm }}>
                <Body style={{ color: th.negative }}>
                  {bpsResidual > 0n ? t('entry.percentResidual', { percent: bpsToText(bpsResidual, locale) }) : t('entry.percentOver', { percent: bpsToText(-bpsResidual, locale) })}
                </Body>
                <Row>{selected.map((p) => <Chip key={p.id} label={t('entry.assignRest', { name: p.name })} selected={false} onPress={() => { assignRestPercent(p.id); }} />)}</Row>
              </View>
            )}
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
