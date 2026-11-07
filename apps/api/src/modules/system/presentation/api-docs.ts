import { ParseUUIDPipe, RequestMethod, type INestApplication } from '@nestjs/common';
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
  SSE_METADATA,
} from '@nestjs/common/constants.js';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum.js';
import { ConfigService } from '@nestjs/config';
import { ModulesContainer } from '@nestjs/core';
import {
  ApiBearerAuth,
  ApiBody,
  ApiExtension,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
  DocumentBuilder,
  SwaggerModule,
  type SchemaObject,
} from '@nestjs/swagger';
import type { Role } from '@repo/shared-types';
import { z } from 'zod';
import { API_DOC_KEY, type ApiDocMetadata } from '../../../common/api-doc.js';
import { appName } from '../../../config/app-name.js';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { scopeFor } from '../../auth/domain/access-policy.js';
import { IS_PUBLIC_KEY, ROLES_KEY, SCOPE_KEY, SELF_SERVICE_KEY } from '../../auth/presentation/decorators.js';
import { LocalAuthOnlyGuard } from '../../auth/presentation/local-auth-only.js';
import { FEATURE_KEY } from '../../feature-flags/presentation/require-feature.js';
import { IDEMPOTENT_KEY } from '../../idempotency/presentation/idempotency.guard.js';
import { LIVE_ONLY_KEY, tenantIdOf } from '../../tenancy/presentation/tenant-context.js';

// The OpenAPI document at /docs (Swagger UI) and /docs/openapi.json. Built from what the routes already declare: the
// Zod schemas their pipes validate with (body, query, path parameters), @Roles/@Public/@LocalAuthOnly/@RequireFeature
// (security, roles, X-Tenant-Id) and @HttpCode (status). Only the summary and the response schema are written by hand, in
// @ApiDoc, and a route without it stops the document from building.

const DESCRIPTION = `
Multi-tenant SaaS API. Every request acts on the caller's own tenant.

**Credentials:** \`Authorization: Bearer <token>\` (from \`POST /v1/auth/login\`, or a Clerk session token in Clerk mode),
or \`X-API-Key: <key>\` for a tenant's own servers. A \`SuperAdmin\` may act on another tenant with \`X-Tenant-Id\` on the
routes that list that header.

**Pagination:** list routes take \`limit\` (1-100, default 20) and \`cursor\`, and answer \`{ items, nextCursor }\`. Pass
\`nextCursor\` back as \`cursor\` for the next page; it is \`null\` on the last one.

**Rate limits:** every response carries \`X-RateLimit-Limit\`, \`X-RateLimit-Remaining\` and \`X-RateLimit-Reset\`. Over the
limit: \`429\` with \`Retry-After\` (seconds).

**Errors:** \`{ statusCode, message, error? }\`; for invalid input, \`message\` lists \`{ path, message }\` per problem.
`.trim();

const ERROR_SCHEMA: SchemaObject = {
  type: 'object',
  required: ['statusCode', 'message'],
  properties: {
    statusCode: { type: 'integer' },
    message: {
      oneOf: [
        { type: 'string' },
        {
          type: 'array',
          items: {
            type: 'object',
            properties: { path: { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'integer' }] } }, message: { type: 'string' } },
          },
        },
      ],
    },
    error: { type: 'string' },
  },
};

// Zod to an OpenAPI 3.0 schema. A `format` (uuid, email, date-time) already says what the regex Zod adds next to it says.
export function openApiSchema(schema: z.ZodType, io: 'input' | 'output'): SchemaObject {
  return dropFormatPatterns(z.toJSONSchema(schema, { io, target: 'openapi-3.0', unrepresentable: 'any' })) as SchemaObject;
}

function dropFormatPatterns(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(dropFormatPatterns);
  if (!node || typeof node !== 'object') return node;
  const keep = Object.entries(node).filter(([key]) => !(key === 'pattern' && 'format' in node));
  return Object.fromEntries(keep.map(([key, value]) => [key, dropFormatPatterns(value)]));
}

type Controller = abstract new (...args: never[]) => unknown;
interface RouteArg {
  data?: unknown;
  pipes?: unknown[];
  // Set for custom parameter decorators, e.g. @TenantId().
  factory?: unknown;
}

// In this order in Swagger UI; only those with routes are listed.
const TAGS: Record<string, string> = {
  auth: 'Sign-in, password resets and the Clerk webhook',
  tenants: 'Tenants (SuperAdmin manages them all)',
  users: 'Members of the current tenant',
  invitations: 'Joining by invitation (local auth mode)',
  'api-keys': "Credentials for a tenant's own servers",
  integrations: 'BYOK secrets, encrypted at rest',
  notifications: 'Real-time stream and email/push delivery',
  push: 'Push devices (optional module)',
  storage: 'Files through presigned URLs (optional module)',
  'audit-logs': 'Recorded writes',
  translations: "The dashboard's text in each language",
  system: 'Installed modules',
  'feature-flags': 'What each tenant may use (SuperAdmin sets overrides)',
};

// Swagger's decorators append: describe each controller once, even when tests create several apps in one process.
const described = new WeakSet<Controller>();

function describeController(controller: Controller): void {
  if (described.has(controller)) return;
  described.add(controller);
  // Grouped by the first path segment: auth, users, storage...
  ApiTags(String(Reflect.getMetadata(PATH_METADATA, controller) ?? '').split('/')[0]!)(controller);
  for (const key of Object.getOwnPropertyNames(controller.prototype)) {
    const descriptor = Object.getOwnPropertyDescriptor(controller.prototype, key)!;
    if (typeof descriptor.value === 'function' && Reflect.getMetadata(METHOD_METADATA, descriptor.value) !== undefined) {
      describeRoute(controller, key, descriptor);
    }
  }
}

function describeRoute(controller: Controller, key: string, descriptor: PropertyDescriptor): void {
  const handler = descriptor.value as object;
  const where = `${controller.name}.${key}`;
  // Method first, then class: how AccessGuard reads them too.
  const meta = <T>(name: string): T | undefined => Reflect.getMetadata(name, handler) ?? Reflect.getMetadata(name, controller);

  const doc = Reflect.getMetadata(API_DOC_KEY, handler) as ApiDocMetadata | undefined;
  if (!doc) throw new Error(`${where} has no @ApiDoc: every route documents its summary and response`);
  const sse = Reflect.getMetadata(SSE_METADATA, handler) === true;
  const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod;
  const status: number = Reflect.getMetadata(HTTP_CODE_METADATA, handler) ?? (method === RequestMethod.POST ? 201 : 200);
  if (doc.response === undefined && status !== 204 && !sse) {
    throw new Error(`${where}: @ApiDoc needs the response schema (null for an empty body)`);
  }
  const isPublic = meta<boolean>(IS_PUBLIC_KEY) === true;
  const roles = meta<Role[]>(ROLES_KEY);
  const guards: unknown[] = [...(Reflect.getMetadata(GUARDS_METADATA, controller) ?? []), ...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? [])];
  const localOnly = guards.includes(LocalAuthOnlyGuard);
  const feature = meta<string>(FEATURE_KEY);
  const idempotent = Reflect.getMetadata(IDEMPOTENT_KEY, handler) !== undefined;

  const decorators: MethodDecorator[] = [];
  let validated = false;

  // Request: straight from the pipes that validate it.
  const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, key) ?? {}) as Record<string, RouteArg>;
  // Only routes that read the tenant act on another one with X-Tenant-Id; the caller's own account does not.
  const tenantScoped = Object.values(args).some((arg) => arg.factory === tenantIdOf);
  for (const [argKey, { data, pipes = [] }] of Object.entries(args)) {
    const type = Number(argKey.split(':')[0]);
    const zod = pipes.find((p): p is ZodValidationPipe<z.ZodType> => p instanceof ZodValidationPipe)?.schema;
    const uuid = pipes.some((p) => p === ParseUUIDPipe || p instanceof ParseUUIDPipe);
    validated ||= !!zod || uuid;
    if (type === RouteParamtypes.BODY && zod) decorators.push(ApiBody({ schema: openApiSchema(zod, 'input') }));
    if (type === RouteParamtypes.QUERY && zod) {
      const { properties = {}, required = [] } = openApiSchema(zod, 'input');
      for (const [name, schema] of Object.entries(properties)) {
        const description = name === 'cursor' ? "The previous page's `nextCursor`" : undefined;
        decorators.push(ApiQuery({ name, required: required.includes(name), schema: schema as SchemaObject, description }));
      }
    }
    if (type === RouteParamtypes.PARAM && typeof data === 'string') {
      const schema: SchemaObject = zod ? openApiSchema(zod, 'input') : uuid ? { type: 'string', format: 'uuid' } : { type: 'string' };
      decorators.push(ApiParam({ name: data, required: true, schema }));
    }
  }

  // Security and roles: the same metadata the guards enforce.
  const notes: string[] = [];
  if (isPublic) {
    notes.push('**Public:** no credentials.');
  } else {
    decorators.push(ApiBearerAuth(), ApiSecurity('apiKey'));
    if (roles) decorators.push(ApiExtension('x-roles', roles));
    notes.push(`**Roles:** ${roles?.join(', ') ?? 'none'}`);
    const scope = meta<string>(SCOPE_KEY);
    notes.push(scope ? `**API keys:** need the \`${scopeFor(scope, RequestMethod[method])}\` scope.` : '**API keys:** not accepted.');
    if (meta<boolean>(SELF_SERVICE_KEY)) notes.push("The caller's own account: open to `Auditor` too, although it writes.");
    if (tenantScoped && roles?.includes('SuperAdmin')) {
      decorators.push(ApiHeader({ name: 'X-Tenant-Id', required: false, description: 'SuperAdmin only: act on this tenant instead of your own.' }));
    }
    if (meta<boolean>(LIVE_ONLY_KEY)) notes.push('Live data only: `403` in test mode.');
    else if (tenantScoped && roles?.some((role) => role !== 'SuperAdmin')) {
      decorators.push(ApiHeader({ name: 'X-Sandbox', required: false, description: "`true`: a signed-in member acts on the tenant's test data. API keys carry their mode in the key instead." }));
    }
  }
  if (idempotent) {
    decorators.push(ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Retries with the same key get the first response instead of a second change, for 24 hours.' }));
  }
  if (localOnly) notes.push('Local auth mode only: `409` when `AUTH_PROVIDER=clerk`.');
  if (feature) notes.push(`Needs the \`${feature}\` feature: \`403\` while it is off for the tenant.`);
  decorators.push(ApiOperation({ summary: doc.summary, description: notes.join('\n\n') }));

  // Responses.
  if (sse) {
    decorators.push(
      ApiProduces('text/event-stream'),
      ApiResponse({
        status: 200,
        description: 'Server-Sent Events: `notification` (the notification as JSON), `ping` every 25 s, and `closed` when the server ends the stream (do not reconnect).',
        content: { 'text/event-stream': { schema: { type: 'string' } } },
      }),
    );
  } else if (doc.response) {
    decorators.push(ApiResponse({ status, description: 'Success', schema: openApiSchema(doc.response, 'output') }));
  } else {
    decorators.push(ApiResponse({ status, description: status === 204 ? 'No content' : 'Accepted, no body' }));
  }
  const error = (code: number, description: string, extra: Parameters<typeof ApiResponse>[0] = {}) =>
    ApiResponse({ status: code, description, schema: ERROR_SCHEMA, ...extra });
  if (validated) decorators.push(error(400, 'Invalid input'));
  if (!isPublic) decorators.push(error(401, 'Missing, invalid or expired credentials'), error(403, 'Role not allowed on this route, or another tenant'));
  if (localOnly) decorators.push(error(409, 'Managed in Clerk for this deployment'));
  if (idempotent) decorators.push(error(409, 'A request with this key is still running, or its response cannot be repeated'), error(422, 'This key was used for a different request'));
  decorators.push(
    error(429, 'Rate limited', { headers: { 'Retry-After': { description: 'Seconds until a request is allowed again', schema: { type: 'integer' } } } }),
  );

  for (const decorate of decorators) decorate(controller.prototype, key, descriptor);
}

export function setupApiDocs(app: INestApplication): void {
  const name = appName(app.get(ConfigService));
  const tags = new Set<string>();
  for (const module of app.get(ModulesContainer).values()) {
    for (const { metatype } of module.controllers.values()) {
      describeController(metatype as Controller);
      tags.add(String(Reflect.getMetadata(PATH_METADATA, metatype as Controller) ?? '').split('/')[0]!);
    }
  }
  const builder = new DocumentBuilder()
    .setTitle(name)
    .setVersion('1')
    .setDescription(DESCRIPTION)
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Access token from POST /v1/auth/login, or a Clerk session token' })
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-API-Key', description: "A tenant's API key (sk_live_… or sk_test_…)" }, 'apiKey');
  for (const [tag, description] of Object.entries(TAGS)) if (tags.has(tag)) builder.addTag(tag, description);
  const config = builder.build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs/openapi.json',
    customSiteTitle: `API reference · ${name}`,
    swaggerOptions: { persistAuthorization: true, displayRequestDuration: true, showExtensions: true },
  });
}
