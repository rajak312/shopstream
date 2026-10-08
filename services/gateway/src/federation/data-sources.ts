import { RemoteGraphQLDataSource, type GraphQLDataSourceProcessOptions } from '@apollo/gateway';
import type { GatewayContext } from './context';

/** Forwards the caller's (already verified) bearer token and request id to subgraphs. */
export class AuthForwardingDataSource extends RemoteGraphQLDataSource<GatewayContext> {
  override willSendRequest({ request, context }: GraphQLDataSourceProcessOptions<GatewayContext>) {
    const ctx = context as Partial<GatewayContext> | undefined;
    if (ctx?.authorization) request.http?.headers.set('authorization', ctx.authorization);
    if (ctx?.requestId) request.http?.headers.set('x-request-id', ctx.requestId);
  }
}
