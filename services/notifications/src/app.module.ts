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
  type ServiceMetrics,
} from '@shopstream/platform';
import type { Connection } from 'mongoose';
import type { NotificationsConfig } from './config';
import { NotificationFeedResolver, OrderTimelineResolver } from './graphql/resolvers';
import { typeDefs } from './graphql/schema';
import { NotificationsService } from './notifications.service';
import { StreamController } from './stream/stream.controller';
import { StreamHub } from './stream/stream.hub';

export interface NotificationsRuntime {
  config: NotificationsConfig;
  logger: Logger;
  metrics: ServiceMetrics;
  mongo: Connection;
  messaging: Messaging;
  notifications: NotificationsService;
  hub: StreamHub;
}

const RUNTIME = Symbol('NOTIFICATIONS_RUNTIME');

class Lifecycle implements OnModuleInit, OnApplicationShutdown {
  constructor(
    @Inject(RUNTIME) private readonly rt: NotificationsRuntime,
    private readonly health: HealthRegistry,
  ) {}

  onModuleInit() {
    this.health.register({ name: 'mongodb', check: () => pingMongo(this.rt.mongo) });
    this.health.register({ name: 'nats', check: () => this.rt.messaging.ping() });
  }

  async onApplicationShutdown() {
    await this.rt.hub.stop();
    await this.rt.messaging.close();
    await this.rt.mongo.close();
    this.rt.logger.info('notifications resources closed');
  }
}

@Module({})
export class NotificationsModule {
  static forRoot(rt: NotificationsRuntime): DynamicModule {
    return {
      module: NotificationsModule,
      imports: [
        PlatformModule.forRoot({
          service: 'notifications',
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
      controllers: [StreamController],
      providers: [
        { provide: RUNTIME, useValue: rt },
        { provide: NotificationsService, useValue: rt.notifications },
        { provide: StreamHub, useValue: rt.hub },
        Lifecycle,
        OrderTimelineResolver,
        NotificationFeedResolver,
      ],
    };
  }
}
