import { TextInput } from 'react-native';
import { useTranslation } from 'react-i18next';
import { transition } from '@vst/domain';
import { useAllSettled, useLiveEntries } from '../src/selectors';
import { useStore } from '../src/store';
import { useTheme } from '../src/theme';
import { Body, Button, Card, Chip, H2, Row, Screen } from '../src/components/ui';

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'DKK', 'SEK', 'NOK', 'PLN', 'CZK', 'JPY'] as const;

export default function Settings() {
  const { t, i18n } = useTranslation();
  const th = useTheme();
  const trip = useStore((s) => s.trip);
  const setTripMeta = useStore((s) => s.setTripMeta);
  const setStatus = useStore((s) => s.setStatus);
  const loadSample = useStore((s) => s.loadSample);
  const clearAll = useStore((s) => s.clearAll);
  const setLocale = useStore((s) => s.setLocale);
  const hasEntries = useLiveEntries().length > 0;
  const allSettled = useAllSettled();
  const ctx = { isAdmin: true, allBalancesZero: allSettled };
  const apply = (action: 'freeze' | 'reopen' | 'close') => { const r = transition(trip.status, action, ctx); if (r.ok) setStatus(r.status); };
  const can = (action: 'freeze' | 'reopen' | 'close') => transition(trip.status, action, ctx).ok;

  return (
    <Screen>
      <Card>
        <H2>{t('trip.name')}</H2>
        <TextInput value={trip.name} onChangeText={(name) => { setTripMeta({ name }); }} accessibilityLabel={t('trip.name')}
          style={{ backgroundColor: th.bg, color: th.text, borderRadius: 10, padding: 12, fontSize: 18, borderWidth: 1, borderColor: th.border }} />
        <H2>{t('trip.currency')}</H2>
        <Row>{CURRENCIES.map((c) => <Chip key={c} label={c} selected={trip.ccy === c} onPress={() => { setTripMeta({ ccy: c }); }} disabled={hasEntries} />)}</Row>
        {hasEntries && <Body muted style={{ fontSize: 13 }}>{t('trip.currencyLocked')}</Body>}
      </Card>

      <Card>
        <H2>{t(`trip.status.${trip.status}`)}</H2>
        <Body muted>{t(`trip.statusHint.${trip.status}`)}</Body>
        <Row>
          {can('freeze') && <Button label={t('trip.freeze')} onPress={() => { apply('freeze'); }} />}
          {trip.status === 'settling' && <Button label={t('trip.close')} onPress={() => { apply('close'); }} disabled={!can('close')} />}
          {can('reopen') && <Button kind="secondary" label={t('trip.reopen')} onPress={() => { apply('reopen'); }} />}
        </Row>
        {trip.status === 'settling' && !allSettled && <Body muted style={{ fontSize: 13 }}>{t('trip.closeBlocked')}</Body>}
      </Card>

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
