import { consumeWsTicket, issueWsTicket } from './security/ws-ticket';
import { requireAuth, type AuthVariables } from './middleware/auth';
import { getAllowedOrigins } from './config';
import { db, sessions } from '@sigmagit/db';
import type { ServerWebSocket } from 'bun';
import { eq, and, gt } from 'drizzle-orm';
import { Hono } from 'hono';

type WebSocketData = {
  userId: string;
  sessionId: string;
  timestamp: number;
  lastPing: number;
  messageCountWindowStart: number;
  messageCount: number;
};

const wsConnections = new Map<string, Set<ServerWebSocket<WebSocketData>>>();
const CONNECTION_TIMEOUT = 30 * 60 * 1000;
const PING_INTERVAL = 5 * 60 * 1000;

/** Per-user concurrent WS connections */
export const WS_MAX_CONNECTIONS_PER_USER = 5;
/** Max inbound message size (bytes) */
export const WS_MAX_MESSAGE_BYTES = 64 * 1024;
/** Max messages per window */
export const WS_MAX_MESSAGES_PER_WINDOW = 120;
export const WS_MESSAGE_WINDOW_MS = 60_000;

let cleanupInterval: NodeJS.Timeout | null = null;

function startCleanupInterval() {
  if (cleanupInterval) return;

  cleanupInterval = setInterval(() => {
    cleanupStaleConnections();
  }, PING_INTERVAL);
}

function cleanupStaleConnections() {
  const now = Date.now();
  let cleaned = 0;

  for (const [userId, connections] of wsConnections.entries()) {
    for (const ws of connections) {
      if (now - ws.data.lastPing > CONNECTION_TIMEOUT) {
        console.log(`[WS] Closing stale connection for user ${userId}`);
        try {
          ws.close();
        } catch (err) {
          console.error('[WS] Error closing stale connection:', err);
        }
        connections.delete(ws);
        cleaned++;
      }
    }

    if (connections.size === 0) {
      wsConnections.delete(userId);
    }
  }

  if (cleaned > 0) {
    console.log(`[WS] Cleaned up ${cleaned} stale connections`);
  }
}

startCleanupInterval();

export function registerConnection(userId: string, ws: ServerWebSocket<WebSocketData>) {
  if (!wsConnections.has(userId)) {
    wsConnections.set(userId, new Set());
  }
  wsConnections.get(userId)!.add(ws);
}

export function unregisterConnection(userId: string, ws: ServerWebSocket<WebSocketData>) {
  const connections = wsConnections.get(userId);
  if (connections) {
    connections.delete(ws);
    if (connections.size === 0) {
      wsConnections.delete(userId);
    }
  }
}

/** Close all sockets for a user (e.g. session revoke / password reset). */
export function closeUserConnections(userId: string, reason = 'session_revoked'): number {
  const connections = wsConnections.get(userId);
  if (!connections) return 0;
  let n = 0;
  for (const ws of connections) {
    try {
      ws.close(4001, reason);
      n++;
    } catch {
      /* ignore */
    }
  }
  wsConnections.delete(userId);
  return n;
}

/** Close sockets bound to a specific session id. */
export function closeSessionConnections(sessionId: string, reason = 'session_revoked'): number {
  let n = 0;
  for (const [userId, connections] of wsConnections.entries()) {
    for (const ws of [...connections]) {
      if (ws.data.sessionId === sessionId) {
        try {
          ws.close(4001, reason);
          connections.delete(ws);
          n++;
        } catch {
          /* ignore */
        }
      }
    }
    if (connections.size === 0) wsConnections.delete(userId);
  }
  return n;
}

export function notifyUser(userId: string, message: object) {
  const connections = wsConnections.get(userId);
  if (connections) {
    const payload = JSON.stringify(message);
    for (const ws of connections) {
      try {
        ws.send(payload);
      } catch (err) {
        console.error('[WS] Failed to send message:', err);
        connections.delete(ws);
      }
    }
  }
}

export function notifyUsers(userIds: string[], message: object) {
  for (const userId of userIds) {
    notifyUser(userId, message);
  }
}

export function getConnectedUserCount(): number {
  return wsConnections.size;
}

export function isUserConnected(userId: string): boolean {
  return wsConnections.has(userId) && wsConnections.get(userId)!.size > 0;
}

export function isAllowedWsOrigin(origin: string | null): boolean {
  if (!origin) return false;
  return getAllowedOrigins().includes(origin);
}

/**
 * Issue a short-lived single-use ticket for WebSocket upgrade.
 */
export const wsTicketRoutes = new Hono<{ Variables: AuthVariables }>();

wsTicketRoutes.post('/api/ws-ticket', requireAuth, async (c) => {
  const user = c.get('user')!;
  const session = c.get('session') as {
    session?: { id?: string };
    id?: string;
  } | null;
  const sessionId =
    session?.session?.id ?? (typeof session?.id === 'string' ? session.id : user.id);

  const existing = wsConnections.get(user.id)?.size ?? 0;
  if (existing >= WS_MAX_CONNECTIONS_PER_USER) {
    return c.json({ error: 'Too many WebSocket connections' }, 429);
  }

  const ticket = issueWsTicket(user.id, sessionId);
  return c.json({ ticket, expiresIn: 30 });
});

export async function handleWebSocketUpgrade(
  request: Request,
  server: any,
): Promise<Response | undefined> {
  const url = new URL(request.url);

  if (url.pathname !== '/ws') {
    return undefined;
  }

  const origin = request.headers.get('origin');
  if (origin && !isAllowedWsOrigin(origin)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  // Non-browser clients may omit Origin; ticket auth still required.

  const ticket = url.searchParams.get('ticket');
  if (!ticket) {
    return new Response(
      JSON.stringify({
        error: 'Unauthorized',
        message: 'Use POST /api/ws-ticket then connect with ?ticket=',
      }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  try {
    const redeemed = consumeWsTicket(ticket);
    if (!redeemed) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Tickets are bound to the issuing session only — no fallback to any session.
    const session = await db.query.sessions.findFirst({
      where: and(
        eq(sessions.id, redeemed.sessionId),
        eq(sessions.userId, redeemed.userId),
        gt(sessions.expiresAt, new Date()),
      ),
      columns: {
        id: true,
        userId: true,
      },
    });

    if (!session) {
      return new Response('Unauthorized', { status: 401 });
    }

    const userId = session.userId;
    const sessionId = session.id;

    const current = wsConnections.get(userId)?.size ?? 0;
    if (current >= WS_MAX_CONNECTIONS_PER_USER) {
      return new Response(JSON.stringify({ error: 'Too many connections' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const upgraded = server.upgrade(request, {
      data: {
        userId,
        sessionId,
        timestamp: Date.now(),
        lastPing: Date.now(),
        messageCountWindowStart: Date.now(),
        messageCount: 0,
      } satisfies WebSocketData,
    });

    if (upgraded) {
      return undefined;
    }

    return new Response('WebSocket upgrade failed', { status: 500 });
  } catch (err) {
    console.error('[WS] Auth error:', err);
    return new Response('Unauthorized', { status: 401 });
  }
}

function allowMessage(ws: ServerWebSocket<WebSocketData>, raw: string | Buffer): boolean {
  const size = typeof raw === 'string' ? Buffer.byteLength(raw) : raw.byteLength;
  if (size > WS_MAX_MESSAGE_BYTES) {
    return false;
  }

  const now = Date.now();
  if (now - ws.data.messageCountWindowStart > WS_MESSAGE_WINDOW_MS) {
    ws.data.messageCountWindowStart = now;
    ws.data.messageCount = 0;
  }
  ws.data.messageCount += 1;
  if (ws.data.messageCount > WS_MAX_MESSAGES_PER_WINDOW) {
    return false;
  }
  return true;
}

export const websocketHandlers = {
  open(ws: ServerWebSocket<WebSocketData>) {
    const { userId } = ws.data;
    ws.data.lastPing = Date.now();
    registerConnection(userId, ws);

    ws.send(JSON.stringify({ type: 'connected', userId }));
  },

  message(ws: ServerWebSocket<WebSocketData>, message: string | Buffer) {
    if (!allowMessage(ws, message)) {
      try {
        ws.close(1009, 'message_limit');
      } catch {
        /* ignore */
      }
      return;
    }

    // Bound JSON parse input
    const text = typeof message === 'string' ? message : message.toString('utf8');
    if (text.length > WS_MAX_MESSAGE_BYTES) {
      try {
        ws.close(1009, 'message_too_large');
      } catch {
        /* ignore */
      }
      return;
    }

    try {
      const data = JSON.parse(text) as { type?: string };

      if (data?.type === 'ping') {
        ws.data.lastPing = Date.now();
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch {
      // Invalid JSON — ignore without throwing
    }
  },

  close(ws: ServerWebSocket<WebSocketData>) {
    const { userId } = ws.data;
    unregisterConnection(userId, ws);
  },

  error(ws: ServerWebSocket<WebSocketData>, error: Error) {
    console.error('[WS] Error:', error);
    const { userId } = ws.data;
    unregisterConnection(userId, ws);
  },
};
