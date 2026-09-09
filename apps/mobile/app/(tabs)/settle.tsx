import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { type ParticipantId, type PlanOptions, type Transfer, entryToWire, grossMatrix, nearestMoney, toPrecise } from '@vst/domain';
import { formatMoney, formatPrecise } from '../../src/format';
import { todayLocal, uuidv7 } from '../../src/ids';
import { useCcy, useEntries, useNames, useParticipants, usePlan, useWriteRules } from '../../src/selectors';
import { useStore } from '../../src/store';
import { space } from '../../src/theme';
import { Amount, Body, Button, Card, Chip, Divider, H2, Row, Screen } from '../../src/components/ui';
import { Text } from 'react-native';

type Kind = 'bilateral' | 'optimal' | 'hub';

/** Stable identity: usePlan memoises on the options object. */
const BILATERAL = { kind: 'bilateral' } as const;

export default function Settle() {
  const { t, i18n } = useTranslation();
  const participants = useParticipants();
  const addEntry = useStore((s) => s.addEntry);
  const names = useNames();
  const rules = useWriteRules();
  const [kind, setKind] = useState<Kind>('optimal');
  const [view, setView] = useState<'plans' | 'matrix'>('plans');
  const entries = useEntries();
  const ccy = useCcy();
  const matrix = useMemo(() => grossMatrix(entries, ccy), [entries, ccy]);
  const [hub, setHub] = useState<string | null>(null);
  const hubId = (hub ?? participants[0]?.id ?? '') as ParticipantId;
  const opts = useMemo<PlanOptions | { kind: 'bilateral' }>(() => {
    if (kind === 'hub') return { kind: 'hub', hub: hubId };
    if (kind === 'optimal') return { kind: 'optimal' };
    return { kind: 'bilateral' };
  }, [kind, hubId]);
  const plan = usePlan(opts);
  // The comparison FR-8.3 asks for: everything is measured against the plan the
  // group builds by hand, where everyone pays exactly the person they owe.
  const byHand = usePlan(BILATERAL);
  const saved = byHand.transfers.length - plan.transfers.length;
  const locale = i18n.language;

  const markPaid = (tr: Transfer) => {
    const id = uuidv7();
    addEntry(entryToWire({
      id, type: 'transfer', description: t('settle.pays', { from: names.get(tr.from) ?? '?', to: names.get(tr.to) ?? '?' }),
      amount: tr.amount, date: todayLocal() as never,
      payments: [{ participantId: tr.from, amount: tr.amount }],
      shares: [{ participantId: tr.to, amount: toPrecise(tr.amount) }],
      createdAt: new Date().toISOString(),
    }));
  };

  if (participants.length === 0) return <Screen><Body muted>{t('overview.empty')}</Body></Screen>;

  if (view === 'matrix') {
    const ids = participants.map((p) => p.id as ParticipantId);
    const short = (n: string) => n.slice(0, 3);
    return (
      <Screen>
        <Row>
          <Chip label={t('settle.plans')} selected={false} onPress={() => { setView('plans'); }} />
          <Chip label={t('settle.matrix')} selected onPress={() => { setView('matrix'); }} />
        </Row>
        <Card>
          <H2>{t('settle.matrix')}</H2>
          <Body muted style={{ fontSize: 13 }}>{t('settle.matrixHint')}</Body>
          <Row style={{ flexWrap: 'nowrap' }}>
            <Text style={{ width: 64 }} />
            {ids.map((c) => <Text key={c} style={{ flex: 1, textAlign: 'right', fontWeight: '600', fontSize: 12 }}>{short(names.get(c) ?? '?')}</Text>)}
          </Row>
          {ids.map((r) => (
            <Row key={r} style={{ flexWrap: 'nowrap' }}>
              <Text style={{ width: 64, fontWeight: '600', fontSize: 12 }}>{short(names.get(r) ?? '?')}</Text>
              {ids.map((c) => {
                const v = matrix.get(r)?.get(c);
                return <Text key={c} style={{ flex: 1, textAlign: 'right', fontSize: 12, fontVariant: ['tabular-nums'] }}>{r === c ? '–' : v ? formatMoney(nearestMoney(v), locale) : '·'}</Text>;
              })}
            </Row>
          ))}
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Row>
        <Chip label={t('settle.plans')} selected onPress={() => { setView('plans'); }} />
        <Chip label={t('settle.matrix')} selected={false} onPress={() => { setView('matrix'); }} />
      </Row>
      <Card>
        <Row>
          {(['bilateral', 'optimal', 'hub'] as const).map((k) => (
            <Chip key={k} selected={kind === k} onPress={() => { setKind(k); }}
              label={k === 'hub' ? t('settle.plan.hub', { name: names.get(hubId) ?? '?' }) : t(`settle.plan.${k}`)} />
          ))}
        </Row>
        {kind === 'hub' && (
          <>
            <H2>{t('settle.chooseHub')}</H2>
            <Row>{participants.map((p) => <Chip key={p.id} label={p.name} selected={p.id === hubId} onPress={() => { setHub(p.id); }} />)}</Row>
          </>
        )}
        <Body muted>
          {t('settle.transfers', { count: plan.transfers.length })}
          {kind === 'optimal' ? ` · ${plan.minimal ? t('settle.minimal') : t('settle.heuristic')}` : ''}
          {kind !== 'bilateral' && byHand.transfers.length > 0
            ? ` · ${saved > 0 ? t('settle.saved', { count: saved }) : t('settle.savedNone')}`
            : ''}
        </Body>
        <Body muted style={{ fontSize: 13 }}>{t(`settle.why.${kind}`, { name: names.get(hubId) ?? '?' })}</Body>
      </Card>

      <Card>
        {plan.transfers.length === 0 ? <Body muted>{t('settle.nothing')}</Body> : plan.transfers.map((tr, i) => (
          <View key={`${tr.from}-${tr.to}`} style={{ gap: space.sm }}>
            {i > 0 && <Divider />}
            <Row style={{ justifyContent: 'space-between' }}>
              <Body style={{ flex: 1 }}>{t('settle.pays', { from: names.get(tr.from) ?? '?', to: names.get(tr.to) ?? '?' })}</Body>
              <Amount size={18}>{formatMoney(tr.amount, locale)}</Amount>
            </Row>
            <Button kind="secondary" label={t('settle.markPaid')} onPress={() => { markPaid(tr); }} disabled={!rules.canWriteTransfer} />
          </View>
        ))}
      </Card>

      {plan.rounding.size > 0 && (
        <Card>
          <H2>{t('settle.rounding')}</H2>
          {[...plan.rounding.entries()].map(([id, delta]) => (
            <Body key={id} muted style={{ fontSize: 13 }}>{t('settle.roundingNote', { name: names.get(id) ?? '?', delta: formatPrecise(delta, locale) })}</Body>
          ))}
        </Card>
      )}
    </Screen>
  );
}
