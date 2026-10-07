import { describe, expect, it } from 'vitest';
import { createTestApp } from '../testing/test-app';
import { seedDemoContent } from './seed';

describe('conteúdo de demonstração', () => {
  it('cria categorias, produtos e imagens uma única vez (idempotente)', async () => {
    const { services } = await createTestApp();
    await Promise.all([seedDemoContent(services), seedDemoContent(services)]);
    await seedDemoContent(services);
    expect(await services.categories.list()).toHaveLength(4);
    const products = await services.products.list();
    expect(products).toHaveLength(9);
    expect(products.every((p) => p.mainImage)).toBe(true);
    expect((await services.settings.get()).companyName).toBe('Queijos da Serra');
  });
});
