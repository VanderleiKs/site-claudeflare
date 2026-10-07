import type { Product, ProductList, ProductQuery, PublicSite } from './models';

/**
 * Leituras públicas de conteúdo. Implementado no Worker pelo ContentService e
 * entregue ao Angular durante o SSR via REQUEST_CONTEXT — o SSR lê o D1 diretamente,
 * sem requisição HTTP para si mesmo.
 */
export interface ContentSource {
  site(): Promise<PublicSite>;
  productList(query: ProductQuery): Promise<ProductList>;
  product(slug: string): Promise<Product | null>;
}

/** Objeto passado pelo Worker (server.ts) para cada renderização. */
export interface SsrRequestContext {
  readonly content: ContentSource;
  /** Origem pública (PUBLIC_SITE_URL ou a da requisição), para canônicas e Open Graph. */
  readonly siteOrigin: string;
}
