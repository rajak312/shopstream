import { ApolloFederationDriver, type ApolloFederationDriverConfig } from '@nestjs/apollo';
import {
  Inject,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import {
  DateTimeScalar,
  HealthRegistry,
  PlatformModule,
  subgraphContext,
  type Logger,
  type Messaging,
  type OutboxRelay,
  type ServiceMetrics,
} from '@shopstream/platform';
import { CartService } from './cart/cart.service';
import type { OrdersConfig } from './config';
import { typeDefs } from './graphql/schema';
import {
  CartItemResolver,
  CartResolver,
  OrderItemResolver,
  OrderResolver,
  OrdersMutationResolver,
  OrdersQueryResolver,
  ProductSalesResolver,
} from './graphql/resolvers';
import type { PrismaClient } from './infra/prisma';
import { OrdersService } from './orders/orders.service';

export interface OrdersRuntime {
  config: OrdersConfig;
  logger: Logger;
  metrics: ServiceMetrics;
  prisma: PrismaClient;
  messaging: Messaging;
  relay: OutboxRelay;
  orders: OrdersService;
  carts: CartService;
  stopBackground: () => Promise<void>;
}

const RUNTIME = Symbol('ORDERS_RUNTIME');

class Lifecycle implements OnModuleInit, OnApplicationShutdown {
  constructor(
    @Inject(RUNTIME) private readonly rt: OrdersRuntime,
    private readonly health: HealthRegistry,
  ) {}

  onModuleInit() {
    this.health.register({
      name: 'postgres',
      check: async () => void (await this.rt.prisma.$queryRaw`SELECT 1`),
    });
    this.health.register({ name: 'nats', check: () => this.rt.messaging.ping() });
  }

  async onApplicationShutdown() {
    await this.rt.stopBackground();
    await this.rt.messaging.close();
    await this.rt.relay.stop();
    await this.rt.prisma.$disconnect();
    this.rt.logger.info('orders resources closed');
  }
}

@Module({})
export class OrdersModule {
  static forRoot(rt: OrdersRuntime): DynamicModule {
    return {
      module: OrdersModule,
      imports: [
        PlatformModule.forRoot({
          service: 'orders',
          config: rt.config,
          logger: rt.logger,
          metrics: rt.metrics,
        }),
        GraphQLModule.forRoot<ApolloFederationDriverConfig>({
          driver: ApolloFederationDriver,
          typeDefs,
          resolvers: { DateTime: DateTimeScalar },
          path: '/graphql',
          playground: false,
          introspection: true,
          context: subgraphContext(rt.config.JWT_SECRET),
        }),
      ],
      providers: [
        { provide: RUNTIME, useValue: rt },
        { provide: OrdersService, useValue: rt.orders },
        { provide: CartService, useValue: rt.carts },
        Lifecycle,
        OrdersQueryResolver,
        OrdersMutationResolver,
        CartResolver,
        CartItemResolver,
        OrderResolver,
        OrderItemResolver,
        ProductSalesResolver,
      ],
    };
  }
}
