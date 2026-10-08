import { createHash } from 'node:crypto';
import { createEvent } from '@shopstream/contracts';
import type { Logger, MongoEventStore } from '@shopstream/platform';
import type { CatalogModels } from '../models';
import { SEED_CATEGORIES, SEED_PRODUCTS, type SeedProduct } from './data';

export function productId(slug: string): string {
  return `prd_${createHash('sha1').update(slug).digest('hex').slice(0, 12)}`;
}

export function categoryId(slug: string): string {
  return `cat_${slug}`;
}

function contentHash(p: SeedProduct): string {
  return createHash('sha1')
    .update(JSON.stringify([p.name, p.sku, p.priceCents, p.description, p.category, p.tags, p.icon]))
    .digest('hex');
}

const EPOCH = Date.UTC(2026, 0, 1);

/**
 * Idempotent seed: safe to run on every start. Inserts missing data, updates
 * changed products (publishing catalog.product.upserted through the outbox so
 * the orders service's price replica stays in sync), and tops up demo stock.
 */
export async function seedCatalog(
  models: CatalogModels,
  store: MongoEventStore,
  logger: Logger,
): Promise<number> {
  for (const c of SEED_CATEGORIES) {
    await models.categories.updateOne(
      { _id: categoryId(c.slug) },
      { $set: { slug: c.slug, name: c.name, description: c.description, sortOrder: c.sortOrder } },
      { upsert: true },
    );
  }

  let changed = 0;
  for (const [index, p] of SEED_PRODUCTS.entries()) {
    const id = productId(p.slug);
    const hash = contentHash(p);
    const imageUrl = `/products/${p.slug}.svg`;
    await store.transaction(async (session) => {
      const existing = await models.products.findById(id).session(session).lean();
      const now = new Date();
      if (existing && existing.contentHash === hash) {
        const floor = Math.min(5, p.stock);
        if (existing.stock < floor) {
          await models.products.updateOne(
            { _id: id },
            { $set: { stock: p.stock, updatedAt: now } },
            { session },
          );
        }
        return;
      }
      await models.products.updateOne(
        { _id: id },
        {
          $set: {
            sku: p.sku,
            slug: p.slug,
            name: p.name,
            description: p.description,
            categoryId: categoryId(p.category),
            priceCents: p.priceCents,
            currency: 'USD',
            imageUrl,
            tags: p.tags,
            rating: p.rating,
            reviewCount: p.reviewCount,
            contentHash: hash,
            updatedAt: now,
          },
          $setOnInsert: { stock: p.stock, reserved: 0, createdAt: new Date(EPOCH + index * 3_600_000) },
        },
        { upsert: true, session },
      );
      await store.enqueue(session, [
        createEvent(
          'catalog.product.upserted',
          'catalog',
          {
            productId: id,
            sku: p.sku,
            slug: p.slug,
            name: p.name,
            priceCents: p.priceCents,
            currency: 'USD',
            imageUrl,
          },
          { correlationId: id },
        ),
      ]);
      changed++;
    });
  }
  logger.info({ products: SEED_PRODUCTS.length, changed }, 'catalog seed complete');
  return changed;
}
