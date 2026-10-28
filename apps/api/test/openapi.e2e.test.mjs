import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { FIXTURES, startApp } from './helpers.mjs';

let app, origin, spec;

before(async () => {
  process.env.API_DOCS = 'true';
  let base;
  ({ app, base } = await startApp());
  origin = base.replace(/\/v1$/, '');
  spec = await (await fetch(`${origin}/docs/openapi.json`)).json();
});

after(() => app?.close());

const op = (method, path) => spec.paths[path]?.[method];
const params = (operation, where) => Object.fromEntries((operation.parameters ?? []).filter((p) => p.in === where).map((p) => [p.name, p]));

test('every route the API serves is documented, with a summary, a success response and its access rule', () => {
  // What Express actually routes, e.g. "delete /v1/api-keys/{id}".
  const served = app
    .getHttpAdapter()
    .getInstance()
    .router.stack.filter((layer) => layer.route?.path.startsWith('/v1/'))
    .flatMap((layer) => Object.keys(layer.route.methods).map((m) => [m, layer.route.path.replace(/:(\w+)/g, '{$1}')]));
  assert.ok(served.length > 30, `only ${served.length} routes found`);
  for (const [method, path] of served) {
    const operation = op(method, path);
    assert.ok(operation, `${method} ${path} is not documented`);
    assert.ok(operation.summary, `${method} ${path} has no summary`);
    assert.ok(Object.keys(operation.responses).some((s) => s.startsWith('2')), `${method} ${path} has no success response`);
    assert.ok(operation.responses['429'], `${method} ${path} does not mention rate limiting`);
    // Either public (no credentials) or protected with the roles the guards enforce.
    if (operation.security) assert.ok(operation['x-roles']?.length, `${method} ${path} has credentials but no roles`);
    else assert.match(operation.description, /Public/, `${method} ${path} is neither public nor protected`);
  }
});

test('request schemas come from the Zod pipes that validate them', () => {
  const create = op('post', '/v1/api-keys').requestBody.content['application/json'].schema;
  assert.deepEqual(Object.keys(create.properties).sort(), ['name', 'role']);
  // SuperAdmin is never assignable: the schema says so too.
  assert.ok(!create.properties.role.enum.includes('SuperAdmin'));

  const query = params(op('get', '/v1/audit-logs'), 'query');
  assert.deepEqual(Object.keys(query).sort(), ['actorId', 'cursor', 'from', 'limit', 'targetId', 'to']);
  assert.deepEqual(query.limit.schema, { default: 20, type: 'integer', minimum: 1, maximum: 100 });
  // A format replaces the regex that implements it, so the reference stays readable.
  assert.deepEqual(query.actorId.schema, { type: 'string', format: 'uuid' });
  assert.equal(query.from.schema.format, 'date-time');

  assert.deepEqual(params(op('patch', '/v1/users/{id}'), 'path').id.schema, { type: 'string', format: 'uuid' });
  assert.ok(params(op('get', '/v1/storage/downloads'), 'query').key.required);
});

test('responses, credentials and headers follow the routes', () => {
  const page = op('get', '/v1/users').responses['200'].content['application/json'].schema;
  assert.deepEqual(page.required, ['items', 'nextCursor']);
  assert.ok(page.properties.items.items.properties.email);

  const login = op('post', '/v1/auth/login');
  assert.equal(login.security, undefined, 'sign-in needs no credentials');
  assert.ok(login.responses['409'], 'local-auth-only routes say Clerk mode answers 409');
  assert.deepEqual(op('get', '/v1/users').security, [{ bearer: [] }, { apiKey: [] }]);
  assert.deepEqual(op('get', '/v1/integrations')['x-roles'], ['TenantAdmin', 'Auditor']);

  // X-Tenant-Id only where a SuperAdmin may act on another tenant's data.
  assert.ok(params(op('patch', '/v1/users/{id}'), 'header')['X-Tenant-Id']);
  assert.equal(params(op('get', '/v1/auth/me'), 'header')['X-Tenant-Id'], undefined, "the caller's own account");
  assert.equal(params(op('get', '/v1/integrations'), 'header')['X-Tenant-Id'], undefined, 'SuperAdmin is not allowed there');

  assert.ok(op('get', '/v1/notifications/stream').responses['200'].content['text/event-stream']);
  assert.deepEqual(Object.keys(spec.components.securitySchemes).sort(), ['apiKey', 'bearer']);
});

test('Swagger UI is served at /docs', async () => {
  const res = await fetch(`${origin}/docs`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /swagger-ui/i);
});

test('a route without @ApiDoc stops the document from building', async () => {
  await assert.rejects(startApp({ optionalModulesDir: join(FIXTURES, 'optional-undocumented') }), /UndocumentedController\.list has no @ApiDoc/);
});

test('API_DOCS=false serves no docs', async () => {
  process.env.API_DOCS = 'false';
  const { app: bare, base } = await startApp();
  try {
    assert.equal((await fetch(`${base.replace(/\/v1$/, '')}/docs/openapi.json`)).status, 404);
  } finally {
    await bare.close();
    process.env.API_DOCS = 'true';
  }
});
