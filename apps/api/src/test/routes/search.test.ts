import { afterEach, describe, expect, test, mock, spyOn } from 'bun:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import { db } from '@sigmagit/db';
import searchRoutes from '../../routes/search';
import { buildSearchQuery, readableRepositoryCondition } from '../../lib/search-query';

afterEach(() => mock.restore());
const dialect = new PgDialect();
describe('search pagination', () => {
  test('uses a single global page and lookahead for every category', () => {
    for (const type of ['all', 'repos', 'issues', 'prs', 'users']) {
      const compiled = dialect.sqlToQuery(buildSearchQuery('needle', type, 20, 40, null));
      expect(compiled.params.slice(-2)).toEqual([21, 40]);
      expect(compiled.sql.match(/LIMIT/g)?.length).toBe(1);
      expect(compiled.sql).toContain('ORDER BY results."createdAt" DESC, type ASC, id ASC');
      if (type === 'all') expect(compiled.sql.match(/UNION ALL/g)?.length).toBe(3);
    }
  });
  test('filters access within repository queries before pagination', () => {
    const anonymous = dialect.sqlToQuery(buildSearchQuery('needle', 'all', 20, 0, null));
    expect(anonymous.sql.match(/"repositories"\."visibility" = 'public'/g)?.length).toBe(3);
    const member = dialect.sqlToQuery(readableRepositoryCondition({id: 'viewer'}));
    expect(member.sql).toContain('EXISTS');
    expect(member.sql).toContain("IN ('owner', 'admin')");
    expect(member.sql).toContain('"team_members"');
    expect(member.params.every(value => value === 'viewer')).toBe(true);
    expect(dialect.sqlToQuery(readableRepositoryCondition({id: 'admin', role: 'admin'})).sql).toBe('true');
  });
  test('returns lookahead without including it in the page', async () => {
    const rows = [{id: 'one'}, {id: 'two'}, {id: 'three'}];
    const execute = spyOn(db, 'execute').mockImplementation((async () => rows) as unknown as typeof db.execute);
    const response = await searchRoutes.request('/api/search?q=needle&type=issues&limit=2&offset=4');
    expect(await response.json()).toEqual({results: rows.slice(0, 2), hasMore: true, query: 'needle'});
    expect(execute).toHaveBeenCalledTimes(1);
  });
  test('rejects excessive offsets without querying the database', async () => {
    const execute = spyOn(db, 'execute');
    for (const offset of ['10001', '9999999999999999999999']) {
      expect((await searchRoutes.request('/api/search?q=needle&offset=' + offset)).status).toBe(400);
    }
    expect(execute).not.toHaveBeenCalled();
  });
});
