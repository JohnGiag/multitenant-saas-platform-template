# syntax=docker/dockerfile:1
# Build from the repository root: docker build -f apps/api/Dockerfile -t api .
# Targets: `api` (default, the server) and `migrate` (applies Prisma migrations, then exits).

FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
# Dependencies first, so editing the code reuses this layer.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared-types/package.json packages/shared-types/
# The root brings typescript, which @repo/shared-types builds with.
RUN pnpm install --frozen-lockfile --filter enterprise-api-starter --filter @repo/api...
COPY packages/shared-types packages/shared-types
COPY apps/api apps/api
RUN pnpm --filter @repo/api... build
# Production dependencies only, with @repo/shared-types copied in rather than linked.
# shortcut: the image is ~780 MB, half of it the Prisma CLI and Studio that @prisma/client pulls in as peers;
# prune them from /out if image size starts to matter (pulls, cold starts).
RUN pnpm --filter @repo/api deploy --prod --legacy /out && cp -r apps/api/dist /out/dist

# One-off job, run before each new release: needs DATABASE_URL.
FROM build AS migrate
WORKDIR /repo/apps/api
USER node
CMD ["./node_modules/.bin/prisma", "migrate", "deploy"]

FROM node:24-alpine AS api
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD wget -qO /dev/null "http://127.0.0.1:${PORT}/v1/health" || exit 1
CMD ["node", "dist/main.js"]
