import { db, users, sessions } from '@sigmagit/db';
import { getAllowedOrigins } from '../src/config';
import { createHmac } from 'node:crypto';

export async function createAuthenticatedFixture(username: string, emailVerified = true) {
  const [user] = await db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      username,
      name: username,
      email: `${username}@example.invalid`,
      emailVerified,
    })
    .returning();
  const token = crypto.randomUUID();
  await db
    .insert(sessions)
    .values({
      id: crypto.randomUUID(),
      userId: user.id,
      token,
      expiresAt: new Date(Date.now() + 300_000),
    });
  const signature = createHmac('sha256', process.env.BETTER_AUTH_SECRET!)
    .update(token)
    .digest('base64');
  const headers = {
    origin: getAllowedOrigins()[0],
    cookie: `sigmagit_dev.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
    'content-type': 'application/json',
  };
  return { user, headers };
}

export function fixtureRequest(
  baseURL: string,
  actor: Awaited<ReturnType<typeof createAuthenticatedFixture>>,
  method: string,
  path: string,
  body?: unknown,
) {
  return fetch(`${baseURL}${path}`, {
    method,
    headers: actor.headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
