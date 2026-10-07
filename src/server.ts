import { AngularAppEngine, createRequestHandler } from '@angular/ssr';
import { Hono } from 'hono';
import { createApi } from './server/api';
import type { AppEnv } from './server/app-env';
import { renderSitemap, robotsTxt } from './server/content/seo-files';
import { MIGRATION_FILES } from './server/db/migration-files';
import type { Env } from './server/platform';
import { ensureBootstrapped, servicesFromEnv } from './server/services';
import type { SsrRequestContext } from './shared/content-source';

/**
 * Cloudflare Worker — ponto de entrada único do site.
 *
 *   arquivos do build (JS, CSS, fontes)  → Workers Static Assets (antes do Worker, sem custo de CPU)
 *   /api/*                               → API REST (Hono) com D1
 *   /uploads/*                           → imagens no R2
 *   /robots.txt, /sitemap.xml
 *   demais rotas                         → Angular SSR (site) ou shell do painel (/admin)
 */
const app = new Hono<AppEnv>();

// Serviços criados por requisição a partir das bindings (D1, R2, variáveis); bootstrap 1x por instância.
app.use(async (c, next) => {
  const services = servicesFromEnv(c.env);
  c.set('services', services);
  await ensureBootstrapped(services, MIGRATION_FILES);
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('X-Frame-Options', 'SAMEORIGIN');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (c.var.services.config.isProduction)
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
});

app.route('/api', createApi());

app.get('/uploads/:key', async (c) => {
  const file = await c.var.services.media.get(c.req.param('key'));
  if (!file) return c.notFound();
  return c.body(file.body, 200, {
    'Content-Type': file.contentType,
    'Cache-Control': 'public, max-age=31536000, immutable',
    // Arquivos enviados nunca executam script, mesmo abertos diretamente.
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    ...(file.etag ? { ETag: file.etag } : {}),
  });
});

const siteOrigin = (c: { req: { url: string }; var: AppEnv['Variables'] }) =>
  c.var.services.config.publicSiteUrl || new URL(c.req.url).origin;

app.get('/robots.txt', (c) => c.text(robotsTxt(siteOrigin(c))));

app.get('/sitemap.xml', async (c) =>
  c.body(renderSitemap(siteOrigin(c), await c.var.services.content.sitemap()), 200, {
    'Content-Type': 'application/xml; charset=utf-8',
    'Cache-Control': 'no-cache',
  }),
);

// Motor do Angular criado na primeira requisição (os hosts aceitos vêm das variáveis do Worker).
let angularApp: AngularAppEngine | undefined;

app.all('*', async (c) => {
  angularApp ??= new AngularAppEngine({ allowedHosts: [...c.var.services.config.allowedHosts] });
  const context: SsrRequestContext = { content: c.var.services.content, siteOrigin: siteOrigin(c) };
  const response = await angularApp.handle(c.req.raw, context);
  if (!response) return c.text('Página não encontrada.', 404);

  const path = new URL(c.req.url).pathname;
  const isAdmin = path === '/admin' || path.startsWith('/admin/');
  const headers = new Headers(response.headers);
  // O HTML reflete o banco no momento da requisição: caches devem sempre revalidar.
  headers.set('Cache-Control', isAdmin ? 'no-store' : 'no-cache');
  if (isAdmin) headers.set('X-Robots-Tag', 'noindex, nofollow');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});

app.onError((error, c) => {
  console.error('[worker]', error);
  return c.text('Erro interno. Tente novamente em instantes.', 500);
});

export default {
  fetch: (request: Request, env: Env, ctx: unknown) => app.fetch(request, env, ctx as never),
};

/**
 * Exigido pelo Angular CLI. Sem as bindings do Cloudflare (D1/R2) o `ng serve` não consegue
 * atender — use `npm run dev` (wrangler dev), que executa o Worker no runtime real.
 */
export const reqHandler = createRequestHandler(
  async () =>
    new Response('Use "npm run dev" (wrangler dev) para executar o site com D1 e R2 locais.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    }),
);
