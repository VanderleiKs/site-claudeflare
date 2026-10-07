import type { ContentSource } from '../../shared/content-source';
import type {
  DashboardSummary,
  Product,
  ProductList,
  ProductQuery,
  PublicSite,
} from '../../shared/models';
import type { CategoryService } from '../catalog/category.service';
import type { ProductService } from '../catalog/product.service';
import type { SettingsService } from '../settings/settings.service';

/**
 * Leituras usadas pelo site público: pela rota /api/public (navegação no navegador) e
 * diretamente pela renderização SSR, sem requisição HTTP intermediária.
 * Só expõe produtos ATIVOS.
 */
export class ContentService implements ContentSource {
  constructor(
    private readonly settings: SettingsService,
    private readonly categories: CategoryService,
    private readonly products: ProductService,
  ) {}

  async site(): Promise<PublicSite> {
    const [settings, categories] = await Promise.all([
      this.settings.get(),
      this.categories.list(true),
    ]);
    return { settings, categories };
  }

  async productList(query: ProductQuery): Promise<ProductList> {
    let category = null;
    if (query.category) {
      category = (await this.categories.list(true)).find((c) => c.slug === query.category) ?? null;
      if (!category) return { items: [], category: null };
    }
    const items = await this.products.list({
      onlyActive: true,
      featured: query.featured,
      categoryId: category?.id,
      limit: query.limit,
    });
    return { items, category };
  }

  product(slug: string): Promise<Product | null> {
    return this.products.findActiveBySlug(slug);
  }

  async sitemap(): Promise<{
    products: { slug: string; updatedAt: string }[];
    categories: string[];
  }> {
    const [products, categories] = await Promise.all([
      this.products.list({ onlyActive: true }),
      this.categories.list(true),
    ]);
    return {
      products: products.map((p) => ({ slug: p.slug, updatedAt: p.updatedAt })),
      categories: categories.filter((c) => c.productCount > 0).map((c) => c.slug),
    };
  }

  async dashboard(): Promise<DashboardSummary> {
    const [all, categories] = await Promise.all([this.products.list(), this.categories.list()]);
    return {
      productCount: all.length,
      activeProductCount: all.filter((p) => p.active).length,
      featuredCount: all.filter((p) => p.featured).length,
      categoryCount: categories.length,
      productsWithoutImage: all.filter((p) => !p.mainImage).length,
      recentlyUpdated: [...all]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 5)
        .map(({ id, name, slug, active, updatedAt }) => ({ id, name, slug, active, updatedAt })),
    };
  }
}
