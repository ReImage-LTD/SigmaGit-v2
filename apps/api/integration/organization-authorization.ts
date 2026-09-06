import {
  db,
  organizations,
  organizationMembers,
  organizationInvitations,
  teams,
  teamMembers,
  teamRepositories,
  repositories,
  users,
} from '@sigmagit/db';
import { createAuthenticatedFixture, fixtureRequest } from './auth-fixture';
import { canAccessRepository } from '../src/lib/access';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';

export async function checkOrganizationAuthorization(baseURL: string) {
  const owner = await createAuthenticatedFixture('org-owner');
  const admin = await createAuthenticatedFixture('org-admin');
  const member = await createAuthenticatedFixture('org-member');
  const outsider = await createAuthenticatedFixture('org-outsider');
  const recipient = await createAuthenticatedFixture('org-recipient', false);
  const [org] = await db
    .insert(organizations)
    .values({ name: 'org-security', displayName: 'Security fixture' })
    .returning();
  await db.insert(organizationMembers).values([
    { organizationId: org.id, userId: owner.user.id, role: 'owner' },
    { organizationId: org.id, userId: admin.user.id, role: 'admin' },
    { organizationId: org.id, userId: member.user.id, role: 'member' },
  ]);
  const call = (actor: typeof owner, method: string, path: string, body?: unknown) =>
    fixtureRequest(baseURL, actor, method, path, body);
  const memberPath = (name: string) => `/api/organizations/${org.name}/members/${name}`;
  assert.equal(
    (await call(outsider, 'PUT', memberPath(outsider.user.username), { role: 'owner' })).status,
    403,
  );
  assert.equal(
    (await call(member, 'PUT', memberPath(member.user.username), { role: 'owner' })).status,
    403,
  );
  assert.equal((await call(member, 'DELETE', memberPath(owner.user.username))).status, 403);
  assert.equal(
    (await call(admin, 'PUT', memberPath(admin.user.username), { role: 'owner' })).status,
    403,
  );
  assert.equal(
    (await call(owner, 'PUT', memberPath(owner.user.username), { role: 'member' })).status,
    409,
  );
  assert.equal((await call(owner, 'DELETE', memberPath(owner.user.username))).status, 409);
  assert.equal(
    (await call(owner, 'PUT', memberPath(member.user.username), { role: 'admin' })).status,
    200,
  );
  assert.equal(
    (await call(owner, 'PUT', memberPath(member.user.username), { role: 'member' })).status,
    200,
  );

  const [team] = await db
    .insert(teams)
    .values({ organizationId: org.id, name: 'private', slug: 'private' })
    .returning();
  const [repo] = await db
    .insert(repositories)
    .values({
      ownerId: owner.user.id,
      organizationId: org.id,
      name: 'private-team',
      visibility: 'private',
    })
    .returning();
  await db.insert(teamMembers).values({ teamId: team.id, userId: member.user.id });
  await db
    .insert(teamRepositories)
    .values({ teamId: team.id, repositoryId: repo.id, permission: 'read' });
  assert(await canAccessRepository(repo, member.user));
  assert.equal((await call(member, 'DELETE', memberPath(member.user.username))).status, 200);
  assert.equal(
    await canAccessRepository(repo, member.user),
    false,
    'departed member retained team access',
  );
  assert.equal(
    (await db.select().from(teamMembers).where(eq(teamMembers.userId, member.user.id))).length,
    0,
  );
  // Old orphaned memberships must not regain access, even before cleanup.
  await db.insert(teamMembers).values({ teamId: team.id, userId: member.user.id });
  assert.equal(await canAccessRepository(repo, member.user), false);

  const [otherOrg] = await db
    .insert(organizations)
    .values({ name: 'other-org', displayName: 'Other' })
    .returning();
  const [foreignTeam] = await db
    .insert(teams)
    .values({ organizationId: otherOrg.id, name: 'secret', slug: 'secret' })
    .returning();
  const invitationPath = `/api/organizations/${org.name}/invitations`;
  assert.equal(
    (await call(admin, 'POST', invitationPath, { userId: outsider.user.id, role: 'owner' })).status,
    403,
  );
  assert.equal((await call(owner, 'POST', invitationPath, { role: 'member' })).status, 400);
  assert.equal(
    (
      await call(owner, 'POST', invitationPath, {
        userId: outsider.user.id,
        teamIds: [foreignTeam.id],
      })
    ).status,
    400,
  );
  const legacyInvite = async (overrides: Partial<typeof organizationInvitations.$inferInsert>) => {
    const [invitation] = await db
      .insert(organizationInvitations)
      .values({
        organizationId: org.id,
        invitedById: owner.user.id,
        userId: recipient.user.id,
        token: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
        ...overrides,
      })
      .returning();
    return invitation;
  };
  const accept = (actor: typeof owner, token: string) =>
    call(actor, 'POST', `/api/invitations/${token}/accept`);
  const foreign = await legacyInvite({ teamIds: [foreignTeam.id] });
  assert.equal((await accept(recipient, foreign.token)).status, 400);
  const elevated = await legacyInvite({ invitedById: admin.user.id, role: 'owner' });
  assert.equal((await accept(recipient, elevated.token)).status, 403);
  const emailed = await legacyInvite({ userId: null, email: recipient.user.email.toUpperCase() });
  assert.equal(
    (await accept(recipient, emailed.token)).status,
    403,
    'unverified email claimed invitation',
  );
  await db.update(users).set({ emailVerified: true }).where(eq(users.id, recipient.user.id));
  assert.equal((await accept(outsider, emailed.token)).status, 403);
  const accepted = await Promise.all([
    accept(recipient, emailed.token),
    accept(recipient, emailed.token),
  ]);
  assert.deepEqual(accepted.map((response) => response.status).sort(), [200, 409]);
  const existingOwnerInvite = await legacyInvite({ userId: owner.user.id, role: 'member' });
  assert.equal((await accept(owner, existingOwnerInvite.token)).status, 200);
  assert.equal(
    (
      await db.query.organizationMembers.findFirst({
        where: and(
          eq(organizationMembers.organizationId, org.id),
          eq(organizationMembers.userId, owner.user.id),
        ),
      })
    )?.role,
    'owner',
  );
  const directedResponse = await call(owner, 'POST', invitationPath, {
    userId: outsider.user.id,
    teamIds: [team.id],
  });
  assert.equal(directedResponse.status, 200);
  const directed = (await directedResponse.json()) as { data: { token: string } };
  assert.equal((await accept(recipient, directed.data.token)).status, 403);
  assert.equal((await accept(outsider, directed.data.token)).status, 200);
  assert(
    await db.query.teamMembers.findFirst({
      where: and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, outsider.user.id)),
    }),
  );

  // Two owners cannot concurrently demote themselves and strand the org.
  await db.insert(organizationMembers).values([
    { organizationId: otherOrg.id, userId: owner.user.id, role: 'owner' },
    { organizationId: otherOrg.id, userId: admin.user.id, role: 'owner' },
  ]);
  const demotions = await Promise.all(
    [owner, admin].map((actor) =>
      call(actor, 'PUT', `/api/organizations/${otherOrg.name}/members/${actor.user.username}`, {
        role: 'member',
      }),
    ),
  );
  assert.deepEqual(demotions.map((response) => response.status).sort(), [200, 409]);
  console.log(
    'PASS: organization role boundaries, last-owner races, team revocation, recipient-bound invitations, and single-use acceptance',
  );
}
