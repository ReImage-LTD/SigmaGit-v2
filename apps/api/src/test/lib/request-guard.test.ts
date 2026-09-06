import { getClientIp, ingressRateLimit } from '../../middleware/rate-limit';
import { requestSizeMiddleware } from '../../middleware/limits';
import { createRequestGuard } from '../../lib/request-guard';
import type { AuthVariables } from '../../middleware/auth';
import { requestSignal } from '../../lib/request-context';
import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const req = (path = '/api/test') => new Request(`http://localhost${path}`);
const settings = { maxRest: 1, maxGit: 1, timeoutMs: 25, transferTimeoutMs: 40 };

describe('request lifetime accounting', () => {
  it('returns 504 and aborts the signal but retains capacity until unfinished work and its late body settle', async () => {
    const finish = deferred();
    let calls = 0;
    let lateCancelled = false;
    let signal: AbortSignal | undefined;
    const fetch = createRequestGuard(async (request) => {
      if (++calls > 1) return new Response('ok');
      signal = request.signal;
      expect(requestSignal()?.aborted).toBe(false);
      await finish.promise;
      return new Response(
        new ReadableStream({
          cancel() {
            lateCancelled = true;
          },
        }),
      );
    }, settings);
    expect((await fetch(req(), null))?.status).toBe(504);
    expect(signal?.aborted).toBe(true);
    const busy = await fetch(req(), null);
    expect(busy?.status).toBe(503);
    expect(busy?.headers.get('retry-after')).toBe('5');
    finish.resolve();
    await tick();
    expect(lateCancelled).toBe(true);
    expect(await (await fetch(req(), null))?.text()).toBe('ok');
    expect(requestSignal()).toBeUndefined();
  });

  it('holds streaming slots until cancellation finishes, without releasing twice', async () => {
    const cancelDone = deferred();
    let calls = 0;
    const fetch = createRequestGuard(
      () =>
        ++calls === 1
          ? new Response(new ReadableStream({ cancel: () => cancelDone.promise }))
          : new Response('ok'),
      { ...settings, timeoutMs: 1000 },
    );
    const stream = await fetch(req(), null);
    expect((await fetch(req(), null))?.status).toBe(503);
    const cancelling = stream!.body!.cancel();
    expect((await fetch(req(), null))?.status).toBe(503);
    cancelDone.resolve();
    await cancelling;
    expect(await (await fetch(req(), null))?.text()).toBe('ok');
  });

  it('cuts off response streams at the deadline and cancels upstream', async () => {
    let cancelled = false;
    const fetch = createRequestGuard(
      () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
        ),
      settings,
    );
    const response = await fetch(req(), null);
    await expect(response!.text()).rejects.toThrow('Request timeout');
    await tick();
    expect(cancelled).toBe(true);
    const next = await fetch(req(), null);
    expect(next?.status).toBe(200);
    await next?.body?.cancel();
  });

  it('enforces independent Git/REST slots and finite transfer deadlines', async () => {
    const fetch = createRequestGuard(() => new Response(new ReadableStream()), settings);
    const rest = await fetch(req(), null);
    const git = await fetch(req('/alice/repo.git/git-upload-pack'), null);
    expect(git?.status).toBe(200);
    expect((await fetch(req('/api/repositories/git-upload-pack/info'), null))?.status).toBe(503);
    await rest?.body?.cancel();
    await expect(git!.text()).rejects.toThrow('Request timeout');
  });

  it('cancels slow incoming bodies while protecting auth and body parsing work', async () => {
    let cancelled = false;
    const app = new Hono<{ Variables: AuthVariables }>();
    app.onError((_, c) => c.text('aborted', 400));
    app.use('*', requestSizeMiddleware);
    app.post('/api/test', async (c) => c.text(await c.req.text()));
    const fetch = createRequestGuard((request) => app.fetch(request), settings);
    const response = await fetch(
      new Request('http://localhost/api/test', {
        method: 'POST',
        body: new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
      }),
      null,
    );
    expect(response?.status).toBe(504);
    await tick();
    expect(cancelled).toBe(true);
  });

  it('releases after handler errors and skips already aborted requests', async () => {
    let calls = 0;
    const fetch = createRequestGuard(() => {
      if (++calls === 1) throw new Error('failure');
      return new Response('ok');
    }, settings);
    const abort = new AbortController();
    abort.abort();
    expect(
      (await fetch(new Request('http://localhost/api/test', { signal: abort.signal }), null))
        ?.status,
    ).toBe(408);
    expect(calls).toBe(0);
    await expect(fetch(req(), null)).rejects.toThrow('failure');
    expect(await (await fetch(req(), null))?.text()).toBe('ok');
  });

  it('retains the native peer identity through request cancellation and body wrappers', async () => {
    const original = new Request('http://localhost/api/test', { method: 'POST', body: 'test' });
    const app = new Hono<{ Variables: AuthVariables }>();
    app.use('*', ingressRateLimit);
    app.use('*', requestSizeMiddleware);
    app.post('/api/test', async (c) => {
      await c.req.text();
      return c.text(getClientIp(c));
    });
    const fetch = createRequestGuard(
      (request, _: null, native) =>
        app.fetch(request, {
          server: {
            requestIP: () => {
              expect(native).toBe(original);
              return { address: '203.0.113.222' };
            },
          },
        }),
      settings,
    );
    expect(await (await fetch(original, null))?.text()).toBe('203.0.113.222');
  });
});
