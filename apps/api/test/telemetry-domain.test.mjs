import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ExportResultCode } from '@opentelemetry/core';
import { ScrubbingSpanExporter, scrubSpan } from '../dist/infrastructure/telemetry/span-scrubber.js';

class FakeSpan {
  name = 'GET /v1/users/:id';
  status = { code: 2, message: 'duplicate key: someone@example.com' };
  attributes = {
    'http.route': '/v1/users/:id',
    'tenant.id': 'tenant-1',
    'url.full': 'https://example.com/hook?token=secret',
    'url.query': 'token=secret',
    'client.address': '203.0.113.7',
    'user_agent.original': 'Mozilla',
    'db.query.text': "UPDATE users SET email = 'someone@example.com'",
    'bullmq.job.result': '{"email":"someone@example.com"}',
    'a.future.attribute': 'nobody reviewed this one',
  };
  events = [
    {
      name: 'exception',
      attributes: { 'exception.type': 'PrismaError', 'exception.message': 'someone@example.com', 'exception.stacktrace': 'at someone@example.com' },
    },
    { name: 'job completed' },
  ];

  spanContext() {
    return { traceId: 'trace-1' };
  }
}

test('only allowlisted attributes leave, so one nobody reviewed stays home', () => {
  assert.deepEqual(scrubSpan(new FakeSpan()).attributes, { 'http.route': '/v1/users/:id', 'tenant.id': 'tenant-1' });
});

test('an exception keeps its type, and loses the message and stack that can quote user input', () => {
  const span = scrubSpan(new FakeSpan());
  assert.deepEqual(span.events.map((e) => e.attributes), [{ 'exception.type': 'PrismaError' }, {}]);
  assert.deepEqual(span.status, { code: 2 });
  assert.doesNotMatch(JSON.stringify(span.events), /someone@example\.com/);
});

test('the rest of the span is untouched, its methods included, and the original is not changed', () => {
  const original = new FakeSpan();
  const span = scrubSpan(original);
  assert.equal(span.name, 'GET /v1/users/:id');
  assert.equal(span.spanContext().traceId, 'trace-1');
  assert.equal(original.attributes['url.query'], 'token=secret');
});

test('the exporter only ever passes on scrubbed spans', () => {
  const sent = [];
  const exporter = new ScrubbingSpanExporter({ export: (spans, done) => (sent.push(...spans), done({ code: ExportResultCode.SUCCESS })) });
  let result;
  exporter.export([new FakeSpan()], (r) => (result = r));
  assert.equal(result.code, ExportResultCode.SUCCESS);
  assert.equal(sent[0].attributes['url.full'], undefined);
});

test('a span that cannot be scrubbed is dropped, never sent raw', () => {
  const sent = [];
  const exporter = new ScrubbingSpanExporter({ export: (spans) => sent.push(...spans) });
  let result;
  exporter.export([{ attributes: null }], (r) => (result = r));
  assert.equal(result.code, ExportResultCode.FAILED);
  assert.deepEqual(sent, []);
});
