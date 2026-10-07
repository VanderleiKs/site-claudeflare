import { Hono } from 'hono';
import { z } from 'zod';
import { SLUG_PATTERN } from '../../shared/models';
import type { AppEnv } from '../app-env';
import { notFound } from '../http/errors';
import { parseBody } from '../http/validation';

const querySchema = z.object({
  category: z.string().regex(SLUG_PATTERN).max(140).optional(),
  featured: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/** Leituras públicas usadas pelo navegador ao navegar (o SSR chama o ContentService direto). */
export const publicRoutes = new Hono<AppEnv>()
  .use(async (c, next) => {
    await next();
    // Pode ser guardado, mas sempre revalidado.
    c.header('Cache-Control', 'no-cache');
  })
  .get('/site', async (c) => c.json(await c.var.services.content.site()))
  .get('/products', async (c) => {
    const query = parseBody(querySchema, c.req.query());
    return c.json(
      await c.var.services.content.productList({
        category: query.category,
        featured: query.featured === 'true',
        limit: query.limit,
      }),
    );
  })
  .get('/products/:slug', async (c) => {
    const product = await c.var.services.content.product(c.req.param('slug').slice(0, 140));
    if (!product) throw notFound('Produto não encontrado.');
    return c.json(product);
  });
