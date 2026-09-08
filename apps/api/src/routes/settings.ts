import { getStorageOwnerId } from '../lib/repo-helpers';
import {
  deleteAccountBodySchema,
  getValidated,
  updateEmailBodySchema,
  updatePasswordBodySchema,
  zValidator,
} from '../middleware/validate';
import { requireAuth, invalidateCachedUser, type AuthVariables } from '../middleware/auth';
import { putObject, deleteObject, deletePrefix, getRepoPrefix } from '../s3';
import { db, users, repositories, accounts, sessions, organizations } from '@sigmagit/db';
import { verifyUserPassword } from '../security/password-verify';
import { validateAvatarUpload } from '../security/avatar';
import { isPasswordCompromised } from '../security/pwned';
import { eq, ne, and } from 'drizzle-orm';
import { appCache } from '../redis';
import { Hono } from 'hono';

const app = new Hono<{ Variables: AuthVariables }>();

function cacheBustAvatarUrl(avatarUrl: string | null, updatedAt: Date): string | null {
  if (!avatarUrl) return null;
  if (avatarUrl.includes('v=')) return avatarUrl;
  const separator = avatarUrl.includes('?') ? '&' : '?';
  return `${avatarUrl}${separator}v=${updatedAt.getTime()}`;
}

app.get('/api/settings', requireAuth, async (c) => {
  const user = c.get('user')!;

  const result = await db.query.users.findFirst({
    where: eq(users.id, user.id),
  });

  if (!result) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json({
    user: {
      ...result,
      avatarUrl: cacheBustAvatarUrl(result.avatarUrl, result.updatedAt),
    },
  });
});

app.patch('/api/settings/profile', requireAuth, async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json<{
    name?: string;
    username?: string;
    bio?: string;
    location?: string;
    website?: string;
    pronouns?: string;
    company?: string;
    gitEmail?: string;
    defaultRepositoryVisibility?: string;
  }>();

  let normalizedUsername = body.username?.toLowerCase().replace(/ /g, '-');

  if (normalizedUsername) {
    if (!/^[a-zA-Z0-9_-]+$/.test(normalizedUsername)) {
      return c.json(
        { error: 'Username can only contain letters, numbers, underscores, and hyphens' },
        400,
      );
    }
    if (normalizedUsername.length < 3) {
      return c.json({ error: 'Username must be at least 3 characters' }, 400);
    }

    const existing = await db.query.users.findFirst({
      where: and(eq(users.username, normalizedUsername), ne(users.id, user.id)),
    });

    const existingOrg = await db.query.organizations.findFirst({ where: eq(organizations.name, normalizedUsername), columns: { id: true } });
    if (existing || existingOrg) {
      return c.json({ error: 'Username is already taken' }, 400);
    }
  }

  if (
    body.defaultRepositoryVisibility &&
    body.defaultRepositoryVisibility !== 'public' &&
    body.defaultRepositoryVisibility !== 'private'
  ) {
    return c.json({ error: "defaultRepositoryVisibility must be 'public' or 'private'" }, 400);
  }

  const { sanitizeHttpUrl } = await import('../lib/url-sanitize');
  let website = body.website;
  if (website !== undefined) {
    if (website.trim() === '') {
      website = '';
    } else {
      const safe = sanitizeHttpUrl(website);
      if (!safe) {
        return c.json({ error: 'website must be a valid http(s) URL' }, 400);
      }
      website = safe;
    }
  }

  const currentUser = await db.query.users.findFirst({
    where: eq(users.id, user.id),
  });

  const finalUsername = normalizedUsername || currentUser?.username;

  await db
    .update(users)
    .set({
      name: body.name ?? currentUser?.name,
      username: finalUsername,
      bio: body.bio ?? currentUser?.bio,
      location: body.location ?? currentUser?.location,
      website: website !== undefined ? website : currentUser?.website,
      pronouns: body.pronouns ?? currentUser?.pronouns,
      company: body.company ?? currentUser?.company,
      gitEmail: body.gitEmail ?? currentUser?.gitEmail,
      defaultRepositoryVisibility:
        (body.defaultRepositoryVisibility as 'public' | 'private') ??
        currentUser?.defaultRepositoryVisibility,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  await invalidateCachedUser(user.id);
  if (currentUser?.username && currentUser.username !== finalUsername) {
    await appCache.invalidateProfileResolve(currentUser.username);
  }
  if (finalUsername) {
    await appCache.invalidateProfileResolve(finalUsername);
  }

  return c.json({ success: true, username: finalUsername });
});

app.patch('/api/settings/preferences', requireAuth, async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json<{
    emailNotifications?: boolean;
    theme?: string;
    language?: string;
    showEmail?: boolean;
  }>();

  const currentUser = await db.query.users.findFirst({
    where: eq(users.id, user.id),
  });

  const currentPreferences = (currentUser?.preferences || {}) as Record<string, any>;

  const newPreferences = { ...currentPreferences };
  if (body.emailNotifications !== undefined)
    newPreferences.emailNotifications = body.emailNotifications;
  if (body.theme !== undefined) newPreferences.theme = body.theme;
  if (body.language !== undefined) newPreferences.language = body.language;
  if (body.showEmail !== undefined) newPreferences.showEmail = body.showEmail;

  await db
    .update(users)
    .set({
      preferences: newPreferences,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  return c.json({ success: true });
});

app.get('/api/settings/word-wrap', requireAuth, async (c) => {
  const user = c.get('user')!;

  const currentUser = await db.query.users.findFirst({
    where: eq(users.id, user.id),
  });

  const preferences = (currentUser?.preferences || {}) as Record<string, any>;
  const wordWrap = preferences.wordWrap ?? false;

  return c.json({ wordWrap });
});

app.patch('/api/settings/word-wrap', requireAuth, async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json<{ wordWrap: boolean }>();

  const currentUser = await db.query.users.findFirst({
    where: eq(users.id, user.id),
  });

  const currentPreferences = (currentUser?.preferences || {}) as Record<string, any>;
  const newPreferences = { ...currentPreferences, wordWrap: body.wordWrap };

  await db
    .update(users)
    .set({
      preferences: newPreferences,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  return c.json({ success: true, wordWrap: body.wordWrap });
});

app.patch(
  '/api/settings/email',
  requireAuth,
  zValidator('json', updateEmailBodySchema),
  async (c) => {
    const user = c.get('user')!;
    const body = getValidated<{ email: string; password: string }>(c, 'json');

    const passwordOk = await verifyUserPassword(user.id, body.password);
    if (!passwordOk) {
      return c.json({ error: 'Password is incorrect' }, 403);
    }

    const existing = await db.query.users.findFirst({
      where: and(eq(users.email, body.email), ne(users.id, user.id)),
    });

    if (existing) {
      return c.json({ error: 'Email already in use' }, 400);
    }

    const [updated] = await db
      .update(users)
      .set({
        email: body.email,
        emailVerified: false,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning();

    await invalidateCachedUser(user.id);

    return c.json(updated);
  },
);

app.post('/api/settings/avatar', requireAuth, async (c) => {
  const user = c.get('user')!;
  const formData = await c.req.formData();
  const file = formData.get('avatar') as File | null;

  if (!file) {
    return c.json({ error: 'No avatar file provided' }, 400);
  }

  const data = await file.arrayBuffer();
  const validation = validateAvatarUpload(data, file.type);
  if (!validation.ok || !validation.mime || !validation.extension) {
    return c.json({ error: validation.error || 'Invalid avatar file' }, 400);
  }

  const currentUser = await db.query.users.findFirst({
    where: eq(users.id, user.id),
  });

  if (currentUser?.avatarUrl) {
    const withoutQuery = currentUser.avatarUrl.split('?')[0];
    const filename = withoutQuery.replace('/api/avatar/', '');
    if (filename) {
      const oldKey = `avatars/${filename}`;
      try {
        await deleteObject(oldKey);
      } catch {}
    }
  }

  // Extension and content-type come only from magic-byte detection.
  const ext = validation.extension;
  const contentType = validation.mime;
  const key = `avatars/${user.id}.${ext}`;

  await putObject(key, Buffer.from(data), contentType);

  const timestamp = Date.now();
  const avatarUrl = `/api/avatar/${user.id}.${ext}?v=${timestamp}`;

  await db
    .update(users)
    .set({
      avatarUrl,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  return c.json({ success: true, avatarUrl });
});

app.delete('/api/settings/avatar', requireAuth, async (c) => {
  const user = c.get('user')!;

  const currentUser = await db.query.users.findFirst({
    where: eq(users.id, user.id),
  });

  if (currentUser?.avatarUrl) {
    const withoutQuery = currentUser.avatarUrl.split('?')[0];
    const filename = withoutQuery.replace('/api/avatar/', '');
    if (filename) {
      const oldKey = `avatars/${filename}`;
      try {
        await deleteObject(oldKey);
      } catch {}
    }
  }

  await db
    .update(users)
    .set({
      avatarUrl: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  return c.json({ success: true, avatarUrl: null });
});

app.patch('/api/settings/social-links', requireAuth, async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json<{
    github?: string;
    twitter?: string;
    linkedin?: string;
    custom?: string[];
  }>();

  const { sanitizeHttpUrl } = await import('../lib/url-sanitize');
  const socialLinks: {
    github?: string;
    twitter?: string;
    linkedin?: string;
    custom?: string[];
  } = {};

  if (body.github?.trim()) {
    const safe = sanitizeHttpUrl(body.github.trim());
    if (!safe) return c.json({ error: 'github must be a valid http(s) URL' }, 400);
    socialLinks.github = safe;
  }
  if (body.twitter?.trim()) {
    const safe = sanitizeHttpUrl(body.twitter.trim());
    if (!safe) return c.json({ error: 'twitter must be a valid http(s) URL' }, 400);
    socialLinks.twitter = safe;
  }
  if (body.linkedin?.trim()) {
    const safe = sanitizeHttpUrl(body.linkedin.trim());
    if (!safe) return c.json({ error: 'linkedin must be a valid http(s) URL' }, 400);
    socialLinks.linkedin = safe;
  }
  if (body.custom?.filter((s) => s.trim()).length) {
    const custom: string[] = [];
    for (const s of body.custom.filter((x) => x.trim())) {
      const safe = sanitizeHttpUrl(s.trim());
      if (!safe) return c.json({ error: 'custom social links must be valid http(s) URLs' }, 400);
      custom.push(safe);
    }
    socialLinks.custom = custom.slice(0, 10);
  }

  await db
    .update(users)
    .set({
      socialLinks,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  return c.json({ success: true });
});

app.patch(
  '/api/settings/password',
  requireAuth,
  zValidator('json', updatePasswordBodySchema),
  async (c) => {
    const user = c.get('user')!;
    const body = getValidated<{ currentPassword: string; newPassword: string }>(c, 'json');

    const account = await db.query.accounts.findFirst({
      where: and(eq(accounts.userId, user.id), eq(accounts.providerId, 'credential')),
    });

    if (!account || !account.password) {
      return c.json({ error: 'No password set for this account' }, 400);
    }

    const valid = await Bun.password.verify(body.currentPassword, account.password);
    if (!valid) {
      return c.json({ error: 'Current password is incorrect' }, 400);
    }

    if (await isPasswordCompromised(body.newPassword)) {
      return c.json(
        {
          code: 'PASSWORD_COMPROMISED',
          error: 'Please choose a more secure password.',
        },
        400,
      );
    }

    const { validatePassword } = await import('@sigmagit/lib/validation');
    const passwordValidation = validatePassword(body.newPassword);
    if (!passwordValidation.valid) {
      return c.json({ error: passwordValidation.error }, 400);
    }

    const newHash = await Bun.password.hash(body.newPassword, { algorithm: 'bcrypt', cost: 12 });

    await db
      .update(accounts)
      .set({
        password: newHash,
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, account.id));

    // Invalidate all sessions so stolen sessions cannot survive a password change.
    // Keep the current session so the user is not immediately logged out.
    const currentSession = c.get('session') as {
      session?: { id?: string };
      id?: string;
    } | null;
    const currentSessionId =
      currentSession?.session?.id ??
      (typeof currentSession?.id === 'string' ? currentSession.id : undefined);

    if (currentSessionId) {
      await db
        .delete(sessions)
        .where(and(eq(sessions.userId, user.id), ne(sessions.id, currentSessionId)));
    } else {
      await db.delete(sessions).where(eq(sessions.userId, user.id));
    }

    await invalidateCachedUser(user.id);

    const { logSecurityEvent } = await import('../security/audit');
    logSecurityEvent({
      action: 'auth.password_change',
      actorId: user.id,
      outcome: 'success',
    });

    // Close sockets for sessions we just deleted (all except current).
    // Without per-socket session mapping beyond sessionId, close all and let client re-ticket.
    try {
      const { closeUserConnections } = await import('../websocket');
      closeUserConnections(user.id, 'password_change');
    } catch {
      /* ignore */
    }

    return c.json({ success: true });
  },
);

app.delete(
  '/api/settings/account',
  requireAuth,
  zValidator('json', deleteAccountBodySchema),
  async (c) => {
    const user = c.get('user')!;
    const body = getValidated<{ password: string }>(c, 'json');

    const passwordOk = await verifyUserPassword(user.id, body.password);
    if (!passwordOk) {
      return c.json({ error: 'Password is incorrect' }, 403);
    }

    const repos = await db.query.repositories.findMany({
      where: eq(repositories.ownerId, user.id),
      columns: { name: true, ownerId: true, organizationId: true, storageOwnerId: true },
    });

    const storageErrors: string[] = [];

    for (const repo of repos) {
      const repoPrefix = getRepoPrefix(getStorageOwnerId(repo), repo.name);
      try {
        await deletePrefix(repoPrefix);
      } catch (error) {
        console.error(`[Settings] Failed to delete storage for repo ${repo.name}:`, error);
        storageErrors.push(repo.name);
      }
    }

    const avatarPrefix = `avatars/${user.id}`;
    try {
      await deletePrefix(avatarPrefix);
    } catch (error) {
      console.error(`[Settings] Failed to delete avatar storage for user ${user.id}:`, error);
      storageErrors.push('avatar');
    }

    await db.delete(users).where(eq(users.id, user.id));

    return c.json({
      success: true,
      storageCleanupErrors: storageErrors.length > 0 ? storageErrors : undefined,
    });
  },
);

app.get('/api/settings/current-user', requireAuth, async (c) => {
  const user = c.get('user')!;

  const result = await db.query.users.findFirst({
    where: eq(users.id, user.id),
  });

  if (!result) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json({
    id: result.id,
    name: result.name,
    email: result.email,
    emailVerified: result.emailVerified,
    username: result.username,
    bio: result.bio,
    location: result.location,
    website: result.website,
    pronouns: result.pronouns,
    avatarUrl: result.avatarUrl,
    company: result.company,
    gitEmail: result.gitEmail,
    defaultRepositoryVisibility: result.defaultRepositoryVisibility,
    preferences: result.preferences,
    socialLinks: result.socialLinks,
    createdAt: result.createdAt,
    updatedAt: result.updatedAt,
    lastActiveAt: result.lastActiveAt,
  });
});

export default app;
