import {
  db,
  repositories,
  projects,
  projectColumns,
  projectItems,
  issues,
  pullRequests,
} from '@sigmagit/db';
import { createAuthenticatedFixture, fixtureRequest } from './auth-fixture';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';

export async function checkProjectAuthorization(baseURL: string) {
  const actor = await createAuthenticatedFixture('project-owner');
  const stranger = await createAuthenticatedFixture('project-stranger');
  const [repo] = await db
    .insert(repositories)
    .values({ ownerId: actor.user.id, name: 'board', visibility: 'public' })
    .returning();
  const [privateRepo] = await db
    .insert(repositories)
    .values({ ownerId: stranger.user.id, name: 'private-board', visibility: 'private' })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({ repositoryId: repo.id, name: 'Public project' })
    .returning();
  const [other] = await db
    .insert(projects)
    .values({ repositoryId: privateRepo.id, name: 'Private project' })
    .returning();
  const [column] = await db
    .insert(projectColumns)
    .values({ projectId: project.id, name: 'Todo', position: 0 })
    .returning();
  const [nextColumn] = await db
    .insert(projectColumns)
    .values({ projectId: project.id, name: 'Done', position: 1 })
    .returning();
  const [foreignColumn] = await db
    .insert(projectColumns)
    .values({ projectId: other.id, name: 'Secret', position: 0 })
    .returning();
  const [foreignIssue] = await db
    .insert(issues)
    .values({
      repositoryId: privateRepo.id,
      authorId: stranger.user.id,
      number: 1,
      title: 'PRIVATE_ISSUE_MARKER',
    })
    .returning();
  const [foreignPR] = await db
    .insert(pullRequests)
    .values({
      repositoryId: privateRepo.id,
      authorId: stranger.user.id,
      number: 1,
      title: 'PRIVATE_PR_MARKER',
      headRepoId: privateRepo.id,
      baseRepoId: privateRepo.id,
      headBranch: 'feature',
      baseBranch: 'main',
      headOid: 'a'.repeat(40),
      baseOid: 'b'.repeat(40),
    })
    .returning();
  const [ownIssue] = await db
    .insert(issues)
    .values({ repositoryId: repo.id, authorId: actor.user.id, number: 1, title: 'Public issue' })
    .returning();
  const call = (method: string, path: string, body?: unknown) =>
    fixtureRequest(baseURL, actor, method, path, body);
  const add = (body: unknown) => call('POST', `/api/projects/${project.id}/items`, body);
  assert.equal(
    (await add({ columnId: column.id, issueId: foreignIssue.id })).status,
    404,
    'private issue attached to a public board',
  );
  assert.equal((await add({ columnId: column.id, pullRequestId: foreignPR.id })).status, 404);
  assert.equal((await add({ columnId: foreignColumn.id, noteContent: 'Injected' })).status, 400);
  assert.equal(
    (await add({ columnId: column.id, issueId: ownIssue.id, noteContent: 'ambiguous' })).status,
    400,
  );
  assert.equal((await add({ columnId: 'bad-id', noteContent: 'invalid' })).status, 400);
  const added = await add({ columnId: column.id, issueId: ownIssue.id });
  assert.equal(added.status, 200);
  const item = (await added.json()) as { id: string; issue: { title: string } };
  assert.equal(item.issue.title, ownIssue.title);
  assert.equal(
    (await call('PATCH', `/api/projects/items/${item.id}`, { columnId: foreignColumn.id })).status,
    400,
  );
  assert.equal(
    (await call('PATCH', `/api/projects/items/${item.id}`, { position: -1 })).status,
    400,
  );
  assert.equal(
    (
      await call('PATCH', `/api/projects/items/${item.id}`, {
        columnId: nextColumn.id,
        position: 0,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call('POST', '/api/projects/items/reorder', {
        items: [{ id: item.id, columnId: column.id, position: -1 }],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call('POST', '/api/projects/items/reorder', {
        items: [{ id: item.id, columnId: column.id, position: 1 }],
      })
    ).status,
    200,
  );
  assert.equal(
    (await db.query.projectItems.findFirst({ where: eq(projectItems.id, item.id) }))?.columnId,
    column.id,
  );
  // Pre-existing corrupt references must also be filtered on read.
  await db.insert(projectItems).values([
    { projectId: project.id, columnId: column.id, issueId: foreignIssue.id, position: 2 },
    { projectId: project.id, columnId: column.id, pullRequestId: foreignPR.id, position: 3 },
    { projectId: other.id, columnId: column.id, noteContent: 'PRIVATE_NOTE_MARKER', position: 4 },
  ]);
  const read = await fetch(`${baseURL}/api/projects/${project.id}`);
  assert.equal(read.status, 200);
  const board = await read.text();
  assert(board.includes('Public issue'));
  assert(!board.includes('PRIVATE_'), 'legacy cross-repository project data leaked');
  console.log('PASS: project item writes and reads stay within their project and repository');
}
