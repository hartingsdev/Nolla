import { type ParticipantId, type WireEntry, allocate, currency, entryToWire, localDate, money, moneyFromString } from '@vst/domain';
import { type Participant } from './store';

/** The first rows of the group's real spreadsheet, so screens have something to show. */
export function sampleTrip(): { trip: { name: string; ccy: string }; participants: Participant[]; entries: WireEntry[] } {
  const EUR = currency('EUR');
  const P = ['Yannik', 'Max', 'Robert', 'Tobias', 'Marc'].map((name, i) => ({ id: `p${String(i)}`, name }));
  const id = (name: string) => (P.find((p) => p.name === name)?.id ?? 'p0') as ParticipantId;
  const all = P.map((p) => p.id as ParticipantId);
  const rows: [string, string, string, string, ParticipantId[], string][] = [
    ['Miete 1/2', '465.35', 'Robert', '2025-11-18', all, 'rent'],
    ['Reinigungskosten', '75.00', 'Robert', '2026-03-01', all, 'rent'],
    ['Einkauf Krefeld', '55.18', 'Marc', '2026-03-01', all, 'groceries'],
    ['Lidl Samstag', '75.17', 'Marc', '2026-03-01', all, 'groceries'],
    ['Tanken Samstag', '72.53', 'Yannik', '2026-03-01', all, 'fuel'],
    ['Maut Tobias', '4.00', 'Tobias', '2026-03-01', all, 'tolls'],
    ['Rulantica', '168.00', 'Marc', '2026-03-02', [id('Yannik'), id('Max'), id('Robert'), id('Tobias')], 'activity'],
    ['Pfandsammlung', '-8.75', 'Marc', '2026-03-04', all, 'groceries'],
  ];
  let k = 0;
  const entries = rows.map(([description, amt, payer, date, among, category]) => {
    const amount = moneyFromString(amt, EUR);
    const eid = `sample-${String(k++)}`;
    return entryToWire({
      id: eid, type: 'expense', description, amount, date: localDate(date), category,
      payments: [{ participantId: id(payer), amount }],
      shares: allocate(amount, { kind: 'equal', among }, { seed: eid }),
      createdAt: `${date}T12:00:00Z`,
    });
  });
  // Essen Saarbrücken: exact amounts, three people
  const s = moneyFromString('39.00', EUR);
  entries.push(entryToWire({
    id: 'sample-x', type: 'expense', description: 'Essen Saarbrücken', amount: s, date: localDate('2026-03-03'), category: 'restaurant',
    payments: [{ participantId: id('Max'), amount: s }],
    shares: allocate(s, { kind: 'exact', amounts: { [id('Yannik')]: money(1175n, EUR), [id('Max')]: money(750n, EUR), [id('Tobias')]: money(1975n, EUR) } }, { seed: 'sample-x' }),
    createdAt: '2026-03-03T20:00:00Z',
  }));
  return { trip: { name: 'Elsass 2026', ccy: 'EUR' }, participants: P, entries };
}
