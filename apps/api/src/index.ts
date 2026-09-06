import { requireRunnerAuth } from './middleware/runner-auth';
import { Hono } from "hono";
import { HTTPException } from 'hono/http-exception';
import { createMiddleware } from "hono/factory";
import { config, getAllowedOrigins } from "./config";
import { initAuth } from "./auth";
import { getRedisSession, getRedisCache } from "./redis";
import { mountRoutes } from "./routes";
import { handleWebSocketUpgrade, websocketHandlers, WS_MAX_MESSAGE_BYTES } from "./websocket";
import {
  memoryMiddleware,
  requestSizeMiddleware,
  gitLimitsMiddleware,
  responseSizeMiddleware,
  BODY_LIMITS,
  shouldRejectRequest,
} from "./middleware/limits";
import rateLimitMiddleware, { ingressRateLimit } from "./middleware/rate-limit";
import { authMiddleware } from "./middleware/auth";
import { requestIdMiddleware } from "./middleware/request-id";
import { createRequestGuard } from "./lib/request-guard";
import { compressionMiddleware } from "./middleware/compression";
import { securityHeadersMiddleware, buildSecurityHeaders } from "./middleware/security-headers";
import { csrfMiddleware } from "./middleware/csrf";
import { sanitizeQueryForLog } from "./lib/log-sanitize";
import { startMigrationWorker } from "./workers/migration";
import { startRunnerHealthWorker } from "./workers/runner-health";
import "./monitoring";
import { db } from '@sigmagit/db';
import { sql } from 'drizzle-orm';
import { createReadinessProbe } from './lib/readiness';
import { access, constants } from 'node:fs/promises';
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { s3Client, bucket } from './s3';
import migrationJournal from '../../../packages/db/migrations/meta/_journal.json';

const isReady = createReadinessProbe(async () => {
  await Promise.all([
    db.execute(sql`SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1`)
      .then((rows) => {
        if (Number(rows[0]?.created_at) < migrationJournal.entries.at(-1)!.when || !rows.length) {
          throw new Error('Database migrations are pending');
        }
      }),
    config.storage.type === 'local'
      ? access(config.storage.localPath, constants.R_OK | constants.W_OK)
      : s3Client
        ? s3Client.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: AbortSignal.timeout(2500) })
        : Promise.reject(new Error('Storage unavailable')),
    config.redisSessionUrl ? getRedisSession().then(async (client) => {
      if (!client) throw new Error('Session store unavailable');
      await client.ping();
    }) : Promise.resolve(),
  ]);
});

export { sanitizeQueryForLog };

if (config.redisSessionUrl) {
  const sessionRedis = await getRedisSession();
  if (sessionRedis) {
    console.log("[Redis:session] Connected successfully");
  } else {
    console.log("[Redis:session] Connection failed, will retry on first request");
  }
}

if (config.redisCacheUrl) {
  const cacheRedis = await getRedisCache();
  if (cacheRedis) {
    console.log("[Redis:cache] Connected successfully");
  } else {
    console.log("[Redis:cache] Connection failed, will retry on first request");
  }
}

if (!config.redisSessionUrl && !config.redisCacheUrl) {
  console.log("[Redis] REDIS_SESSION_URL / REDIS_CACHE_URL not configured, running without cache");
}

const app = new Hono();
app.onError((error, c) => {
  if (error instanceof HTTPException && error.status < 500) {
    return c.json({ error: error.message }, error.status);
  }
  // Database errors can include SQL bindings (password hashes and tokens).
  console.error('[API] Unhandled request error', { name: error.name });
  return c.json({ error: 'Internal server error' }, 500);
});

const loggingMiddleware = createMiddleware(async (c, next) => {
  const start = Date.now();
  const method = c.req.method;
  const path = c.req.path;
  const queryPos = c.req.url.indexOf('?');
  const query = queryPos >= 0 ? sanitizeQueryForLog(c.req.url.slice(queryPos)) : '';

  await next();

  const status = c.res.status;
  const duration = Date.now() - start;
  const contentLength = c.res.headers.get("content-length") || "-";

  const skipLogging = path === "/health" || path === "/api/health";
  if (!skipLogging) {
    const statusColor =
      status >= 500 ? "\x1b[31m" : status >= 400 ? "\x1b[33m" : status >= 300 ? "\x1b[36m" : "\x1b[32m";
    const resetColor = "\x1b[0m";
    console.log(
      `[API] ${method} ${path}${query} ${statusColor}${status}${resetColor} ${duration}ms ${contentLength}b`
    );
  }
});

app.use("*", requestIdMiddleware);
app.use("*", securityHeadersMiddleware);
app.use("*", loggingMiddleware);

app.use("*", createMiddleware(async (c, next) => {
  const origin = c.req.header("origin");
  const allowedOrigins = getAllowedOrigins();
  const isAllowed = Boolean(origin && allowedOrigins.includes(origin));

  // Only emit CORS allow headers for permitted origins. Never fall back to the
  // first configured origin for disallowed/missing Origin (credentialed CSRF).
  if (isAllowed && origin) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Access-Control-Allow-Credentials", "true");
  }
  c.header("Vary", "Origin");

  await next();
}));

app.use("*", memoryMiddleware);
app.use("*", ingressRateLimit);
app.use("*", requestSizeMiddleware);

app.use("*", createMiddleware(async (c, next) => {
  await initAuth();
  await next();
}));

app.use("*", authMiddleware);
app.use("*", csrfMiddleware);
app.use("*", gitLimitsMiddleware);
app.use("/api/runners/:runnerId/heartbeat", requireRunnerAuth);
app.use("/api/runners/:runnerId/jobs/:jobId/*", requireRunnerAuth);
app.use("*", rateLimitMiddleware);
app.use("*", compressionMiddleware);
app.use("*", responseSizeMiddleware);

mountRoutes(app);

if (config.enableMigrations) {
  startMigrationWorker();
}

startRunnerHealthWorker();

const port = config.port;

type ApiServer = Parameters<typeof handleWebSocketUpgrade>[1];
const guardedFetch = createRequestGuard(
  async (request: Request, server: ApiServer, original: Request) => {
    if (new URL(request.url).pathname === '/ws') return handleWebSocketUpgrade(request, server);
    // Request wrappers do not retain Bun transport metadata. Resolve it using
    // the native request while Hono reads the bounded, cancellable request.
    return app.fetch(request, { server: { requestIP: () => server.requestIP(original) } });
  },
  {
    maxRest: config.maxConcurrentRest,
    maxGit: config.maxConcurrentGit,
    timeoutMs: config.requestTimeoutMs,
    transferTimeoutMs: config.transferTimeoutMs,
    errorResponse: (request, status, error) => {
      const headers = new Headers(buildSecurityHeaders(config.isProduction));
      const origin = request.headers.get('origin');
      headers.set('Vary', 'Origin');
      if (origin && getAllowedOrigins().includes(origin)) {
        headers.set('Access-Control-Allow-Origin', origin);
        headers.set('Access-Control-Allow-Credentials', 'true');
      }
      if (status === 503) headers.set('Retry-After', '5');
      return Response.json({ error }, { status, headers });
    },
  },
);

export default {
  port,
  fetch: async (request: Request, server: ApiServer) => {
    const path = new URL(request.url).pathname;
    if ((request.method === 'GET' || request.method === 'HEAD') &&
        ['/health', '/api/health', '/ready', '/api/ready'].includes(path)) {
      const ready = path.endsWith('/health') || (!shouldRejectRequest() && await isReady());
      return Response.json({ status: ready ? 'ok' : 'unavailable' }, {
        status: ready ? 200 : 503,
        headers: { ...buildSecurityHeaders(config.isProduction), 'Cache-Control': 'no-store' },
      });
    }
    if (request.method === "OPTIONS") {
      const origin = request.headers.get("origin");
      const allowedOrigins = getAllowedOrigins();
      const isAllowed = Boolean(origin && allowedOrigins.includes(origin));
      const headers: Record<string, string> = {
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, Cookie, x-api-key, x-internal-auth, X-Webhook-Secret, X-Request-Id, X-Provider-Token",
        "Access-Control-Max-Age": "300",
        Vary: "Origin",
      };
      if (isAllowed && origin) {
        headers["Access-Control-Allow-Origin"] = origin;
        headers["Access-Control-Allow-Credentials"] = "true";
      }
      return new Response(null, {
        status: isAllowed ? 204 : 403,
        headers,
      });
    }

    return guardedFetch(request, server);
  },
  websocket: { ...websocketHandlers, maxPayloadLength: WS_MAX_MESSAGE_BYTES },
  maxRequestBodySize: BODY_LIMITS.absoluteMax,
  idleTimeout: 255,
};
