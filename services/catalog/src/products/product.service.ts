import { badInput } from '@shopstream/platform';
import type { PipelineStage } from 'mongoose';
import type { CatalogModels, CategoryDoc, ProductDoc } from '../models';
import { afterCursorFilter, sortSpec, toCursor, type ProductSort } from './pagination';

export interface ProductFilter {
  search?: string | null;
  categorySlug?: string | null;
  minPriceCents?: number | null;
  maxPriceCents?: number | null;
  inStockOnly?: boolean | null;
}

export interface ProductPage {
  edges: { cursor: string; node: ProductDoc }[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  totalCount: number;
}

export class ProductService {
  constructor(private readonly models: CatalogModels) {}

  async list(args: {
    first?: number | null;
    after?: string | null;
    filter?: ProductFilter | null;
    sort?: ProductSort | null;
  }): Promise<ProductPage> {
    const first = args.first ?? 12;
    if (first < 1 || first > 50) throw badInput('first must be between 1 and 50');
    const filter = args.filter ?? {};
    const search = filter.search?.trim() || undefined;
    const match: Record<string, unknown> = {};
    if (search) match.$text = { $search: search };
    if (filter.categorySlug) {
      const category = await this.models.categories.findOne({ slug: filter.categorySlug }).lean();
      if (!category) return { edges: [], pageInfo: { hasNextPage: false, endCursor: null }, totalCount: 0 };
      match.categoryId = category._id;
    }
    if (filter.minPriceCents != null || filter.maxPriceCents != null) {
      match.priceCents = {
        ...(filter.minPriceCents != null ? { $gte: filter.minPriceCents } : {}),
        ...(filter.maxPriceCents != null ? { $lte: filter.maxPriceCents } : {}),
      };
    }
    if (filter.inStockOnly) match.stock = { $gt: 0 };

    const spec = sortSpec(args.sort ?? (search ? 'RELEVANCE' : 'NEWEST'), Boolean(search));
    const pipeline: PipelineStage[] = [{ $match: match }];
    if (spec.field === 'score') pipeline.push({ $addFields: { score: { $meta: 'textScore' } } });
    const seek = afterCursorFilter(spec, args.after ?? undefined);
    if (Object.keys(seek).length > 0) pipeline.push({ $match: seek });
    pipeline.push({ $sort: { [spec.field]: spec.direction, _id: spec.direction } }, { $limit: first + 1 });

    const [rows, totalCount] = await Promise.all([
      this.models.products.aggregate<ProductDoc & { score?: number }>(pipeline),
      this.models.products.countDocuments(match),
    ]);
    const hasNextPage = rows.length > first;
    const page = rows.slice(0, first);
    const edges = page.map((node) => ({
      cursor: toCursor(spec, node as unknown as Record<string, unknown> & { _id: string }),
      node,
    }));
    return { edges, pageInfo: { hasNextPage, endCursor: edges.at(-1)?.cursor ?? null }, totalCount };
  }

  byId(id: string) {
    return this.models.products.findById(id).lean();
  }

  async byIds(ids: readonly string[]): Promise<(ProductDoc | null)[]> {
    const docs = await this.models.products.find({ _id: { $in: ids } }).lean();
    const map = new Map(docs.map((d) => [d._id, d]));
    return ids.map((id) => map.get(id) ?? null);
  }

  bySlug(slug: string) {
    return this.models.products.findOne({ slug }).lean();
  }

  categories(): Promise<CategoryDoc[]> {
    return this.models.categories.find().sort({ sortOrder: 1 }).lean();
  }

  async categoryById(id: string) {
    return this.models.categories.findById(id).lean();
  }

  async productCounts(): Promise<Map<string, number>> {
    const rows = await this.models.products.aggregate<{ _id: string; count: number }>([
      { $group: { _id: '$categoryId', count: { $sum: 1 } } },
    ]);
    return new Map(rows.map((r) => [r._id, r.count]));
  }
}
