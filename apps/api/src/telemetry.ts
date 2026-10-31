import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ExpressInstrumentation, ExpressLayerType } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { createAllowListAttributesProcessor } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { PrismaInstrumentation } from '@prisma/instrumentation';
import { ScrubbingSpanExporter } from './infrastructure/telemetry/span-scrubber.js';

// Optional, and never imported by the app: it runs only when preloaded, ahead of everything it instruments (see
// `start:otel`, and NODE_OPTIONS in production). Where the data goes is standard OTEL_* configuration.

// Probes would drown the traffic, and an SSE stream would be a single span lasting hours.
const UNTRACED = ['/v1/health', '/v1/notifications/stream'];

// The default also describes the process, on every signal: its command line and its OS user. The instance id keeps
// replicas' metrics apart.
process.env.OTEL_NODE_RESOURCE_DETECTORS ??= 'env,host,serviceinstance';

const sdk = new NodeSDK({
  serviceName: process.env.OTEL_SERVICE_NAME ?? 'enterprise-api',
  // OTEL_TRACES_EXPORTER=none, or OTLP through the scrubber: any other exporter would bypass it.
  traceExporter: process.env.OTEL_TRACES_EXPORTER === 'none' ? undefined : new ScrubbingSpanExporter(new OTLPTraceExporter()),
  // Its server.address is a tenant-chosen webhook host: a label per receiver, and a tenant's business on a metric.
  views: [
    {
      instrumentName: 'http.client.request.duration',
      attributesProcessors: [createAllowListAttributesProcessor(['http.request.method', 'http.response.status_code', 'error.type'])],
    },
  ],
  instrumentations: [
    new HttpInstrumentation({ ignoreIncomingRequestHook: (req) => UNTRACED.some((path) => req.url?.startsWith(path)) }),
    new ExpressInstrumentation({ ignoreLayersType: [ExpressLayerType.MIDDLEWARE, ExpressLayerType.ROUTER] }),
    new IORedisInstrumentation(),
    new UndiciInstrumentation(),
    new RuntimeNodeInstrumentation(),
    new PrismaInstrumentation(),
  ],
});
sdk.start();

// Nest closes the app on the first signal, then sends it again: only then has everything been emitted. Listening here
// means that second signal no longer ends the process by itself. Bounded, so an unreachable backend cannot hold it up.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  let closing = false;
  process.on(signal, () => {
    if (!closing) {
      closing = true;
      return;
    }
    setTimeout(() => process.exit(0), 5000).unref();
    void sdk.shutdown().finally(() => process.exit(0));
  });
}
