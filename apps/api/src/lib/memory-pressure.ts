export function memoryBudgetBytes(value = '1024'): number {
  const mib = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(mib) || mib < 64 || mib > 1_048_576) {
    throw new Error('API_MEMORY_BUDGET_MB must be an integer between 64 and 1048576');
  }
  return mib * 1024 * 1024;
}

/** RSS includes buffers/native allocations; hysteresis avoids flapping near the limit. */
export function createMemoryPressure(budget: number, now = Date.now) {
  let rejecting = false;
  let lastCollection = -Infinity;
  return {
    shouldReject(rss: number): boolean {
      if (rss >= budget * 0.92) rejecting = true;
      else if (rss < budget * 0.85) rejecting = false;
      return rejecting;
    },
    shouldCollect(rss: number): boolean {
      if (rss < budget * 0.90 || now() - lastCollection < 60_000) return false;
      lastCollection = now();
      return true;
    },
  };
}
