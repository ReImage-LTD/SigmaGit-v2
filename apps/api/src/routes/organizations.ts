import { publicUserColumns } from '../lib/public-user';
import { listPage, pageResponse } from '../lib/list-page';
import { changeOrganizationMember, acceptOrganizationInvitation } from '../lib/org-membership';
import { Hono } from "hono";
import { db, organizations, organizationMembers, teams, teamMembers, teamRepositories, organizationInvitations, users, repositories } from "@sigmagit/db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { requireAuth, type AuthVariables } from "../middleware/auth";
import { filterAccessibleRepos } from "../lib/access";
import { parseLimit, parseOffset } from "../lib/validation";
import { logAuditEvent } from "./admin";
import { randomUUID } from "crypto";
import { appCache } from "../redis";
import { z } from "zod";
import { formatZodError } from "../middleware/validate";
import { logSecurityEvent } from "../security/audit";

const app = new Hono<{ Variables: AuthVariables }>();

app.post("/api/organizations", requireAuth, async (c) => {
  const user = c.get("user")!;
  const parsed = z.object({
    name: z.string().trim().toLowerCase().min(3).max(39).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
    displayName: z.string().max(100).optional(),
    description: z.string().max(2000).optional(),
    email: z.union([z.string().email(), z.literal('')]).optional(),
    website: z.string().max(2000).optional(),
    location: z.string().max(200).optional(),
  }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(formatZodError(parsed.error), 400);
  const { name, displayName, description, email, website, location } = parsed.data;
  const [existingUser] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = ${name}`).limit(1);
  if (existingUser) return c.json({ error: 'Organization name already taken' }, 409);

  const [existingOrg] = await db.select().from(organizations).where(eq(organizations.name, name.toLowerCase()));
  if (existingOrg) {
    return c.json({ error: "Organization name already taken" }, 400);
  }

  const org = await db.transaction(async tx => {
  const [org] = await tx
    .insert(organizations)
    .values({
      name: name.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
      displayName: displayName ?? name,
      description,
      email,
      website,
      location,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  await tx.insert(organizationMembers).values({
    organizationId: org.id,
    userId: user.id,
    role: "owner",
    createdAt: new Date(),
  });
  return org;
  }).catch((error: unknown) => {
    const cause = error as { code?: string; cause?: { code?: string } };
    if (cause.code === '23505' || cause.cause?.code === '23505') return null;
    throw error;
  });
  if (!org) return c.json({ error: 'Organization name already taken' }, 409);

  await logAuditEvent(
    user.id,
    "org.create",
    "organization",
    org.id,
    { name: org.name },
    c.req.header("x-forwarded-for") || c.req.header("x-real-ip")
  );

  return c.json({ data: org });
});

app.get("/api/organizations/:org", async (c) => {
  const orgName = c.req.param("org");

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, orgName));

  if (!org) {
    return c.json({ error: "Organization not found" }, 404);
  }

  const [[memberCount], [repoCount]] = await Promise.all([
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(organizationMembers)
      .where(eq(organizationMembers.organizationId, org.id)),
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(repositories)
      .where(eq(repositories.organizationId, org.id)),
  ]);

  return c.json({
    ...org,
    memberCount: Number(memberCount?.count) || 0,
    repoCount: Number(repoCount?.count) || 0,
  });
});

app.patch("/api/organizations/:org", requireAuth, async (c) => {
  const user = c.get("user")!;
  const orgName = c.req.param("org");
  const body = await c.req.json();

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, orgName));

  if (!org) {
    return c.json({ error: "Organization not found" }, 404);
  }

  const [member] = await db
    .select()
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, org.id),
        eq(organizationMembers.userId, user.id),
        eq(organizationMembers.role, "owner")
      )
    );

  if (!member) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const updates: Record<string, unknown> = {};
  if (body.displayName !== undefined) updates.displayName = body.displayName;
  if (body.description !== undefined) updates.description = body.description;
  if (body.email !== undefined) updates.email = body.email;
  if (body.website !== undefined) updates.website = body.website;
  if (body.location !== undefined) updates.location = body.location;
  if (body.avatarUrl !== undefined) updates.avatarUrl = body.avatarUrl;

  await db.update(organizations).set({ ...updates, updatedAt: new Date() }).where(eq(organizations.id, org.id));

  await logAuditEvent(
    user.id,
    "org.update",
    "organization",
    org.id,
    { name: org.name, changes: Object.keys(updates) },
    c.req.header("x-forwarded-for") || c.req.header("x-real-ip")
  );

  return c.json({ success: true });
});

app.delete("/api/organizations/:org", requireAuth, async (c) => {
  const user = c.get("user")!;
  const orgName = c.req.param("org");

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, orgName));

  if (!org) {
    return c.json({ error: "Organization not found" }, 404);
  }

  const [member] = await db
    .select()
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, org.id),
        eq(organizationMembers.userId, user.id),
        eq(organizationMembers.role, "owner")
      )
    );

  if (!member) {
    return c.json({ error: "Forbidden" }, 403);
  }

  await db.delete(organizations).where(eq(organizations.id, org.id));

  await logAuditEvent(
    user.id,
    "org.delete",
    "organization",
    org.id,
    { name: org.name },
    c.req.header("x-forwarded-for") || c.req.header("x-real-ip")
  );

  return c.json({ success: true });
});

app.get("/api/organizations/:org/members", async (c) => {
  const { limit, offset } = listPage(c.req.query());
  const orgName = c.req.param("org");

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, orgName));

  if (!org) {
    return c.json({ error: "Organization not found" }, 404);
  }

  const members = await db
    .select({
      user: publicUserColumns,
      role: organizationMembers.role,
      joinedAt: organizationMembers.createdAt,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(organizationMembers.userId, users.id))
    .where(eq(organizationMembers.organizationId, org.id))
    .orderBy(desc(organizationMembers.createdAt), organizationMembers.userId)
    .limit(limit + 1)
    .offset(offset);

  return c.json(pageResponse('members', members, limit, offset));
});

const orgMemberRoleSchema = z
  .object({
    role: z.enum(["owner", "admin", "member"]),
  })
  .strict();

app.put("/api/organizations/:org/members/:username", requireAuth, async (c) => {
  const user = c.get("user")!;
  const orgName = c.req.param("org");
  const username = c.req.param("username");
  const parsed = orgMemberRoleSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json(formatZodError(parsed.error), 400);
  }
  const { role } = parsed.data;

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, orgName));

  if (!org) {
    return c.json({ error: "Organization not found" }, 404);
  }

  const [targetUser] = await db.select().from(users).where(eq(users.username, username));
  if (!targetUser) {
    return c.json({ error: "User not found" }, 404);
  }

  const failure = await changeOrganizationMember(org.id, user.id, targetUser.id, role);
  if (failure) return c.json({ error: failure.error }, failure.status);

  await appCache.invalidateUserAccess(targetUser.id);
  await logAuditEvent(
    user.id,
    "org.member.update",
    "organization",
    org.id,
    { username, role },
    c.req.header("x-forwarded-for") || c.req.header("x-real-ip")
  );
  logSecurityEvent({
    action: "org.role_change",
    actorId: user.id,
    targetType: "user",
    targetId: targetUser.id,
    outcome: "success",
    meta: { org: org.name, role },
  });

  return c.json({ success: true });
});

app.delete("/api/organizations/:org/members/:username", requireAuth, async (c) => {
  const user = c.get("user")!;
  const orgName = c.req.param("org");
  const username = c.req.param("username");

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, orgName));

  if (!org) {
    return c.json({ error: "Organization not found" }, 404);
  }

  const [targetUser] = await db.select().from(users).where(eq(users.username, username));
  if (!targetUser) {
    return c.json({ error: "User not found" }, 404);
  }

  const failure = await changeOrganizationMember(org.id, user.id, targetUser.id);
  if (failure) return c.json({ error: failure.error }, failure.status);

  await appCache.invalidateUserAccess(targetUser.id);
  await logAuditEvent(
    user.id,
    "org.member.remove",
    "organization",
    org.id,
    { username },
    c.req.header("x-forwarded-for") || c.req.header("x-real-ip")
  );
  logSecurityEvent({
    action: "org.member_remove",
    actorId: user.id,
    targetType: "user",
    targetId: targetUser.id,
    outcome: "success",
    meta: { org: org.name },
  });

  return c.json({ success: true });
});

app.get("/api/organizations/:org/teams", requireAuth, async (c) => {
  const { limit, offset } = listPage(c.req.query());
  const user = c.get("user")!;
  const orgName = c.req.param("org");

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, orgName));

  if (!org) {
    return c.json({ error: "Organization not found" }, 404);
  }

  const [member] = await db
    .select()
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, org.id),
        eq(organizationMembers.userId, user.id)
      )
    );

  if (!member) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const teamsList = await db
    .select()
    .from(teams)
    .where(eq(teams.organizationId, org.id))
    .orderBy(desc(teams.createdAt), teams.id)
    .limit(limit + 1)
    .offset(offset);

  return c.json(pageResponse('teams', teamsList, limit, offset));
});

app.post("/api/organizations/:org/teams", requireAuth, async (c) => {
  const user = c.get("user")!;
  const orgName = c.req.param("org");
  const body = await c.req.json();
  const { name, description, permission } = body;

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, orgName));

  if (!org) {
    return c.json({ error: "Organization not found" }, 404);
  }

  const [member] = await db
    .select()
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, org.id),
        eq(organizationMembers.userId, user.id)
      )
    );

  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, "-");

  const [team] = await db
    .insert(teams)
    .values({
      organizationId: org.id,
      name,
      slug,
      description,
      permission: permission || "read",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  await logAuditEvent(
    user.id,
    "team.create",
    "team",
    team.id,
    { org: org.name, name: team.name },
    c.req.header("x-forwarded-for") || c.req.header("x-real-ip")
  );

  return c.json({ data: team });
});

app.get("/api/organizations/:org/teams/:team", requireAuth, async (c) => {
  const user = c.get("user")!;
  const orgName = c.req.param("org");
  const teamSlug = c.req.param("team");

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, orgName));

  if (!org) {
    return c.json({ error: "Organization not found" }, 404);
  }

  const [member] = await db
    .select()
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, org.id),
        eq(organizationMembers.userId, user.id)
      )
    );

  if (!member) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const [team] = await db
    .select()
    .from(teams)
    .where(
      and(
        eq(teams.organizationId, org.id),
        eq(teams.slug, teamSlug)
      )
    );

  if (!team) {
    return c.json({ error: "Team not found" }, 404);
  }

  const teamMembersList = await db
    .select({
      user: publicUserColumns,
      joinedAt: teamMembers.createdAt,
    })
    .from(teamMembers)
    .innerJoin(users, eq(teamMembers.userId, users.id))
    .where(eq(teamMembers.teamId, team.id));

  const teamRepos = await db
    .select({
      repository: repositories,
      permission: teamRepositories.permission,
    })
    .from(teamRepositories)
    .innerJoin(repositories, eq(teamRepositories.repositoryId, repositories.id))
    .where(eq(teamRepositories.teamId, team.id));

  const accessible = await filterAccessibleRepos(teamRepos.map(row => row.repository), user);
  const accessibleIds = new Set(accessible.map(repo => repo.id));
  return c.json({ ...team, members: teamMembersList, repositories: teamRepos.filter(row => accessibleIds.has(row.repository.id)) });
});

app.delete("/api/organizations/:org/teams/:team", requireAuth, async (c) => {
  const user = c.get("user")!;
  const orgName = c.req.param("org");
  const teamSlug = c.req.param("team");

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, orgName));

  if (!org) {
    return c.json({ error: "Organization not found" }, 404);
  }

  const [member] = await db
    .select()
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, org.id),
        eq(organizationMembers.userId, user.id)
      )
    );

  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.organizationId, org.id), eq(teams.slug, teamSlug)));

  if (!team) {
    return c.json({ error: "Team not found" }, 404);
  }

  await db.delete(teams).where(eq(teams.id, team.id));

  await logAuditEvent(
    user.id,
    "team.delete",
    "team",
    team.id,
    { org: org.name, team: team.slug },
    c.req.header("x-forwarded-for") || c.req.header("x-real-ip")
  );

  return c.json({ success: true });
});

app.put("/api/organizations/:org/teams/:team/members", requireAuth, async (c) => {
  const user = c.get("user")!;
  const orgName = c.req.param("org");
  const teamSlug = c.req.param("team");
  const body = await c.req.json<{ username?: string }>();
  const username = body.username?.trim();

  if (!username) {
    return c.json({ error: "Username is required" }, 400);
  }

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, orgName));

  if (!org) {
    return c.json({ error: "Organization not found" }, 404);
  }

  const [requester] = await db
    .select()
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, org.id),
        eq(organizationMembers.userId, user.id)
      )
    );

  if (!requester || (requester.role !== "owner" && requester.role !== "admin")) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.organizationId, org.id), eq(teams.slug, teamSlug)));

  if (!team) {
    return c.json({ error: "Team not found" }, 404);
  }

  const [targetUser] = await db.select().from(users).where(eq(users.username, username));
  if (!targetUser) {
    return c.json({ error: "User not found" }, 404);
  }

  const [orgMember] = await db
    .select()
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, org.id),
        eq(organizationMembers.userId, targetUser.id)
      )
    );

  if (!orgMember) {
    return c.json({ error: "User must be a member of the organization first" }, 400);
  }

  await db
    .insert(teamMembers)
    .values({
      teamId: team.id,
      userId: targetUser.id,
      createdAt: new Date(),
    })
    .onConflictDoNothing();

  await appCache.invalidateUserAccess(targetUser.id);
  await logAuditEvent(
    user.id,
    "team.member.add",
    "team",
    team.id,
    { org: org.name, team: team.slug, username },
    c.req.header("x-forwarded-for") || c.req.header("x-real-ip")
  );

  return c.json({ success: true });
});

app.delete("/api/organizations/:org/teams/:team/members/:username", requireAuth, async (c) => {
  const user = c.get("user")!;
  const orgName = c.req.param("org");
  const teamSlug = c.req.param("team");
  const username = c.req.param("username");

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, orgName));

  if (!org) {
    return c.json({ error: "Organization not found" }, 404);
  }

  const [requester] = await db
    .select()
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, org.id),
        eq(organizationMembers.userId, user.id)
      )
    );

  if (!requester || (requester.role !== "owner" && requester.role !== "admin")) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.organizationId, org.id), eq(teams.slug, teamSlug)));

  if (!team) {
    return c.json({ error: "Team not found" }, 404);
  }

  const [targetUser] = await db.select().from(users).where(eq(users.username, username));
  if (!targetUser) {
    return c.json({ error: "User not found" }, 404);
  }

  await db
    .delete(teamMembers)
    .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, targetUser.id)));

  await appCache.invalidateUserAccess(targetUser.id);
  await logAuditEvent(
    user.id,
    "team.member.remove",
    "team",
    team.id,
    { org: org.name, team: team.slug, username },
    c.req.header("x-forwarded-for") || c.req.header("x-real-ip")
  );

  return c.json({ success: true });
});

app.put("/api/organizations/:org/teams/:team/repos/:repo", requireAuth, async (c) => {
  const user = c.get("user")!;
  const orgName = c.req.param("org");
  const teamSlug = c.req.param("team");
  const repoName = c.req.param("repo");
  const body = await c.req.json<{ permission?: "read" | "write" | "admin" }>();
  const permission = body.permission || "read";

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, orgName));

  if (!org) {
    return c.json({ error: "Organization not found" }, 404);
  }

  const [requester] = await db
    .select()
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, org.id),
        eq(organizationMembers.userId, user.id)
      )
    );

  if (!requester || (requester.role !== "owner" && requester.role !== "admin")) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.organizationId, org.id), eq(teams.slug, teamSlug)));

  if (!team) {
    return c.json({ error: "Team not found" }, 404);
  }

  const [repository] = await db
    .select()
    .from(repositories)
    .where(and(eq(repositories.organizationId, org.id), eq(repositories.name, repoName)));

  if (!repository) {
    return c.json({ error: "Repository not found" }, 404);
  }

  await db
    .insert(teamRepositories)
    .values({
      teamId: team.id,
      repositoryId: repository.id,
      permission,
      createdAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [teamRepositories.teamId, teamRepositories.repositoryId],
      set: { permission },
    });

  await appCache.invalidateRepoAccess(repository.id);
  await logAuditEvent(
    user.id,
    "team.repo.add",
    "team",
    team.id,
    { org: org.name, team: team.slug, repo: repoName, permission },
    c.req.header("x-forwarded-for") || c.req.header("x-real-ip")
  );

  return c.json({ success: true });
});

app.delete("/api/organizations/:org/teams/:team/repos/:repo", requireAuth, async (c) => {
  const user = c.get("user")!;
  const orgName = c.req.param("org");
  const teamSlug = c.req.param("team");
  const repoName = c.req.param("repo");

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, orgName));

  if (!org) {
    return c.json({ error: "Organization not found" }, 404);
  }

  const [requester] = await db
    .select()
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, org.id),
        eq(organizationMembers.userId, user.id)
      )
    );

  if (!requester || (requester.role !== "owner" && requester.role !== "admin")) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.organizationId, org.id), eq(teams.slug, teamSlug)));

  if (!team) {
    return c.json({ error: "Team not found" }, 404);
  }

  const [repository] = await db
    .select()
    .from(repositories)
    .where(and(eq(repositories.organizationId, org.id), eq(repositories.name, repoName)));

  if (!repository) {
    return c.json({ error: "Repository not found" }, 404);
  }

  await db
    .delete(teamRepositories)
    .where(and(eq(teamRepositories.teamId, team.id), eq(teamRepositories.repositoryId, repository.id)));

  await appCache.invalidateRepoAccess(repository.id);
  await logAuditEvent(
    user.id,
    "team.repo.remove",
    "team",
    team.id,
    { org: org.name, team: team.slug, repo: repoName },
    c.req.header("x-forwarded-for") || c.req.header("x-real-ip")
  );

  return c.json({ success: true });
});

app.get("/api/organizations/:org/repositories", async (c) => {
  const orgName = c.req.param("org");
  const currentUser = c.get("user");
  const limit = parseLimit(c.req.query("limit"), 30);
  const offset = parseOffset(c.req.query("offset"), 0);

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, orgName));

  if (!org) {
    return c.json({ error: "Organization not found" }, 404);
  }

  const repos = await db
    .select()
    .from(repositories)
    .where(eq(repositories.organizationId, org.id))
    .orderBy(desc(repositories.createdAt))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = repos.length > limit;
  const pageRepos = repos.slice(0, limit);
  const accessibleRepos = await filterAccessibleRepos(pageRepos, currentUser);

  const reposWithOwner = accessibleRepos.map((repo) => ({
    ...repo,
    owner: {
      id: org.id,
      username: org.name,
      name: org.displayName,
      avatarUrl: org.avatarUrl,
    },
  }));

  return c.json({ repositories: reposWithOwner, hasMore });
});

const invitationSchema = z.object({
  email: z.string().trim().email().max(254).optional(),
  userId: z.string().min(1).max(200).optional(),
  role: z.enum(['owner', 'admin', 'member']).default('member'),
  teamIds: z.array(z.string().uuid()).max(100).default([]),
}).strict().refine(value => Boolean(value.email || value.userId), { message: 'An invitation recipient is required' });

app.post("/api/organizations/:org/invitations", requireAuth, async (c) => {
  const user = c.get("user")!;
  const orgName = c.req.param("org");
  const parsed = invitationSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(formatZodError(parsed.error), 400);
  const { email, userId, role, teamIds } = parsed.data;

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, orgName));

  if (!org) {
    return c.json({ error: "Organization not found" }, 404);
  }

  const [member] = await db
    .select()
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, org.id),
        eq(organizationMembers.userId, user.id)
      )
    );

  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const token = randomUUID();
  if (role === 'owner' && member.role !== 'owner') return c.json({ error: 'Only owners can invite owners' }, 403);
  if (userId && !(await db.query.users.findFirst({ where: eq(users.id, userId), columns: { id: true } }))) {
    return c.json({ error: 'Invitation recipient not found' }, 400);
  }
  const uniqueTeamIds = [...new Set(teamIds)];
  if (uniqueTeamIds.length) {
    const matching = await db.select({ id: teams.id }).from(teams).where(and(eq(teams.organizationId, org.id), inArray(teams.id, uniqueTeamIds)));
    if (matching.length !== uniqueTeamIds.length) return c.json({ error: 'Invalid invitation teams' }, 400);
  }
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const [invitation] = await db
    .insert(organizationInvitations)
    .values({
      organizationId: org.id,
      email,
      userId,
      invitedById: user.id,
      role: role || "member",
      teamIds: uniqueTeamIds,
      token,
      expiresAt,
      createdAt: new Date(),
    })
    .returning();

  await logAuditEvent(
    user.id,
    "org.invitation.create",
    "organization",
    org.id,
    { email, userId, role },
    c.req.header("x-forwarded-for") || c.req.header("x-real-ip")
  );

  return c.json({ data: invitation });
});

app.get("/api/organizations/:org/invitations", requireAuth, async (c) => {
  const { limit, offset } = listPage(c.req.query());
  const user = c.get("user")!;
  const orgName = c.req.param("org");

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, orgName));

  if (!org) {
    return c.json({ error: "Organization not found" }, 404);
  }

  const [member] = await db
    .select()
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, org.id),
        eq(organizationMembers.userId, user.id)
      )
    );

  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const invitations = await db
    .select({
      invitation: organizationInvitations,
      invitedBy: users,
    })
    .from(organizationInvitations)
    .innerJoin(users, eq(organizationInvitations.invitedById, users.id))
    .where(
      and(
        eq(organizationInvitations.organizationId, org.id),
        sql`${organizationInvitations.acceptedAt} IS NULL`
      )
    )
    .orderBy(desc(organizationInvitations.createdAt), organizationInvitations.id)
    .limit(limit + 1)
    .offset(offset);

  return c.json(pageResponse('invitations', invitations, limit, offset));
});

app.delete("/api/organizations/:org/invitations/:id", requireAuth, async (c) => {
  const user = c.get("user")!;
  const orgName = c.req.param("org");
  const invitationId = c.req.param("id");

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, orgName));

  if (!org) {
    return c.json({ error: "Organization not found" }, 404);
  }

  const [member] = await db
    .select()
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, org.id),
        eq(organizationMembers.userId, user.id)
      )
    );

  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    return c.json({ error: "Forbidden" }, 403);
  }

  await db
    .delete(organizationInvitations)
    .where(
      and(
        eq(organizationInvitations.id, invitationId),
        eq(organizationInvitations.organizationId, org.id)
      )
    );

  return c.json({ success: true });
});

app.post("/api/invitations/:token/accept", requireAuth, async (c) => {
  const user = c.get("user")!;
  const token = c.req.param("token");

  const failure = await acceptOrganizationInvitation(token, user.id);
  if (failure) return c.json({ error: failure.error }, failure.status);
  await appCache.invalidateUserAccess(user.id);

  return c.json({ success: true });
});

app.get("/api/user/organizations", async (c) => {
  const { limit, offset } = listPage(c.req.query());
  const user = c.get("user");
  if (!user) {
    return c.json({ organizations: [] });
  }

  const orgs = await db
    .select({
      organization: organizations,
      role: organizationMembers.role,
      joinedAt: organizationMembers.createdAt,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
    .where(eq(organizationMembers.userId, user.id))
    .orderBy(desc(organizationMembers.createdAt), organizationMembers.organizationId)
    .limit(limit + 1)
    .offset(offset);

  return c.json(pageResponse('organizations', orgs, limit, offset));
});

export default app;
