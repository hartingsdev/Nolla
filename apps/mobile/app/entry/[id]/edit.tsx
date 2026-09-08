import { Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { entryToWire } from '@vst/domain';
import { EntryForm } from '../../../src/components/EntryForm';
import { useDismiss } from '../../../src/nav';
import { useEntries, useWriteRules } from '../../../src/selectors';
import { useStore } from '../../../src/store';
import { Body, Screen } from '../../../src/components/ui';

export default function EditEntry() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const dismiss = useDismiss();
  const entries = useEntries();
  const updateEntry = useStore((s) => s.updateEntry);
  const rules = useWriteRules();
  const e = entries.find((x) => x.id === id);
  if (!e) return <Screen><Body muted>{t('ledger.empty')}</Body></Screen>;
  if (!rules.canEdit) return <Screen><Body muted>{t('trip.readOnly', { status: t(`trip.status.${rules.status}`) })}</Body></Screen>;
  return (
    <>
      <Stack.Screen options={{ title: t('entry.edit') }} />
      <EntryForm initial={e} allowed={['expense', 'transfer']} onSave={(n) => { updateEntry(entryToWire(n)); dismiss(); }} onCancel={dismiss} />
    </>
  );
}
