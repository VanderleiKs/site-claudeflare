import { Hono } from 'hono';
import type { ImageRef } from '../../shared/models';
import { createApi } from '../api';
import type { AppEnv } from '../app-env';
import { loadConfig } from '../config';
import { nodeDatabase } from '../db/node-database';
import { createServices, type Services } from '../services';
import { type MediaStorage, memoryStorage } from '../storage/media-storage';

export const ADMIN = { email: 'admin@teste.local', password: 'Senha-Teste-123' };

export interface TestApp {
  readonly services: Services;
  readonly storage: MediaStorage;
  readonly client: () => TestClient;
}

/**
 * API real (Hono) com SQLite em memória (mesmas migrations do D1) e armazenamento em memória.
 * As requisições são feitas direto em `app.request`, sem abrir porta.
 */
export async function createTestApp(vars: Record<string, string> = {}): Promise<TestApp> {
  const config = loadConfig({
    ENVIRONMENT: 'test',
    ADMIN_EMAIL: ADMIN.email,
    ADMIN_PASSWORD: ADMIN.password,
    SEED_DEMO: 'false',
    ...vars,
  });
  const storage = memoryStorage();
  const services = createServices(config, nodeDatabase(), storage);
  await services.auth.ensureAdmin();
  const app = new Hono<AppEnv>()
    .use(async (c, next) => {
      c.set('services', services);
      await next();
    })
    .route('/api', createApi());
  return { services, storage, client: () => new TestClient(app) };
}

/** Cliente que guarda os cookies da sessão e envia o cabeçalho CSRF, como o navegador. */
export class TestClient {
  private readonly cookies = new Map<string, string>();

  constructor(private readonly app: Hono<AppEnv>) {}

  get csrf(): string {
    return this.cookies.get('XSRF-TOKEN') ?? '';
  }

  async request(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const binary = body instanceof Uint8Array;
    const response = await this.app.request(path, {
      method,
      headers: {
        ...(body !== undefined && !binary ? { 'content-type': 'application/json' } : {}),
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        'x-xsrf-token': this.csrf,
        'cf-connecting-ip': '203.0.113.10',
        ...headers,
      },
      body: body === undefined ? undefined : binary ? new Uint8Array(body) : JSON.stringify(body),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [name, value] = cookie.split(';')[0].split('=');
      if (value) this.cookies.set(name, value);
      else this.cookies.delete(name);
    }
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      body: text ? JSON.parse(text) : null,
    };
  }

  login(email = ADMIN.email, password = ADMIN.password) {
    return this.request('POST', '/api/auth/login', { email, password });
  }

  upload(bytes: Uint8Array, type = 'image/png') {
    return this.request('POST', '/api/admin/media', bytes, {
      'content-type': type,
      'x-file-name': 'foto.png',
    }) as Promise<{
      status: number;
      body: ImageRef;
    }>;
  }
}

/** PNG válido mínimo (1x1). */
export const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

/** Chave de armazenamento a partir da URL pública (/uploads/<chave>). */
export const keyOf = (url: string) => url.replace('/uploads/', '');
