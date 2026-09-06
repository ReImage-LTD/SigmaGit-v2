import {
  filterAccessibleRepos,
  evaluateRepoAccessFromFacts,
  type Repository,
} from '../../lib/access';
import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { db } from '@sigmagit/db';

afterEach(() => mock.restore());

const repo: Repository = {
  id: 'repo',
  ownerId: 'owner',
  organizationId: 'org',
  visibility: 'private',
};

describe('consistent repository permissions', () => {
  it('allows team write access despite a read-only collaborator grant', () => {
    expect(
      evaluateRepoAccessFromFacts(
        repo,
        { id: 'user' },
        {
          collaboratorPermission: 'read',
          orgRole: null,
          teamPermission: 'write',
        },
        true,
      ),
    ).toBe(true);
  });

  it('does not let platform admins fall through to org or team write grants in lists', async () => {
    const rows = [
      [{ repositoryId: 'repo', permission: 'read' }],
      [{ organizationId: 'org', role: 'owner' }],
      [{ repositoryId: 'repo', permission: 'admin' }],
    ];
    spyOn(db, 'select').mockImplementation(() => {
      const result = rows.shift();
      const builder = {
        from: () => builder,
        innerJoin: () => builder,
        where: () => Promise.resolve(result),
      };
      return builder as unknown as ReturnType<typeof db.select>;
    });
    expect(await filterAccessibleRepos([repo], { id: 'admin', role: 'admin' }, true)).toEqual([]);
  });
});
