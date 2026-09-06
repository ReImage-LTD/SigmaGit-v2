import { AsyncLocalStorage } from 'node:async_hooks';

export const requestContext = new AsyncLocalStorage<AbortSignal>();

export function requestSignal(signal?: AbortSignal | null): AbortSignal | undefined {
  const current = requestContext.getStore();
  if (current && signal) return AbortSignal.any([current, signal]);
  return current ?? signal ?? undefined;
}
