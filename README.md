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
| `pnpm --filter @repo/api test:live` | Opt-in: sends one real email with `RESEND_PLATFORM_KEY` to Resend's `delivered@resend.dev` test address (no real inbox); with a dev-only full-access key in `RESEND_PLATFORM_FULL_ACCESS_KEY` (never used by the app, not in `.env.example`) also confirms delivery through Resend's API. `pnpm test` never sends real email |
| `pnpm --filter @repo/api db:migrate` | Creates and applies a migration after a schema change (development) |

## Auth at a glance

- `POST /v1/auth/login` with `{ tenantId, email, password }` returns a 15-minute JWT. Send it as `Authorization: Bearer <token>`.
- Headless clients send `X-API-Key: <key>`. A `TenantAdmin` creates keys with `POST /v1/api-keys` (the key is shown once), lists them newest first with `GET /v1/api-keys?cursor=&limit=` (also `Auditor`) and revokes them with `DELETE /v1/api-keys/:id`.
- `AUTH_PROVIDER=local|clerk` picks the identity provider for the whole deployment (see Clerk mode below).
- Bootstrapping: insert the first `SuperAdmin` directly in the database (with an Argon2id `password_hash`). From then on, a `SuperAdmin` creates tenants and invites their first `TenantAdmin` through the API (see Users below).

## Clerk mode (`AUTH_PROVIDER=clerk`)

Clerk is where people and organizations are created; the API mirrors them through webhooks. **Each Clerk Organization is one tenant**, each membership one user of that tenant.

- **Setup:** set `CLERK_ISSUER` (your Frontend API URL), `CLERK_WEBHOOK_SECRET` and `CLERK_AUTHORIZED_PARTIES` (see `.env.example`). In the Clerk dashboard, enable Organizations and add a webhook endpoint at `<api>/v1/auth/clerk/webhook` subscribed to `organization.created`, `organization.updated`, `organization.deleted`, `organizationMembership.created`, `organizationMembership.deleted`, `user.updated` and `user.deleted`. Locally, relay it with the Clerk CLI: `clerk webhooks listen --forward-to http://localhost:3000/v1/auth/clerk/webhook`.
- **Requests:** the dashboard sends the Clerk session token as `Authorization: Bearer <token>`. It is verified against Clerk's published keys; its active organization picks the tenant. A token without an active organization, or for an organization or user not mirrored yet, gets `401`.
- **Mirrored from Clerk:** organizations (created, renamed, deleted; deleting one removes the tenant and all its data), memberships (a new `org:admin` starts as `TenantAdmin`, anyone else as `User`) and user emails. Webhooks are verified (Svix signature, 5-minute window) and may arrive in any order or more than once.
- **Still ours:** roles after a member joins (`PATCH /v1/users/:id`), tiers, API keys, BYOK integrations, notifications and rate limits.
- **Answer `409` ("managed in Clerk"):** sign-in, password change and reset, invitations, creating or deleting tenants, renaming the current tenant and removing members. Those happen in Clerk.
- **First SuperAdmin:** create the platform organization in Clerk and join it; then set that user's `role` to `SuperAdmin` in the database.

## Users and invitations

Nobody chooses a password for someone else: members join by invitation and set their own.

- `POST /v1/invitations` with `{ email, role? }` (`TenantAdmin`, or a `SuperAdmin` via `X-Tenant-Id`) emails a single-use link to `APP_URL/accept-invitation?token=…`, valid 7 days. The invitee's dashboard posts `{ token, password }` to the public `POST /v1/invitations/accept`, which creates the account. `GET /v1/invitations` lists pending ones (also `Auditor`); `POST /v1/invitations/:id/resend` sends a fresh link (the old one stops working); `DELETE /v1/invitations/:id` revokes. Inviting the same email again replaces the pending invitation.
- **Who sends the email:** invitations and password resets always use the platform credentials (`RESEND_PLATFORM_KEY`, `RESEND_PLATFORM_FROM`), never a tenant's own Resend integration: whoever controls the sending account can read the link in its logs and accept or reset in the user's place. Tenant Resend integrations are for notifications only. Without the platform key, invitations answer `503`; if the email fails, `502` and no invitation is kept. Only a hash of each token is stored.
- **Forgotten password:** `POST /v1/auth/password-reset` with `{ tenantId, email }` always answers `202` (it never reveals whether the account exists) and emails a 1-hour link to `APP_URL/reset-password?token=…`; `POST /v1/auth/password-reset/confirm` with `{ token, password }` sets the new password and lifts any login lockout. Requests are limited per account.
- `GET /v1/users?cursor=&limit=` lists the members of the current tenant (`TenantAdmin`, `Auditor`, or a `SuperAdmin` via `X-Tenant-Id`); `PATCH /v1/users/:id` with `{ role }` changes a role; `DELETE /v1/users/:id` removes a member.
- No one becomes `SuperAdmin` through the API, `SuperAdmin` accounts cannot be changed or removed through it, and a tenant always keeps at least one `TenantAdmin` (`409` otherwise, also when two admins demote each other at the same moment).
- `PUT /v1/users/me/password` with `{ currentPassword, newPassword }` changes the caller's own password, for every role including `Auditor`. Wrong guesses count towards the same per-account limit as login. Passwords need at least 12 characters.
- Role changes and removals take effect when the user's current token expires (at most 15 minutes).
- Keep `RESEND_PLATFORM_KEY` a **send-only** Resend key: a full-access key can read sent emails, including their invitation and reset links.

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

## File storage (optional module `storage`)

- Works with Cloudflare R2 or any S3-compatible store. File bytes never pass through the API: it hands out presigned URLs that are valid for 15 minutes, and clients transfer the files directly to and from the bucket.
- `POST /v1/storage/uploads` (`TenantAdmin`, `User`) with `{ filename, size }` answers `201` with `{ key, url, expiresAt }`. `size` is the exact size in bytes, at most 1 MB (`MAX_UPLOAD_BYTES`). The client `PUT`s exactly that many bytes to `url`; the size is signed into the URL, so the store refuses any other size. The key is `<tenantId>/<random>/<filename>`, so uploads never overwrite each other.
- `GET /v1/storage/downloads?key=` (`TenantAdmin`, `User`, `Auditor`) answers `{ url, expiresAt }`. The file is served as an attachment. A key outside the caller's tenant answers `404`.
- `DELETE /v1/storage/objects?key=` (`TenantAdmin`, `User`) deletes a file from the platform bucket and frees its quota. Only the user or API key that uploaded it, or a `TenantAdmin`, may delete it; anyone else gets `403`. Reading stays open to the whole tenant. Files in a tenant's own bucket answer `404`; delete those with the bucket's own tools (the API never sends requests to a tenant-chosen endpoint).
- **Own bucket:** a tenant can use its own bucket via `PUT /v1/integrations/r2` with `{ endpoint, bucket, accessKeyId, secretAccessKey, region? }`; `region` defaults to `auto`, which is what R2 uses. New uploads then go there, with no quota.
- **Platform bucket:** tenants without their own bucket use the platform's (`STORAGE_*` in `.env`), with a quota of 100 MB and 1,000 files per tenant (`PLATFORM_QUOTA` in `optional/storage/domain/platform-quota.ts`). An upload over the quota answers `409`. The quota counts each upload URL issued, whether or not the file was then sent; deleting the key frees it. If neither bucket is configured, the endpoints answer `503`.
- **Deleting a tenant** also deletes its files from the platform bucket. Files in its own bucket are left to it.
- **Browser uploads need CORS on the bucket.** Browsers ask the bucket before a cross-site `PUT`, and R2 refuses unless the bucket allows the dashboard's origin. In the R2 dashboard (bucket → Settings → CORS policy):

  ```json
  [{ "AllowedOrigins": ["https://your-dashboard.example"], "AllowedMethods": ["PUT", "GET"], "AllowedHeaders": ["content-type"], "MaxAgeSeconds": 3600 }]
  ```

  A tenant's own bucket needs the same rule.

## Tenants and integrations

- Every request acts on the caller's own tenant. A `SuperAdmin` may act on another tenant by sending `X-Tenant-Id: <tenantId>`; anyone else sending a different id gets `403`.
- A `SuperAdmin` manages tenants (and, once built, their users) only. Integrations (BYOK secrets) and notifications belong to each tenant's own `TenantAdmin`; a `SuperAdmin` gets `403` there, with or without `X-Tenant-Id`.
- `GET /v1/tenants/current` reads the current tenant; `PATCH /v1/tenants/current` renames it (`TenantAdmin`).
- `SuperAdmin` only: `POST /v1/tenants`, `GET /v1/tenants?cursor=&limit=`, `PATCH /v1/tenants/:id` (name, tier), `DELETE /v1/tenants/:id` (deletes the tenant with all its users, invitations, API keys, integrations and audit records, plus its queued and dead-lettered jobs and its files in the platform bucket). The platform tenant, the one holding the `SuperAdmin` accounts, can never be deleted (`403`), neither through the API nor through a Clerk organization deletion.
- **Audit log:** every successful write (`POST`, `PUT`, `PATCH`, `DELETE`) by a signed-in user or API key is recorded in `audit_logs`: the actor (kind, id, role), the route pattern, the `:id` target, the status, and, when a `SuperAdmin` acted on another tenant, which one. Rows are kept in the actor's own tenant, so a `SuperAdmin`'s actions survive the deletion of the tenant they acted on. Reads, rejected requests and unauthenticated calls (login, invitation acceptance, webhooks) are not recorded. There is no API to read it yet: query the table.
- `GET /v1/system/capabilities` lists the installed optional modules (`apps/api/src/optional/<key>/`) and whether each is enabled for the current tenant. Delete a module's folder to uninstall it; nothing else needs to change.
- BYOK secrets: `PUT /v1/integrations/:provider` with `{ config, enabled? }` stores a provider's config encrypted with AES-256-GCM (only providers used by an installed module; others get `404`); `GET /v1/integrations` lists them with masked values only; `DELETE /v1/integrations/:provider` removes them. Secrets are never returned by the API.
