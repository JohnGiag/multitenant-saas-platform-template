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
- Headless clients send `X-API-Key: <key>`. A `TenantAdmin` creates keys with `POST /v1/api-keys` (the key is shown once) and revokes them with `DELETE /v1/api-keys/:id`.
- `AUTH_PROVIDER=local|clerk` picks the identity provider. The Clerk adapter is still a stub that rejects every token.
- There is no sign-up endpoint yet: insert the first user directly in the database, with an Argon2id `password_hash`.

## Tenants and integrations

- Every request acts on the caller's own tenant. A `SuperAdmin` may act on another tenant by sending `X-Tenant-Id: <tenantId>`; anyone else sending a different id gets `403`.
- `GET /v1/tenants/current` reads the current tenant; `PATCH /v1/tenants/current` renames it (`TenantAdmin`).
- `SuperAdmin` only: `POST /v1/tenants`, `GET /v1/tenants?cursor=&limit=`, `PATCH /v1/tenants/:id` (name, tier), `DELETE /v1/tenants/:id` (refused with `409` while the tenant still has data).
- `GET /v1/system/capabilities` lists the installed optional modules (`apps/api/src/optional/<key>/`) and whether each is enabled for the current tenant. Delete a module's folder to uninstall it; nothing else needs to change.
- BYOK secrets: `PUT /v1/integrations/:provider` with `{ config, enabled? }` stores a provider's config encrypted with AES-256-GCM (only providers used by an installed module; others get `404`); `GET /v1/integrations` lists them with masked values only; `DELETE /v1/integrations/:provider` removes them. Secrets are never returned by the API.
