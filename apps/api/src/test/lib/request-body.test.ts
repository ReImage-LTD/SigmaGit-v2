import { describe, expect, it } from 'bun:test';
import {
  BodyTooLargeError,
  readBodyLimited,
  readJsonLimited,
  readRequestBodyLimited,
  RequestBodyTooLargeError,
} from '../../lib/request-body';

describe('readRequestBodyLimited', () => {
  it('reads small bodies', async () => {
    const req = new Request('http://localhost/x', {
      method: 'POST',
      body: 'hello',
      headers: { 'content-length': '5' },
    });
    const buf = await readRequestBodyLimited(req, 100);
    expect(buf.toString()).toBe('hello');
  });

  it('rejects when Content-Length exceeds max', async () => {
    const req = new Request('http://localhost/x', {
      method: 'POST',
      body: 'x'.repeat(10),
      headers: { 'content-length': '10' },
    });
    await expect(readRequestBodyLimited(req, 5)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError
    );
  });

  it('readBodyLimited returns ArrayBuffer', async () => {
    const req = new Request('http://localhost/x', {
      method: 'POST',
      body: 'ab',
      headers: { 'content-length': '2' },
    });
    const buf = await readBodyLimited(req, 100);
    expect(new TextDecoder().decode(buf)).toBe('ab');
  });

  it('parses limited JSON', async () => {
    const body = JSON.stringify({ a: 1 });
    const req = new Request('http://localhost/x', {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json',
        'content-length': String(body.length),
      },
    });
    const data = await readJsonLimited<{ a: number }>(req, 100);
    expect(data.a).toBe(1);
  });

  it('BodyTooLargeError aliases RequestBodyTooLargeError', () => {
    expect(BodyTooLargeError).toBe(RequestBodyTooLargeError);
  });
});
