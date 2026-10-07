import { ACCEPTED_IMAGE_TYPES, type ImageRef, MAX_UPLOAD_BYTES } from '../../shared/models';
import { type Database, placeholders, type Row, sql } from '../db/database';
import { badRequest, HttpError, notFound } from '../http/errors';
import type { MediaStorage } from '../storage/media-storage';

type AcceptedType = (typeof ACCEPTED_IMAGE_TYPES)[number];
type StoredType = AcceptedType | 'image/svg+xml';

const EXTENSIONS: Record<StoredType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

/** URL pública de um arquivo (servido pelo Worker a partir do R2, com cache imutável). */
export const mediaUrl = (key: string) => `/uploads/${key}`;

/**
 * Tipo real pelo conteúdo ("magic bytes"). Extensão e Content-Type do navegador não são
 * confiáveis. SVG não é aceito em uploads (pode conter script).
 */
export function detectImageType(bytes: Uint8Array): AcceptedType | null {
  if (bytes.length < 12) return null;
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b))
    return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

const toImage = (row: Row): ImageRef => ({
  id: String(row['id']),
  url: mediaUrl(String(row['storage_key'])),
  alt: row['alt'] === null ? null : String(row['alt']),
});

export class MediaService {
  constructor(
    private readonly db: Database,
    private readonly storage: MediaStorage,
  ) {}

  /** Imagem enviada pelo painel: valida tamanho e tipo real antes de gravar. */
  async upload(bytes: Uint8Array, originalName: string, alt: string | null): Promise<ImageRef> {
    if (!bytes.length) throw badRequest('Nenhum arquivo enviado.');
    if (bytes.length > MAX_UPLOAD_BYTES)
      throw new HttpError(413, 'A imagem deve ter no máximo 5 MB.');
    const type = detectImageType(bytes);
    if (!type) throw new HttpError(415, 'Formato não suportado. Envie JPEG, PNG ou WebP.');
    return this.store(bytes, type, originalName, alt);
  }

  /** Grava sem validação de upload — uso interno (seed com SVG gerado pela aplicação). */
  async store(
    bytes: Uint8Array,
    type: StoredType,
    originalName: string,
    alt: string | null,
  ): Promise<ImageRef> {
    const id = crypto.randomUUID();
    const key = `${id}.${EXTENSIONS[type]}`;
    await this.storage.put(key, bytes, type);
    try {
      await this.db.run(
        sql(
          'INSERT INTO media (id, storage_key, mime_type, size_bytes, original_name, alt) VALUES (?, ?, ?, ?, ?, ?)',
          id,
          key,
          type,
          bytes.length,
          sanitizeName(originalName),
          alt?.trim().slice(0, 200) || null,
        ),
      );
    } catch (error) {
      await this.storage.delete(key);
      throw error;
    }
    return { id, url: mediaUrl(key), alt: alt?.trim() || null };
  }

  async findMany(ids: readonly string[]): Promise<Map<string, ImageRef>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows = await this.db.all(
      sql(
        `SELECT id, storage_key, alt FROM media WHERE id IN (${placeholders(unique.length)})`,
        ...unique,
      ),
    );
    return new Map(rows.map((row) => [String(row['id']), toImage(row)]));
  }

  async assertExist(ids: readonly (string | null | undefined)[]): Promise<void> {
    const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if ((await this.findMany(wanted)).size !== wanted.length) {
      throw badRequest('Uma ou mais imagens informadas não existem.');
    }
  }

  /** Quantos registros (produtos, galerias, configurações) usam a imagem. */
  async usageCount(id: string): Promise<number> {
    const row = await this.db.first<{ n: number }>(
      sql(
        `SELECT (SELECT COUNT(*) FROM products WHERE main_image_id = ?1)
              + (SELECT COUNT(*) FROM product_images WHERE media_id = ?1)
              + (SELECT COUNT(*) FROM settings WHERE ?1 IN (
                  json_extract(data, '$.logoId'), json_extract(data, '$.heroImageId'), json_extract(data, '$.aboutImageId')))
            AS n`,
        id,
      ),
    );
    return Number(row?.n ?? 0);
  }

  /** Exclusão pelo painel: recusa se a imagem estiver em uso. */
  async delete(id: string): Promise<void> {
    const row = await this.db.first(sql('SELECT storage_key FROM media WHERE id = ?', id));
    if (!row) throw notFound('Imagem não encontrada.');
    const uses = await this.usageCount(id);
    if (uses > 0) throw new HttpError(409, `A imagem está em uso em ${uses} lugar(es).`);
    await this.db.run(sql('DELETE FROM media WHERE id = ?', id));
    await this.storage.delete(String(row['storage_key']));
  }

  /** Após substituir/remover imagens: apaga as que nenhum registro usa mais. */
  async deleteIfUnused(ids: Iterable<string | null | undefined>): Promise<void> {
    for (const id of new Set([...ids].filter((v): v is string => Boolean(v)))) {
      if ((await this.usageCount(id)) > 0) continue;
      const row = await this.db.first(sql('SELECT storage_key FROM media WHERE id = ?', id));
      if (!row) continue;
      await this.db.run(sql('DELETE FROM media WHERE id = ?', id));
      await this.storage.delete(String(row['storage_key']));
    }
  }

  /** Remove uploads abandonados (sem uso) com mais de `hours` horas. */
  async cleanupOrphans(hours = 24): Promise<void> {
    const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString();
    const rows = await this.db.all(sql('SELECT id FROM media WHERE created_at < ?', cutoff));
    await this.deleteIfUnused(rows.map((row) => String(row['id'])));
  }

  /** Arquivo para servir em /uploads/:key. */
  get(key: string) {
    return /^[0-9a-f-]{36}\.(jpg|png|webp|svg)$/.test(key)
      ? this.storage.get(key)
      : Promise.resolve(null);
  }
}

function sanitizeName(name: string): string {
  return (name || 'imagem').replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 150);
}
