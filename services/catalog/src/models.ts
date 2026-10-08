import { Schema, type Connection, type Model } from 'mongoose';

export interface CategoryDoc {
  _id: string;
  slug: string;
  name: string;
  description: string;
  sortOrder: number;
}

export interface ProductDoc {
  _id: string;
  sku: string;
  slug: string;
  name: string;
  description: string;
  categoryId: string;
  priceCents: number;
  currency: 'USD';
  imageUrl: string;
  tags: string[];
  rating: number;
  reviewCount: number;
  /** Units available to sell. */
  stock: number;
  /** Units held by open reservations (reserved but not shipped). */
  reserved: number;
  contentHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export type ReservationStatus = 'RESERVED' | 'REJECTED' | 'RELEASED' | 'COMMITTED' | 'CANCELLED';

export interface ReservationDoc {
  /** = orderId: one reservation per order makes the saga step naturally idempotent. */
  _id: string;
  userId: string;
  items: { productId: string; quantity: number }[];
  status: ReservationStatus;
  createdAt: Date;
  updatedAt: Date;
}

const categorySchema = new Schema<CategoryDoc>(
  {
    _id: String,
    slug: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    sortOrder: { type: Number, default: 0 },
  },
  { collection: 'categories', versionKey: false },
);

const productSchema = new Schema<ProductDoc>(
  {
    _id: String,
    sku: { type: String, required: true, unique: true },
    slug: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    categoryId: { type: String, required: true },
    priceCents: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'USD' },
    imageUrl: { type: String, required: true },
    tags: { type: [String], default: [] },
    rating: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 },
    stock: { type: Number, required: true, min: 0 },
    reserved: { type: Number, default: 0, min: 0 },
    contentHash: { type: String, required: true },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { collection: 'products', versionKey: false },
);
// Full-text search with relevance weighting.
productSchema.index(
  { name: 'text', tags: 'text', description: 'text' },
  { weights: { name: 10, tags: 5, description: 1 }, name: 'product_text' },
);
// Compound indexes backing each sort order of the cursor pagination (sort key + _id tiebreaker).
productSchema.index({ categoryId: 1, priceCents: 1, _id: 1 });
productSchema.index({ priceCents: 1, _id: 1 });
productSchema.index({ createdAt: -1, _id: -1 });
productSchema.index({ name: 1, _id: 1 });

const reservationSchema = new Schema<ReservationDoc>(
  {
    _id: String,
    userId: { type: String, required: true },
    items: [{ _id: false, productId: String, quantity: Number }],
    status: { type: String, required: true },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { collection: 'reservations', versionKey: false },
);

export interface CatalogModels {
  categories: Model<CategoryDoc>;
  products: Model<ProductDoc>;
  reservations: Model<ReservationDoc>;
}

export async function createModels(conn: Connection): Promise<CatalogModels> {
  const models: CatalogModels = {
    categories: conn.model<CategoryDoc>('Category', categorySchema),
    products: conn.model<ProductDoc>('Product', productSchema),
    reservations: conn.model<ReservationDoc>('Reservation', reservationSchema),
  };
  // Collections must exist before they are used inside multi-document transactions.
  for (const m of Object.values(models) as Model<unknown>[]) {
    await m.createCollection().catch(() => undefined);
    await m.syncIndexes();
  }
  return models;
}
