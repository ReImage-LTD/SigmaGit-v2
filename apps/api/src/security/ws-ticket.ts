/**
 * Short-lived single-use tickets for WebSocket auth.
 * Avoids putting long-lived session tokens in the URL query string.
 */

import { randomBytes } from 'node:crypto';

export interface WsTicketRecord {
  userId: string;
  sessionId: string;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 30_000;
const tickets = new Map<string, WsTicketRecord>();

let lastSweep = 0;

function sweepExpired(now: number = Date.now()) {
  if (now - lastSweep < 5_000) return;
  lastSweep = now;
  for (const [key, rec] of tickets) {
    if (rec.expiresAt <= now) tickets.delete(key);
  }
}

export function issueWsTicket(
  userId: string,
  sessionId: string,
  ttlMs: number = DEFAULT_TTL_MS
): string {
  sweepExpired();
  const ticket = randomBytes(32).toString('base64url');
  tickets.set(ticket, {
    userId,
    sessionId,
    expiresAt: Date.now() + ttlMs,
  });
  return ticket;
}

/**
 * Consume a ticket (single-use). Returns null if missing/expired.
 */
export function consumeWsTicket(ticket: string): WsTicketRecord | null {
  if (!ticket) return null;
  sweepExpired();
  const rec = tickets.get(ticket);
  if (!rec) return null;
  tickets.delete(ticket);
  if (rec.expiresAt <= Date.now()) return null;
  return rec;
}

/** Test helper: clear all tickets. */
export function clearWsTicketsForTests(): void {
  tickets.clear();
  lastSweep = 0;
}

/** Test helper: peek without consuming. */
export function peekWsTicketForTests(ticket: string): WsTicketRecord | undefined {
  return tickets.get(ticket);
}
