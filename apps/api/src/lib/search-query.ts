import { sql, type SQL } from 'drizzle-orm';
import {
  repositories, organizations, users, issues, pullRequests, repositoryCollaborators,
  organizationMembers, teamMembers, teamRepositories,
} from '@sigmagit/db';
import type { AccessUser } from './access';

/** Read policy equivalent to canAccessRepository, evaluated before database pagination. */
export function readableRepositoryCondition(user: AccessUser): SQL {
  if (user?.role === 'admin') return sql`true`;
  const publicRepo = sql`${repositories.visibility} = 'public'`;
  if (!user) return publicRepo;
  return sql`(${publicRepo} OR ${repositories.ownerId} = ${user.id}
    OR EXISTS (SELECT 1 FROM ${repositoryCollaborators}
      WHERE ${repositoryCollaborators.repositoryId} = ${repositories.id}
        AND ${repositoryCollaborators.userId} = ${user.id})
    OR EXISTS (SELECT 1 FROM ${organizationMembers}
      WHERE ${organizationMembers.organizationId} = ${repositories.organizationId}
        AND ${organizationMembers.userId} = ${user.id}
        AND ${organizationMembers.role} IN ('owner', 'admin'))
    OR EXISTS (SELECT 1 FROM ${teamRepositories}
      INNER JOIN ${teamMembers} ON ${teamMembers.teamId} = ${teamRepositories.teamId}
      WHERE ${teamRepositories.repositoryId} = ${repositories.id}
        AND ${teamMembers.userId} = ${user.id}))`;
}

export const SEARCH_TYPES = ['all', 'repositories', 'repos', 'issues', 'pulls', 'prs', 'users'];

export function buildSearchQuery(query: string, type: string, limit: number, offset: number, user: AccessUser): SQL {
  const queries: SQL[] = [];
  const readable = readableRepositoryCondition(user);
  const ownerName = sql`coalesce(${organizations.name}, ${users.username})`;
  const ownerAvatar = sql`CASE WHEN ${repositories.organizationId} IS NOT NULL
    THEN ${organizations.avatarUrl} ELSE ${users.avatarUrl} END`;
  const repoJoin = sql`FROM ${repositories} INNER JOIN ${users} ON ${users.id} = ${repositories.ownerId}
    LEFT JOIN ${organizations} ON ${organizations.id} = ${repositories.organizationId}`;
  if (['all', 'repositories', 'repos'].includes(type)) {
    queries.push(sql`SELECT 'repository' AS type, ${repositories.id}::text AS id,
      ${repositories.name} AS title, ${repositories.description} AS description,
      '/' || ${ownerName} || '/' || ${repositories.name} AS url,
      json_build_object('username', ${ownerName}, 'avatarUrl', ${ownerAvatar}) AS owner,
      NULL::json AS repository, NULL::text AS state, NULL::integer AS number,
      ${repositories.createdAt} AS "createdAt"
      ${repoJoin}
      WHERE ${repositories.searchVector} @@ websearch_to_tsquery('english', ${query}) AND ${readable}`);
  }
  for (const resource of [
    { table: issues, types: ['all', 'issues'], type: 'issue', path: 'issues' },
    { table: pullRequests, types: ['all', 'pulls', 'prs'], type: 'pull_request', path: 'pulls' },
  ]) {
    if (!resource.types.includes(type)) continue;
    const table = resource.table;
    queries.push(sql`SELECT ${resource.type}::text AS type, ${table.id}::text AS id,
      ${table.title} AS title, left(${table.body}, 200) AS description,
      '/' || ${ownerName} || '/' || ${repositories.name} || '/' || ${resource.path} || '/' || ${table.number} AS url,
      NULL::json AS owner,
      json_build_object('name', ${repositories.name}, 'owner', ${ownerName}) AS repository,
      ${table.state}::text AS state, ${table.number} AS number, ${table.createdAt} AS "createdAt"
      ${repoJoin} INNER JOIN ${table} ON ${table.repositoryId} = ${repositories.id}
      WHERE ${table.searchVector} @@ websearch_to_tsquery('english', ${query}) AND ${readable}`);
  }
  if (['all', 'users'].includes(type)) {
    const pattern = '%' + query + '%';
    queries.push(sql`SELECT 'user' AS type, ${users.id}::text AS id,
      ${users.username} AS title, coalesce(nullif(${users.bio}, ''), ${users.name}) AS description,
      '/' || ${users.username} AS url,
      json_build_object('username', ${users.username}, 'avatarUrl', ${users.avatarUrl}) AS owner,
      NULL::json AS repository, NULL::text AS state, NULL::integer AS number,
      ${users.createdAt} AS "createdAt" FROM ${users}
      WHERE ${users.username} ILIKE ${pattern} OR ${users.name} ILIKE ${pattern} OR ${users.bio} ILIKE ${pattern}`);
  }
  if (!queries.length) throw new Error('Invalid search type');
  return sql`SELECT type, id, title, description, url, owner, repository, state, number,
    to_char("createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt"
    FROM (${sql.join(queries, sql` UNION ALL `)}) AS results
    ORDER BY results."createdAt" DESC, type ASC, id ASC LIMIT ${limit + 1} OFFSET ${offset}`;
}
