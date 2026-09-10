import { Alert, Platform, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useApi } from '../src/sync/useSync';
import { useStore } from '../src/store';
import { Body, Button, Card, Chip, H2, Row, Screen } from '../src/components/ui';

/**
 * App settings: everything that does NOT change when you switch trips
 * (app/trip/settings.tsx is the other half). The store already draws the same
 * line — these live at the root of it, trip settings live on a TripState.
 */
export default function AppSettings() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const api = useApi();
  const auth = useStore((s) => s.auth);
  const setAuth = useStore((s) => s.setAuth);
  const setLocale = useStore((s) => s.setLocale);
  const removeTrip = useStore((s) => s.removeTrip);
  const loadSample = useStore((s) => s.loadSample);
  const clearAll = useStore((s) => s.clearAll);

  const confirm = (msg: string, onYes: () => void) => {
    if (Platform.OS === 'web') { if (globalThis.confirm(msg)) onYes(); return; }
    Alert.alert(msg, undefined, [{ text: t('common.no'), style: 'cancel' }, { text: t('common.yes'), style: 'destructive', onPress: onYes }]);
  };
  const signOut = async () => { try { await api.logout(); } catch { /* token may already be dead */ } setAuth(null); router.replace('/trips'); };
  const deleteAccount = () => {
    confirm(t('auth.deleteConfirm'), () => {
      void api.deleteAccount().then(() => { setAuth(null); for (const x of Object.values(useStore.getState().trips)) if (x.meta.remote) removeTrip(x.meta.id); router.replace('/trips'); });
    });
  };

  return (
    <Screen>
      <Body muted style={{ fontSize: 13 }}>{t('settings.scopeHint')}</Body>

      <Card>
        <H2>{t('settings.language')}</H2>
        <Row>
          {(['en', 'de'] as const).map((l) => <Chip key={l} label={l.toUpperCase()} selected={i18n.language === l} onPress={() => { setLocale(l); }} />)}
        </Row>
      </Card>

      <Card>
        <H2>{t('settings.account')}</H2>
        {auth ? (
          <>
            <Body muted>{t('auth.signedInAs', { email: auth.email ?? auth.userId })}</Body>
            <Button kind="secondary" label={t('auth.signOut')} onPress={() => { void signOut(); }} />
            <Button kind="danger" label={t('auth.deleteAccount')} onPress={deleteAccount} />
          </>
        ) : <Button kind="secondary" label={t('auth.signIn')} onPress={() => { router.push('/signin'); }} />}
      </Card>

      {/*
        * Developer affordances, and they must never reach a shipped build (#8).
        *
        * The comparison is written out here rather than behind an imported
        * constant on purpose: Expo inlines `process.env.EXPO_PUBLIC_*` at export
        * time, so this folds to `false` at this exact site and the minifier drops
        * the branch. Behind an import it stays in the bundle as dead-but-shipped
        * code — `pnpm check:no-dev-ui` caught precisely that and fails the build
        * if the marker below ever turns up in a production export again.
        *
        * The flag is set in exactly two places, both test paths: the `e2e` script
        * and the export step of the CI job that feeds Playwright. For local work:
        * `EXPO_PUBLIC_E2E=1 pnpm --filter @vst/mobile web`.
        */}
      {process.env.EXPO_PUBLIC_E2E === '1' && (
        <View testID="nolla-dev-tools">
          <Card>
            <H2>{t('settings.developer')}</H2>
            <Button kind="secondary" label={t('settings.resetSample')} onPress={loadSample} />
            <Button kind="danger" label={t('settings.clear')} onPress={clearAll} />
          </Card>
        </View>
      )}
    </Screen>
  );
}
