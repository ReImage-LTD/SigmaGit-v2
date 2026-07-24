import { describe, expect, it, beforeEach } from 'bun:test';
import {
  clearWsTicketsForTests,
  consumeWsTicket,
  issueWsTicket,
  peekWsTicketForTests,
} from '../../security/ws-ticket';

describe('ws-ticket', () => {
  beforeEach(() => {
    clearWsTicketsForTests();
  });

  it('issues and consumes a ticket once', () => {
    const ticket = issueWsTicket('user-1', 'session-1', 30_000);
    expect(ticket.length).toBeGreaterThan(20);
    expect(peekWsTicketForTests(ticket)?.userId).toBe('user-1');

    const first = consumeWsTicket(ticket);
    expect(first).toEqual({
      userId: 'user-1',
      sessionId: 'session-1',
      expiresAt: expect.any(Number),
    });

    const second = consumeWsTicket(ticket);
    expect(second).toBeNull();
  });

  it('rejects empty tickets', () => {
    expect(consumeWsTicket('')).toBeNull();
    expect(consumeWsTicket('unknown')).toBeNull();
  });

  it('rejects expired tickets', async () => {
    const ticket = issueWsTicket('user-1', 'session-1', 1);
    await new Promise((r) => setTimeout(r, 5));
    expect(consumeWsTicket(ticket)).toBeNull();
  });
});
