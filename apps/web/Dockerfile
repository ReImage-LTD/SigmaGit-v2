FROM oven/bun:1.4.2 AS builder

WORKDIR /app

ARG API_URL
ARG VITE_API_URL
ARG VITE_DATABUDDY_CLIENT_ID

ENV API_URL=$API_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_DATABUDDY_CLIENT_ID=$VITE_DATABUDDY_CLIENT_ID
ENV PROD=true

COPY package.json bun.lock ./
COPY .npmrc ./
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
COPY apps/discord-bot/package.json ./apps/discord-bot/
COPY apps/docs-vitepress/package.json ./apps/docs-vitepress/
COPY packages/db/package.json ./packages/db/
COPY packages/lib/package.json ./packages/lib/
COPY packages/hooks/package.json ./packages/hooks/

RUN bun install --frozen-lockfile

COPY packages ./packages
COPY apps/web ./apps/web

WORKDIR /app/apps/web
ENV NODE_ENV=production
RUN bun run build

FROM oven/bun:1.4.2-alpine AS runner

WORKDIR /app

COPY --chown=bun:bun --from=builder /app/node_modules ./node_modules
COPY --chown=bun:bun --from=builder /app/apps/web/node_modules ./apps/web/node_modules
COPY --chown=bun:bun --from=builder /app/apps/web/.output ./apps/web/.output
COPY --chown=bun:bun --from=builder /app/apps/web/package.json ./apps/web/package.json

ENV NODE_ENV=production
EXPOSE 3000
WORKDIR /app/apps/web

USER bun

CMD ["bun", "run", ".output/server/index.mjs"]
