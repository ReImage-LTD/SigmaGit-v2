/** Count actual bytes without buffering the entire body or trusting its headers. */
export function boundedStream(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  exceeded: (receivedBytes: number) => Error,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let bytes = 0;
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            return;
          }
          bytes += value.byteLength;
          if (bytes > maxBytes) {
            const error = exceeded(bytes);
            controller.error(error);
            void reader.cancel(error).catch(() => {});
            return;
          }
          controller.enqueue(value);
        } catch (error) {
          controller.error(error);
        }
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    },
    { highWaterMark: 0 },
  );
}
