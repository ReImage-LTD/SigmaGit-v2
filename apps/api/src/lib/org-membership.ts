import {
  db,
  organizations,
  organizationMembers,
  organizationInvitations,
  teams,
  teamMembers,
  users,
} from '@sigmagit/db';
import { and, eq, inArray } from 'drizzle-orm';

interface MembershipError {
  error: string;
  status: 400 | 403 | 404 | 409;
}
type OrgRole = 'owner' | 'admin' | 'member';

// Serialize membership changes on the organization, including concurrent changes
// by different owners, so they cannot both remove the last owner.
export async function changeOrganizationMember(
  organizationId: string,
  actorId: string,
  targetId: string,
  role?: OrgRole,
): Promise<MembershipError | null> {
  return db.transaction(async (tx) => {
    const [org] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .for('update');
    if (!org) return { error: 'Organization not found', status: 404 };
    const members = await tx
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          inArray(organizationMembers.userId, [actorId, targetId]),
        ),
      );
    const actor = members.find((member) => member.userId === actorId);
    const target = members.find((member) => member.userId === targetId);
    if (!actor || (actor.role !== 'owner' && (role !== undefined || actorId !== targetId))) {
      return { error: 'Forbidden', status: 403 };
    }
    if (target?.role === 'owner' && role !== 'owner') {
      const owners = await tx
        .select({ userId: organizationMembers.userId })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, organizationId),
            eq(organizationMembers.role, 'owner'),
          ),
        )
        .limit(2);
      if (owners.length < 2) return { error: 'Organization must retain an owner', status: 409 };
    }
    if (role !== undefined) {
      await tx
        .insert(organizationMembers)
        .values({ organizationId, userId: targetId, role })
        .onConflictDoUpdate({
          target: [organizationMembers.organizationId, organizationMembers.userId],
          set: { role },
        });
    } else {
      await tx
        .delete(teamMembers)
        .where(
          and(
            eq(teamMembers.userId, targetId),
            inArray(
              teamMembers.teamId,
              tx
                .select({ id: teams.id })
                .from(teams)
                .where(eq(teams.organizationId, organizationId)),
            ),
          ),
        );
      await tx
        .delete(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, organizationId),
            eq(organizationMembers.userId, targetId),
          ),
        );
    }
    return null;
  });
}

export async function acceptOrganizationInvitation(
  token: string,
  userId: string,
): Promise<MembershipError | null> {
  return db.transaction(async (tx) => {
    const [found] = await tx
      .select({ organizationId: organizationInvitations.organizationId })
      .from(organizationInvitations)
      .where(eq(organizationInvitations.token, token));
    if (!found) return { error: 'Invitation not found', status: 404 };
    await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, found.organizationId))
      .for('update');
    const [invitation] = await tx
      .select()
      .from(organizationInvitations)
      .where(eq(organizationInvitations.token, token))
      .for('update');
    if (!invitation) return { error: 'Invitation not found', status: 404 };
    if (invitation.acceptedAt) return { error: 'Invitation already accepted', status: 409 };
    if (invitation.expiresAt <= new Date()) return { error: 'Invitation expired', status: 400 };
    const [recipient] = await tx
      .select({ email: users.email, emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.id, userId));
    if (
      !recipient ||
      (!invitation.userId && !invitation.email) ||
      (invitation.userId && invitation.userId !== userId) ||
      (invitation.email &&
        (!recipient.emailVerified ||
          recipient.email.toLowerCase() !== invitation.email.toLowerCase()))
    ) {
      return { error: 'Invitation is not for this user', status: 403 };
    }
    const [inviter] = await tx
      .select({ role: organizationMembers.role })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, invitation.organizationId),
          eq(organizationMembers.userId, invitation.invitedById),
        ),
      );
    if (
      !inviter ||
      !['owner', 'admin'].includes(inviter.role) ||
      !['owner', 'admin', 'member'].includes(invitation.role) ||
      (invitation.role === 'owner' && inviter.role !== 'owner')
    ) {
      return { error: 'Invitation is no longer authorized', status: 403 };
    }
    const teamIds = [...new Set(invitation.teamIds ?? [])];
    if (teamIds.length) {
      const matching = await tx
        .select({ id: teams.id })
        .from(teams)
        .where(
          and(eq(teams.organizationId, invitation.organizationId), inArray(teams.id, teamIds)),
        );
      if (matching.length !== teamIds.length)
        return { error: 'Invalid invitation teams', status: 400 };
    }
    // Joining must not downgrade an existing owner or promote an existing member
    // through an older invitation. Role changes use the dedicated owner endpoint.
    await tx
      .insert(organizationMembers)
      .values({ organizationId: invitation.organizationId, userId, role: invitation.role })
      .onConflictDoNothing();
    if (teamIds.length)
      await tx
        .insert(teamMembers)
        .values(teamIds.map((teamId) => ({ teamId, userId })))
        .onConflictDoNothing();
    await tx
      .update(organizationInvitations)
      .set({ acceptedAt: new Date() })
      .where(eq(organizationInvitations.id, invitation.id));
    return null;
  });
}
