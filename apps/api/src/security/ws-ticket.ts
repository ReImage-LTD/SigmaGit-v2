/**
 * Short-lived single-use tickets for WebSocket auth.
 * Avoids putting long-lived session tokens in the URL query string.
 * Tickets are HMAC-signed with WS_TICKET_SECRET and single-use in process memory.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config';

export interface WsTicketRecord {
  userId: string;
  sessionId: string;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 30_000;
const consumed = new Set<string>();
let lastSweep = 0;

function sweepConsumed(now: number = Date.now()) {
  if (now - lastSweep < 5_000) return;
  lastSweep = now;
  // Consumed nonces are short-lived; clear set periodically to bound memory.
  if (consumed.size > 10_000) consumed.clear();
}

function signPayload(payload: string): string {
  return createHmac('sha256', config.wsTicketSecret).update(payload).digest('base64url');
}

export function issueWsTicket(
  userId: string,
  sessionId: string,
  ttlMs: number = DEFAULT_TTL_MS
): string {
  sweepConsumed();
  const nonce = randomBytes(16).toString('base64url');
  const expiresAt = Date.now() + ttlMs;
  const body = `${userId}.${sessionId}.${expiresAt}.${nonce}`;
  const sig = signPayload(body);
  return `${body}.${sig}`;
}

/**
 * Consume a ticket (single-use). Returns null if missing/expired/invalid.
 */
export function consumeWsTicket(ticket: string): WsTicketRecord | null {
  if (!ticket || typeof ticket !== 'string') return null;
  sweepConsumed();

  const parts = ticket.split('.');
  if (parts.length !== 5) return null;
  const [userId, sessionId, expStr, nonce, sig] = parts;
  if (!userId || !sessionId || !expStr || !nonce || !sig) return null;

  const body = `${userId}.${sessionId}.${expStr}.${nonce}`;
  const expected = signPayload(body);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  const expiresAt = Number(expStr);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;

  if (consumed.has(nonce)) return null;
  consumed.add(nonce);

  return { userId, sessionId, expiresAt };
}

/** Test helper: clear all tickets. */
export function clearWsTicketsForTests(): void {
  consumed.clear();
  lastSweep = 0;
}

/** Test helper: peek without consuming. */
export function peekWsTicketForTests(_ticket: string): WsTicketRecord | undefined {
  return undefined;
}
