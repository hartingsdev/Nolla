import { useEffect, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ApiClient } from '../../src/api/client';
import { useApi } from '../../src/sync/useSync';
import { useStore } from '../../src/store';
import { Body, Button, Card, Screen } from '../../src/components/ui';

/** Universal-link target of the magic link: /auth/email?token=… */
export default function EmailVerify() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const api = useApi();
  const setAuth = useStore((s) => s.setAuth);
  const pendingInvite = useStore((s) => s.pendingInvite);
  const [status, setStatus] = useState<'pending' | 'failed'>(token ? 'pending' : 'failed');
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (!token) return;
    void (async () => {
      try {
        const r = await api.verifyMagicLink(token);
        const me = await new ApiClient(api.baseUrl, r.token).me();
        if (!alive.current) return;
        setAuth({ token: r.token, userId: r.userId, email: me.email });
        if (pendingInvite) router.replace({ pathname: '/i/[token]', params: { token: pendingInvite } });
        else router.replace('/trips');
      } catch { if (alive.current) setStatus('failed'); }
    })();
    return () => { alive.current = false; };
  }, [token, api, setAuth, pendingInvite, router]);

  return (
    <Screen>
      <Card>
        {status === 'failed' ? (
          <>
            <Body>{t('auth.failed')}</Body>
            <Button label={t('auth.signIn')} onPress={() => { router.replace('/signin'); }} />
          </>
        ) : <Body muted>{t('auth.verifying')}</Body>}
      </Card>
    </Screen>
  );
}
