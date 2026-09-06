import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { AuthVariables } from '../../middleware/auth';
import * as repoHelpers from '../../lib/repo-helpers';
import fileRoutes from '../../routes/file';
import * as git from '../../git';
import { Hono } from 'hono';

afterEach(() => mock.restore());

describe('raw repository files', () => {
  for (const visibility of ['private', 'public']) {
    it(`does not cache ${visibility} repository content`, async () => {
      spyOn(repoHelpers, 'resolveRepositoryBySlug').mockResolvedValue({
        id: 'repo',
        name: 'repo',
        description: null,
        ownerId: 'owner',
        organizationId: null,
        visibility,
        defaultBranch: 'main',
        storageOwnerId: 'owner',
        ownerSlug: 'owner',
        ownerType: 'user',
        ownerDisplay: 'Owner',
      });
      spyOn(repoHelpers, 'createRepoGitStore').mockReturnValue(
        {} as ReturnType<typeof repoHelpers.createRepoGitStore>,
      );
      spyOn(git, 'getFile').mockResolvedValue({ content: 'secret', oid: 'oid' } as Awaited<
        ReturnType<typeof git.getFile>
      >);
      const app = new Hono<{ Variables: AuthVariables }>();
      app.use('*', async (c, next) => {
        c.set('user', {
          id: 'owner',
          name: 'Owner',
          username: 'owner',
          email: 'owner@example.com',
        });
        await next();
      });
      app.route('/', fileRoutes);
      const response = await app.request('/file/owner/repo/main/secret.txt');
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('secret');
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    });
  }
});
