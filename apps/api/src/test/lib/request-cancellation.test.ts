import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { createRequestGuard } from '../../lib/request-guard';
import { guardedFetch } from '../../security/ssrf';
import { S3StorageBackend } from '../../storage';
import { S3Client } from '@aws-sdk/client-s3';

afterEach(() => mock.restore());
const limits = { maxRest: 1, maxGit: 1, timeoutMs: 25 };
const request = () => new Request('http://localhost/api/test');
const storage = () =>
  new S3StorageBackend({
    endpoint: 'https://s3.example',
    region: 'us-east-1',
    bucket: 'bucket',
    accessKeyId: 'test',
    secretAccessKey: 'test',
  });

describe('request cancellation propagation', () => {
  it('cancels S3 storage during a pending read after delivering a chunk', async () => {
    let cancellations = 0;
    let receivedReason: unknown;
    const pulled = Promise.withResolvers<void>();
    let reads = 0;
    spyOn(S3Client.prototype, 'send').mockImplementation((async () => ({
      Body: {
        transformToWebStream: () =>
          new ReadableStream<Uint8Array>(
            {
              pull(controller) {
                if (reads++ === 0) controller.enqueue(new Uint8Array([1, 2, 3]));
                else pulled.resolve();
              },
              cancel(reason) {
                cancellations++;
                receivedReason = reason;
                // A failing transport cleanup must not replace the cancellation error.
                return Promise.reject(new Error('transport cleanup failed'));
              },
            },
            { highWaterMark: 0 },
          ),
      },
    })) as unknown as typeof S3Client.prototype.send);
    const caller = new AbortController();
    const stream = await storage().getStream('key', caller.signal);
    const reader = stream!.getReader();
    expect((await reader.read()).value).toEqual(new Uint8Array([1, 2, 3]));
    const next = reader.read();
    await pulled.promise;
    const reason = new Error('client disconnected');
    caller.abort(reason);
    await expect(next).rejects.toThrow('client disconnected');
    await expect(reader.read()).rejects.toThrow('client disconnected');
    expect(receivedReason).toBe(reason);
    expect(cancellations).toBe(1);
  });

  it('combines the HTTP deadline with a guarded fetch caller signal', async () => {
    let observed: AbortSignal | null | undefined;
    spyOn(globalThis, 'fetch').mockImplementation(((_input: unknown, init?: RequestInit) => {
      observed = init?.signal;
      return new Promise<Response>((_, reject) =>
        observed?.addEventListener('abort', () => reject(observed?.reason), { once: true }),
      );
    }) as typeof fetch);
    const caller = new AbortController();
    const run = createRequestGuard(async () => {
      await guardedFetch('https://93.184.216.34/', { signal: caller.signal });
      return new Response('unexpected');
    }, limits);
    expect((await run(request(), null))?.status).toBe(504);
    expect(observed?.aborted).toBe(true);
    expect(caller.signal.aborted).toBe(false);
  });

  it('passes the deadline to S3 SDK operations', async () => {
    let observed: AbortSignal | undefined;
    spyOn(S3Client.prototype, 'send').mockImplementation(((
      _command: unknown,
      options: { abortSignal: AbortSignal },
    ) => {
      observed = options.abortSignal;
      return new Promise((_, reject) =>
        observed?.addEventListener('abort', () => reject(observed?.reason), { once: true }),
      );
    }) as unknown as typeof S3Client.prototype.send);
    const backend = storage();
    const run = createRequestGuard(async () => {
      await backend.put('key', 'data');
      return new Response('unexpected');
    }, limits);
    expect((await run(request(), null))?.status).toBe(504);
    expect(observed?.aborted).toBe(true);
  });

  it('cancels a stalled S3 response body after its headers have arrived', async () => {
    let cancelled = false;
    spyOn(S3Client.prototype, 'send').mockImplementation((async () => ({
      Body: {
        transformToWebStream: () =>
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
      },
    })) as unknown as typeof S3Client.prototype.send);
    const backend = storage();
    const run = createRequestGuard(async () => {
      await backend.get('key');
      return new Response('unexpected');
    }, limits);
    expect((await run(request(), null))?.status).toBe(504);
    expect(cancelled).toBe(true);
  });
});
