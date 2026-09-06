import { parseLimit, parseOffset } from './validation';

export function listPage(query: Record<string, string | undefined>) {
  return {
    limit: parseLimit(query.limit, 30, 100),
    offset: Math.min(parseOffset(query.offset, 0), 2_147_483_647),
  };
}

export function pageResponse<K extends string, T>(key: K, rows: T[], limit: number, offset: number) {
  const hasMore = rows.length > limit;
  return {
    [key]: rows.slice(0, limit),
    hasMore,
    nextOffset: hasMore ? offset + limit : null,
  };
}
