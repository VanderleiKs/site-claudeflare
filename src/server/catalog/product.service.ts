import type { Availability, Product, ProductInput } from '../../shared/models';
import { type Database, nowIso, placeholders, type Row, sql, type Statement } from '../db/database';
import { badRequest, conflict, notFound } from '../http/errors';
import { parseBody } from '../http/validation';
import type { MediaService } from '../media/media.service';
import { productSchema } from './catalog.schemas';

export interface ProductFilter {
  readonly onlyActive?: boolean;
  readonly featured?: boolean;
  readonly categoryId?: string;
  readonly search?: string;
  readonly limit?: number;
}

const BASE_SELECT = `
  SELECT p.*, c.name AS category_name, c.slug AS category_slug
    FROM products p JOIN categories c ON c.id = p.category_id`;

export class ProductService {
  constructor(
    private readonly db: Database,
    private readonly media: MediaService,
  ) {}

  async list(filter: ProductFilter = {}): Promise<Product[]> {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.onlyActive) where.push('p.active = 1');
    if (filter.featured) where.push('p.featured = 1');
    if (filter.categoryId) {
      where.push('p.category_id = ?');
      params.push(filter.categoryId);
    }
    if (filter.search) {
      where.push("p.name LIKE ? ESCAPE '\\'");
      params.push(`%${filter.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    }
    if (filter.limit) params.push(filter.limit);
    const query = `${BASE_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY p.sort_order, p.name ${filter.limit ? 'LIMIT ?' : ''}`;
    return this.hydrate(await this.db.all(sql(query, ...params)));
  }

  async findActiveBySlug(slug: string): Promise<Product | null> {
    const rows = await this.db.all(sql(`${BASE_SELECT} WHERE p.slug = ? AND p.active = 1`, slug));
    return (await this.hydrate(rows))[0] ?? null;
  }

  async get(id: string): Promise<Product> {
    const product = (
      await this.hydrate(await this.db.all(sql(`${BASE_SELECT} WHERE p.id = ?`, id)))
    )[0];
    if (!product) throw notFound('Produto não encontrado.');
    return product;
  }

  async create(body: unknown): Promise<Product> {
    const input = await this.validate(body);
    const id = crypto.randomUUID();
    await this.db.batch([
      sql(
        `INSERT INTO products (id, name, slug, short_description, description, category_id, price_cents, price_unit,
           availability, main_image_id, featured, active, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        input.name,
        input.slug,
        input.shortDescription,
        input.description,
        input.categoryId,
        input.priceCents,
        input.priceUnit,
        input.availability,
        input.mainImageId,
        Number(input.featured),
        Number(input.active),
        input.sortOrder,
      ),
      ...this.galleryStatements(id, input.galleryImageIds),
    ]);
    return this.get(id);
  }

  async update(id: string, body: unknown): Promise<Product> {
    const before = await this.get(id);
    const input = await this.validate(body, id);
    await this.db.batch([
      sql(
        `UPDATE products SET name = ?, slug = ?, short_description = ?, description = ?, category_id = ?,
           price_cents = ?, price_unit = ?, availability = ?, main_image_id = ?, featured = ?, active = ?,
           sort_order = ?, updated_at = ?
         WHERE id = ?`,
        input.name,
        input.slug,
        input.shortDescription,
        input.description,
        input.categoryId,
        input.priceCents,
        input.priceUnit,
        input.availability,
        input.mainImageId,
        Number(input.featured),
        Number(input.active),
        input.sortOrder,
        nowIso(),
        id,
      ),
      ...this.galleryStatements(id, input.galleryImageIds),
    ]);
    // Imagens substituídas são apagadas se nenhum outro registro as usa.
    await this.media.deleteIfUnused([before.mainImage?.id, ...before.gallery.map((g) => g.id)]);
    return this.get(id);
  }

  /** Alterações rápidas pela listagem (ativar/desativar, destacar). */
  async setFlags(id: string, flags: { active?: boolean; featured?: boolean }): Promise<Product> {
    const current = await this.get(id);
    await this.db.run(
      sql(
        'UPDATE products SET active = ?, featured = ?, updated_at = ? WHERE id = ?',
        Number(flags.active ?? current.active),
        Number(flags.featured ?? current.featured),
        nowIso(),
        id,
      ),
    );
    return this.get(id);
  }

  async delete(id: string): Promise<void> {
    const product = await this.get(id);
    await this.db.run(sql('DELETE FROM products WHERE id = ?', id));
    await this.media.deleteIfUnused([product.mainImage?.id, ...product.gallery.map((g) => g.id)]);
  }

  private async validate(body: unknown, exceptId = ''): Promise<ProductInput> {
    const input = parseBody(productSchema, body);
    if (!(await this.db.first(sql('SELECT 1 FROM categories WHERE id = ?', input.categoryId)))) {
      throw badRequest('Categoria inexistente.', [
        { field: 'categoryId', message: 'Selecione uma categoria válida.' },
      ]);
    }
    if (
      await this.db.first(
        sql('SELECT 1 FROM products WHERE slug = ? AND id <> ?', input.slug, exceptId),
      )
    ) {
      throw conflict('Já existe um produto com este slug.');
    }
    await this.media.assertExist([input.mainImageId, ...input.galleryImageIds]);
    return input;
  }

  private galleryStatements(productId: string, mediaIds: readonly string[]): Statement[] {
    return [
      sql('DELETE FROM product_images WHERE product_id = ?', productId),
      ...mediaIds.map((mediaId, position) =>
        sql(
          'INSERT INTO product_images (product_id, media_id, position) VALUES (?, ?, ?)',
          productId,
          mediaId,
          position,
        ),
      ),
    ];
  }

  /** Converte linhas em Product carregando imagens com poucas consultas. */
  private async hydrate(rows: Row[]): Promise<Product[]> {
    if (!rows.length) return [];
    const ids = rows.map((row) => String(row['id']));
    const gallery = await this.db.all(
      sql(
        `SELECT product_id, media_id FROM product_images WHERE product_id IN (${placeholders(ids.length)}) ORDER BY position`,
        ...ids,
      ),
    );
    const images = await this.media.findMany([
      ...rows.map((row) => row['main_image_id']).filter((v): v is string => typeof v === 'string'),
      ...gallery.map((g) => String(g['media_id'])),
    ]);
    return rows.map((row) => ({
      id: String(row['id']),
      name: String(row['name']),
      slug: String(row['slug']),
      shortDescription: String(row['short_description']),
      description: String(row['description']),
      category: {
        id: String(row['category_id']),
        name: String(row['category_name']),
        slug: String(row['category_slug']),
      },
      priceCents: row['price_cents'] === null ? null : Number(row['price_cents']),
      priceUnit: row['price_unit'] === null ? null : String(row['price_unit']),
      availability: String(row['availability']) as Availability,
      featured: Number(row['featured']) === 1,
      active: Number(row['active']) === 1,
      sortOrder: Number(row['sort_order']),
      mainImage:
        typeof row['main_image_id'] === 'string'
          ? (images.get(row['main_image_id']) ?? null)
          : null,
      gallery: gallery
        .filter((g) => g['product_id'] === row['id'])
        .map((g) => images.get(String(g['media_id'])))
        .filter((image) => image !== undefined),
      updatedAt: String(row['updated_at']),
    }));
  }
}
