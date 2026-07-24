import type { ServerWebSocket } from "bun";
import { db, sessions } from "@sigmagit/db";
import { eq, and, gt } from "drizzle-orm";
import { consumeWsTicket, issueWsTicket } from "./security/ws-ticket";
import { Hono } from "hono";
import { requireAuth, type AuthVariables } from "./middleware/auth";

type WebSocketData = {
  userId: string;
  sessionId: string;
  timestamp: number;
  lastPing: number;
};

const wsConnections = new Map<string, Set<ServerWebSocket<WebSocketData>>>();
const CONNECTION_TIMEOUT = 30 * 60 * 1000;
const PING_INTERVAL = 5 * 60 * 1000;

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
          console.error("[WS] Error closing stale connection:", err);
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

export function notifyUser(userId: string, message: object) {
  const connections = wsConnections.get(userId);
  if (connections) {
    const payload = JSON.stringify(message);
    for (const ws of connections) {
      try {
        ws.send(payload);
      } catch (err) {
        console.error("[WS] Failed to send message:", err);
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

/**
 * Issue a short-lived single-use ticket for WebSocket upgrade.
 * Clients must not put long-lived session tokens in the URL.
 */
export const wsTicketRoutes = new Hono<{ Variables: AuthVariables }>();

wsTicketRoutes.post("/api/ws-ticket", requireAuth, async (c) => {
  const user = c.get("user")!;
  const session = c.get("session") as {
    session?: { id?: string };
    id?: string;
  } | null;
  const sessionId =
    session?.session?.id ?? (typeof session?.id === "string" ? session.id : user.id);

  const ticket = issueWsTicket(user.id, sessionId);
  return c.json({ ticket, expiresIn: 30 });
});

export async function handleWebSocketUpgrade(
  request: Request,
  server: any
): Promise<Response | undefined> {
  const url = new URL(request.url);

  if (url.pathname !== "/ws") {
    return undefined;
  }

  // Prefer short-lived ticket. Legacy session token query is rejected.
  const ticket = url.searchParams.get("ticket");
  if (!ticket) {
    return new Response(
      JSON.stringify({
        error: "Unauthorized",
        message: "Use POST /api/ws-ticket then connect with ?ticket=",
      }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const redeemed = consumeWsTicket(ticket);
    if (!redeemed) {
      return new Response("Unauthorized", { status: 401 });
    }

    // Confirm the session is still valid at upgrade time.
    const session = await db.query.sessions.findFirst({
      where: and(
        eq(sessions.id, redeemed.sessionId),
        eq(sessions.userId, redeemed.userId),
        gt(sessions.expiresAt, new Date())
      ),
      columns: {
        id: true,
        userId: true,
      },
    });

    // If session id was a fallback user id (edge case), still allow ticket user.
    const userId = session?.userId ?? redeemed.userId;
    const sessionId = session?.id ?? redeemed.sessionId;

    if (session && session.userId !== redeemed.userId) {
      return new Response("Unauthorized", { status: 401 });
    }

    // When we have a real session row mismatch (expired), reject.
    if (!session) {
      // Ticket may have used session.id — verify user still has any valid session.
      const anySession = await db.query.sessions.findFirst({
        where: and(eq(sessions.userId, redeemed.userId), gt(sessions.expiresAt, new Date())),
        columns: { id: true, userId: true },
      });
      if (!anySession) {
        return new Response("Unauthorized", { status: 401 });
      }
    }

    const upgraded = server.upgrade(request, {
      data: {
        userId,
        sessionId,
        timestamp: Date.now(),
        lastPing: Date.now(),
      },
    });

    if (upgraded) {
      return undefined;
    }

    return new Response("WebSocket upgrade failed", { status: 500 });
  } catch (err) {
    console.error("[WS] Auth error:", err);
    return new Response("Unauthorized", { status: 401 });
  }
}

export const websocketHandlers = {
  open(ws: ServerWebSocket<WebSocketData>) {
    const { userId } = ws.data;
    ws.data.lastPing = Date.now();
    registerConnection(userId, ws);

    ws.send(JSON.stringify({ type: "connected", userId }));
  },

  message(ws: ServerWebSocket<WebSocketData>, message: string | Buffer) {
    try {
      const data = JSON.parse(message.toString());

      if (data.type === "ping") {
        ws.data.lastPing = Date.now();
        ws.send(JSON.stringify({ type: "pong" }));
      }
    } catch (err) {
      console.error("[WS] Invalid message:", err);
    }
  },

  close(ws: ServerWebSocket<WebSocketData>) {
    const { userId } = ws.data;
    unregisterConnection(userId, ws);
  },

  error(ws: ServerWebSocket<WebSocketData>, error: Error) {
    console.error("[WS] Error:", error);
    const { userId } = ws.data;
    unregisterConnection(userId, ws);
  },
};
