/** Coalesce probes so health traffic cannot exhaust dependency connection pools. */
export function createReadinessProbe(check: () => Promise<void>, timeoutMs = 3000) {
  let pending: Promise<boolean> | undefined;
  let cached = false;
  let expires = 0;
  return async (): Promise<boolean> => {
    if (Date.now() < expires) return cached;
    if (!pending) {
      pending = Promise.resolve()
        .then(check)
        .then(
          () => true,
          () => false,
        )
        .finally(() => {
          pending = undefined;
        });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      cached = await Promise.race([
        pending,
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), timeoutMs);
        }),
      ]);
      expires = Date.now() + 1000;
      return cached;
    } finally {
      clearTimeout(timer);
    }
  };
}
