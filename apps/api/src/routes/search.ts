import { Hono } from 'hono';
import { db } from '@sigmagit/db';
import type { AuthVariables } from '../middleware/auth';
import { parseLimit, parseOffset } from '../lib/validation';
import { buildSearchQuery, SEARCH_TYPES } from '../lib/search-query';

const app = new Hono<{ Variables: AuthVariables }>();

app.get('/api/search', async (c) => {
  const query = c.req.query('q')?.trim();
  const type = c.req.query('type') || 'all';
  const limit = parseLimit(c.req.query('limit'), 20, 50);
  const offset = parseOffset(c.req.query('offset'), 0);
  if (!query || query.length < 2) {
    return c.json({ results: [], hasMore: false, total: 0 });
  }
  if (!SEARCH_TYPES.includes(type) || query.length > 500 || !Number.isSafeInteger(offset) || offset > 10000) {
    return c.json({ error: 'Invalid search type, query length or offset (maximum 10000)' }, 400);
  }
  const rows = await db.execute(buildSearchQuery(query, type, limit, offset, c.get('user')));
  return c.json({ results: rows.slice(0, limit), hasMore: rows.length > limit, query });
});

export default app;
