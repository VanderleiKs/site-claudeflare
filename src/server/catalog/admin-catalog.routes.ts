import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app-env';
import { idSchema, parseBody } from '../http/validation';

const listSchema = z.object({
  q: z.string().trim().max(100).optional(),
  categoryId: idSchema.optional(),
});
const flagsSchema = z.object({ active: z.boolean().optional(), featured: z.boolean().optional() });
const deleteCategorySchema = z.object({ moveTo: idSchema.optional() });

const id = (value: string) => parseBody(idSchema, value);
const json = (c: { req: { json(): Promise<unknown> } }) => c.req.json().catch(() => null);

/** Produtos, categorias e resumo do painel (montado sob /api/admin, já autenticado). */
export const adminCatalogRoutes = new Hono<AppEnv>()
  .get('/dashboard', async (c) => c.json(await c.var.services.content.dashboard()))

  .get('/products', async (c) => {
    const query = parseBody(listSchema, c.req.query());
    return c.json(
      await c.var.services.products.list({ search: query.q, categoryId: query.categoryId }),
    );
  })
  .get('/products/:id', async (c) =>
    c.json(await c.var.services.products.get(id(c.req.param('id')))),
  )
  .post('/products', async (c) => c.json(await c.var.services.products.create(await json(c)), 201))
  .put('/products/:id', async (c) =>
    c.json(await c.var.services.products.update(id(c.req.param('id')), await json(c))),
  )
  .patch('/products/:id', async (c) =>
    c.json(
      await c.var.services.products.setFlags(
        id(c.req.param('id')),
        parseBody(flagsSchema, await json(c)),
      ),
    ),
  )
  .delete('/products/:id', async (c) => {
    await c.var.services.products.delete(id(c.req.param('id')));
    return c.body(null, 204);
  })

  .get('/categories', async (c) => c.json(await c.var.services.categories.list()))
  .post('/categories', async (c) =>
    c.json(await c.var.services.categories.create(await json(c)), 201),
  )
  .put('/categories/:id', async (c) =>
    c.json(await c.var.services.categories.update(id(c.req.param('id')), await json(c))),
  )
  .delete('/categories/:id', async (c) => {
    const { moveTo } = parseBody(deleteCategorySchema, c.req.query());
    return c.json(await c.var.services.categories.delete(id(c.req.param('id')), moveTo));
  });
