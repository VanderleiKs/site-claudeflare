import { beforeEach, describe, expect, it } from 'vitest';
import { hashPassword, passwordProblem, verifyPassword } from '../crypto';
import { ADMIN, createTestApp, type TestClient } from '../testing/test-app';

describe('senhas', () => {
  it('gera hash PBKDF2 com sal e verifica', async () => {
    const hash = await hashPassword('Senha-Forte-123');
    expect(hash).toMatch(/^pbkdf2-sha256\$100000\$/);
    expect(await verifyPassword('Senha-Forte-123', hash)).toBe(true);
    expect(await verifyPassword('senha-forte-123', hash)).toBe(false);
    expect(await hashPassword('Senha-Forte-123')).not.toBe(hash);
  });

  it('exige senha forte', () => {
    expect(passwordProblem('curta')).toMatch(/10 caracteres/);
    expect(passwordProblem('somenteminusculas')).toMatch(/3 tipos/);
    expect(passwordProblem('Senha-Forte-123')).toBeNull();
  });
});

describe('autenticação e autorização (API)', () => {
  let client: TestClient;

  beforeEach(async () => {
    client = (await createTestApp({ LOGIN_MAX_FAILED_ATTEMPTS: '3' })).client();
  });

  it('login define cookie HttpOnly e cookie CSRF; logout invalida a sessão', async () => {
    const response = await client.login();
    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe(ADMIN.email);
    const setCookie = response.headers.getSetCookie().join('\n');
    expect(setCookie).toMatch(/sid=[^;]+;.*HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(client.csrf).not.toBe('');

    expect((await client.request('GET', '/api/auth/me')).status).toBe(200);
    expect((await client.request('POST', '/api/auth/logout', {})).status).toBe(204);
    expect((await client.request('GET', '/api/auth/me')).status).toBe(401);
  });

  it('em produção usa cookie __Host- com Secure', async () => {
    const production = (await createTestApp({ ENVIRONMENT: 'production' })).client();
    const setCookie = (await production.login()).headers.getSetCookie().join('\n');
    expect(setCookie).toMatch(/__Host-sid=[^;]+;.*Secure/i);
  });

  it('mensagem genérica para e-mail inexistente e senha errada', async () => {
    const wrong = await client.login(ADMIN.email, 'errada');
    const unknown = await client.login('ninguem@teste.local', 'errada');
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect(wrong.body.message).toBe(unknown.body.message);
  });

  it('bloqueia a conta após tentativas excessivas', async () => {
    for (let i = 0; i < 3; i++) await client.login(ADMIN.email, 'errada');
    expect((await client.login()).status).toBe(429);
  });

  it('limita tentativas por IP (contagem no banco)', async () => {
    const limited = (await createTestApp({ LOGIN_MAX_PER_IP: '2' })).client();
    await limited.login('a@teste.local', 'x');
    await limited.login('b@teste.local', 'x');
    expect((await limited.login()).status).toBe(429);
  });

  it('login exige JSON (impede login CSRF por formulário)', async () => {
    const response = await client.request('POST', '/api/auth/login', undefined, {
      'content-type': 'application/x-www-form-urlencoded',
    });
    expect(response.status).toBe(415);
  });

  it('rotas administrativas exigem sessão', async () => {
    for (const [method, path] of [
      ['GET', '/api/admin/products'],
      ['GET', '/api/admin/dashboard'],
      ['POST', '/api/admin/categories'],
      ['PUT', '/api/admin/settings'],
      ['POST', '/api/admin/media'],
    ]) {
      const response = await client.request(method, path, method === 'GET' ? undefined : {});
      expect(response.status, `${method} ${path}`).toBe(401);
    }
  });

  it('escritas exigem o token CSRF da sessão', async () => {
    await client.login();
    const body = { name: 'Frescos', slug: 'frescos' };
    expect(
      (await client.request('POST', '/api/admin/categories', body, { 'x-xsrf-token': '' })).status,
    ).toBe(403);
    expect(
      (await client.request('POST', '/api/admin/categories', body, { 'x-xsrf-token': 'falso' }))
        .status,
    ).toBe(403);
    expect((await client.request('POST', '/api/admin/categories', body)).status).toBe(201);
  });

  it('troca de senha encerra a sessão e passa a valer a nova senha', async () => {
    await client.login();
    const body = (newPassword: string) => ({ currentPassword: ADMIN.password, newPassword });
    expect((await client.request('PUT', '/api/auth/password', body('fraca'))).status).toBe(400);
    expect((await client.request('PUT', '/api/auth/password', body('Nova-Senha-456'))).status).toBe(
      204,
    );
    expect((await client.request('GET', '/api/auth/me')).status).toBe(401);
    expect((await client.login(ADMIN.email, 'Nova-Senha-456')).status).toBe(200);
  });
});

describe('hosts aceitos pelo SSR', () => {
  it('aceita *.workers.dev e o domínio de PUBLIC_SITE_URL', async () => {
    const { loadConfig } = await import('../config');
    const config = loadConfig({
      ENVIRONMENT: 'production',
      PUBLIC_SITE_URL: 'https://www.exemplo.com.br/',
    });
    expect(config.allowedHosts).toEqual(
      expect.arrayContaining(['www.exemplo.com.br', '*.workers.dev']),
    );
    expect(config.allowedHosts).not.toContain('localhost');
    expect(config.publicSiteUrl).toBe('https://www.exemplo.com.br');
  });
});
