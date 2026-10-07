import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

/** Nome lido automaticamente pelo HttpClient do Angular para o cabeçalho X-XSRF-TOKEN. */
export const CSRF_COOKIE = 'XSRF-TOKEN';
export const CSRF_HEADER = 'x-xsrf-token';

/** Com HTTPS, o prefixo __Host- obriga Secure, Path=/ e ausência de Domain. */
const sessionCookieName = (secure: boolean) => (secure ? '__Host-sid' : 'sid');

export const readSessionToken = (c: Context, secure: boolean) =>
  getCookie(c, sessionCookieName(secure));

export function setSessionCookies(
  c: Context,
  secure: boolean,
  token: string,
  csrf: string,
  hours: number,
): void {
  const base = { secure, sameSite: 'Lax', path: '/', maxAge: hours * 3600 } as const;
  setCookie(c, sessionCookieName(secure), token, { ...base, httpOnly: true });
  // O token CSRF precisa ser legível pelo JavaScript da própria origem (double submit).
  setCookie(c, CSRF_COOKIE, csrf, { ...base, httpOnly: false });
}

export function clearSessionCookies(c: Context, secure: boolean): void {
  deleteCookie(c, sessionCookieName(secure), { path: '/', secure });
  deleteCookie(c, CSRF_COOKIE, { path: '/', secure });
}
