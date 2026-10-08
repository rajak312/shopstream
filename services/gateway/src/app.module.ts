import { LocalGraphQLDataSource } from '@apollo/gateway';
import { ApolloGatewayDriver, type ApolloGatewayDriverConfig } from '@nestjs/apollo';
import {
  Inject,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import {
  HealthRegistry,
  PlatformModule,
  pingMongo,
  type Logger,
  type ServiceMetrics,
} from '@shopstream/platform';
import type { GraphQLFormattedError, GraphQLSchema } from 'graphql';
import type { Connection } from 'mongoose';
import type { GatewayConfig } from './config';
import { EventsController } from './events/events.controller';
import { gatewayContext } from './federation/context';
import { AuthForwardingDataSource } from './federation/data-sources';
import { depthLimit } from './federation/depth-limit';
import { resilientSupergraph, type SubgraphDef } from './federation/supergraph';
import { identityTypeDefs } from './identity/identity.subgraph';

export interface GatewayRuntime {
  config: GatewayConfig;
  logger: Logger;
  metrics: ServiceMetrics;
  mongo: Connection;
  identitySchema: GraphQLSchema;
}

const RUNTIME = Symbol('GATEWAY_RUNTIME');
const IDENTITY = 'identity';

class Lifecycle implements OnModuleInit, OnApplicationShutdown {
  constructor(
    @Inject(RUNTIME) private readonly rt: GatewayRuntime,
    private readonly health: HealthRegistry,
  ) {}

  onModuleInit() {
    this.health.register({ name: 'mongodb', check: () => pingMongo(this.rt.mongo) });
  }

  async onApplicationShutdown() {
    await this.rt.mongo.close();
    this.rt.logger.info('gateway resources closed');
  }
}

export function subgraphList(config: GatewayConfig): SubgraphDef[] {
  return [
    { name: IDENTITY, url: 'local://identity', sdl: identityTypeDefs },
    { name: 'catalog', url: config.CATALOG_URL },
    { name: 'orders', url: config.ORDERS_URL },
    { name: 'payments', url: config.PAYMENTS_URL },
    { name: 'notifications', url: config.NOTIFICATIONS_URL },
  ];
}

/** Hide internal error details from clients in production; keep codes for the UI. */
function formatError(production: boolean) {
  return (formatted: GraphQLFormattedError): GraphQLFormattedError => {
    const code = formatted.extensions?.code;
    if (production && (code === 'INTERNAL_SERVER_ERROR' || code === undefined)) {
      return {
        message: 'Something went wrong. Please try again.',
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
        ...(formatted.path ? { path: formatted.path } : {}),
      };
    }
    const { stacktrace: _stack, ...extensions } = formatted.extensions ?? {};
    return { ...formatted, extensions };
  };
}

@Module({})
export class GatewayModule {
  static forRoot(rt: GatewayRuntime): DynamicModule {
    const production = rt.config.NODE_ENV === 'production';
    return {
      module: GatewayModule,
      imports: [
        PlatformModule.forRoot({
          service: 'gateway',
          config: rt.config,
          logger: rt.logger,
          metrics: rt.metrics,
        }),
        GraphQLModule.forRoot<ApolloGatewayDriverConfig>({
          driver: ApolloGatewayDriver,
          server: {
            path: '/graphql',
            playground: false,
            introspection: true,
            context: gatewayContext(rt.config.JWT_SECRET),
            validationRules: [depthLimit(rt.config.MAX_QUERY_DEPTH)],
            formatError: formatError(production),
            includeStacktraceInErrorResponses: false,
          },
          gateway: {
            supergraphSdl: resilientSupergraph(subgraphList(rt.config), rt.logger, {
              pollIntervalMs: rt.config.SUPERGRAPH_POLL_MS,
            }),
            buildService: ({ name, url }) =>
              name === IDENTITY
                ? new LocalGraphQLDataSource(rt.identitySchema)
                : new AuthForwardingDataSource({ url }),
          },
        }),
      ],
      controllers: [EventsController],
      providers: [{ provide: RUNTIME, useValue: rt }, Lifecycle],
    };
  }
}
