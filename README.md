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

Set `JWT_SECRET` in `apps/api/.env` to at least 32 random characters:

```sh
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

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
| `pnpm --filter @repo/api db:migrate` | Creates and applies a migration after a schema change (development) |

## Auth at a glance

- `POST /v1/auth/login` with `{ tenantId, email, password }` returns a 15-minute JWT. Send it as `Authorization: Bearer <token>`.
- Headless clients send `X-API-Key: <key>`. A `TenantAdmin` creates keys with `POST /v1/api-keys` (the key is shown once) and revokes them with `DELETE /v1/api-keys/:id`.
- `AUTH_PROVIDER=local|clerk` picks the identity provider. The Clerk adapter is still a stub that rejects every token.
- There is no sign-up endpoint yet: insert the first user directly in the database, with an Argon2id `password_hash`.
