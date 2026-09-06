/** Concatenate lazy sources with at most one active reader and no eager prefetch. */
export function concatenateStreams<T>(
  sources: readonly T[],
  open: (source: T, signal: AbortSignal) => Promise<ReadableStream<Uint8Array> | null>,
  signal?: AbortSignal,
): ReadableStream<Uint8Array> {
  const abort = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let next = 0;
  let stopped = false;
  let onAbort: (() => void) | undefined;
  const detach = () => { if (onAbort) signal?.removeEventListener('abort', onAbort); };
  const stop = async (reason: unknown) => {
    if (stopped) return;
    stopped = true;
    detach();
    abort.abort(reason);
    const active = reader;
    reader = null;
    if (active) {
      try { await active.cancel(reason); } finally { active.releaseLock(); }
    }
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      onAbort = () => {
        void stop(signal?.reason).catch(() => {});
        controller.error(signal?.reason);
      };
      if (signal?.aborted) onAbort();
      else signal?.addEventListener('abort', onAbort, {once: true});
    },
    async pull(controller) {
      try {
        while (!stopped) {
          if (!reader) {
            if (next === sources.length) {
              stopped = true;
              detach();
              controller.close();
              return;
            }
            const stream = await open(sources[next++], abort.signal);
            if (stopped) { await stream?.cancel(abort.signal.reason); return; }
            if (!stream) throw new Error('Missing blob chunk');
            reader = stream.getReader();
          }
          const result = await reader.read();
          if (stopped) return;
          if (result.done) {
            reader.releaseLock();
            reader = null;
            continue;
          }
          controller.enqueue(result.value);
          return;
        }
      } catch (error) {
        if (!stopped) {
          await stop(error).catch(() => {});
          controller.error(error);
        }
      }
    },
    cancel: stop,
  }, {highWaterMark: 0});
}
