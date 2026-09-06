import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { Hono } from 'hono';
import { db } from '@sigmagit/db';
import adminRoutes from '../../routes/admin';
import { appCache, repoCache } from '../../redis';
import * as storage from '../../s3';
import type { AuthVariables } from '../../middleware/auth';

afterEach(() => mock.restore());

test('ownership transfer changes metadata without moving or deleting objects', async () => {
  const repository = { id: 'repo', name: 'repo', ownerId: 'old', organizationId: null, storageOwnerId: 'permanent' };
  spyOn(db.query.repositories, 'findFirst')
    .mockResolvedValueOnce(repository as Awaited<ReturnType<typeof db.query.repositories.findFirst>>)
    .mockResolvedValueOnce(undefined);
  spyOn(db.query.users, 'findFirst').mockResolvedValue({ id: 'new', username: 'new' } as Awaited<ReturnType<typeof db.query.users.findFirst>>);
  let values: unknown;
  spyOn(db, 'update').mockImplementation((() => ({ set: (input: unknown) => {
    values = input;
    return { where: async () => [] };
  } })) as unknown as typeof db.update);
  spyOn(db, 'insert').mockImplementation((() => ({ values: async () => [] })) as unknown as typeof db.insert);
  spyOn(appCache, 'invalidateRepoSlug').mockResolvedValue(undefined);
  spyOn(repoCache, 'invalidateRepo').mockResolvedValue(undefined);
  const copy = spyOn(storage, 'copyPrefix');
  const remove = spyOn(storage, 'deletePrefix');
  const app = new Hono<{Variables: AuthVariables}>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 'admin', role: 'admin' } as NonNullable<AuthVariables['user']>);
    await next();
  });
  app.route('/', adminRoutes);
  const response = await app.request('/api/admin/repositories/repo/transfer', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({newOwnerId: 'new'}),
  });
  expect(response.status).toBe(200);
  expect(values).toEqual({ownerId: 'new', organizationId: null});
  expect(copy).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});
