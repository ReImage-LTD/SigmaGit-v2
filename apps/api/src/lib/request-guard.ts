import { isGitProtocolPath, isHealthPath } from './request-path';
import { requestContext } from './request-context';

interface RequestGuardOptions {
  maxRest: number;
  maxGit: number;
  timeoutMs?: number;
  transferTimeoutMs?: number;
  errorResponse?: (request: Request, status: 408 | 503 | 504, error: string) => Response;
}

/** Track actual work and response lifetime, independently of the router's Context. */
export function createRequestGuard<T>(
  handler: (
    request: Request,
    transport: T,
    original: Request,
  ) => Response | undefined | Promise<Response | undefined>,
  options: RequestGuardOptions,
) {
  let rest = 0;
  let git = 0;
  const errorResponse =
    options.errorResponse ??
    ((_: Request, status: number, error: string) =>
      Response.json({ error }, { status, headers: status === 503 ? { 'Retry-After': '5' } : {} }));
  return async (original: Request, transport: T): Promise<Response | undefined> => {
    const path = new URL(original.url).pathname;
    if (isHealthPath(path)) return handler(original, transport, original);
    const isGit = isGitProtocolPath(path);
    if ((isGit ? git : rest) >= (isGit ? options.maxGit : options.maxRest)) {
      return errorResponse(original, 503, 'Server busy, try again later');
    }
    if (isGit) git++;
    else rest++;

    const controller = new AbortController();
    let timedOut = false;
    let released = false;
    const onDisconnect = () => controller.abort(original.signal.reason);
    original.signal.addEventListener('abort', onDisconnect, { once: true });
    const timeout =
      isGit || path.startsWith('/v2/')
        ? (options.transferTimeoutMs ?? 240_000)
        : (options.timeoutMs ?? 30_000);
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error('Request timeout'));
    }, timeout);
    const release = () => {
      if (released) return;
      released = true;
      clearTimeout(timer);
      original.signal.removeEventListener('abort', onDisconnect);
      if (isGit) git--;
      else rest--;
    };
    if (original.signal.aborted) {
      release();
      return errorResponse(original, 408, 'Request aborted');
    }

    // Bun upgrades require the native request. Handshake work still receives the
    // deadline through async context and must check it before upgrading.
    const work = Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      const request =
        path === '/ws'
          ? original
          : new Request(original, {
              signal: controller.signal,
              body: original.body,
            });
      return requestContext.run(controller.signal, () => handler(request, transport, original));
    });
    let abortListener: () => void = () => {};
    const aborted = new Promise<{ aborted: true }>((resolve) => {
      abortListener = () => resolve({ aborted: true });
      controller.signal.addEventListener('abort', abortListener, { once: true });
      if (controller.signal.aborted) abortListener();
    });
    try {
      const result = await Promise.race([work.then((response) => ({ response })), aborted]);
      controller.signal.removeEventListener('abort', abortListener);
      if ('aborted' in result) {
        // Do not free capacity for database/other work that cannot be cancelled.
        // Cancel any late response as well, so it cannot retain a socket/stream.
        void work
          .then(async (response) => {
            await response?.body?.cancel(controller.signal.reason);
          })
          .catch(() => {})
          .finally(release);
        return errorResponse(
          original,
          timedOut ? 504 : 408,
          timedOut ? 'Request timeout' : 'Request aborted',
        );
      }
      if (!result.response?.body) {
        release();
        return result.response;
      }
      return trackResponse(result.response, controller, release);
    } catch (error) {
      controller.signal.removeEventListener('abort', abortListener);
      release();
      throw error;
    }
  };
}

function trackResponse(response: Response, abort: AbortController, release: () => void): Response {
  const reader = response.body!.getReader();
  let finished = false;
  let streamController: ReadableStreamDefaultController<Uint8Array>;
  const cleanup = () => {
    abort.signal.removeEventListener('abort', onAbort);
    release();
  };
  const cancel = async (reason: unknown) => {
    if (finished) return;
    finished = true;
    try {
      await reader.cancel(reason);
    } finally {
      cleanup();
    }
  };
  const onAbort = () => {
    if (finished) return;
    streamController.error(abort.signal.reason);
    void cancel(abort.signal.reason).catch(() => {});
  };
  const body = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        streamController = controller;
        abort.signal.addEventListener('abort', onAbort, { once: true });
        if (abort.signal.aborted) onAbort();
      },
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (finished) return;
          if (done) {
            finished = true;
            controller.close();
            cleanup();
          } else controller.enqueue(value);
        } catch (error) {
          if (!finished) {
            finished = true;
            controller.error(error);
            cleanup();
          }
        }
      },
      async cancel(reason) {
        const completion = cancel(reason);
        abort.abort(reason);
        await completion;
      },
    },
    { highWaterMark: 0 },
  );
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
