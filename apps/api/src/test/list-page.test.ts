import { expect, it } from 'bun:test';
import { listPage, pageResponse } from '../lib/list-page';

it('bounds list sizes and offsets from untrusted query strings', () => {
  expect(listPage({})).toEqual({ limit: 30, offset: 0 });
  expect(listPage({ limit: '999999', offset: '-1' })).toEqual({ limit: 100, offset: 0 });
  expect(listPage({ limit: '-1', offset: '9'.repeat(400) })).toEqual({ limit: 30, offset: 2147483647 });
});

it('removes the lookahead row and exposes a continuation only when needed', () => {
  expect(pageResponse('rows', [1, 2, 3], 2, 10)).toEqual({ rows: [1, 2], hasMore: true, nextOffset: 12 });
  expect(pageResponse('rows', [3], 2, 12)).toEqual({ rows: [3], hasMore: false, nextOffset: null });
  expect(pageResponse('rows', [], 2, 100)).toEqual({ rows: [], hasMore: false, nextOffset: null });
});
