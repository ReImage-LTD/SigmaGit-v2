import { expect, test } from 'bun:test';
import { migrationCreateBodySchema } from '../middleware/validate';

test('imports accept explicit visibility and default options to private', () => {
  const input = { source: 'url', sourceUrl: 'https://example.test/repo.git', options: {} };
  expect(migrationCreateBodySchema.parse(input).options?.visibility).toBe('private');
  expect(migrationCreateBodySchema.parse({ ...input, options: { visibility: 'public' } }).options?.visibility).toBe('public');
  expect(migrationCreateBodySchema.safeParse({ ...input, options: { visibility: 'invalid' } }).success).toBe(false);
});
