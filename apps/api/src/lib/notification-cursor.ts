export interface NotificationCursor {
  timestamp: string;
  id: string;
}

export function encodeNotificationCursor(cursor: NotificationCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeNotificationCursor(value: string): NotificationCursor | null {
  if (value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const cursor: unknown = JSON.parse(Buffer.from(value, 'base64url').toString());
    if (!cursor || typeof cursor !== 'object') return null;
    const { timestamp, id } = cursor as Partial<NotificationCursor>;
    if (
      typeof timestamp !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}$/.test(timestamp) ||
      !Number.isFinite(Date.parse(timestamp + 'Z')) ||
      typeof id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    )
      return null;
    const date = new Date(timestamp + 'Z');
    if (date.getUTCFullYear() < 1 || date.toISOString().slice(0, 19) !== timestamp.slice(0, 19))
      return null;
    return { timestamp, id };
  } catch {
    return null;
  }
}
