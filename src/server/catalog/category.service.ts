import type { Category } from '../../shared/models';
import { type Database, type Row, sql } from '../db/database';
import { badRequest, conflict, notFound } from '../http/errors';
import { parseBody } from '../http/validation';
import { categorySchema } from './catalog.schemas';

const toCategory = (row: Row): Category => ({
  id: String(row['id']),
  name: String(row['name']),
  slug: String(row['slug']),
  description: row['description'] === null ? null : String(row['description']),
  sortOrder: Number(row['sort_order']),
  productCount: Number(row['product_count'] ?? 0),
});

const SELECT = (onlyActive: boolean) => `
  SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id ${onlyActive ? 'AND p.active = 1' : ''}) AS product_count
    FROM categories c`;

export class CategoryService {
  constructor(private readonly db: Database) {}

  /** @param onlyActive conta apenas produtos ativos (uso no site público). */
  async list(onlyActive = false): Promise<Category[]> {
    return (await this.db.all(sql(`${SELECT(onlyActive)} ORDER BY c.sort_order, c.name`))).map(
      toCategory,
    );
  }

  async get(id: string): Promise<Category> {
    const row = await this.db.first(sql(`${SELECT(false)} WHERE c.id = ?`, id));
    if (!row) throw notFound('Categoria não encontrada.');
    return toCategory(row);
  }

  async create(body: unknown): Promise<Category> {
    const input = parseBody(categorySchema, body);
    await this.assertSlugFree(input.slug);
    const id = crypto.randomUUID();
    await this.db.run(
      sql(
        'INSERT INTO categories (id, name, slug, description, sort_order) VALUES (?, ?, ?, ?, ?)',
        id,
        input.name,
        input.slug,
        input.description,
        input.sortOrder,
      ),
    );
    return this.get(id);
  }

  async update(id: string, body: unknown): Promise<Category> {
    await this.get(id);
    const input = parseBody(categorySchema, body);
    await this.assertSlugFree(input.slug, id);
    await this.db.run(
      sql(
        'UPDATE categories SET name = ?, slug = ?, description = ?, sort_order = ? WHERE id = ?',
        input.name,
        input.slug,
        input.description,
        input.sortOrder,
        id,
      ),
    );
    return this.get(id);
  }

  /**
   * Exclui sem deixar produtos órfãos: com produtos, exige `moveTo` e move tudo de forma
   * atômica. O banco também impede a exclusão (FK RESTRICT).
   */
  async delete(id: string, moveTo?: string): Promise<{ movedProducts: number }> {
    const category = await this.get(id);
    if (category.productCount > 0 && !moveTo) {
      throw conflict(
        `A categoria possui ${category.productCount} produto(s). Escolha para qual categoria movê-los.`,
      );
    }
    if (moveTo) {
      if (moveTo === id) throw badRequest('A categoria de destino deve ser diferente.');
      await this.get(moveTo);
    }
    await this.db.batch([
      ...(moveTo
        ? [sql('UPDATE products SET category_id = ? WHERE category_id = ?', moveTo, id)]
        : []),
      sql('DELETE FROM categories WHERE id = ?', id),
    ]);
    return { movedProducts: moveTo ? category.productCount : 0 };
  }

  private async assertSlugFree(slug: string, exceptId = ''): Promise<void> {
    if (
      await this.db.first(
        sql('SELECT 1 FROM categories WHERE slug = ? AND id <> ?', slug, exceptId),
      )
    ) {
      throw conflict('Já existe uma categoria com este slug.');
    }
  }
}
