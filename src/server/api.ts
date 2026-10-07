import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AppEnv } from './app-env';
import { requireAuth } from './auth/auth.middleware';
import { authRoutes } from './auth/auth.routes';
import { adminCatalogRoutes } from './catalog/admin-catalog.routes';
import { publicRoutes } from './content/public.routes';
import { errorResponse, HttpError } from './http/errors';
import { mediaRoutes } from './media/media.routes';
import { settingsRoutes } from './settings/settings.routes';

/**
 * API REST (montada em /api). Espera `c.var.services` definido por quem a monta.
 *   /api/auth/*     login, logout, sessão, troca de senha
 *   /api/public/*   leitura pública (produtos ativos e configurações)
 *   /api/admin/*    painel — exige sessão + token CSRF em escritas
 */
export function createApi(): Hono<AppEnv> {
  const admin = new Hono<AppEnv>()
    .use(requireAuth)
    .route('/media', mediaRoutes)
    .route('/settings', settingsRoutes)
    .route('/', adminCatalogRoutes);

  const jsonLimit = bodyLimit({
    maxSize: 100 * 1024,
    onError: () => {
      throw new HttpError(413, 'Conteúdo maior que o permitido.');
    },
  });

  return new Hono<AppEnv>()
    .use(async (c, next) => {
      await next();
      if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
    })
    .use('/auth/*', jsonLimit)
    .use('/admin/products/*', jsonLimit)
    .use('/admin/categories/*', jsonLimit)
    .use('/admin/settings/*', jsonLimit)
    .route('/auth', authRoutes)
    .route('/public', publicRoutes)
    .route('/admin', admin)
    .notFound(() => {
      throw new HttpError(404, 'Rota não encontrada.');
    })
    .onError(errorResponse);
}
