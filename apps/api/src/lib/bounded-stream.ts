/** Count actual bytes without buffering the entire body or trusting its headers. */
export function boundedStream(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  exceeded: (receivedBytes: number) => Error,
  signal?: AbortSignal,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let bytes = 0;
  let finished = false;
  let streamController: ReadableStreamDefaultController<Uint8Array>;
  const cleanup = () => signal?.removeEventListener('abort', onAbort);
  const onAbort = () => {
    if (finished) return;
    finished = true;
    streamController.error(signal?.reason);
    cleanup();
    void reader.cancel(signal?.reason).catch(() => {});
  };
  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        streamController = controller;
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) onAbort();
      },
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (finished) return;
          if (done) {
            finished = true;
            cleanup();
            controller.close();
            return;
          }
          bytes += value.byteLength;
          if (bytes > maxBytes) {
            finished = true;
            cleanup();
            const error = exceeded(bytes);
            controller.error(error);
            void reader.cancel(error).catch(() => {});
            return;
          }
          controller.enqueue(value);
        } catch (error) {
          if (!finished) {
            finished = true;
            cleanup();
            controller.error(error);
          }
        }
      },
      cancel(reason) {
        finished = true;
        cleanup();
        return reader.cancel(reason);
      },
    },
    { highWaterMark: 0 },
  );
}
