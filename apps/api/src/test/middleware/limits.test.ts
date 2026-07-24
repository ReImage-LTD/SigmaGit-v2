import { describe, expect, it } from 'bun:test';
import { evaluateRequestSizeLimit, GIT_PUSH_SIZE_LIMIT } from '../../middleware/limits';

describe('evaluateRequestSizeLimit', () => {
  it('allows small Content-Length', () => {
    const r = evaluateRequestSizeLimit({
      method: 'POST',
      path: '/api/settings',
      contentLength: '100',
    });
    expect(r.allowed).toBe(true);
  });

  it('rejects oversized Content-Length', () => {
    const r = evaluateRequestSizeLimit({
      method: 'POST',
      path: '/api/settings',
      contentLength: String(200 * 1024 * 1024),
    });
    expect(r.allowed).toBe(false);
    expect(r.status).toBe(413);
  });

  it('rejects git push over pack limit', () => {
    const r = evaluateRequestSizeLimit({
      method: 'POST',
      path: '/alice/repo.git/git-receive-pack',
      contentLength: String(GIT_PUSH_SIZE_LIMIT + 1),
    });
    expect(r.allowed).toBe(false);
    // Pack limit equals MAX_REQUEST_SIZE; either message is a hard reject.
    expect(r.status).toBe(413);
  });

  it('rejects chunked non-git requests without Content-Length', () => {
    const r = evaluateRequestSizeLimit({
      method: 'POST',
      path: '/api/migrations',
      contentLength: null,
      transferEncoding: 'chunked',
    });
    expect(r.allowed).toBe(false);
    expect(r.status).toBe(411);
  });

  it('allows DELETE without Content-Length (no body)', () => {
    const r = evaluateRequestSizeLimit({
      method: 'DELETE',
      path: '/api/settings/account',
      contentLength: null,
    });
    expect(r.allowed).toBe(true);
  });

  it('allows git-receive-pack without Content-Length (streaming)', () => {
    const r = evaluateRequestSizeLimit({
      method: 'POST',
      path: '/alice/repo.git/git-receive-pack',
      contentLength: null,
      transferEncoding: 'chunked',
    });
    expect(r.allowed).toBe(true);
  });
});
