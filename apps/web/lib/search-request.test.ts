import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../../packages/lib/src/api';

afterEach(() => vi.unstubAllGlobals());

describe('search request cancellation', () => {
  it('passes cancellation to fetch without adding it to the query string', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ results: [], total: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    const api = createApiClient({
      baseUrl: 'https://api.example.com',
      getAuthHeaders: () => Promise.resolve({}),
    });

    await api.search.query('hello world', { type: 'issues', limit: 10, signal: controller.signal });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/api/search?q=hello+world&type=issues&limit=10',
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it('rejects obsolete requests when the query observer cancels them', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
              once: true,
            });
            controller.abort(new DOMException('Search replaced', 'AbortError'));
          }),
      ),
    );
    const api = createApiClient({
      baseUrl: 'https://api.example.com',
      getAuthHeaders: () => Promise.resolve({}),
    });

    await expect(
      api.search.query('old query', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
