import { computeOrderTotals, lineTotalCents } from '@shopstream/contracts';
import { badInput } from '@shopstream/platform';
import { MAX_QUANTITY_PER_LINE } from '../domain/checkout';
import type { PrismaClient } from '../infra/prisma';

export interface CartView {
  id: string;
  items: {
    productId: string;
    name: string;
    imageUrl: string;
    unitPriceCents: number;
    quantity: number;
    lineTotalCents: number;
  }[];
  itemCount: number;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
}

export class CartService {
  constructor(private readonly prisma: PrismaClient) {}

  async get(userId: string): Promise<CartView> {
    const cart = await this.prisma.cart.upsert({
      where: { userId },
      update: {},
      create: { userId },
      include: { items: { orderBy: { addedAt: 'asc' } } },
    });
    const snapshots = await this.prisma.productSnapshot.findMany({
      where: { id: { in: cart.items.map((i) => i.productId) } },
    });
    const byId = new Map(snapshots.map((s) => [s.id, s]));
    const items = cart.items.flatMap((i) => {
      const s = byId.get(i.productId);
      if (!s) return [];
      return [
        {
          productId: i.productId,
          name: s.name,
          imageUrl: s.imageUrl,
          unitPriceCents: s.priceCents,
          quantity: i.quantity,
          lineTotalCents: lineTotalCents(s.priceCents, i.quantity),
        },
      ];
    });
    const totals = computeOrderTotals(items);
    return {
      id: cart.id,
      items,
      itemCount: items.reduce((n, i) => n + i.quantity, 0),
      ...totals,
    };
  }

  async add(userId: string, productId: string, quantity: number): Promise<CartView> {
    if (!Number.isInteger(quantity) || quantity < 1) throw badInput('quantity must be a positive integer');
    const product = await this.prisma.productSnapshot.findUnique({ where: { id: productId } });
    if (!product) throw badInput('Unknown product');
    const cart = await this.prisma.cart.upsert({ where: { userId }, update: {}, create: { userId } });
    const existing = await this.prisma.cartItem.findUnique({
      where: { cartId_productId: { cartId: cart.id, productId } },
    });
    const next = Math.min((existing?.quantity ?? 0) + quantity, MAX_QUANTITY_PER_LINE);
    await this.prisma.cartItem.upsert({
      where: { cartId_productId: { cartId: cart.id, productId } },
      update: { quantity: next },
      create: { cartId: cart.id, productId, quantity: next },
    });
    return this.get(userId);
  }

  async update(userId: string, productId: string, quantity: number): Promise<CartView> {
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_QUANTITY_PER_LINE) {
      throw badInput(`quantity must be between 0 and ${MAX_QUANTITY_PER_LINE}`);
    }
    const cart = await this.prisma.cart.upsert({ where: { userId }, update: {}, create: { userId } });
    if (quantity === 0) {
      await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id, productId } });
    } else {
      await this.prisma.cartItem.updateMany({ where: { cartId: cart.id, productId }, data: { quantity } });
    }
    return this.get(userId);
  }

  async clear(userId: string): Promise<CartView> {
    const cart = await this.prisma.cart.findUnique({ where: { userId } });
    if (cart) await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    return this.get(userId);
  }
}
