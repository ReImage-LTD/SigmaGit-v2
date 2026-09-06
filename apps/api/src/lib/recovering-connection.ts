/** One connection/health check at a time, with bounded backoff and no permanent lockout. */
export function createRecoveringConnection<T>(options: {
  connect: () => Promise<T>;
  healthy: (client: T) => Promise<boolean>;
  dispose: (client: T) => void;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  let client: T | null = null;
  let healthyUntil = 0;
  let retryAt = 0;
  let failures = 0;
  let pending: Promise<T | null> | null = null;

  async function resolve(): Promise<T | null> {
    if (client && now() < healthyUntil) return client;
    if (client) {
      let healthy = false;
      try {
        healthy = await options.healthy(client);
      } catch {
        /* reconnect below */
      }
      if (healthy) {
        healthyUntil = now() + 5_000;
        return client;
      }
      options.dispose(client);
      client = null;
    }
    if (now() < retryAt) return null;
    try {
      client = await options.connect();
      failures = 0;
      healthyUntil = now() + 5_000;
      return client;
    } catch {
      retryAt = now() + Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5));
      return null;
    }
  }

  return {
    get(): Promise<T | null> {
      if (pending) return pending;
      pending = resolve();
      const result = pending;
      const clear = () => {
        pending = null;
      };
      void result.then(clear, clear);
      return result;
    },
    invalidate(failed: T) {
      if (client === failed) healthyUntil = 0;
    },
  };
}
