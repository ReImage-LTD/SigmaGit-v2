import { expect, test } from 'bun:test';
import { concatenateStreams } from '../../lib/concatenate-streams';

test('opens chunks only on demand and preserves order', async () => {
  const opened: number[] = [];
  const stream = concatenateStreams([1, 2], async value => {
    opened.push(value);
    return new ReadableStream({start(c) { c.enqueue(new Uint8Array([value])); c.close(); }});
  });
  await Promise.resolve();
  expect(opened).toEqual([]);
  const reader = stream.getReader();
  expect((await reader.read()).value).toEqual(new Uint8Array([1]));
  await Promise.resolve();
  expect(opened).toEqual([1]);
  expect((await reader.read()).value).toEqual(new Uint8Array([2]));
  expect((await reader.read()).done).toBe(true);
});

test('cancellation closes the active source and prevents later fetches', async () => {
  let cancelled = false;
  let opened = 0;
  const stream = concatenateStreams([1, 2], async () => {
    opened++;
    return new ReadableStream({pull(c) {c.enqueue(new Uint8Array([1]));}, cancel() {cancelled = true;}});
  });
  const reader = stream.getReader();
  await reader.read();
  await reader.cancel('disconnected');
  expect(cancelled).toBe(true);
  expect(opened).toBe(1);
});

test('cancellation aborts a pending source request', async () => {
  let pendingSignal!: AbortSignal;
  let resolveOpen!: (stream: ReadableStream<Uint8Array>) => void;
  let cancelled = false;
  const stream = concatenateStreams([1], async (_, signal) => {
    pendingSignal = signal;
    return new Promise(resolve => {resolveOpen = resolve;});
  });
  const reader = stream.getReader();
  const read = reader.read();
  await Promise.resolve();
  await reader.cancel();
  expect(pendingSignal.aborted).toBe(true);
  resolveOpen(new ReadableStream({cancel() {cancelled = true;}}));
  await read;
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(cancelled).toBe(true);
});

test('missing sources error the response instead of truncating it', async () => {
  const reader = concatenateStreams([1], async () => null).getReader();
  await expect(reader.read()).rejects.toThrow('Missing blob chunk');
});

test('request abort cancels an active reader and rejects the download', async () => {
  const abort = new AbortController();
  let cancelled = false;
  const stream = concatenateStreams([1], async () => new ReadableStream({cancel() {cancelled = true;}}), abort.signal);
  const reader = stream.getReader();
  const pending = reader.read();
  await Promise.resolve();
  await Promise.resolve();
  abort.abort(new Error('request timeout'));
  await expect(pending).rejects.toThrow('request timeout');
  expect(cancelled).toBe(true);
});
