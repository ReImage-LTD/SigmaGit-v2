import { describe, expect, it, beforeEach } from 'bun:test';
import {
  clearWsTicketsForTests,
  consumeWsTicket,
  issueWsTicket,
} from '../../security/ws-ticket';

describe('ws-ticket', () => {
  beforeEach(() => {
    clearWsTicketsForTests();
  });

  it('issues and consumes a ticket once', () => {
    const ticket = issueWsTicket('user-1', 'session-1', 30_000);
    expect(ticket.length).toBeGreaterThan(20);
    expect(ticket.split('.').length).toBe(5);

    const first = consumeWsTicket(ticket);
    expect(first?.userId).toBe('user-1');
    expect(first?.sessionId).toBe('session-1');
    expect(typeof first?.expiresAt).toBe('number');

    const second = consumeWsTicket(ticket);
    expect(second).toBeNull();
  });

  it('rejects empty tickets and tampering', () => {
    expect(consumeWsTicket('')).toBeNull();
    expect(consumeWsTicket('unknown')).toBeNull();
    const ticket = issueWsTicket('user-1', 'session-1', 30_000);
    const parts = ticket.split('.');
    parts[0] = 'other-user';
    expect(consumeWsTicket(parts.join('.'))).toBeNull();
  });

  it('rejects expired tickets', async () => {
    const ticket = issueWsTicket('user-1', 'session-1', 1);
    await new Promise((r) => setTimeout(r, 5));
    expect(consumeWsTicket(ticket)).toBeNull();
  });
});
