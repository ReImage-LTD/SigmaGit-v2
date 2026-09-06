FROM oven/bun:1.4.2 AS manifests

WORKDIR /app

ARG WEB_URL
ENV WEB_URL=$WEB_URL

COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/discord-bot/package.json ./apps/discord-bot/
COPY apps/docs-vitepress/package.json ./apps/docs-vitepress/
COPY packages/db/package.json ./packages/db/
COPY packages/lib/package.json ./packages/lib/
COPY packages/hooks/package.json ./packages/hooks/

FROM manifests AS production-dependencies
RUN bun install --frozen-lockfile --production --filter @sigmagit/api --filter @sigmagit/db --filter @sigmagit/lib

FROM manifests AS builder
RUN bun install --frozen-lockfile

COPY packages/db ./packages/db
COPY packages/lib ./packages/lib
COPY packages/hooks ./packages/hooks
COPY apps/api ./apps/api

WORKDIR /app/apps/api
RUN bun build src/index.ts src/server.ts src/migrate.ts --outdir dist --target bun --production --packages=external

FROM oven/bun:1.4.2-alpine AS runner

WORKDIR /app/apps/api

COPY --chown=bun:bun --from=builder /app/apps/api/dist ./dist
COPY --chown=bun:bun --from=builder /app/apps/api/package.json ./
COPY --chown=bun:bun --from=production-dependencies /app/node_modules /app/node_modules
COPY --chown=bun:bun --from=production-dependencies /app/packages /app/packages
COPY --chown=bun:bun --from=builder /app/packages/db/src /app/packages/db/src
COPY --chown=bun:bun --from=builder /app/packages/db/migrations /app/packages/db/migrations
COPY --chown=bun:bun --from=builder /app/packages/lib/src /app/packages/lib/src
COPY --chown=bun:bun --from=production-dependencies /app/apps/api/node_modules ./node_modules

RUN apk add --no-cache git ca-certificates && mkdir -p /data/repos && chown -R bun:bun /data

ENV NODE_ENV=production
ENV PORT=3001
ENV STORAGE_LOCAL_PATH=/data/repos

EXPOSE 3001

USER bun

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s CMD wget -qO- http://127.0.0.1:${PORT}/ready || exit 1

CMD ["bun", "run", "dist/server.js"]
