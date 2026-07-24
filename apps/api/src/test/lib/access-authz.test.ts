import { describe, expect, it } from 'bun:test';
import {
  evaluateRepoAccessFromFacts,
  type RepoAccessFacts,
  type Repository,
} from '../../lib/access';
import { authorizeRepositoryAccess } from '../../lib/authz';

const publicRepo: Repository = {
  id: 'r1',
  ownerId: 'owner',
  organizationId: null,
  visibility: 'public',
};

const privateRepo: Repository = {
  id: 'r2',
  ownerId: 'owner',
  organizationId: null,
  visibility: 'private',
};

const orgPrivate: Repository = {
  id: 'r3',
  ownerId: 'owner',
  organizationId: 'org1',
  visibility: 'private',
};

const emptyFacts: RepoAccessFacts = {
  collaboratorPermission: null,
  orgRole: null,
  teamPermission: null,
};

describe('evaluateRepoAccessFromFacts (table-driven)', () => {
  const cases: Array<{
    name: string;
    repo: Repository;
    user: { id: string; role?: string } | null;
    facts: RepoAccessFacts | null;
    write: boolean;
    expected: boolean;
  }> = [
    {
      name: 'anonymous can read public',
      repo: publicRepo,
      user: null,
      facts: null,
      write: false,
      expected: true,
    },
    {
      name: 'anonymous cannot read private',
      repo: privateRepo,
      user: null,
      facts: null,
      write: false,
      expected: false,
    },
    {
      name: 'anonymous cannot write public',
      repo: publicRepo,
      user: null,
      facts: null,
      write: true,
      expected: false,
    },
    {
      name: 'owner can write',
      repo: privateRepo,
      user: { id: 'owner' },
      facts: emptyFacts,
      write: true,
      expected: true,
    },
    {
      name: 'platform admin can read private',
      repo: privateRepo,
      user: { id: 'admin1', role: 'admin' },
      facts: emptyFacts,
      write: false,
      expected: true,
    },
    {
      name: 'platform admin cannot write without collab',
      repo: privateRepo,
      user: { id: 'admin1', role: 'admin' },
      facts: emptyFacts,
      write: true,
      expected: false,
    },
    {
      name: 'read collaborator can read private',
      repo: privateRepo,
      user: { id: 'u1' },
      facts: { ...emptyFacts, collaboratorPermission: 'read' },
      write: false,
      expected: true,
    },
    {
      name: 'read collaborator cannot write',
      repo: privateRepo,
      user: { id: 'u1' },
      facts: { ...emptyFacts, collaboratorPermission: 'read' },
      write: true,
      expected: false,
    },
    {
      name: 'write collaborator can write',
      repo: privateRepo,
      user: { id: 'u1' },
      facts: { ...emptyFacts, collaboratorPermission: 'write' },
      write: true,
      expected: true,
    },
    {
      name: 'admin collaborator can write',
      repo: privateRepo,
      user: { id: 'u1' },
      facts: { ...emptyFacts, collaboratorPermission: 'admin' },
      write: true,
      expected: true,
    },
    {
      name: 'org owner can access org private',
      repo: orgPrivate,
      user: { id: 'u1' },
      facts: { ...emptyFacts, orgRole: 'owner' },
      write: true,
      expected: true,
    },
    {
      name: 'org admin can access org private',
      repo: orgPrivate,
      user: { id: 'u1' },
      facts: { ...emptyFacts, orgRole: 'admin' },
      write: false,
      expected: true,
    },
    {
      name: 'org member cannot access private org repo without team/collab',
      repo: orgPrivate,
      user: { id: 'u1' },
      facts: { ...emptyFacts, orgRole: 'member' },
      write: false,
      expected: false,
    },
    {
      name: 'team write permission grants write',
      repo: privateRepo,
      user: { id: 'u1' },
      facts: { ...emptyFacts, teamPermission: 'write' },
      write: true,
      expected: true,
    },
    {
      name: 'team read cannot write',
      repo: privateRepo,
      user: { id: 'u1' },
      facts: { ...emptyFacts, teamPermission: 'read' },
      write: true,
      expected: false,
    },
    {
      name: 'moderator without membership cannot read private',
      repo: privateRepo,
      user: { id: 'mod1', role: 'moderator' },
      facts: emptyFacts,
      write: false,
      expected: false,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(evaluateRepoAccessFromFacts(c.repo, c.user, c.facts, c.write)).toBe(c.expected);
    });
  }
});

describe('authorizeRepositoryAccess', () => {
  it('returns 404 for missing repo', async () => {
    const r = await authorizeRepositoryAccess(null, { id: 'u1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
  });
});
