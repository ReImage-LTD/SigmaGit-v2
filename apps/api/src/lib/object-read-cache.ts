import { createSingleFlight } from './single-flight';
import { requestSignal } from './request-context';

interface CacheOptions {
  maxBytes?: number;
  maxEntries?: number;
  maxObjectBytes?: number;
  ttlMs?: number;
}

export function isImmutableGitObject(key: string): boolean {
  return /^repos\/[^/]+\/[^/]+\/objects\/(?:[0-9a-f]{2}\/[0-9a-f]{38}|pack\/pack-[0-9a-f]{40}\.idx)$/.test(
    key,
  );
}

export function createObjectReadCache(options: CacheOptions = {}) {
  const maxBytes = options.maxBytes ?? 32 * 1024 * 1024;
  const maxEntries = options.maxEntries ?? 4096;
  const maxObjectBytes = options.maxObjectBytes ?? 1024 * 1024;
  const ttlMs = options.ttlMs ?? 5 * 60_000;
  const entries = new Map<string, { data: Buffer; expires: number }>();
  const share = createSingleFlight();
  let bytes = 0;
  let generation = 0;
  const remove = (key: string) => {
    const entry = entries.get(key);
    if (entry) bytes -= entry.data.length;
    entries.delete(key);
  };
  return {
    async get(key: string, load: () => Promise<Buffer | null>): Promise<Buffer | null> {
      const signal = requestSignal();
      signal?.throwIfAborted();
      if (!isImmutableGitObject(key)) return load();
      const entry = entries.get(key);
      if (entry && entry.expires > Date.now()) {
        entries.delete(key);
        entries.set(key, entry);
        return Buffer.from(entry.data);
      }
      remove(key);
      const version = generation;
      const data = await share(
        `${version}:${key}`,
        async () => {
          const value = await load();
          requestSignal()?.throwIfAborted();
          if (
            value &&
            version === generation &&
            value.length <= Math.min(maxObjectBytes, maxBytes)
          ) {
            remove(key);
            while (
              entries.size &&
              (entries.size >= maxEntries || bytes + value.length > maxBytes)
            ) {
              remove(entries.keys().next().value!);
            }
            if (maxEntries > 0) {
              const copy = Buffer.from(value);
              entries.set(key, { data: copy, expires: Date.now() + ttlMs });
              bytes += copy.length;
            }
          }
          return value;
        },
        signal,
      );
      // Callers (including Git) must not be able to mutate another reader's cached bytes.
      return data ? Buffer.from(data) : null;
    },
    invalidate(key: string, prefix = false) {
      generation++;
      if (prefix) {
        const boundary = key.replace(/\/+$/, '') + '/';
        for (const cached of entries.keys()) if (cached.startsWith(boundary)) remove(cached);
      } else remove(key);
    },
    stats: () => ({ bytes, entries: entries.size }),
  };
}
