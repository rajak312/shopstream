import { Args, Parent, Query, ResolveField, Resolver, ResolveReference } from '@nestjs/graphql';
import { formatMoney } from '@shopstream/contracts';
import DataLoader from 'dataloader';
import type { CategoryDoc, ProductDoc } from '../models';
import type { ProductSort } from '../products/pagination';
import { ProductService, type ProductFilter } from '../products/product.service';

const LOW_STOCK_THRESHOLD = 5;

@Resolver('Query')
export class CatalogQueryResolver {
  constructor(private readonly products: ProductService) {}

  @Query('products')
  list(
    @Args('first') first: number | null,
    @Args('after') after: string | null,
    @Args('filter') filter: ProductFilter | null,
    @Args('sort') sort: ProductSort | null,
  ) {
    return this.products.list({ first, after, filter, sort });
  }

  @Query('product')
  product(@Args('id') id: string) {
    return this.products.byId(id);
  }

  @Query('productBySlug')
  productBySlug(@Args('slug') slug: string) {
    return this.products.bySlug(slug);
  }

  @Query('categories')
  categories() {
    return this.products.categories();
  }
}

@Resolver('Product')
export class ProductResolver {
  /**
   * Batches entity lookups coming from other subgraphs (e.g. a list of order
   * lines) into a single $in query. cache:false = batching only, never stale.
   */
  private readonly loader: DataLoader<string, ProductDoc | null>;
  private categoryCache?: { at: number; byId: Map<string, CategoryDoc> };

  constructor(private readonly products: ProductService) {
    this.loader = new DataLoader((ids) => this.products.byIds(ids), { cache: false });
  }

  @ResolveReference()
  resolveReference(reference: { __typename: 'Product'; id: string }) {
    return this.loader.load(reference.id);
  }

  @ResolveField('id')
  id(@Parent() p: ProductDoc) {
    return p._id;
  }

  @ResolveField('price')
  price(@Parent() p: ProductDoc) {
    return {
      amountCents: p.priceCents,
      currency: p.currency,
      formatted: formatMoney(p.priceCents, p.currency),
    };
  }

  @ResolveField('available')
  available(@Parent() p: ProductDoc) {
    return p.stock;
  }

  @ResolveField('inStock')
  inStock(@Parent() p: ProductDoc) {
    return p.stock > 0;
  }

  @ResolveField('lowStock')
  lowStock(@Parent() p: ProductDoc) {
    return p.stock > 0 && p.stock <= LOW_STOCK_THRESHOLD;
  }

  @ResolveField('category')
  async category(@Parent() p: ProductDoc) {
    if (!this.categoryCache || Date.now() - this.categoryCache.at > 60_000) {
      const all = await this.products.categories();
      this.categoryCache = { at: Date.now(), byId: new Map(all.map((c) => [c._id, c])) };
    }
    return this.categoryCache.byId.get(p.categoryId) ?? (await this.products.categoryById(p.categoryId));
  }
}

@Resolver('Category')
export class CategoryResolver {
  constructor(private readonly products: ProductService) {}

  @ResolveReference()
  resolveReference(reference: { id: string }) {
    return this.products.categoryById(reference.id);
  }

  @ResolveField('id')
  id(@Parent() c: CategoryDoc) {
    return c._id;
  }

  @ResolveField('productCount')
  async productCount(@Parent() c: CategoryDoc) {
    return (await this.products.productCounts()).get(c._id) ?? 0;
  }
}
