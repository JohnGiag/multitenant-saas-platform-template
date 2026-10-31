import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace';

// The only span attributes that leave the process. An allowlist, so an attribute a new instrumentation version starts
// sending stays home until someone adds it here: raw URLs and query strings can carry tokens, client.address and
// user_agent.original are personal data, and db.query.text is left out so no value can slip through in SQL or Redis
// arguments. A custom span's attributes need a line here too. Ids only, never emails, names or secrets.
export const EXPORTED_SPAN_ATTRIBUTES: ReadonlySet<string> = new Set([
  'http.request.method',
  'http.response.status_code',
  'http.route',
  'url.scheme',
  'server.address',
  'server.port',
  'network.protocol.version',
  'error.type',
  'express.type',
  'db.system.name',
  'db.operation.name',
  // Prisma: the model and action, e.g. "User.findMany".
  'name',
  'model',
  'method',
  'models',
  'actions',
  // BullMQ: which job, never its options, result or failure reason, which can hold its data.
  'bullmq.queue.name',
  'bullmq.queue.operation',
  'bullmq.job.name',
  'bullmq.job.id',
  'bullmq.job.attempts.made',
  'tenant.id',
]);

const EXCEPTION_ATTRIBUTES: ReadonlySet<string> = new Set(['exception.type']);

const keep = <T>(attributes: Record<string, T>, allowed: ReadonlySet<string>): Record<string, T> =>
  Object.fromEntries(Object.entries(attributes).filter(([key]) => allowed.has(key)));

// Inherits everything else from the original span. Exception messages and stack traces can quote user input, and
// status.message repeats them, so only the error's type goes out.
export function scrubSpan(span: ReadableSpan): ReadableSpan {
  return Object.create(span, {
    attributes: { value: keep(span.attributes, EXPORTED_SPAN_ATTRIBUTES) },
    events: { value: span.events.map((event) => ({ ...event, attributes: keep(event.attributes ?? {}, EXCEPTION_ATTRIBUTES) })) },
    status: { value: { code: span.status.code } },
  }) as ReadableSpan;
}

export class ScrubbingSpanExporter implements SpanExporter {
  constructor(private readonly exporter: SpanExporter) {}

  export(spans: ReadableSpan[], done: (result: ExportResult) => void): void {
    try {
      this.exporter.export(spans.map(scrubSpan), done);
    } catch (error) {
      // Never hand the raw spans on: a span that cannot be scrubbed is dropped.
      done({ code: ExportResultCode.FAILED, error: error instanceof Error ? error : new Error(String(error)) });
    }
  }

  shutdown(): Promise<void> {
    return this.exporter.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.exporter.forceFlush?.() ?? Promise.resolve();
  }
}
