import { type Database, sql } from '../db/database';
import type { R2Bucket } from '../platform';

export interface StoredObject {
  readonly body: ReadableStream | Uint8Array<ArrayBuffer>;
  readonly contentType: string;
  readonly etag?: string;
}

/** Armazenamento de arquivos. Produção: Cloudflare R2 (ou D1, sem bucket). Testes: memória. */
export interface MediaStorage {
  /** Tamanho máximo aceito por arquivo, se menor que o limite geral de upload. */
  readonly maxBytes?: number;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  has?(key: string): boolean;
}

export function r2Storage(bucket: R2Bucket): MediaStorage {
  return {
    put: async (key, body, contentType) => {
      await bucket.put(key, body, {
        // Chaves são UUIDs: o conteúdo nunca muda, então o cache pode ser imutável.
        httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' },
      });
    },
    get: async (key) => {
      const object = await bucket.get(key);
      if (!object) return null;
      return {
        body: object.body,
        contentType: object.httpMetadata?.contentType ?? 'application/octet-stream',
        etag: object.httpEtag,
      };
    },
    delete: (key) => bucket.delete(key),
  };
}

/** Implementação em memória para testes. */
export function memoryStorage(): MediaStorage {
  const files = new Map<string, { body: Uint8Array; contentType: string }>();
  return {
    put: async (key, body, contentType) => {
      files.set(key, { body, contentType });
    },
    get: async (key) => {
      const file = files.get(key);
      return file ? { body: new Uint8Array(file.body), contentType: file.contentType } : null;
    },
    delete: async (key) => {
      files.delete(key);
    },
    has: (key) => files.has(key),
  };
}

/** Limite por arquivo guardado no D1 (cada linha do D1 aceita até ~2 MB). */
export const D1_MAX_FILE_BYTES = 1_500_000;

/**
 * Imagens dentro do próprio D1 — alternativa para testar sem criar bucket R2.
 * Limitado a ~1,5 MB por imagem; para produção com muitas fotos, prefira o R2.
 */
export function d1Storage(db: Database): MediaStorage {
  return {
    maxBytes: D1_MAX_FILE_BYTES,
    put: async (key, body, contentType) => {
      const buffer = body.buffer.slice(
        body.byteOffset,
        body.byteOffset + body.byteLength,
      ) as ArrayBuffer;
      await db.run(
        sql(
          'INSERT OR REPLACE INTO media_blobs (storage_key, content_type, body) VALUES (?, ?, ?)',
          key,
          contentType,
          buffer,
        ),
      );
    },
    get: async (key) => {
      const row = await db.first(
        sql('SELECT content_type, body FROM media_blobs WHERE storage_key = ?', key),
      );
      if (!row) return null;
      const raw = row['body'];
      // O D1 devolve BLOB como array de números; o SQLite do Node, como Uint8Array.
      const body =
        raw instanceof Uint8Array
          ? new Uint8Array(raw)
          : new Uint8Array(raw as ArrayLike<number> | ArrayBuffer);
      return { body, contentType: String(row['content_type']) };
    },
    delete: async (key) => {
      await db.run(sql('DELETE FROM media_blobs WHERE storage_key = ?', key));
    },
  };
}

/**
 * Grava no R2 e, na leitura, procura também no D1 — assim as imagens enviadas antes de
 * ativar o R2 continuam funcionando depois da troca.
 */
export function withFallback(primary: MediaStorage, previous: MediaStorage): MediaStorage {
  return {
    put: (key, body, contentType) => primary.put(key, body, contentType),
    get: async (key) => (await primary.get(key)) ?? previous.get(key),
    delete: async (key) => {
      await Promise.all([primary.delete(key), previous.delete(key)]);
    },
  };
}
