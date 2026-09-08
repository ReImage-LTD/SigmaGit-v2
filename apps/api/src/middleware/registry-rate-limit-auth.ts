import { createMiddleware } from 'hono/factory';
import { verifyRegistryToken } from '../registry/token';
import type { AuthVariables } from './auth';

/** Establish quota identity only; registry handlers still enforce repository scopes. */
export const registryRateLimitAuth = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  if (c.req.path.startsWith('/v2/')) {
    const authorization = c.req.header('Authorization');
    const claims = authorization?.startsWith('Bearer ')
      ? verifyRegistryToken(authorization.slice(7).trim())
      : null;
    if (claims && claims.access.length > 0) c.set('registryRateLimitUserId', claims.sub);
  }
  await next();
});
