import { describe, expect, it } from 'bun:test';
import {
  formatZodError,
  installBodySchema,
  migrationCreateBodySchema,
  updateEmailBodySchema,
  webhookCreateBodySchema,
} from '../../middleware/validate';
import { z } from 'zod';

describe('request validation schemas', () => {
  it('installBodySchema rejects unknown keys (strict)', () => {
    const r = installBodySchema.safeParse({
      name: 'Admin',
      username: 'adminuser',
      email: 'a@example.com',
      password: 'password123',
      role: 'superadmin',
    });
    expect(r.success).toBe(false);
  });

  it('installBodySchema accepts valid payload', () => {
    const r = installBodySchema.safeParse({
      name: 'Admin',
      username: 'adminuser',
      email: 'a@example.com',
      password: 'password123',
    });
    expect(r.success).toBe(true);
  });

  it('updateEmailBodySchema requires password', () => {
    expect(updateEmailBodySchema.safeParse({ email: 'a@b.com' }).success).toBe(false);
    expect(
      updateEmailBodySchema.safeParse({ email: 'a@b.com', password: 'x' }).success
    ).toBe(true);
  });

  it('webhookCreateBodySchema validates events and url', () => {
    expect(
      webhookCreateBodySchema.safeParse({
        url: 'https://example.com/hook',
        events: ['push'],
      }).success
    ).toBe(true);
    expect(
      webhookCreateBodySchema.safeParse({
        url: 'https://example.com/hook',
        events: ['not-an-event'],
      }).success
    ).toBe(false);
  });

  it('migrationCreateBodySchema is strict', () => {
    expect(
      migrationCreateBodySchema.safeParse({
        source: 'github',
        sourceOwner: 'o',
        sourceRepo: 'r',
        extra: true,
      }).success
    ).toBe(false);
  });

  it('formatZodError returns consistent shape', () => {
    const schema = z.object({ a: z.string() }).strict();
    const parsed = schema.safeParse({});
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const body = formatZodError(parsed.error);
      expect(body.error).toBe('Validation failed');
      expect(body.details.length).toBeGreaterThan(0);
      expect(body.details[0]).toHaveProperty('path');
      expect(body.details[0]).toHaveProperty('message');
    }
  });
});
