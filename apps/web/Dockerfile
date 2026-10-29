# syntax=docker/dockerfile:1
# check=skip=SecretsUsedInArgOrEnv
# (AUTH_PROVIDER and the Clerk *publishable* key only look like secrets to the linter: both are meant to be public.
# Real secrets, CLERK_SECRET_KEY and DASHBOARD_PROXY_SECRET, are never build arguments.)
# Build from the repository root: docker build -f apps/web/Dockerfile -t web .
# AUTH_PROVIDER and NEXT_PUBLIC_* are baked in at build time, so pass them as build arguments. Everything else
# (API_URL, DASHBOARD_PROXY_SECRET, TRUST_PROXY_HOPS, CLERK_SECRET_KEY) is read when the container starts.

FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared-types/package.json packages/shared-types/
# The root brings typescript, which @repo/shared-types builds with.
RUN pnpm install --frozen-lockfile --filter enterprise-api-starter --filter @repo/web...
COPY packages/shared-types packages/shared-types
COPY apps/web apps/web
ARG AUTH_PROVIDER=local
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
ENV AUTH_PROVIDER=$AUTH_PROVIDER NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY \
    NEXT_OUTPUT=standalone NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @repo/web... build

FROM node:24-alpine AS web
ARG AUTH_PROVIDER=local
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 AUTH_PROVIDER=$AUTH_PROVIDER PORT=3001 HOSTNAME=0.0.0.0
WORKDIR /app
# The traced server and its node_modules, plus the static assets standalone output leaves out.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD wget -qO /dev/null "http://127.0.0.1:${PORT}/health" || exit 1
CMD ["node", "apps/web/server.js"]
