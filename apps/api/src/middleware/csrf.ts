import { createMiddleware } from 'hono/factory';
import { getAllowedOrigins } from '../config';
import type { AuthVariables } from './auth';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for cookie-authenticated browser mutations.
 *
 * - Safe methods are always allowed.
 * - Requests authenticated only via API key / Authorization bearer skip Origin checks
 *   (CLI/service clients).
 * - Cookie-session mutations require Origin (or Referer) in the allowed origins list.
 * - Missing Origin on cookie-authenticated mutations is rejected (browsers always send Origin
 *   for cross-site and same-site POST with modern browsers for non-GET).
 */
export const csrfMiddleware = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (SAFE_METHODS.has(method)) {
    await next();
    return;
  }

  // Non-browser / service clients: explicit API key or Authorization bearer.
  const hasApiKey = Boolean(c.req.header('x-api-key'));
  const authz = c.req.header('authorization');
  const hasBearer = Boolean(authz && /^Bearer\s+\S+/i.test(authz));
  const hasInternal = Boolean(c.req.header('x-internal-auth'));

  if (hasApiKey || hasBearer || hasInternal) {
    await next();
    return;
  }

  // If no user session, nothing cookie-based to protect (public endpoints handle their own auth).
  const user = c.get('user');
  if (!user) {
    await next();
    return;
  }

  const origin = c.req.header('origin');
  const allowed = getAllowedOrigins();

  if (origin) {
    if (!allowed.includes(origin)) {
      return c.json({ error: 'Origin not allowed' }, 403);
    }
    await next();
    return;
  }

  // Fallback: same-origin some clients send Referer without Origin.
  const referer = c.req.header('referer');
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      if (allowed.includes(refOrigin)) {
        await next();
        return;
      }
    } catch {
      /* fall through */
    }
  }

  return c.json({ error: 'Missing or invalid Origin for cookie-authenticated request' }, 403);
});
