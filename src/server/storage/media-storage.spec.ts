import { describe, expect, it } from 'vitest';
import { nodeDatabase } from '../db/node-database';
import { createTestApp, PNG_1X1 } from '../testing/test-app';
import { createServices } from '../services';
import { d1Storage, memoryStorage, withFallback } from './media-storage';

describe('imagens no D1 (sem bucket R2)', () => {
  it('grava, lê e remove', async () => {
    const storage = d1Storage(nodeDatabase());
    await storage.put('a.png', PNG_1X1, 'image/png');
    const file = await storage.get('a.png');
    expect(file?.contentType).toBe('image/png');
    expect(Array.from(file!.body as Uint8Array)).toEqual(Array.from(PNG_1X1));
    await storage.delete('a.png');
    expect(await storage.get('a.png')).toBeNull();
  });

  it('upload pela API funciona e respeita o limite menor', async () => {
    const { services } = await createTestApp();
    const db = nodeDatabase();
    const d1Services = createServices(services.config, db, d1Storage(db));
    const image = await d1Services.media.upload(PNG_1X1, 'foto.png', null);
    expect(await d1Services.media.get(image.url.replace('/uploads/', ''))).not.toBeNull();
    const big = new Uint8Array(1_600_000);
    big.set(PNG_1X1);
    await expect(d1Services.media.upload(big, 'grande.png', null)).rejects.toThrow(/1,4 MB/);
  });
});

describe('troca do D1 para o R2', () => {
  it('novas imagens vão para o R2 e as antigas do D1 continuam acessíveis', async () => {
    const d1 = d1Storage(nodeDatabase());
    const r2 = memoryStorage();
    await d1.put('antiga.png', PNG_1X1, 'image/png');
    const storage = withFallback(r2, d1);
    await storage.put('nova.png', PNG_1X1, 'image/png');
    expect(r2.has?.('nova.png')).toBe(true);
    expect(await storage.get('antiga.png')).not.toBeNull();
    await storage.delete('antiga.png');
    expect(await d1.get('antiga.png')).toBeNull();
  });
});
