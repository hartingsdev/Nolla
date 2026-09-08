/**
 * CSV export (FR-7.8): the spreadsheet-shaped exit path, and the safety valve
 * if the group ever falls back to a sheet mid-trip (requirements §13).
 *
 * Everything about the document itself lives in the domain; this file only
 * gathers the trip from the store, translates the headings and hands the text
 * to the platform — a download on web, the share sheet on a phone.
 */
import { useCallback } from 'react';
import { Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  type ExportLabels, type PlanOptions, CSV_BOM, csvDialect, exportFilename, tripCsv,
} from '@vst/domain';
import { useBalances, useCcy, useEntries, useNames, useParticipants, usePlan, useTripMeta } from './selectors';

const OPTIMAL: PlanOptions = { kind: 'optimal' };

/** The headings, translated. Keys mirror `ExportLabels` one for one. */
function labelsFrom(t: (k: string) => string): ExportLabels {
  return {
    trip: t('export.label.trip'), currency: t('export.label.currency'), status: t('export.label.status'), exported: t('export.label.exported'),
    date: t('export.label.date'), type: t('export.label.type'), description: t('export.label.description'), reason: t('entry.reason'), category: t('export.label.category'),
    amount: t('export.label.amount'), paidBy: t('export.label.paidBy'), settled: t('export.label.settled'),
    entries: t('export.label.entries'), totals: t('export.label.totals'), participant: t('export.label.participant'),
    paid: t('export.label.paid'), owed: t('export.label.owed'), transfers: t('export.label.transfers'),
    balance: t('export.label.balance'), total: t('export.label.total'),
    settlement: t('export.label.settlement'), from: t('export.label.from'), to: t('export.label.to'),
    types: { expense: t('entry.type.expense'), transfer: t('entry.type.transfer'), adjustment: t('entry.type.adjustment') },
  };
}

/** Builds the file for the active trip. Pure enough to call from a test. */
export function useCsvFile(): () => { filename: string; text: string } {
  const { t, i18n } = useTranslation();
  const meta = useTripMeta();
  const ccy = useCcy();
  const entries = useEntries();
  const participants = useParticipants();
  const names = useNames();
  const plan = usePlan(OPTIMAL);
  const { shown } = useBalances();
  const settled = [...shown.values()].every((m) => m.minor === 0n);

  return useCallback(() => {
    const now = new Date().toISOString();
    const name = meta?.name ?? t('export.untitled');
    const text = tripCsv({
      tripName: name,
      status: t(`trip.status.${meta?.status ?? 'open'}`),
      ccy,
      participants: participants.filter((p) => !p.tombstoned).map((p) => ({ id: p.id, name: names.get(p.id) ?? p.id })),
      entries,
      // A settled trip has no plan worth printing; an open one gets the shortest.
      ...(settled ? {} : { plan }),
      generatedAt: now,
      labels: labelsFrom(t),
      dialect: csvDialect(i18n.language),
    });
    return { filename: exportFilename(name, now), text: CSV_BOM + text };
  }, [meta, ccy, entries, participants, names, plan, settled, t, i18n.language]);
}

/**
 * Hands the file to the platform. On web that is an ordinary download; on a
 * phone the file goes to the cache directory and then into the share sheet,
 * which is the only way to get it off the device.
 */
export async function saveCsv(filename: string, text: string): Promise<void> {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoking immediately can cancel the download in some browsers.
    setTimeout(() => { URL.revokeObjectURL(url); }, 10_000);
    return;
  }
  const [{ File, Paths }, Sharing] = await Promise.all([import('expo-file-system'), import('expo-sharing')]);
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  file.write(text);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: filename });
  }
}
