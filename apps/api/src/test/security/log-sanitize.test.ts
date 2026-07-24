import { describe, expect, it } from 'bun:test';
import { sanitizeQueryForLog } from '../../lib/log-sanitize';

describe('sanitizeQueryForLog', () => {
  it('redacts token-like query params', () => {
    const q = sanitizeQueryForLog('?token=supersecret&page=1');
    expect(q).toContain('%5BREDACTED%5D');
    expect(q).not.toContain('supersecret');
    expect(q).toContain('page=1');
  });

  it('redacts password, secret, ticket, api_key', () => {
    const q = sanitizeQueryForLog(
      '?password=p1&secret=s1&ticket=t1&api_key=k1&access_token=a1'
    );
    expect(q).not.toContain('p1');
    expect(q).not.toContain('s1');
    expect(q).not.toContain('t1');
    expect(q).not.toContain('k1');
    expect(q).not.toContain('a1');
  });

  it('returns empty for no query', () => {
    expect(sanitizeQueryForLog('')).toBe('');
  });
});
