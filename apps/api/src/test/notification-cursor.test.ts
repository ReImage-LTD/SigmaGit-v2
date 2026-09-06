import { expect, it } from 'bun:test';
import { decodeNotificationCursor, encodeNotificationCursor } from '../lib/notification-cursor';

it('preserves notification timestamp microseconds and rejects malformed cursors', () => {
  const cursor = { timestamp: '2026-09-06T12:00:00.123456', id: crypto.randomUUID() };
  expect(decodeNotificationCursor(encodeNotificationCursor(cursor))).toEqual(cursor);
  for (const invalid of ['', '!', 'a'.repeat(257), Buffer.from('{}').toString('base64url')]) {
    expect(decodeNotificationCursor(invalid)).toBeNull();
  }
});
