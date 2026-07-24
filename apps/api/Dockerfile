FROM oven/bun:1.3.14 AS builder

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

RUN bun install --frozen-lockfile

COPY packages/db ./packages/db
COPY packages/lib ./packages/lib
COPY packages/hooks ./packages/hooks
COPY apps/api ./apps/api

WORKDIR /app/apps/api
RUN bun build src/index.ts --outdir dist --target bun --minify --packages=external

FROM oven/bun:1.3.14-alpine AS runner

WORKDIR /app

COPY --chown=bun:bun --from=builder /app/apps/api/dist ./dist
COPY --chown=bun:bun --from=builder /app/apps/api/package.json ./
COPY --chown=bun:bun --from=builder /app/node_modules ./node_modules

RUN mkdir -p /data/repos && chown -R bun:bun /data

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

USER bun

HEALTHCHECK CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["bun", "run", "dist/index.js"]
