import { expect, test } from 'bun:test';
import { publicUserColumns } from '../../lib/public-user';
import { db, users } from '@sigmagit/db';

test('public member projection excludes private user columns from SQL', () => {
  const query = db.select(publicUserColumns).from(users).toSQL().sql;
  expect(Object.keys(publicUserColumns).sort()).toEqual(['avatarUrl', 'id', 'name', 'username']);
  for (const field of ['email', 'preferences', 'nwc_connection_string', 'nostr_public_key']) {
    expect(query).not.toContain('"' + field + '"');
  }
});
