import { AuthService } from './auth/auth.service';
import { CategoryService } from './catalog/category.service';
import { ProductService } from './catalog/product.service';
import { loadConfig, type ServerConfig } from './config';
import { ContentService } from './content/content.service';
import { type Database, d1Database } from './db/database';
import { applyMigrations, type MigrationFile } from './db/migrator';
import { seedDemoContent } from './db/seed';
import { MediaService } from './media/media.service';
import type { Env } from './platform';
import { SettingsService } from './settings/settings.service';
import { d1Storage, type MediaStorage, r2Storage, withFallback } from './storage/media-storage';

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

/**
 * Serviços a partir das bindings do Worker (D1 + R2 + variáveis). Objetos leves, criados por requisição.
 * Sem a binding MEDIA (R2), as imagens são guardadas no próprio D1; com ela, vão para o R2
 * e as imagens antigas do D1 continuam sendo lidas.
 */
export function servicesFromEnv(env: Env): Services {
  const db = d1Database(env.DB);
  return createServices(
    loadConfig(env),
    db,
    env.MEDIA ? withFallback(r2Storage(env.MEDIA), d1Storage(db)) : d1Storage(db),
  );
}

let bootstrap: Promise<void> | undefined;

/**
 * Executado uma vez por instância do Worker: aplica migrations pendentes no D1, cria o admin
 * a partir dos secrets e, se SEED_DEMO=true e o banco estiver vazio, insere a demonstração.
 * As operações são idempotentes (seguras se várias instâncias rodarem ao mesmo tempo).
 */
export function ensureBootstrapped(
  services: Services,
  migrations: readonly MigrationFile[] = [],
): Promise<void> {
  bootstrap ??= (async () => {
    const applied = await applyMigrations(services.db, migrations);
    if (applied.length) console.warn(`[db] Migrations aplicadas: ${applied.join(', ')}`);
    await services.auth.ensureAdmin();
    if (services.config.seedDemo) await seedDemoContent(services);
  })().catch((error: unknown) => {
    bootstrap = undefined; // tenta de novo na próxima requisição
    throw error;
  });
  return bootstrap;
}
