import type { Env } from './platform';

/** Configuração derivada das variáveis do Worker. Nenhum valor aqui chega ao navegador. */
export interface ServerConfig {
  readonly isProduction: boolean;
  readonly publicSiteUrl: string;
  readonly allowedHosts: readonly string[];
  readonly cookieSecure: boolean;
  readonly sessionHours: number;
  readonly seedDemo: boolean;
  readonly admin: {
    readonly email: string;
    readonly password: string;
    readonly name: string;
    readonly resetPassword: boolean;
  };
  readonly login: {
    readonly maxFailedAttempts: number;
    readonly lockMinutes: number;
    readonly maxPerIpPer15Min: number;
  };
}

type Vars = Partial<Record<keyof Env, unknown>>;

const text = (value: unknown, fallback = '') =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

function int(value: unknown, fallback: number): number {
  const parsed = Number(text(value));
  return text(value) && Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

const bool = (value: unknown, fallback: boolean) =>
  text(value) ? ['1', 'true', 'sim', 'yes'].includes(text(value).toLowerCase()) : fallback;

export function loadConfig(vars: Vars): ServerConfig {
  const isProduction = text(vars.ENVIRONMENT, 'production') === 'production';
  const publicSiteUrl = text(vars.PUBLIC_SITE_URL).replace(/\/+$/, '');
  const allowedHosts = text(vars.ALLOWED_HOSTS)
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
  if (publicSiteUrl) allowedHosts.push(new URL(publicSiteUrl).hostname);
  if (!isProduction) allowedHosts.push('localhost', '127.0.0.1');

  return {
    isProduction,
    publicSiteUrl,
    allowedHosts,
    // Fora de produção (wrangler dev em http://localhost) o cookie não pode exigir HTTPS.
    cookieSecure: isProduction,
    sessionHours: int(vars.SESSION_HOURS, 12),
    seedDemo: bool(vars.SEED_DEMO, !isProduction),
    admin: {
      email: text(vars.ADMIN_EMAIL).toLowerCase(),
      password: typeof vars.ADMIN_PASSWORD === 'string' ? vars.ADMIN_PASSWORD : '',
      name: text(vars.ADMIN_NAME, 'Administrador'),
      resetPassword: bool(vars.ADMIN_RESET_PASSWORD, false),
    },
    login: {
      maxFailedAttempts: int(vars.LOGIN_MAX_FAILED_ATTEMPTS, 5),
      lockMinutes: int(vars.LOGIN_LOCK_MINUTES, 15),
      maxPerIpPer15Min: int(vars.LOGIN_MAX_PER_IP, 20),
    },
  };
}
