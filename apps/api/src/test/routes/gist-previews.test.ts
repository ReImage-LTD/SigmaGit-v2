import { GIST_PREVIEW_CHARACTERS, gistFilePreviewColumns } from '../../lib/gist-preview';
import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import type { AuthVariables } from '../../middleware/auth';
import { db, gistFiles } from '@sigmagit/db';
import gistRoutes from '../../routes/gists';
import { Hono } from 'hono';

afterEach(() => mock.restore());

const gist = { id: 'gist', ownerId: 'owner', visibility: 'public' };
const owner = { id: 'owner', username: 'alice' };
const file = {
  id: 'file',
  gistId: 'gist',
  filename: 'large.txt',
  size: 1_000_000,
  preview: 'x'.repeat(512),
};

function mockSelect(results: unknown[][]) {
  let next = 0;
  return spyOn(db, 'select').mockImplementation((() => {
    const result = results[next++];
    const builder = {
      from: () => builder,
      where: () => builder,
      orderBy: () => builder,
      limit: () => builder,
      offset: () => builder,
      then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(result).then(resolve),
    };
    return builder;
  }) as unknown as typeof db.select);
}

describe('gist list previews', () => {
  test('projects bounded SQL previews instead of full content', () => {
    const query = db.select(gistFilePreviewColumns).from(gistFiles).toSQL();
    expect(query.sql).toContain('left("content", $1)');
    expect(query.params).toContain(GIST_PREVIEW_CHARACTERS);
    expect(gistFilePreviewColumns).not.toHaveProperty('content');
    expect(query.sql.match(/"content"/g)).toHaveLength(1);
  });

  for (const scenario of [
    { path: '/api/gists', results: [[gist], [file]], previewQuery: 1 },
    { path: '/api/gists/public', results: [[gist], [file], [owner]], previewQuery: 1 },
    { path: '/api/users/alice/gists', results: [[owner], [gist], [file]], previewQuery: 2 },
  ]) {
    test(`${scenario.path} uses the preview projection`, async () => {
      const select = mockSelect(scenario.results);
      const app = new Hono<{ Variables: AuthVariables }>();
      app.use('*', async (c, next) => {
        c.set('user', { ...owner, name: 'Alice', email: 'a@example.com' });
        await next();
      });
      app.route('/', gistRoutes);
      const response = await app.request(scenario.path);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { gists: Array<{ files: Array<typeof file> }> };
      expect(body.gists[0].files[0]).toEqual(file);
      expect(body.gists[0].files[0]).not.toHaveProperty('content');
      expect(select.mock.calls[scenario.previewQuery][0]).toBe(gistFilePreviewColumns);
    });
  }

  test('detail requests retain complete contents for viewing and editing', async () => {
    const fullFile = { ...file, content: 'x'.repeat(1_000_000) };
    const select = mockSelect([[gist], [owner], [fullFile]]);
    const response = await gistRoutes.request('/api/gists/gist');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { files: Array<{ content: string }> };
    expect(body.files[0].content).toHaveLength(1_000_000);
    expect(select.mock.calls[2]).toHaveLength(0);
  });

  test('empty public pages do not query file bodies', async () => {
    const select = mockSelect([[]]);
    expect(await (await gistRoutes.request('/api/gists/public')).json()).toEqual({
      gists: [],
      hasMore: false,
    });
    expect(select).toHaveBeenCalledTimes(1);
  });
});
