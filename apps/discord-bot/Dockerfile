FROM oven/bun:1.4.2 AS builder

WORKDIR /app

COPY package.json bun.lock ./
COPY .npmrc ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/docs-vitepress/package.json ./apps/docs-vitepress/
COPY apps/discord-bot/package.json ./apps/discord-bot/
COPY packages/db/package.json ./packages/db/
COPY packages/lib/package.json ./packages/lib/
COPY packages/hooks/package.json ./packages/hooks/

RUN bun install --frozen-lockfile

COPY apps/discord-bot ./apps/discord-bot

FROM oven/bun:1.4.2-alpine AS runner

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/discord-bot ./apps/discord-bot

ENV NODE_ENV=production

WORKDIR /app/apps/discord-bot

CMD ["bun", "run", "src/index.ts"]
