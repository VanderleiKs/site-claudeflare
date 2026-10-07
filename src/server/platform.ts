/**
 * Tipos mínimos das bindings do Cloudflare usadas pelo projeto (D1 e R2).
 * Declarados aqui para não misturar os tipos globais do Workers com os do DOM (Angular).
 */
export type SqlValue = string | number | null;

export interface D1Result<T> {
  results: T[];
  meta: { changes?: number };
}

export interface D1PreparedStatement {
  bind(...values: SqlValue[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1Result<unknown>>;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result<unknown>[]>;
}

export interface R2ObjectBody {
  readonly body: ReadableStream;
  readonly httpEtag: string;
  readonly httpMetadata?: { contentType?: string };
}

export interface R2Bucket {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array | string,
    options?: { httpMetadata?: { contentType?: string; cacheControl?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(key: string): Promise<void>;
}

/** Bindings e variáveis do Worker (definidas em wrangler.jsonc, .dev.vars e secrets). */
export interface Env {
  readonly DB: D1Database;
  readonly MEDIA: R2Bucket;
  readonly ENVIRONMENT?: string;
  readonly PUBLIC_SITE_URL?: string;
  readonly ALLOWED_HOSTS?: string;
  readonly SEED_DEMO?: string;
  readonly SESSION_HOURS?: string;
  readonly LOGIN_MAX_FAILED_ATTEMPTS?: string;
  readonly LOGIN_LOCK_MINUTES?: string;
  readonly LOGIN_MAX_PER_IP?: string;
  readonly ADMIN_EMAIL?: string;
  readonly ADMIN_NAME?: string;
  readonly ADMIN_PASSWORD?: string;
  readonly ADMIN_RESET_PASSWORD?: string;
}
