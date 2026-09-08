import { Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { entryToWire } from '@vst/domain';
import { EntryForm } from '../../src/components/EntryForm';
import { useDismiss } from '../../src/nav';
import { useEntries, useWriteRules } from '../../src/selectors';
import { useStore } from '../../src/store';
import { Body, Screen } from '../../src/components/ui';

export default function NewEntry() {
  const { t } = useTranslation();
  const dismiss = useDismiss();
  const { kind, from } = useLocalSearchParams<{ kind?: 'transfer'; from?: string }>();
  const entries = useEntries();
  const template = from ? entries.find((e) => e.id === from) : undefined;
  const addEntry = useStore((s) => s.addEntry);
  const rules = useWriteRules();
  const allowed = [...(rules.canWriteExpense ? ['expense' as const] : []), ...(rules.canWriteTransfer ? ['transfer' as const] : [])];
  if (allowed.length === 0) return <Screen><Body muted>{t('trip.readOnly', { status: t(`trip.status.${rules.status}`) })}</Body></Screen>;
  const only = kind === 'transfer' ? (['transfer'] as const) : allowed;
  return (
    <>
      <Stack.Screen options={{ title: only.length === 1 && only[0] === 'transfer' ? t('entry.newPayment') : t('entry.new') }} />
      <EntryForm allowed={only} {...(template ? { initial: template, clone: true } : {})} onSave={(e) => { addEntry(entryToWire(e)); dismiss(); }} onCancel={dismiss} />
    </>
  );
}
