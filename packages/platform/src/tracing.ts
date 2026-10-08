/**
 * OpenTelemetry bootstrap. Must be loaded before any instrumented module
 * (http, express, graphql, mongodb, pg) is required, which is why services
 * import it from `@shopstream/platform/tracing` at the very top of main.ts.
 */
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ExpressInstrumentation, ExpressLayerType } from '@opentelemetry/instrumentation-express';
import { GraphQLInstrumentation } from '@opentelemetry/instrumentation-graphql';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { MongoDBInstrumentation } from '@opentelemetry/instrumentation-mongodb';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

let sdk: NodeSDK | undefined;

export interface TracingHandle {
  enabled: boolean;
  shutdown(): Promise<void>;
}

const IGNORED_PATHS = new Set(['/health', '/ready', '/metrics', '/favicon.ico']);

export function startTracing(serviceName: string, env = process.env): TracingHandle {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint || env.OTEL_SDK_DISABLED === 'true' || sdk) {
    return { enabled: Boolean(sdk), shutdown: async () => undefined };
  }
  if (env.OTEL_DEBUG === 'true') diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);

  const ratio = Number(env.OTEL_TRACES_SAMPLER_RATIO ?? '1');
  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: env.OTEL_SERVICE_NAME ?? serviceName,
      [ATTR_SERVICE_VERSION]: env.APP_VERSION ?? 'dev',
      'deployment.environment.name': env.NODE_ENV ?? 'development',
    }),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, '')}/v1/traces` }),
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(ratio) }),
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => IGNORED_PATHS.has((req.url ?? '').split('?')[0] ?? ''),
      }),
      // Route-level spans only: per-middleware spans are noise in a trace view.
      new ExpressInstrumentation({
        ignoreLayersType: [ExpressLayerType.MIDDLEWARE, ExpressLayerType.ROUTER],
      }),
      new GraphQLInstrumentation({ mergeItems: true, ignoreResolveSpans: true }),
      new MongoDBInstrumentation({ requireParentSpan: true }),
      new PgInstrumentation({ requireParentSpan: true, ignoreConnectSpans: true }),
    ],
  });
  sdk.start();
  const handle = sdk;
  return {
    enabled: true,
    shutdown: async () => {
      await handle.shutdown().catch(() => undefined);
    },
  };
}
