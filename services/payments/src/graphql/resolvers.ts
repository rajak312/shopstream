import { Context, Parent, ResolveField, Resolver, ResolveReference } from '@nestjs/graphql';
import { formatMoney } from '@shopstream/contracts';
import type { GraphQLContext } from '@shopstream/platform';
import { PaymentsService, type PaymentDoc } from '../payments.service';

@Resolver('Order')
export class OrderPaymentResolver {
  constructor(private readonly payments: PaymentsService) {}

  @ResolveReference()
  resolveReference(ref: { id: string }) {
    return { id: ref.id };
  }

  @ResolveField('payment')
  payment(@Parent() order: { id: string }, @Context() ctx: GraphQLContext) {
    if (!ctx.user) return null;
    return this.payments.forOrder(order.id, ctx.user.id);
  }
}

@Resolver('Payment')
export class PaymentResolver {
  @ResolveField('id') id(@Parent() p: PaymentDoc) {
    return p.paymentId;
  }
  @ResolveField('amount') amount(@Parent() p: PaymentDoc) {
    return {
      amountCents: p.amountCents,
      currency: p.currency,
      formatted: formatMoney(p.amountCents, p.currency),
    };
  }
}
