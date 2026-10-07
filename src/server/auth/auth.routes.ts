import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app-env';
import { HttpError } from '../http/errors';
import { parseBody } from '../http/validation';
import { currentUser, requireAuth } from './auth.middleware';
import { clearSessionCookies, readSessionToken, setSessionCookies } from './cookies';

const loginSchema = z.object({
  email: z.string().trim().email('Informe um e-mail válido.').max(254),
  password: z.string().min(1, 'Informe a senha.').max(200),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1, 'Informe a senha atual.').max(200),
  newPassword: z.string().max(200),
});

export const authRoutes = new Hono<AppEnv>()
  .post('/login', async (c) => {
    // JSON obrigatório: formulários de outros sites não conseguem enviar (login CSRF).
    if (!c.req.header('content-type')?.startsWith('application/json'))
      throw new HttpError(415, 'Envie os dados em JSON.');
    const { auth, config } = c.var.services;
    const ip = c.req.header('cf-connecting-ip') ?? 'local';
    if (!(await auth.allowLoginAttempt(ip)))
      throw new HttpError(429, 'Muitas tentativas de login. Aguarde alguns minutos.');
    const { email, password } = parseBody(loginSchema, await c.req.json().catch(() => null));
    const session = await auth.login(email, password);
    setSessionCookies(
      c,
      config.cookieSecure,
      session.token,
      session.csrfToken,
      config.sessionHours,
    );
    return c.json({ user: session.user });
  })
  .post('/logout', requireAuth, async (c) => {
    const { auth, config } = c.var.services;
    await auth.logout(readSessionToken(c, config.cookieSecure));
    clearSessionCookies(c, config.cookieSecure);
    return c.body(null, 204);
  })
  .get('/me', requireAuth, (c) => c.json({ user: currentUser(c) }))
  .put('/password', requireAuth, async (c) => {
    const { auth, config } = c.var.services;
    const body = parseBody(passwordSchema, await c.req.json().catch(() => null));
    await auth.changePassword(currentUser(c).id, body.currentPassword, body.newPassword);
    clearSessionCookies(c, config.cookieSecure);
    return c.body(null, 204);
  });
