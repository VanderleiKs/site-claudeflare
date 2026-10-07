import { beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, PNG_1X1, type TestApp, type TestClient } from '../testing/test-app';

describe('configurações do site (API)', () => {
  let app: TestApp;
  let admin: TestClient;

  beforeEach(async () => {
    app = await createTestApp();
    admin = app.client();
    await admin.login();
  });

  it('instalação nova tem configurações neutras', async () => {
    const site = await app.client().request('GET', '/api/public/site');
    expect(site.body.settings.companyName).toBe('Minha Empresa');
  });

  it('salva, normaliza e publica imediatamente', async () => {
    const current = (await admin.request('GET', '/api/admin/settings')).body;
    const logo = (await admin.upload(PNG_1X1)).body;
    const saved = await admin.request('PUT', '/api/admin/settings', {
      ...current,
      companyName: 'Nova Empresa',
      whatsapp: '+55 (54) 99999-0000',
      logoId: logo.id,
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      companyName: 'Nova Empresa',
      whatsapp: '5554999990000',
      logo: { id: logo.id },
    });
    expect((await app.client().request('GET', '/api/public/site')).body.settings.companyName).toBe(
      'Nova Empresa',
    );
    // imagem em uso pelas configurações não pode ser excluída
    expect((await admin.request('DELETE', `/api/admin/media/${logo.id}`)).status).toBe(409);
  });

  it('rejeita cor, URL e e-mail inválidos', async () => {
    const current = (await admin.request('GET', '/api/admin/settings')).body;
    const response = await admin.request('PUT', '/api/admin/settings', {
      ...current,
      primaryColor: 'vermelho',
      instagramUrl: 'javascript:alert(1)',
      email: 'nao-e-email',
    });
    expect(response.status).toBe(400);
    expect(response.body.errors.map((e: { field: string }) => e.field)).toEqual(
      expect.arrayContaining(['primaryColor', 'instagramUrl', 'email']),
    );
  });
});
