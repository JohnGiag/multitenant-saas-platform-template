# enterprise-api-starter

Multi-tenant SaaS starter: a NestJS API (`apps/api`), shared Zod contracts (`packages/shared-types`) and, later, a Next.js dashboard (`apps/web`). Engineering rules live in [CLAUDE.md](CLAUDE.md).

## Requirements

- Node.js 22+ with Corepack (`corepack enable` provides the pinned pnpm)
- Docker (PostgreSQL 17 and Redis 7)

## Getting started

```sh
pnpm install
docker compose up -d --wait
cp apps/api/.env.example apps/api/.env
```

In `apps/api/.env`, set `JWT_SECRET` (at least 32 characters) and `BYOK_MASTER_KEY` (32 bytes, base64):

```sh
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"  # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"     # BYOK_MASTER_KEY
```

Keep `BYOK_MASTER_KEY` safe: without it, stored tenant secrets cannot be decrypted.

Then apply the database migrations:

```sh
pnpm --filter @repo/api db:deploy
```

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Builds shared types, then runs the API in watch mode on `PORT` (default 3000) |
| `pnpm build` | Builds every package |
| `pnpm typecheck` | Type-checks every package |
| `pnpm test` | Builds, then runs all tests. API tests need the database running and `.env` set up |
| `pnpm coverage` | Same as `pnpm test` for the API, plus a line/branch/function coverage report per source file |
| `pnpm --filter @repo/api db:migrate` | Creates and applies a migration after a schema change (development) |

## Auth at a glance

- `POST /v1/auth/login` with `{ tenantId, email, password }` returns a 15-minute JWT. Send it as `Authorization: Bearer <token>`.
- Headless clients send `X-API-Key: <key>`. A `TenantAdmin` creates keys with `POST /v1/api-keys` (the key is shown once), lists them newest first with `GET /v1/api-keys?cursor=&limit=` (also `Auditor`) and revokes them with `DELETE /v1/api-keys/:id`.
- `AUTH_PROVIDER=local|clerk` picks the identity provider. The Clerk adapter is still a stub that rejects every token.
- There is no sign-up endpoint yet: insert the first user directly in the database, with an Argon2id `password_hash`.

## Rate limits

Every route is rate limited with a Redis sliding window over the last 60 seconds. Responses carry `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`; over the limit, the API answers `429` with `Retry-After` (seconds).

| Caller | Bucket | Limit per minute | If Redis is down |
|---|---|---|---|
| Signed-in user or API key | per tenant and caller | `free` 120, `pro` 600, `enterprise` 3000 | served, unmetered |
| Unauthenticated (e.g. login) | per client IP and route | 100 | `503` |
| Login attempts | per account (tenant + email), from any IP; a successful login resets it | 10 per 15 minutes | `503` |

Behind a load balancer, set `TRUST_PROXY_HOPS` to the number of proxies so the real client IP is used. For Redis high availability, set `REDIS_SENTINELS` and `REDIS_SENTINEL_NAME` instead of `REDIS_URL` (see `.env.example`).

## Notifications and background jobs

- `POST /v1/notifications` (`TenantAdmin`) with `{ userId, title, body, data? }` sends to a user of the current tenant and answers `202` with `{ queued, realtime }`.
- **Real-time:** `GET /v1/notifications/stream` is a Server-Sent Events stream of the caller's own notifications. Events are fanned out through Redis Pub/Sub, so it works with any number of API instances. Browsers' `EventSource` cannot send an `Authorization` header: use a fetch-based SSE client. A user may hold 5 open streams per instance; opening a 6th closes the oldest with a final `closed` event, after which the client should not reconnect.
- **Email** (optional module `email`, configure `PUT /v1/integrations/resend` with `{ apiKey, from }`) and **push** (optional module `push`, configure `PUT /v1/integrations/fcm` with `{ serviceAccount: "<service account JSON>" }`; devices register with `POST /v1/push/devices` and `DELETE /v1/push/devices/:token`) are delivered by a BullMQ worker, one job per channel. The worker loads the tenant's secrets when the job runs; payloads never contain them.
- A channel whose module is deleted, or that the tenant has not configured or has disabled, is skipped, not failed.
- Failures are retried with exponential backoff (`JOB_ATTEMPTS`, `JOB_BACKOFF_MS`); errors that a retry cannot fix (rejected credentials, unverified sender) skip the retries. Jobs that still fail are copied to the `notifications-dlq` queue with their payload, error and every attempt's stack trace, and stay there for inspection and replay.
- Every API instance also runs a worker (`WORKER_CONCURRENCY` jobs at a time).

## Tenants and integrations

- Every request acts on the caller's own tenant. A `SuperAdmin` may act on another tenant by sending `X-Tenant-Id: <tenantId>`; anyone else sending a different id gets `403`.
- A `SuperAdmin` manages tenants (and, once built, their users) only. Integrations (BYOK secrets) and notifications belong to each tenant's own `TenantAdmin`; a `SuperAdmin` gets `403` there, with or without `X-Tenant-Id`.
- `GET /v1/tenants/current` reads the current tenant; `PATCH /v1/tenants/current` renames it (`TenantAdmin`).
- `SuperAdmin` only: `POST /v1/tenants`, `GET /v1/tenants?cursor=&limit=`, `PATCH /v1/tenants/:id` (name, tier), `DELETE /v1/tenants/:id` (refused with `409` while the tenant still has data).
- `GET /v1/system/capabilities` lists the installed optional modules (`apps/api/src/optional/<key>/`) and whether each is enabled for the current tenant. Delete a module's folder to uninstall it; nothing else needs to change.
- BYOK secrets: `PUT /v1/integrations/:provider` with `{ config, enabled? }` stores a provider's config encrypted with AES-256-GCM (only providers used by an installed module; others get `404`); `GET /v1/integrations` lists them with masked values only; `DELETE /v1/integrations/:provider` removes them. Secrets are never returned by the API.
