import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { config, getAllowedOrigins } from "./config";
import { initAuth } from "./auth";
import { getRedisSession, getRedisCache } from "./redis";
import { mountRoutes } from "./routes";
import { handleWebSocketUpgrade, websocketHandlers } from "./websocket";
import {
  memoryMiddleware,
  requestSizeMiddleware,
  gitLimitsMiddleware,
  responseSizeMiddleware,
} from "./middleware/limits";
import rateLimitMiddleware, { concurrencyLimiter } from "./middleware/rate-limit";
import { authMiddleware } from "./middleware/auth";
import { requestIdMiddleware } from "./middleware/request-id";
import { requestTimeoutMiddleware } from "./middleware/timeout";
import { compressionMiddleware } from "./middleware/compression";
import { securityHeadersMiddleware } from "./middleware/security-headers";
import { sanitizeQueryForLog } from "./lib/log-sanitize";
import { startMigrationWorker } from "./workers/migration";
import { startRunnerHealthWorker } from "./workers/runner-health";
import "./monitoring";

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

app.use("*", createMiddleware(async (c, next) => {
  await initAuth();
  await next();
}));

app.use("*", authMiddleware);
app.use("*", concurrencyLimiter());
app.use("*", memoryMiddleware);
app.use("*", requestSizeMiddleware);
app.use("*", gitLimitsMiddleware);
app.use("*", requestTimeoutMiddleware());
app.use("*", rateLimitMiddleware);
app.use("*", responseSizeMiddleware);
app.use("*", compressionMiddleware);

mountRoutes(app);

if (config.enableMigrations) {
  startMigrationWorker();
}

startRunnerHealthWorker();

const port = config.port;

export default {
  port,
  fetch: async (request: Request, server: any) => {
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

    const wsResponse = await handleWebSocketUpgrade(request, server);
    if (wsResponse !== undefined) {
      return wsResponse;
    }

    return app.fetch(request);
  },
  websocket: websocketHandlers,
  idleTimeout: 255,
};
