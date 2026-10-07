import type { R2Bucket } from '../platform';

export interface StoredObject {
  readonly body: ReadableStream | Uint8Array<ArrayBuffer>;
  readonly contentType: string;
  readonly etag?: string;
}

/** Armazenamento de arquivos. Produção: Cloudflare R2. Testes: memória. */
export interface MediaStorage {
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
