import { useTranslation } from 'react-i18next';
import { useStore } from '../src/store';
import { Button, Card, Chip, H2, Row, Screen } from '../src/components/ui';

export default function Settings() {
  const { t, i18n } = useTranslation();
  const loadSample = useStore((s) => s.loadSample);
  const clearAll = useStore((s) => s.clearAll);
  const setLocale = useStore((s) => s.setLocale);
  return (
    <Screen>
      <Card>
        <H2>{t('settings.language')}</H2>
        <Row>
          {(['en', 'de'] as const).map((l) => <Chip key={l} label={l.toUpperCase()} selected={i18n.language === l} onPress={() => { setLocale(l); }} />)}
        </Row>
      </Card>
      <Card>
        <Button kind="secondary" label={t('settings.resetSample')} onPress={loadSample} />
        <Button kind="danger" label={t('settings.clear')} onPress={clearAll} />
      </Card>
    </Screen>
  );
}
