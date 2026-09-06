import { deflate as deflateCallback, gzip as gzipCallback, inflate as inflateCallback, inflateRaw as inflateRawCallback } from 'node:zlib';
import { promisify } from 'node:util';

const deflate = promisify(deflateCallback);
const gzip = promisify(gzipCallback);
const inflate = promisify(inflateCallback);
const inflateRaw = promisify(inflateRawCallback);

export { deflate, gzip, inflate, inflateRaw };

/** Decode one zlib stream once, with an allocation bound and exact consumed input count. */
export function inflateWithConsumedBytes(
  buf: Buffer,
  offset: number,
  maxOutputLength: number,
): Promise<{ data: Buffer; bytesRead: number }> {
  if (!Number.isSafeInteger(maxOutputLength) || maxOutputLength < 1) {
    return Promise.reject(new Error('Invalid decompression budget'));
  }
  return new Promise((resolve, reject) => {
    inflateCallback(buf.subarray(offset), { info: true, maxOutputLength }, (error, result) => {
      if (error) return reject(error);
      const output = result as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
      resolve({ data: output.buffer, bytesRead: output.engine.bytesWritten });
    });
  });
}
