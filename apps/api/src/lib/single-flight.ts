import { requestContext } from './request-context';

interface Flight {
  controller: AbortController;
  promise: Promise<unknown>;
  waiters: number;
}

/** Share work, without letting one disconnected client cancel other callers. */
export function createSingleFlight(maxEntries = 1024, timeoutMs = 60_000) {
  const flights = new Map<string, Flight>();
  return function run<T>(key: string, load: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    let flight = flights.get(key);
    if (!flight) {
      if (flights.size >= maxEntries) return load();
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(new Error('Shared load timed out')),
        timeoutMs,
      );
      const aborted = new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
          once: true,
        });
      });
      const entry: Flight = { controller, waiters: 0, promise: Promise.resolve() };
      entry.promise = Promise.race([
        Promise.resolve().then(() => requestContext.run(controller.signal, load)),
        aborted,
      ]).finally(() => {
        clearTimeout(timer);
        if (flights.get(key) === entry) flights.delete(key);
      });
      flight = entry;
      flights.set(key, entry);
    }
    const current = flight;
    current.waiters++;
    return new Promise<T>((resolve, reject) => {
      let finished = false;
      const finish = (ok: boolean, value: unknown) => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener('abort', abort);
        if (--current.waiters === 0) {
          if (flights.get(key) === current) flights.delete(key);
          current.controller.abort(new Error('No remaining callers'));
        }
        if (!ok) reject(value);
        else resolve(value as T);
      };
      const abort = () => finish(false, signal?.reason ?? new Error('Request aborted'));
      signal?.addEventListener('abort', abort, { once: true });
      current.promise.then(
        (value) => finish(true, value),
        (error) => finish(false, error),
      );
      if (signal?.aborted) abort();
    });
  };
}
