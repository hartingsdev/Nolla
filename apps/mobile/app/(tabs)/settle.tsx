import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { type ParticipantId, type PlanOptions, type Transfer, entryToWire, toPrecise } from '@vst/domain';
import { formatMoney, formatPrecise } from '../../src/format';
import { todayLocal, uuidv7 } from '../../src/ids';
import { useNames, usePlan, useWriteRules } from '../../src/selectors';
import { useStore } from '../../src/store';
import { space } from '../../src/theme';
import { Amount, Body, Button, Card, Chip, Divider, H2, Row, Screen } from '../../src/components/ui';

type Kind = 'bilateral' | 'optimal' | 'hub';

export default function Settle() {
  const { t, i18n } = useTranslation();
  const participants = useStore((s) => s.participants);
  const addEntry = useStore((s) => s.addEntry);
  const names = useNames();
  const rules = useWriteRules();
  const [kind, setKind] = useState<Kind>('optimal');
  const [hub, setHub] = useState<string | null>(null);
  const hubId = (hub ?? participants[0]?.id ?? '') as ParticipantId;
  const opts = useMemo<PlanOptions | { kind: 'bilateral' }>(() => {
    if (kind === 'hub') return { kind: 'hub', hub: hubId };
    if (kind === 'optimal') return { kind: 'optimal' };
    return { kind: 'bilateral' };
  }, [kind, hubId]);
  const plan = usePlan(opts);
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

  return (
    <Screen>
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
        </Body>
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
