import {
  db,
  repositoryCollaborators,
  organizationMembers,
  teamRepositories,
  teamMembers,
} from '@sigmagit/db';
import { eq, and, inArray } from 'drizzle-orm';
import { getCached, setCache, CACHE_TTL, appCache } from '../redis';

export type AccessUser = { id: string; role?: string } | null | undefined;
export type Repository = {
  id: string;
  ownerId: string;
  organizationId?: string | null;
  visibility: string;
};

type RepoPermission = 'read' | 'write' | 'admin';

const PERMISSION_RANK: Record<RepoPermission, number> = {
  read: 1,
  write: 2,
  admin: 3,
};

function hasWritePermission(permission: RepoPermission): boolean {
  return permission === 'write' || permission === 'admin';
}

function satisfiesAccess(permission: RepoPermission, writeRequired: boolean): boolean {
  if (writeRequired) {
    return hasWritePermission(permission);
  }
  return true;
}

async function getCollaboratorPermission(
  repositoryId: string,
  userId: string
): Promise<RepoPermission | null> {
  const collaborator = await db.query.repositoryCollaborators.findFirst({
    where: and(
      eq(repositoryCollaborators.repositoryId, repositoryId),
      eq(repositoryCollaborators.userId, userId)
    ),
  });

  return collaborator?.permission ?? null;
}

async function getBestTeamPermission(
  repositoryId: string,
  userId: string
): Promise<RepoPermission | null> {
  const rows = await db
    .select({ permission: teamRepositories.permission })
    .from(teamRepositories)
    .innerJoin(teamMembers, eq(teamMembers.teamId, teamRepositories.teamId))
    .where(and(eq(teamRepositories.repositoryId, repositoryId), eq(teamMembers.userId, userId)));

  if (rows.length === 0) {
    return null;
  }

  return rows.reduce<RepoPermission>(
    (best, row) => (PERMISSION_RANK[row.permission] > PERMISSION_RANK[best] ? row.permission : best),
    rows[0].permission
  );
}

async function getOrgMemberRole(
  organizationId: string,
  userId: string
): Promise<'owner' | 'admin' | 'member' | null> {
  const member = await db.query.organizationMembers.findFirst({
    where: and(
      eq(organizationMembers.organizationId, organizationId),
      eq(organizationMembers.userId, userId)
    ),
  });

  return member?.role ?? null;
}

type OrgRole = 'owner' | 'admin' | 'member';

export type RepoAccessFacts = {
  collaboratorPermission: RepoPermission | null;
  orgRole: OrgRole | null;
  teamPermission: RepoPermission | null;
};

/**
 * Pure access decision for unit tests / table-driven coverage.
 * Mirrors canAccessRepository once membership facts are resolved.
 */
export function evaluateRepoAccessFromFacts(
  repo: Repository,
  user: AccessUser,
  facts: RepoAccessFacts | null,
  writeRequired = false
): boolean {
  if (user?.role === 'admin' && user?.id) {
    if (!writeRequired) return true;
    if (user.id === repo.ownerId) return true;
    return (
      facts?.collaboratorPermission != null &&
      hasWritePermission(facts.collaboratorPermission)
    );
  }

  if (repo.visibility === 'public' && !writeRequired) return true;
  if (!user?.id) return false;
  if (user.id === repo.ownerId) return true;
  if (!facts) return false;

  if (repo.organizationId) {
    const role = facts.orgRole;
    if (role === 'owner' || role === 'admin') return true;
    if (role === 'member' && repo.visibility === 'public' && !writeRequired) return true;
  }

  return (
    (facts.collaboratorPermission != null &&
      satisfiesAccess(facts.collaboratorPermission, writeRequired)) ||
    (facts.teamPermission != null &&
      (!repo.organizationId || facts.orgRole != null) &&
      satisfiesAccess(facts.teamPermission, writeRequired))
  );
}

/**
 * Resolve (and cache) the membership-derived access facts for a single
 * (repo, user) pair. Only membership data is cached — repo visibility and
 * ownership are evaluated live by the callers, so they can never go stale.
 * Cached facts are invalidated on collaborator changes and otherwise expire
 * after CACHE_TTL.accessFacts (short TTL bounds staleness for org/team changes).
 */
async function getRepoAccessFacts(repo: Repository, userId: string): Promise<RepoAccessFacts> {
  const cacheKey = appCache.accessKey(repo.id, userId);
  const cached = await getCached<RepoAccessFacts>(cacheKey);
  if (cached) return cached;

  const [collaboratorPermission, orgRole, teamPermission] = await Promise.all([
    getCollaboratorPermission(repo.id, userId),
    repo.organizationId ? getOrgMemberRole(repo.organizationId, userId) : Promise.resolve(null),
    getBestTeamPermission(repo.id, userId),
  ]);

  const facts: RepoAccessFacts = { collaboratorPermission, orgRole, teamPermission };
  await setCache(cacheKey, facts, CACHE_TTL.accessFacts);
  return facts;
}

/**
 * Check if a user can access a repository.
 *
 * - Admins always have READ access to all repos
 * - Public repos are readable by anyone
 * - Private repos require owner, collaborator, org membership, or team access
 * - Org owners/admins have full access to org repos
 * - Org members can read public org repos
 * - Team access is granted via teamRepositories joined through teamMembers
 * - For write operations, admins still need explicit collaborator status
 */
export async function canAccessRepository(
  repo: Repository,
  user: AccessUser,
  writeRequired = false
): Promise<boolean> {
  // Admins always have READ access to everything
  if (user?.role === 'admin' && user?.id) {
    // For write operations, admins still need to be owner or write/admin collaborator
    if (!writeRequired) return true;
    if (user.id === repo.ownerId) return true;
    const { collaboratorPermission } = await getRepoAccessFacts(repo, user.id);
    return collaboratorPermission != null && hasWritePermission(collaboratorPermission);
  }

  // Public repos - anyone can read
  if (repo.visibility === 'public' && !writeRequired) return true;

  // Need auth for private repos (check both user existence and id)
  if (!user?.id) return false;

  // Owner always has access
  if (user.id === repo.ownerId) return true;

  const facts = await getRepoAccessFacts(repo, user.id);

  return evaluateRepoAccessFromFacts(repo, user, facts, writeRequired);
}

/**
 * Filter a list of repositories to those the user can access.
 * Uses batched DB queries instead of per-repo canAccessRepository calls.
 */
export async function filterAccessibleRepos<T extends Repository>(
  repos: T[],
  user: AccessUser,
  writeRequired = false
): Promise<T[]> {
  if (repos.length === 0) return [];

  if (user?.role === 'admin' && user?.id && !writeRequired) {
    return repos;
  }

  const accessibleIds = new Set<string>();

  if (!writeRequired) {
    for (const repo of repos) {
      if (repo.visibility === 'public') {
        accessibleIds.add(repo.id);
      }
    }
  }

  if (!user?.id) {
    return repos.filter((r) => accessibleIds.has(r.id));
  }

  const userId = user.id;

  for (const repo of repos) {
    if (repo.ownerId === userId) {
      accessibleIds.add(repo.id);
    }
  }

  const pendingRepos = repos.filter((repo) => !accessibleIds.has(repo.id));
  if (pendingRepos.length === 0) return repos;

  // Search results can contain many issues or pull requests from the same repo.
  // Query each unresolved repository once, excluding public/owned fast paths.
  const repoIds = [...new Set(pendingRepos.map((repo) => repo.id))];
  const orgIds = [
    ...new Set(pendingRepos.map((r) => r.organizationId).filter((id): id is string => id != null)),
  ];

  const [collaboratorRows, orgMemberRows, teamPermRows] = await Promise.all([
    db
      .select({
        repositoryId: repositoryCollaborators.repositoryId,
        permission: repositoryCollaborators.permission,
      })
      .from(repositoryCollaborators)
      .where(
        and(
          inArray(repositoryCollaborators.repositoryId, repoIds),
          eq(repositoryCollaborators.userId, userId)
        )
      ),
    orgIds.length > 0
      ? db
          .select({
            organizationId: organizationMembers.organizationId,
            role: organizationMembers.role,
          })
          .from(organizationMembers)
          .where(
            and(
              inArray(organizationMembers.organizationId, orgIds),
              eq(organizationMembers.userId, userId)
            )
          )
      : Promise.resolve([]),
    db
      .select({
        repositoryId: teamRepositories.repositoryId,
        permission: teamRepositories.permission,
      })
      .from(teamRepositories)
      .innerJoin(teamMembers, eq(teamMembers.teamId, teamRepositories.teamId))
      .where(
        and(inArray(teamRepositories.repositoryId, repoIds), eq(teamMembers.userId, userId))
      ),
  ]);

  const collabByRepo = new Map(collaboratorRows.map((r) => [r.repositoryId, r.permission]));
  const orgRoleByOrgId = new Map(orgMemberRows.map((r) => [r.organizationId, r.role]));
  const teamPermByRepo = new Map<string, RepoPermission>();
  for (const row of teamPermRows) {
    const current = teamPermByRepo.get(row.repositoryId);
    if (!current || PERMISSION_RANK[row.permission] > PERMISSION_RANK[current]) {
      teamPermByRepo.set(row.repositoryId, row.permission);
    }
  }

  for (const repo of repos) {
    if (accessibleIds.has(repo.id)) continue;

    const facts: RepoAccessFacts = {
      collaboratorPermission: collabByRepo.get(repo.id) ?? null,
      orgRole: repo.organizationId ? orgRoleByOrgId.get(repo.organizationId) ?? null : null,
      teamPermission: teamPermByRepo.get(repo.id) ?? null,
    };
    if (evaluateRepoAccessFromFacts(repo, user, facts, writeRequired)) {
      accessibleIds.add(repo.id);
    }
  }

  return repos.filter((r) => accessibleIds.has(r.id));
}

/**
 * Check if a user can manage repository settings (branch protection, webhooks, collaborators, etc.).
 *
 * - Repo owner always qualifies
 * - Org owners/admins qualify for org repos
 * - Admin collaborators qualify
 */
export async function canManageRepository(
  repo: Repository,
  user: { id: string }
): Promise<boolean> {
  if (user.id === repo.ownerId) return true;

  const facts = await getRepoAccessFacts(repo, user.id);

  if (repo.organizationId && (facts.orgRole === 'owner' || facts.orgRole === 'admin')) {
    return true;
  }

  return facts.collaboratorPermission === 'admin';
}
