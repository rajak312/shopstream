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
import type { CatalogConfig } from './config';
import { typeDefs } from './graphql/schema';
import { CatalogQueryResolver, CategoryResolver, ProductResolver } from './graphql/resolvers';
import { ProductService } from './products/product.service';

export interface CatalogRuntime {
  config: CatalogConfig;
  logger: Logger;
  metrics: ServiceMetrics;
  mongo: Connection;
  messaging: Messaging;
  relay: OutboxRelay;
  products: ProductService;
}

const RUNTIME = Symbol('CATALOG_RUNTIME');

class Lifecycle implements OnModuleInit, OnApplicationShutdown {
  constructor(
    @Inject(RUNTIME) private readonly rt: CatalogRuntime,
    private readonly health: HealthRegistry,
  ) {}

  onModuleInit() {
    this.health.register({ name: 'mongodb', check: () => pingMongo(this.rt.mongo) });
    this.health.register({ name: 'nats', check: () => this.rt.messaging.ping() });
  }

  /** Order matters: stop consuming, flush the outbox, then close connections. */
  async onApplicationShutdown() {
    await this.rt.messaging.close();
    await this.rt.relay.stop();
    await this.rt.mongo.close();
    this.rt.logger.info('catalog resources closed');
  }
}

@Module({})
export class CatalogModule {
  static forRoot(rt: CatalogRuntime): DynamicModule {
    return {
      module: CatalogModule,
      imports: [
        PlatformModule.forRoot({
          service: 'catalog',
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
        { provide: ProductService, useValue: rt.products },
        Lifecycle,
        CatalogQueryResolver,
        ProductResolver,
        CategoryResolver,
      ],
    };
  }
}
