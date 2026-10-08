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
  pingMongo,
  subgraphContext,
  type Logger,
  type Messaging,
  type OutboxRelay,
  type ServiceMetrics,
} from '@shopstream/platform';
import type { Connection } from 'mongoose';
import type { PaymentsConfig } from './config';
import { OrderPaymentResolver, PaymentResolver } from './graphql/resolvers';
import { typeDefs } from './graphql/schema';
import { PaymentsService } from './payments.service';

export interface PaymentsRuntime {
  config: PaymentsConfig;
  logger: Logger;
  metrics: ServiceMetrics;
  mongo: Connection;
  messaging: Messaging;
  relay: OutboxRelay;
  payments: PaymentsService;
}

const RUNTIME = Symbol('PAYMENTS_RUNTIME');

class Lifecycle implements OnModuleInit, OnApplicationShutdown {
  constructor(
    @Inject(RUNTIME) private readonly rt: PaymentsRuntime,
    private readonly health: HealthRegistry,
  ) {}

  onModuleInit() {
    this.health.register({ name: 'mongodb', check: () => pingMongo(this.rt.mongo) });
    this.health.register({ name: 'nats', check: () => this.rt.messaging.ping() });
  }

  async onApplicationShutdown() {
    await this.rt.messaging.close();
    await this.rt.relay.stop();
    await this.rt.mongo.close();
    this.rt.logger.info('payments resources closed');
  }
}

@Module({})
export class PaymentsModule {
  static forRoot(rt: PaymentsRuntime): DynamicModule {
    return {
      module: PaymentsModule,
      imports: [
        PlatformModule.forRoot({
          service: 'payments',
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
        { provide: PaymentsService, useValue: rt.payments },
        Lifecycle,
        OrderPaymentResolver,
        PaymentResolver,
      ],
    };
  }
}
