/**
 * Resource-loading authorization helpers with consistent 404 semantics
 * (do not disclose private resource existence to unauthorized callers).
 */

import type { Context } from 'hono';
import {
  canAccessRepository,
  canManageRepository,
  type AccessUser,
  type Repository,
} from './access';

export type AuthzDenied = { ok: false; status: 404 | 403; error: string };
export type AuthzAllowed<T> = { ok: true; resource: T };
export type AuthzResult<T> = AuthzAllowed<T> | AuthzDenied;

/**
 * Authorize repository access. Unauthorized / missing → 404 (no existence leak).
 * Authenticated but insufficient permission for write on a known-visible resource
 * still returns 404 for private repos; public repos return 403 for write denial.
 */
export async function authorizeRepositoryAccess(
  repo: Repository | null | undefined,
  user: AccessUser,
  options: { write?: boolean; manage?: boolean } = {}
): Promise<AuthzResult<Repository>> {
  if (!repo) {
    return { ok: false, status: 404, error: 'Not found' };
  }

  if (options.manage) {
    if (!user?.id) return { ok: false, status: 404, error: 'Not found' };
    const allowed = await canManageRepository(repo, { id: user.id });
    if (!allowed) {
      // Hide private repos; 403 only if they could already know it exists (public + read)
      if (repo.visibility === 'public' && (await canAccessRepository(repo, user, false))) {
        return { ok: false, status: 403, error: 'Forbidden' };
      }
      return { ok: false, status: 404, error: 'Not found' };
    }
    return { ok: true, resource: repo };
  }

  const write = Boolean(options.write);
  const allowed = await canAccessRepository(repo, user, write);
  if (!allowed) {
    if (
      write &&
      repo.visibility === 'public' &&
      (await canAccessRepository(repo, user, false))
    ) {
      return { ok: false, status: 403, error: 'Forbidden' };
    }
    return { ok: false, status: 404, error: 'Not found' };
  }
  return { ok: true, resource: repo };
}

/** Hono helper: return JSON error response for denied authz. */
export function authzError(c: Context, result: AuthzDenied) {
  return c.json({ error: result.error }, result.status);
}
