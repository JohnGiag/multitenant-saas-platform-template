# CLAUDE.md — enterprise-api-starter

A reusable, project-agnostic **multi-tenant SaaS boilerplate**: a headless NestJS API core plus a Next.js admin dashboard. Every rule below is binding for all code in this repo.

## Execution rule: feature by feature

- Build **one feature or module at a time**. Never scaffold the whole app or several complex systems in one step.
- Each step ends in a working, compiling state. Stop and wait for confirmation before starting the next feature.
- Don't add speculative code, options or abstractions that the current feature doesn't need.

## Tech stack

| Area                                       | Choice                                        |
| ------------------------------------------ | --------------------------------------------- |
| Monorepo                                   | Turborepo + pnpm workspaces                   |
| API (`apps/api`)                           | NestJS, modular monolith, Clean Architecture  |
| Dashboard (`apps/web`)                     | Next.js (App Router), Tailwind CSS, shadcn/ui |
| Shared contracts (`packages/shared-types`) | TypeScript interfaces, DTOs, Zod schemas      |
| Data                                       | PostgreSQL 17 via Prisma ORM                  |
| Cache / queues                             | Redis, BullMQ                                 |
| Object storage                             | Cloudflare R2 / S3-compatible                 |

## Repository layout

```
apps/
  api/                 NestJS API
  web/                 Next.js admin dashboard
packages/
  shared-types/        Zod schemas + inferred types shared by api and web
```

### API module layout (Clean Architecture)

Each module under `apps/api/src/modules/<name>/` is split into:

- `domain/`: entities, value objects, ports (interfaces). No framework or ORM imports.
- `infrastructure/`: adapters that implement the ports (Prisma repositories, Redis, R2, Resend, FCM, Clerk).
- `presentation/`: controllers, guards, request/response mapping.

Dependencies point inward: presentation → domain ← infrastructure. Domain code never imports Prisma, NestJS HTTP types or vendor SDKs.

## Plug-and-play modularity

- **Core modules** (always present): tenancy, auth, RBAC, API keys, BYOK integrations, rate limiting, jobs, notifications core, system capabilities.
- **Optional modules** (e.g. FCM push, R2 storage, email dispatch, Stripe billing) each live in one self-contained folder.
- **Deleting an optional module's folder must not break compilation.** Nothing outside an optional module's folder imports from it, neither core code nor other optional modules (enforced by `apps/api/test/architecture.test.mjs`). Shared code between optional modules belongs in core.
- **Contract:** each optional module is a folder `apps/api/src/optional/<key>/` whose `index.ts` default-exports `{ key, integration?, module } satisfies OptionalModule` (from `modules/system/domain/optional-module.ts`). At startup the loader imports every compiled `optional/*/index.js` and adds `module` to the app; a folder without `index.js`, an invalid descriptor or a duplicate key stops startup.
- **Meters:** a module declares what it counts with `meters: [{ key, quotas }]` in that descriptor (per tier, `{ limit, hard }` or `null` for no limit), spends with `UsageMeter.record(tenantId, meter, quantity)`, and enforces a hard limit with `@EnforceQuota(meter)` on the route (`429`, code `quota_exceeded`; `UsageMeter.isRefused` where there is no route).
- **Feature flags:** a module declares its own with `featureFlags: [{ key, minTier }]` in that descriptor (`minTier: null` is off until overridden); a migration adds a `flag.<key>` translation for every locale. Check them with `@RequireFeature(key)` on routes and `FeatureFlags.isEnabled(tenantId, key)` where there is no route, never with `principal.tier` (stale, and the SuperAdmin's own under `X-Tenant-Id`). An override beats the tier both ways. Only `SuperAdmin` sets overrides, like tiers; `@RequireFeature` never widens `@Roles`. A flag with the module's own key gates the whole module, so its capability reports disabled.
- `integration` names the `tenant_integrations` provider that switches the module on per tenant; omit it when the module needs no tenant configuration. `platformReady` keeps a module disabled while platform settings it cannot work without are missing (billing without `STRIPE_*`). `ownsTenantTier` marks a module that sets tenant tiers itself: while it is enabled, core refuses manual tier changes. `PUT /v1/integrations/:provider` only accepts providers declared by an installed module (deleting stays allowed, to clean up after uninstalled ones).
- Optional modules may import core code; core reaches them only through ports (e.g. `INTEGRATION_SERVICE`) and the registry.
- `GET /v1/system/capabilities` reports which optional modules are installed and enabled for the current tenant. The web dashboard reads it to show or hide the settings for each feature.

## Multi-tenancy

- **Primary keys & IDs:** NEVER use auto-incrementing integer IDs (`autoincrement()`). All entities must use globally unique, time-sortable IDs (`UUIDv7` or `cuid2`) to prevent ID enumeration vulnerabilities and maintain index performance.
- Every tenant-owned table has a non-null `tenant_id` column, and **every query filters by it**, including background jobs, admin tooling and raw SQL. The only exceptions are lookups that happen before any tenant is known: sign-in and password reset find a user's accounts by email (capped by `MAX_ACCOUNTS_PER_EMAIL` in `modules/auth/domain/account-lookup.ts`; sign-in only acts on accounts whose password matched, reset only mails the email's owner), and Clerk webhooks address a Clerk user across their tenants. One system process is also exempt: `OutboxRelay` claims due `outbox_events` before it knows any tenant, passes each row only to a job carrying that row's own `tenant_id`, and never returns rows to a caller. A `RetentionSweep` (`common/retention-sweep.ts`) deletes rows past their retention by age alone: it reads nothing and returns nothing. Add no others.
- **Composite indexes on tenant-owned tables start with `tenant_id`** as the leftmost column (e.g. `@@index([tenantId, createdAt, id])`). The exceptions above have their own indexes (`users.email`, `users.clerk_user_id`, `outbox_events (next_attempt_at, id)`, and each sweep's `created_at`).
- **Sign-in needs only email and password.** When the password matches accounts in several tenants, the API answers with a `TenantChoice` and the client signs in again with the chosen `tenantId`. Never ask users for a tenant ID.
- Tenant context is resolved once per request (auth token or API key) and passed explicitly or via request-scoped context. Never trust a `tenantId` from a request body.
- Handlers get the tenant from `@TenantId()`, never from `principal.tenantId`. It honours a SuperAdmin's `X-Tenant-Id` and throws instead of yielding `undefined` (Prisma drops `undefined` filters).
- Only `SuperAdmin` may operate across tenants, and only through explicit, audited code paths.
- **`SuperAdmin` manages tenants and their users, nothing inside them.** It never gets a tenant's integrations (BYOK secrets), messaging or other business data, not even via `X-Tenant-Id`: leave `SuperAdmin` out of `@Roles` on such routes. Its own account routes (`/auth/me`, its own stream and devices) are fine.
- Every new tenant-scoped repository needs a test proving that tenant A cannot read or write tenant B's data.
- **Deleting a tenant erases everything it owns.** Core tables are deleted in `PrismaTenantRepository.delete`. Data kept elsewhere (files in a bucket, queued jobs) is erased by a hook registered in `TenantDeletionHooks` (`modules/tenancy`). Hooks run before the rows are deleted and must be safe to run twice. An optional module's table uses `onDelete: Cascade` on its tenant relation, so core never names it. The one exception: a deleted tenant's id stays in exported traces until the telemetry backend's retention expires it (an opaque id, nothing else about the tenant).

## Auth & security

- **Provider abstraction:** a single `AuthService` port in the auth domain. Adapters: local (JWT + Argon2id password hashing) and Clerk. Selected by config. Swapping providers must not touch domain logic or other modules. In Clerk mode, Clerk Organizations are tenants and memberships are users, mirrored by the signed webhooks (`ClerkWebhookHandler`, idempotent and order-independent); roles and tiers stay in our database. Routes Clerk takes over carry `@LocalAuthOnly()` (409 in Clerk mode), and the dashboard hides their screens when its own `AUTH_PROVIDER` (`lib/auth-mode.ts`, same value as the API's) is `clerk`.
- **Sessions (local mode):** 15-minute access tokens and single-use refresh tokens, rotated through `auth_sessions`. Refresh tokens are derived from `(tenant, session, generation)` with an HMAC and never stored; a replay ends the session. Anything that should stop existing access tokens calls `AccessRevocations.revoke(scope, id)` after its change commits (`tenant`, `user`, `session` or `apiKey`). The dashboard renews cookies only in `/session/refresh`, since pages cannot set them.
- **RBAC roles:** `SuperAdmin`, `TenantAdmin`, `User`, `Auditor`. `Auditor` is read-only. Enforce with guards plus decorators on controllers; deny by default.
- **API keys** (for headless clients): show the key once at creation, store only its hash, look it up by a non-secret prefix, compare in constant time, scope it to a tenant, and support revoking it. Format `sk_<live|test>_<prefix>_<secret>`. Verified keys are cached per instance for 30 seconds (`ApiKeyCache`, the hash and never the secret); a `tenant` or `apiKey` revocation makes the next request read the database again, so revoking is immediate unless Redis is down, when a revoked key can work for up to those 30 seconds.
- **API key scopes** narrow a key's role, never widen it. A route is closed to keys unless it (or its controller) carries `@RequireScope()`: no name means `read` for read methods and `write` for the rest, a name means that scope. A module adds its own with `ApiScopes.declare` in `onModuleInit`. Billing stays closed to keys.
- **Test mode:** a live tenant has at most one sandbox, an ordinary tenant with `tenants.sandbox_of` set, created on first use, deleted with its parent, hidden from the tenant list. Test keys belong to it, so every isolation rule applies unchanged. A signed-in member switches with `X-Sandbox: true`, which only changes what `@TenantId()` resolves to and keeps their role; `X-Sandbox` is refused from API keys (their mode is in the key) and from `SuperAdmin`. A sandbox has no plan: `FeatureFlags` and key rate limits use its live tenant's tier. Routes with real effects outside the platform carry `@LiveOnly()` (invitations, billing).
- **Invitation only, in both modes: no self sign-up.** Local mode: invitations from the dashboard's Users page; never add a sign-up route. Clerk mode: Clerk organization invitations, with Clerk's sign-up mode Restricted and organization creation and deletion by users turned off (README, Clerk mode).
- **Passwords are only ever chosen by their owner.** Users join through invitations and recover through password resets: single-use emailed tokens, stored only as SHA-256 hashes, never put in queues, logs or responses. System emails go through `SYSTEM_MAILER` (`modules/mail`), always with the platform's credentials: never send an email carrying a link through a tenant-controlled account, which could read it in its logs.
- **BYOK secrets** (`tenant_integrations` table): tenant-provided keys (Resend, Firebase, R2, …) are encrypted with **AES-256-GCM**, with a random 96-bit IV for each encryption, and the auth tag is stored with the ciphertext. The master key comes from the environment and must never be logged. Secrets are decrypted only at the moment of use and never returned by the API. Responses show only masked values.
- Validate all input at the boundary with Zod schemas from `packages/shared-types`.
- Never log secrets, tokens, passwords or full PII.

### Compliance targets

- **ISO 27001**: access control, encryption at rest and in transit, audit logs for security-relevant actions. `AuditInterceptor` (`modules/audit`) records every successful write by a signed-in caller in `audit_logs`, in the actor's own tenant. Public routes that change an account (sign-in, a replayed refresh token, invitation acceptance, password reset) write their row in the same transaction instead. It records only ids and route patterns, never raw URLs, bodies or PII. `@NotAudited()` skips a route: only for high-volume machine traffic that is no person's action (a tenant's server sending data), never for a route a person uses to change something.
- **ISO 27701**: minimal PII collection, tenant-scoped PII, support for export (`GET /v1/users/:id/export`, plus `GET /v1/audit-logs?actorId=`, for a `TenantAdmin`) and deletion of a data subject's records.
- **ISO 42001**: any AI feature records model, input metadata, output and actor in an audit trail.

## File storage (R2 / S3)

- Optional storage module behind a `StorageProvider` port.
- Clients upload and download through **presigned URLs**. File bytes never go through the API.
- Object keys are prefixed with the tenant ID (`<tenantId>/...`).
- Credentials and bucket config can be set per tenant (BYOK through `tenant_integrations`), with platform defaults as a fallback.
- Upload URLs sign the exact file size (max `MAX_UPLOAD_BYTES`, 1 MB). Files in the platform bucket are tracked in `storage_objects` and capped per tenant (`PLATFORM_QUOTA`). The API sends requests only to the platform bucket, never to a tenant-chosen endpoint (SSRF).

## Infrastructure & performance

- **Rate limiting:** Redis sliding window, keyed by tenant + user (or API key) + tier. Return `429` with a `Retry-After` header. Implemented as a global guard (`modules/rate-limit`); `AppModule` registers the guard chain in order `AuthGuard` (identifies, never rejects) → `RateLimitGuard` → `AccessGuard` (roles, 401/403) → `TenantContextGuard`, so every route is covered without opting in, rejected credentials included (the one exception: requests a route's `@ExemptTrustedCaller` check proves come from a provider, such as a validly signed Stripe webhook; anything unproven is limited as usual): authenticated callers get their tier's limit and fail open when Redis is down; public routes are limited per client IP and route and fail closed (except health probes, marked `@FailOpen()`). An IPv6 client counts as its whole /64 (`rateLimitAddress`), since one connection owns all of it. The dashboard forwards each browser's IP (`X-Client-Ip`), believed only with `DASHBOARD_PROXY_SECRET`; never trust a client-supplied IP header without it. Login is also limited per hashed email (any tenant) when signing in by email alone, or per account (tenant + hashed email) when a `tenantId` is sent, counted before the lookup: per client IP first, then for all IPs together at a higher ceiling, so one stranger's guesses cannot lock the owner out (many addresses together can reach the ceiling: the price of having one). A successful login resets that IP's counter, never the ceiling. Password reset requests are limited the same way per hashed email. Limits live in `rate-limit-policy.ts`.
- **Background jobs:** heavy work (emails, webhooks, processing) runs on BullMQ workers. Every job payload carries `tenantId`, and the worker loads that tenant's secrets when it runs (no secrets in job payloads). Use retries with backoff, and send jobs that run out of attempts to a **dead-letter queue**. New queues use `JobsModule.registerQueue(name)` (shared retry policy + `<name>-dlq`) and a worker extending `DeadLetteringWorker` (`modules/jobs`), which handles dead-lettering, the startup sweep, shutdown during a Redis outage, and dropping a deleted tenant's jobs. A queue whose jobs can pile up for one tenant opts in to fair queueing with `JobsModule.registerQueue(name, { partitions })`: producers take the queue from `PartitionedQueues.for(tenantId)`, and each partition has its own worker, so a flood slows only about one partition's tenants (see `WEBHOOKS_WORKERS`). `WORKER_CONCURRENCY` applies per partition. Every outgoing HTTP call has a timeout (`AbortSignal.timeout`), so a hung provider cannot hold a worker slot. Queue connections wait out a Redis outage, so a queue call on a request path goes through `withTimeout(…, QUEUE_TIMEOUT_MS, …)` (`common/with-timeout.ts`): a request must answer during an outage. A controller turns that into a 503 with `.catch(unavailableOnTimeout)`.
- **Idempotency:** `@Idempotent()` on a route that creates something (`modules/idempotency`) makes a retry with the same `Idempotency-Key` header return the first response instead of a second change, for 24 hours. A key belongs to a tenant, and to the caller and request that first used it (`422` otherwise); `409` while it runs. A failed request frees its key. `@Idempotent({ secret: true })` for a response that holds something shown once: it is never stored, and a retry gets a `409`.
- **Pagination:** every list endpoint uses **keyset (cursor) pagination** over a stable order (e.g. `(created_at, id)`), backed by an index that starts with `tenant_id`. Never use `OFFSET`. Use `common/keyset.ts` (`keysetArgs` + `keysetPage`, cursor validated by `keysetCursorSchema(<sort field's Zod type>)`, e.g. `z.iso.datetime()` for `created_at`) with an index on `(tenant_id, <field>, id)`; a unique sort key can use `toCursorPage` directly. `apps/api/test/pagination.e2e.test.mjs` shows how to prove the index is used with `EXPLAIN`.

## Usage metering

- `modules/usage` counts in Redis per tenant, meter and hour; `UsageFlush` copies the hours to `usage_records` every 2 minutes, never lowering a count, so a lost Redis costs minutes, not a month. Each counter carries its own tenant. Quotas are per calendar month (UTC), and a sandbox counts apart under its live tenant's tier.
- Passing 80% and 100% of a quota publishes `usage.threshold_reached`, which mails the tenant's admins through `SYSTEM_MAILER`.
- Core never imports billing: billing follows `UsageMeter.onFlushed` and reports what is new to Stripe's meter events, under the meter's key as the event name. The identifier holds the record id and its total, so a retry is counted once.

## Events and webhooks

- Report what happened in a tenant with `recordEvent(tx, tenantId, type, data)` (`modules/events/infrastructure/outbox.ts`), inside the transaction of the change itself, so an event is never lost or sent for a change that rolled back. Payloads leave the platform: ids and roles only, never emails, names or secrets. A module publishing its own types declares them with `TenantEvents.declare`.
- `OutboxRelay` moves `outbox_events` rows into the `tenant-events` queue, at least once and in no guaranteed order, moments after the response. A row stays until Redis has it, however long an outage lasts. `TenantEventsWorker` then runs the listeners with the usual job retries, every listener under the same event id, and one that keeps failing sends the event to `tenant-events-dlq`. So a listener must be safe to run twice and must give up soon, because it holds a worker slot.
- The optional `webhooks` module delivers them to the tenant's endpoints (Standard Webhooks signatures, its own retry schedule). **Every outgoing request to a tenant-chosen URL goes through `postWebhook`** (`optional/webhooks/infrastructure/https-delivery.ts`), which refuses non-public addresses at connection time (SSRF). Never call a tenant-chosen URL with plain `fetch`. Every attempt is logged in `webhook_deliveries` for 30 days, with its payload (ids only) and never the endpoint's response, which could contain anything. Redelivering keeps the original `webhook-id`, so receivers still deduplicate.

## Observability

- OpenTelemetry, off unless `dist/telemetry.js` is preloaded (`start:otel`, or `NODE_OPTIONS` in production). The app never imports that file, and needs nothing else to switch on: use `@opentelemetry/api` directly, which does nothing without it. Backends are chosen with standard `OTEL_*` variables, so never add a vendor SDK or a vendor-specific exporter.
- **Allowlists, not blocklists.** A span attribute leaves only if it is in `EXPORTED_SPAN_ATTRIBUTES` (`infrastructure/telemetry/span-scrubber.ts`). Every trace exporter goes through `ScrubbingSpanExporter`. Exceptions keep only their type.
- **Telemetry follows the logging rule:** ids and route patterns, never secrets, tokens, raw URLs, IP addresses, user agents, emails or names. `test/telemetry.e2e.test.mjs` proves it against the real server.
- **Metric labels stay bounded:** never a tenant, user, raw URL or tenant-chosen host, because each value adds a time series. `tenant.id` belongs on spans only.
- Log messages are exported as written, so never put a client IP or PII in one.

## Notifications

- A multi-channel dispatcher with these channels: **SSE** (real-time web updates), **FCM** (push), **Resend** (transactional email).
- Each channel is a pluggable adapter. If a channel's module is missing or the tenant hasn't configured it, the dispatcher skips that channel without errors and logs at debug level.
- Delivery runs through BullMQ, except SSE fan-out.
- **Checks that reject a request belong in guards, not interceptors or handlers that run after an `await`.** Nest runs interceptors lazily; on an SSE route that is after the stream has started, so a late 403/429 becomes a 200 with an `error` event.
- **Adding a channel:** an optional module provides a class implementing `NotificationChannel` (`modules/notifications/domain/notification-channel.ts`) that registers itself in `NotificationChannelRegistry` in `onModuleInit`. Throw `PermanentDeliveryError` for failures a retry cannot fix; any other error is retried. Use `deliveryId` as the provider's idempotency key where one exists.
- SSE goes through Redis Pub/Sub (`SseHub`) so events reach users connected to any instance.

## Frontend (`apps/web`)

- Must meet **WCAG 2.1/2.2 AA**: semantic HTML, Radix/shadcn primitives, visible focus, full keyboard operation, labelled form controls, AA colour contrast, and `aria-live` for async status. Every new page goes into `e2e/a11y.spec.ts` (axe), and new flows get a Playwright test in `apps/web/e2e`.
- The browser never calls the API. Server components and server actions call it through `lib/api.ts` (server-only), with the token from the `httpOnly` session cookie. Never expose the token or `API_URL` to client code.
- Feature settings pages render only when `/v1/system/capabilities` reports the feature.
- **No hard-coded UI text.** It lives in the platform-wide `translations` table (not tenant-owned) and reaches pages through `getT()` (server components and actions), `useT()` (client components) and `pageTitle(key)` (titles). A new key gets a row for every locale in `LOCALES`, inserted by a migration; `src/lib/messages.test.ts` checks every key used is seeded, and `test/i18n.e2e.test.mjs` that every locale has every key.
- API types and validation come from `packages/shared-types`. Don't duplicate DTOs.

## Conventions

- TypeScript `strict` everywhere. Extend `tsconfig.base.json`.
- API routes are versioned under `/v1`.
- Every route carries `@ApiDoc(summary, responseSchema)` (`common/api-doc.ts`; `null` for an empty body, omitted only for `204`). The OpenAPI document at `/docs` reads everything else from the route (Zod pipes, `@Roles`, `@Public`, `@LocalAuthOnly`, `@HttpCode`), and a route without `@ApiDoc` stops it from building (`test/openapi.e2e.test.mjs`). Validate input with `new ZodValidationPipe(Schema)` so it is documented too.
- Database columns use `snake_case` (mapped through Prisma `@map`). TypeScript uses `camelCase`.
- Root scripts (`pnpm build | dev | typecheck | test | test:e2e`) run through Turborepo.
