import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { emailRequest, emailVerify, providerSignIn } from '@vst/contracts';
import { userRepo } from '@vst/persistence';
import { eq } from 'drizzle-orm';
import { schema } from '@vst/persistence';
import { z } from 'zod';
import { type AppDeps } from '../app.ts';
import { deleteAccount, requestMagicLink, signInWithProvider, verifyMagicLink } from '../identity/signin.ts';
import { auth, type AuthVars } from './middleware.ts';
import { jsonBig } from './json.ts';

const ip = (h: Headers) => h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? '0.0.0.0';

export function authRoutes(deps: AppDeps) {
  const app = new Hono<{ Variables: AuthVars }>();
  const signIn = deps.signInDeps();

  for (const provider of ['apple', 'google'] as const) {
    app.post(`/auth/${provider}`, zValidator('json', providerSignIn), async (c) => {
      try {
        const r = await signInWithProvider(signIn, provider, c.req.valid('json').token, ip(c.req.raw.headers));
        deps.metrics.auth(provider, 'ok');
        return jsonBig(c, { token: r.token, userId: r.userId, isNewUser: r.isNewUser }, 200);
      } catch (e) { deps.metrics.auth(provider, 'invalid'); throw e; }
    });
  }
  app.post('/auth/email/request', zValidator('json', emailRequest), async (c) => {
    await requestMagicLink(signIn, c.req.valid('json').email, ip(c.req.raw.headers));
    deps.metrics.auth('email', 'requested');
    return c.body(null, 204);
  });
  app.post('/auth/email/verify', zValidator('json', emailVerify), async (c) => {
    try {
      const r = await verifyMagicLink(signIn, c.req.valid('json').token);
      deps.metrics.auth('email', 'ok');
      return jsonBig(c, { token: r.token, userId: r.userId, isNewUser: r.isNewUser });
    } catch (e) { deps.metrics.auth('email', 'invalid'); throw e; }
  });

  app.use('/auth/logout', auth(deps.sessions));
  app.post('/auth/logout', async (c) => { await deps.sessions.revoke(c.get('token')); return c.body(null, 204); });

  app.use('/me', auth(deps.sessions));
  app.use('/me/*', auth(deps.sessions));
  app.get('/me', async (c) => {
    const u = await userRepo.get(deps.db, c.get('userId'));
    return jsonBig(c, { id: u?.id, email: u?.email, displayName: u?.displayName, plan: u?.plan });
  });
  app.patch('/me', zValidator('json', z.object({ displayName: z.string().min(1).max(60) })), async (c) => {
    await deps.db.update(schema.users).set({ displayName: c.req.valid('json').displayName }).where(eq(schema.users.id, c.get('userId')));
    return c.body(null, 204);
  });
  /** FR-1.9, App Store 5.1.1(v). */
  app.delete('/me', async (c) => {
    await deleteAccount({ db: deps.db, sessions: deps.sessions }, c.get('userId'));
    deps.metrics.accountDeleted();
    return c.body(null, 204);
  });
  return app;
}
