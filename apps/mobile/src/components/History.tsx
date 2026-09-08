import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  type EntryDiff, type ScalarField, type WireEntry, currency, entryDiff, isEmptyDiff, moneyFromString, preciseFromString,
} from '@vst/domain';
import { type EntryHistory, type EntryRevision } from '../api/types';
import { formatDate, formatMoney, formatPrecise } from '../format';
import { useApi } from '../sync/useSync';
import { useNames, useTripMeta } from '../selectors';
import { space, useTheme } from '../theme';
import { Body, Card, Divider, H2 } from './ui';

/** One change as a person reads it: who, when, and the lines of what. */
interface Step { at: string; who: string; lines: string[] }

/**
 * The audit trail for one entry (FR-10.2).
 *
 * The server stores each state BEFORE a change, so a revision plus whatever
 * follows it — the next revision, or the entry as it stands — is one edit. The
 * diffing is the domain's; this file only turns it into sentences.
 *
 * Local-only trips have no server and therefore no history: there is nobody
 * else to have changed anything.
 */
export function History({ entryId }: { entryId: string }) {
  const { t, i18n } = useTranslation();
  const th = useTheme();
  const api = useApi();
  const meta = useTripMeta();
  const names = useNames();
  const locale = i18n.language;
  const remote = meta?.remote ?? false;
  const tripId = meta?.id ?? '';
  const [data, setData] = useState<EntryHistory | null>(null);
  const [failed, setFailed] = useState(false);

  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  /** Returns the trail, or null when it could not be fetched. */
  const load = useCallback(async (): Promise<EntryHistory | null> => {
    if (!remote) return null;
    try { return await api.entryHistory(tripId, entryId); } catch { return null; }
  }, [api, tripId, entryId, remote]);

  useEffect(() => {
    void (async () => {
      const h = await load();
      if (!mounted.current) return;
      if (h) { setData(h); setFailed(false); } else setFailed(true);
    })();
  }, [load]);

  if (!remote) return null;

  const ccy = currency(meta?.ccy ?? 'EUR');
  const who = (a: { displayName: string | null } | null) => a?.displayName ?? t('history.someone');
  const name = (id: string) => names.get(id) ?? t('history.someone');
  const money = (s: string) => formatMoney(moneyFromString(s, ccy), locale);
  const share = (s: string) => formatPrecise(preciseFromString(s, ccy), locale);

  /** One readable line per difference. Money is formatted here, where the currency is known. */
  const linesOf = (d: EntryDiff): string[] => {
    const out: string[] = [];
    for (const f of d.fields) {
      if (f.field === 'deleted') { out.push(f.to === 'true' ? t('history.deleted') : t('history.restored')); continue; }
      out.push(t('history.changed', { field: t(`history.field.${f.field}`), from: showField(f.field, f.from), to: showField(f.field, f.to) }));
    }
    for (const p of d.payments) out.push(line('history.paid', p));
    for (const s of d.shares) out.push(line('history.share', s, true));
    return out;
  };

  const showField = (field: ScalarField, v: string): string => {
    if (v === '') return t('history.nothing');
    if (field === 'amount') return money(v);
    if (field === 'date') return formatDate(v, locale);
    if (field === 'category') return t(`category.${v}`);
    if (field === 'type') return t(`entry.type.${v}`);
    return `“${v}”`;
  };

  const line = (key: string, c: { participantId: string; from: string | null; to: string | null }, precise = false): string => {
    const fmt = precise ? share : money;
    const person = name(c.participantId);
    if (c.from === null) return t(`${key}Added`, { name: person, amount: fmt(c.to ?? '0') });
    if (c.to === null) return t(`${key}Removed`, { name: person, amount: fmt(c.from) });
    return t(`${key}Changed`, { name: person, from: fmt(c.from), to: fmt(c.to) });
  };

  const steps: Step[] = [];
  if (data) {
    const after = (i: number): WireEntry => data.revisions[i + 1]?.snapshot ?? data.current;
    data.revisions.forEach((r: EntryRevision, i) => {
      const d = entryDiff(r.snapshot, after(i));
      if (!isEmptyDiff(d)) steps.push({ at: r.at, who: who(r.actor), lines: linesOf(d) });
    });
    steps.reverse(); // newest first, creation last
  }

  return (
    <Card>
      <H2>{t('history.title')}</H2>
      {failed && <Body muted style={{ fontSize: 13 }}>{t('history.unavailable')}</Body>}
      {!failed && !data && <Body muted style={{ fontSize: 13 }}>{t('history.loading')}</Body>}
      {data && (
        <View style={{ gap: space.sm }}>
          {steps.map((s, i) => (
            <View key={`${s.at}-${String(i)}`} style={{ gap: 2 }}>
              {i > 0 && <Divider />}
              <Body style={{ fontSize: 13 }}>{t('history.by', { name: s.who })}</Body>
              {s.lines.map((l, j) => <Body key={j} muted style={{ fontSize: 13 }}>{l}</Body>)}
              <Body muted style={{ fontSize: 12, color: th.muted }}>{formatDate(s.at.slice(0, 10), locale)}</Body>
            </View>
          ))}
          {steps.length > 0 && <Divider />}
          <View style={{ gap: 2 }}>
            <Body style={{ fontSize: 13 }}>{t('history.created', { name: who(data.createdBy) })}</Body>
            <Body muted style={{ fontSize: 12, color: th.muted }}>{formatDate(data.createdAt.slice(0, 10), locale)}</Body>
          </View>
        </View>
      )}
    </Card>
  );
}
