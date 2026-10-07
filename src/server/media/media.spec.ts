import { beforeEach, describe, expect, it } from 'vitest';
import type { MediaStorage } from '../storage/media-storage';
import { createTestApp, keyOf, PNG_1X1, type TestClient } from '../testing/test-app';
import { detectImageType } from './media.service';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('detecção de tipo de imagem', () => {
  it('usa o conteúdo, não a extensão', () => {
    expect(detectImageType(PNG_1X1)).toBe('image/png');
    expect(detectImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(
      'image/jpeg',
    );
    expect(detectImageType(bytes('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(detectImageType(bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
  });
});

describe('upload de imagens (API)', () => {
  let admin: TestClient;
  let storage: MediaStorage;

  beforeEach(async () => {
    const app = await createTestApp();
    storage = app.storage;
    admin = app.client();
    await admin.login();
  });

  it('grava imagem válida no armazenamento', async () => {
    const response = await admin.upload(PNG_1X1);
    expect(response.status).toBe(201);
    expect(response.body.url).toMatch(/^\/uploads\/[0-9a-f-]{36}\.png$/);
    expect(storage.has?.(keyOf(response.body.url))).toBe(true);
  });

  it('recusa conteúdo que não é imagem, SVG e tipos não aceitos', async () => {
    expect((await admin.upload(bytes('<script>alert(1)</script> não é imagem'))).status).toBe(415);
    expect(
      (await admin.upload(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml'))
        .status,
    ).toBe(415);
    expect((await admin.upload(PNG_1X1, 'application/pdf')).status).toBe(415);
  });

  it('recusa arquivo acima de 5 MB', async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 10);
    big.set(PNG_1X1);
    expect((await admin.upload(big)).status).toBe(413);
  });

  it('mantém imagem usada por outro registro e apaga a que ficou sem uso', async () => {
    const category = (
      await admin.request('POST', '/api/admin/categories', { name: 'Cat', slug: 'cat' })
    ).body;
    const a = (await admin.upload(PNG_1X1)).body;
    const b = (await admin.upload(PNG_1X1)).body;
    const base = {
      shortDescription: 'Descrição curta ok.',
      description: 'Descrição completa ok.',
      categoryId: category.id,
    };
    const p1 = (
      await admin.request('POST', '/api/admin/products', {
        ...base,
        name: 'P1',
        slug: 'p1',
        mainImageId: a.id,
      })
    ).body;
    await admin.request('POST', '/api/admin/products', {
      ...base,
      name: 'P2',
      slug: 'p2',
      galleryImageIds: [a.id],
    });

    expect((await admin.request('DELETE', `/api/admin/media/${a.id}`)).status).toBe(409);

    // troca a principal de P1: "a" continua (galeria de P2)
    await admin.request('PUT', `/api/admin/products/${p1.id}`, {
      ...base,
      name: 'P1',
      slug: 'p1',
      mainImageId: b.id,
    });
    expect(storage.has?.(keyOf(a.url))).toBe(true);

    // remove a principal de P1: "b" fica sem uso e é apagada
    await admin.request('PUT', `/api/admin/products/${p1.id}`, {
      ...base,
      name: 'P1',
      slug: 'p1',
      mainImageId: null,
    });
    expect(storage.has?.(keyOf(b.url))).toBe(false);
  });
});
