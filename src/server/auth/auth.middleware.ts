import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../app-env';
import { constantTimeEqual } from '../crypto';
import { HttpError } from '../http/errors';
import { CSRF_HEADER, readSessionToken } from './cookies';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Exige sessão válida. Em métodos que alteram dados, exige também o cabeçalho
 * X-XSRF-TOKEN igual ao token CSRF da sessão (proteção contra CSRF com cookies).
 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const { auth, config } = c.var.services;
  const session = await auth.findSession(readSessionToken(c, config.cookieSecure));
  if (!session) throw new HttpError(401, 'Sessão expirada. Entre novamente.');
  if (
    !SAFE_METHODS.has(c.req.method) &&
    !constantTimeEqual(c.req.header(CSRF_HEADER) ?? '', session.csrfToken)
  ) {
    throw new HttpError(403, 'Token de segurança inválido. Recarregue a página.');
  }
  c.set('user', session.user);
  await next();
});

/** Usuário autenticado (definido por requireAuth). */
export function currentUser(c: { var: AppEnv['Variables'] }) {
  if (!c.var.user) throw new HttpError(401, 'Sessão expirada. Entre novamente.');
  return c.var.user;
}
