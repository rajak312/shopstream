import { Args, Mutation, Parent, Query, ResolveField, Resolver, ResolveReference } from '@nestjs/graphql';
import { TEST_CARDS, formatMoney } from '@shopstream/contracts';
import { CurrentUser, requireUser, type AuthUser, type GraphQLContext } from '@shopstream/platform';
import DataLoader from 'dataloader';
import { CartService, type CartView } from '../cart/cart.service';
import type { CheckoutInput } from '../domain/checkout';
import { canCustomerCancel } from '../domain/order-state-machine';
import { OrdersService, type OrderWithRelations } from '../orders/orders.service';

const money = (amountCents: number) => ({
  amountCents,
  currency: 'USD',
  formatted: formatMoney(amountCents),
});

@Resolver('Query')
export class OrdersQueryResolver {
  constructor(
    private readonly carts: CartService,
    private readonly orders: OrdersService,
  ) {}

  @Query('cart')
  cart(@CurrentUser() user: AuthUser) {
    return this.carts.get(user.id);
  }

  @Query('myOrders')
  myOrders(@CurrentUser() user: AuthUser, @Args('first') first: number, @Args('after') after: string | null) {
    return this.orders.listForUser(user.id, first ?? 10, after);
  }

  @Query('order')
  order(@CurrentUser() user: AuthUser, @Args('id') id: string) {
    return this.orders.getForUser(user.id, id);
  }

  @Query('testCards')
  testCards() {
    return TEST_CARDS;
  }
}

@Resolver('Mutation')
export class OrdersMutationResolver {
  constructor(
    private readonly carts: CartService,
    private readonly orders: OrdersService,
  ) {}

  @Mutation('addToCart')
  addToCart(
    @CurrentUser() user: AuthUser,
    @Args('productId') productId: string,
    @Args('quantity') quantity: number,
  ) {
    return this.carts.add(user.id, productId, quantity);
  }

  @Mutation('updateCartItem')
  updateCartItem(
    @CurrentUser() user: AuthUser,
    @Args('productId') productId: string,
    @Args('quantity') quantity: number,
  ) {
    return this.carts.update(user.id, productId, quantity);
  }

  @Mutation('removeFromCart')
  removeFromCart(@CurrentUser() user: AuthUser, @Args('productId') productId: string) {
    return this.carts.update(user.id, productId, 0);
  }

  @Mutation('clearCart')
  clearCart(@CurrentUser() user: AuthUser) {
    return this.carts.clear(user.id);
  }

  @Mutation('checkout')
  checkout(@CurrentUser() user: AuthUser, @Args('input') input: CheckoutInput) {
    return this.orders.checkout(user.id, input);
  }

  @Mutation('cancelOrder')
  cancelOrder(@CurrentUser() user: AuthUser, @Args('id') id: string) {
    return this.orders.cancelByCustomer(user.id, id);
  }
}

@Resolver('Cart')
export class CartResolver {
  @ResolveField('subtotal') subtotal(@Parent() c: CartView) {
    return money(c.subtotalCents);
  }
  @ResolveField('estimatedShipping') shipping(@Parent() c: CartView) {
    return money(c.shippingCents);
  }
  @ResolveField('estimatedTax') tax(@Parent() c: CartView) {
    return money(c.taxCents);
  }
  @ResolveField('estimatedTotal') total(@Parent() c: CartView) {
    return money(c.totalCents);
  }
}

@Resolver('CartItem')
export class CartItemResolver {
  @ResolveField('product') product(@Parent() i: CartView['items'][number]) {
    return { __typename: 'Product', id: i.productId };
  }
  @ResolveField('unitPrice') unitPrice(@Parent() i: CartView['items'][number]) {
    return money(i.unitPriceCents);
  }
  @ResolveField('lineTotal') lineTotal(@Parent() i: CartView['items'][number]) {
    return money(i.lineTotalCents);
  }
}

@Resolver('Order')
export class OrderResolver {
  constructor(private readonly orders: OrdersService) {}

  /** Other subgraphs reference orders by id; only the owner may resolve one. */
  @ResolveReference()
  async resolveReference(ref: { id: string }, ctx: GraphQLContext) {
    const user = requireUser(ctx);
    return this.orders.getForUser(user.id, ref.id);
  }

  @ResolveField('subtotal') subtotal(@Parent() o: OrderWithRelations) {
    return money(o.subtotalCents);
  }
  @ResolveField('shipping') shipping(@Parent() o: OrderWithRelations) {
    return money(o.shippingCents);
  }
  @ResolveField('tax') tax(@Parent() o: OrderWithRelations) {
    return money(o.taxCents);
  }
  @ResolveField('total') total(@Parent() o: OrderWithRelations) {
    return money(o.totalCents);
  }
  @ResolveField('card') card(@Parent() o: OrderWithRelations) {
    return { brand: o.cardBrand, last4: o.cardLast4 };
  }
  @ResolveField('statusHistory') statusHistory(@Parent() o: OrderWithRelations) {
    return o.history;
  }
  @ResolveField('canCancel') canCancel(@Parent() o: OrderWithRelations) {
    return canCustomerCancel(o.status);
  }
}

@Resolver('OrderItem')
export class OrderItemResolver {
  @ResolveField('product') product(@Parent() i: { productId: string }) {
    return { __typename: 'Product', id: i.productId };
  }
  @ResolveField('unitPrice') unitPrice(@Parent() i: { unitPriceCents: number }) {
    return money(i.unitPriceCents);
  }
  @ResolveField('lineTotal') lineTotal(@Parent() i: { lineTotalCents: number }) {
    return money(i.lineTotalCents);
  }
}

@Resolver('Product')
export class ProductSalesResolver {
  private readonly loader: DataLoader<string, number>;

  constructor(orders: OrdersService) {
    this.loader = new DataLoader((ids) => orders.unitsSold(ids), { cache: false });
  }

  @ResolveReference()
  resolveReference(ref: { id: string }) {
    return { id: ref.id };
  }

  @ResolveField('unitsSold')
  unitsSold(@Parent() p: { id: string }) {
    return this.loader.load(p.id);
  }
}
