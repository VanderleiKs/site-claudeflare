import { Hono } from 'hono';
import type { AppEnv } from '../app-env';

export const settingsRoutes = new Hono<AppEnv>()
  .get('/', async (c) => c.json(await c.var.services.settings.get()))
  .put('/', async (c) =>
    c.json(await c.var.services.settings.update(await c.req.json().catch(() => null))),
  );
