import { AuthService } from './auth/auth.service';
import { CategoryService } from './catalog/category.service';
import { ProductService } from './catalog/product.service';
import { loadConfig, type ServerConfig } from './config';
import { ContentService } from './content/content.service';
import { type Database, d1Database } from './db/database';
import { seedDemoContent } from './db/seed';
import { MediaService } from './media/media.service';
import type { Env } from './platform';
import { SettingsService } from './settings/settings.service';
import { type MediaStorage, r2Storage } from './storage/media-storage';

/** Composição das dependências do backend (injeção manual, sem framework). */
export interface Services {
  readonly config: ServerConfig;
  readonly db: Database;
  readonly auth: AuthService;
  readonly media: MediaService;
  readonly categories: CategoryService;
  readonly products: ProductService;
  readonly settings: SettingsService;
  readonly content: ContentService;
}

export function createServices(
  config: ServerConfig,
  db: Database,
  storage: MediaStorage,
): Services {
  const media = new MediaService(db, storage);
  const categories = new CategoryService(db);
  const products = new ProductService(db, media);
  const settings = new SettingsService(db, media);
  return {
    config,
    db,
    auth: new AuthService(db, config),
    media,
    categories,
    products,
    settings,
    content: new ContentService(settings, categories, products),
  };
}

/** Serviços a partir das bindings do Worker (D1 + R2 + variáveis). Objetos leves, criados por requisição. */
export const servicesFromEnv = (env: Env): Services =>
  createServices(loadConfig(env), d1Database(env.DB), r2Storage(env.MEDIA));

let bootstrap: Promise<void> | undefined;

/**
 * Executado uma vez por instância do Worker: cria o admin a partir dos secrets e,
 * se SEED_DEMO=true e o banco estiver vazio, insere o conteúdo de demonstração.
 * As operações são idempotentes (seguras se várias instâncias rodarem ao mesmo tempo).
 */
export function ensureBootstrapped(services: Services): Promise<void> {
  bootstrap ??= (async () => {
    await services.auth.ensureAdmin();
    if (services.config.seedDemo) await seedDemoContent(services);
  })().catch((error: unknown) => {
    bootstrap = undefined; // tenta de novo na próxima requisição
    throw error;
  });
  return bootstrap;
}
