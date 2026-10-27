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
- **Optional modules** (e.g. FCM push, R2 storage, email dispatch) each live in one self-contained folder.
- **Deleting an optional module's folder must not break compilation.** Nothing outside an optional module's folder imports from it, neither core code nor other optional modules (enforced by `apps/api/test/architecture.test.mjs`). Shared code between optional modules belongs in core.
- **Contract:** each optional module is a folder `apps/api/src/optional/<key>/` whose `index.ts` default-exports `{ key, integration?, module } satisfies OptionalModule` (from `modules/system/domain/optional-module.ts`). At startup the loader imports every compiled `optional/*/index.js` and adds `module` to the app; a folder without `index.js`, an invalid descriptor or a duplicate key stops startup.
- `integration` names the `tenant_integrations` provider that switches the module on per tenant; omit it when the module needs no tenant configuration. `PUT /v1/integrations/:provider` only accepts providers declared by an installed module (deleting stays allowed, to clean up after uninstalled ones).
- Optional modules may import core code; core reaches them only through ports (e.g. `INTEGRATION_SERVICE`) and the registry.
- `GET /v1/system/capabilities` reports which optional modules are installed and enabled for the current tenant. The web dashboard reads it to show or hide the settings for each feature.

## Multi-tenancy

- **Primary keys & IDs:** NEVER use auto-incrementing integer IDs (`autoincrement()`). All entities must use globally unique, time-sortable IDs (`UUIDv7` or `cuid2`) to prevent ID enumeration vulnerabilities and maintain index performance.
- Every tenant-owned table has a non-null `tenant_id` column, and **every query filters by it**. No exceptions, including background jobs, admin tooling and raw SQL.
- **Composite indexes on tenant-owned tables start with `tenant_id`** as the leftmost column (e.g. `@@index([tenantId, createdAt, id])`).
- Tenant context is resolved once per request (auth token or API key) and passed explicitly or via request-scoped context. Never trust a `tenantId` from a request body.
- Handlers get the tenant from `@TenantId()`, never from `principal.tenantId`. It honours a SuperAdmin's `X-Tenant-Id` and throws instead of yielding `undefined` (Prisma drops `undefined` filters).
- Only `SuperAdmin` may operate across tenants, and only through explicit, audited code paths.
- **`SuperAdmin` manages tenants and their users, nothing inside them.** It never gets a tenant's integrations (BYOK secrets), messaging or other business data, not even via `X-Tenant-Id`: leave `SuperAdmin` out of `@Roles` on such routes. Its own account routes (`/auth/me`, its own stream and devices) are fine.
- Every new tenant-scoped repository needs a test proving that tenant A cannot read or write tenant B's data.
- **Deleting a tenant erases everything it owns.** Core tables are deleted in `PrismaTenantRepository.delete`. Data kept elsewhere (files in a bucket, queued jobs) is erased by a hook registered in `TenantDeletionHooks` (`modules/tenancy`). Hooks run before the rows are deleted and must be safe to run twice. An optional module's table uses `onDelete: Cascade` on its tenant relation, so core never names it.

## Auth & security

- **Provider abstraction:** a single `AuthService` port in the auth domain. Adapters: local (JWT + Argon2id password hashing) and Clerk. Selected by config. Swapping providers must not touch domain logic or other modules. In Clerk mode, Clerk Organizations are tenants and memberships are users, mirrored by the signed webhooks (`ClerkWebhookHandler`, idempotent and order-independent); roles and tiers stay in our database. Routes Clerk takes over carry `@LocalAuthOnly()` (409 in Clerk mode).
- **RBAC roles:** `SuperAdmin`, `TenantAdmin`, `User`, `Auditor`. `Auditor` is read-only. Enforce with guards plus decorators on controllers; deny by default.
- **API keys** (for headless clients): show the key once at creation, store only its hash, look it up by a non-secret prefix, compare in constant time, scope it to a tenant, and support revoking it.
- **Passwords are only ever chosen by their owner.** Users join through invitations and recover through password resets: single-use emailed tokens, stored only as SHA-256 hashes, never put in queues, logs or responses. System emails go through `SYSTEM_MAILER` (`modules/mail`), always with the platform's credentials: never send an email carrying a link through a tenant-controlled account, which could read it in its logs.
- **BYOK secrets** (`tenant_integrations` table): tenant-provided keys (Resend, Firebase, R2, …) are encrypted with **AES-256-GCM**, with a random 96-bit IV for each encryption, and the auth tag is stored with the ciphertext. The master key comes from the environment and must never be logged. Secrets are decrypted only at the moment of use and never returned by the API. Responses show only masked values.
- Validate all input at the boundary with Zod schemas from `packages/shared-types`.
- Never log secrets, tokens, passwords or full PII.

### Compliance targets

- **ISO 27001**: access control, encryption at rest and in transit, audit logs for security-relevant actions. `AuditInterceptor` (`modules/audit`) records every successful write by a signed-in caller in `audit_logs`, in the actor's own tenant. It records only ids and route patterns, never raw URLs, bodies or PII.
- **ISO 27701**: minimal PII collection, tenant-scoped PII, support for export and deletion of a data subject's records.
- **ISO 42001**: any AI feature records model, input metadata, output and actor in an audit trail.

## File storage (R2 / S3)

- Optional storage module behind a `StorageProvider` port.
- Clients upload and download through **presigned URLs**. File bytes never go through the API.
- Object keys are prefixed with the tenant ID (`<tenantId>/...`).
- Credentials and bucket config can be set per tenant (BYOK through `tenant_integrations`), with platform defaults as a fallback.
- Upload URLs sign the exact file size (max `MAX_UPLOAD_BYTES`, 1 MB). Files in the platform bucket are tracked in `storage_objects` and capped per tenant (`PLATFORM_QUOTA`). The API sends requests only to the platform bucket, never to a tenant-chosen endpoint (SSRF).

## Infrastructure & performance

- **Rate limiting:** Redis sliding window, keyed by tenant + user (or API key) + tier. Return `429` with a `Retry-After` header. Implemented as a global guard (`modules/rate-limit`); `AppModule` registers the guard chain in order `AuthGuard` (identifies, never rejects) → `RateLimitGuard` → `AccessGuard` (roles, 401/403) → `TenantContextGuard`, so every route is covered without opting in, rejected credentials included: authenticated callers get their tier's limit and fail open when Redis is down; public routes are limited per client IP and route and fail closed. Login is also limited per account (tenant + hashed email) across IPs; a successful login resets that counter. Limits live in `rate-limit-policy.ts`.
- **Background jobs:** heavy work (emails, webhooks, processing) runs on BullMQ workers. Every job payload carries `tenantId`, and the worker loads that tenant's secrets when it runs (no secrets in job payloads). Use retries with backoff, and send jobs that run out of attempts to a **dead-letter queue**. New queues use `JobsModule.registerQueue(name)` (shared retry policy + `<name>-dlq`) and a worker extending `DeadLetteringWorker` (`modules/jobs`), which handles dead-lettering, the startup sweep, shutdown during a Redis outage, and dropping a deleted tenant's jobs. Every outgoing HTTP call has a timeout (`AbortSignal.timeout`), so a hung provider cannot hold a worker slot.
- **Pagination:** every list endpoint uses **keyset (cursor) pagination** over a stable order (e.g. `(created_at, id)`), backed by an index that starts with `tenant_id`. Never use `OFFSET`. Use `common/keyset.ts` (`keysetArgs` + `keysetPage`, cursor validated by `keysetCursorSchema(<sort field's Zod type>)`, e.g. `z.iso.datetime()` for `created_at`) with an index on `(tenant_id, <field>, id)`; a unique sort key can use `toCursorPage` directly. `apps/api/test/pagination.e2e.test.mjs` shows how to prove the index is used with `EXPLAIN`.

## Notifications

- A multi-channel dispatcher with these channels: **SSE** (real-time web updates), **FCM** (push), **Resend** (transactional email).
- Each channel is a pluggable adapter. If a channel's module is missing or the tenant hasn't configured it, the dispatcher skips that channel without errors and logs at debug level.
- Delivery runs through BullMQ, except SSE fan-out.
- **Checks that reject a request belong in guards, not interceptors or handlers that run after an `await`.** Nest runs interceptors lazily; on an SSE route that is after the stream has started, so a late 403/429 becomes a 200 with an `error` event.
- **Adding a channel:** an optional module provides a class implementing `NotificationChannel` (`modules/notifications/domain/notification-channel.ts`) that registers itself in `NotificationChannelRegistry` in `onModuleInit`. Throw `PermanentDeliveryError` for failures a retry cannot fix; any other error is retried. Use `deliveryId` as the provider's idempotency key where one exists.
- SSE goes through Redis Pub/Sub (`SseHub`) so events reach users connected to any instance.

## Frontend (`apps/web`)

- Must meet **WCAG 2.1/2.2 AA**: semantic HTML, Radix/shadcn primitives, visible focus, full keyboard operation, labelled form controls, AA colour contrast, and `aria-live` for async status.
- The browser never calls the API. Server components and server actions call it through `lib/api.ts` (server-only), with the token from the `httpOnly` session cookie. Never expose the token or `API_URL` to client code.
- Feature settings pages render only when `/v1/system/capabilities` reports the feature.
- API types and validation come from `packages/shared-types`. Don't duplicate DTOs.

## Conventions

- TypeScript `strict` everywhere. Extend `tsconfig.base.json`.
- API routes are versioned under `/v1`.
- Database columns use `snake_case` (mapped through Prisma `@map`). TypeScript uses `camelCase`.
- Root scripts (`pnpm build | dev | typecheck | test`) run through Turborepo.
