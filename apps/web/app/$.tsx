import { createFileRoute } from '@tanstack/react-router';
import { getApiUrl } from '@/lib/utils';

export const Route = createFileRoute('/$')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        return handleGitRequest(request);
      },
      POST: async ({ request }) => {
        return handleGitRequest(request);
      },
      OPTIONS: async ({ request }) => {
        return handleGitRequest(request);
      },
    },
  },
});

/**
 * Stream Git smart-HTTP traffic to the API without buffering entire
 * request/response bodies in memory.
 */
async function handleGitRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  const gitPattern = /^\/[^/]+\/[^/]+\.git\//;
  if (!gitPattern.test(path)) {
    return new Response(null, {
      status: 404,
      statusText: 'Not Found',
    });
  }

  const apiUrl = getApiUrl();
  if (!apiUrl) {
    return new Response(JSON.stringify({ error: 'API URL not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const backendUrl = `${apiUrl}${path}${url.search}`;

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  const maxBodyBytes = 100 * 1024 * 1024;
  if (contentLength > maxBodyBytes) {
    return new Response('Request body too large', { status: 413 });
  }

  const headers = new Headers();
  const requestHeaderAllowlist = new Set([
    'accept',
    'authorization',
    'content-type',
    'cookie',
    'git-protocol',
    'user-agent',
  ]);
  request.headers.forEach((value, key) => {
    if (requestHeaderAllowlist.has(key.toLowerCase())) headers.set(key, value);
  });

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600_000);
    request.signal.addEventListener('abort', () => controller.abort(), { once: true });

    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    let receivedBytes = 0;
    const limitedBody =
      hasBody && request.body
        ? request.body.pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>({
              transform(chunk, streamController) {
                receivedBytes += chunk.byteLength;
                if (receivedBytes > maxBodyBytes) {
                  controller.abort();
                  streamController.error(new Error('Request body too large'));
                  return;
                }
                streamController.enqueue(chunk);
              },
            }),
          )
        : undefined;
    const response = await fetch(backendUrl, {
      method: request.method,
      headers,
      body: limitedBody,
      // @ts-expect-error duplex required for streaming request body in fetch
      duplex: hasBody ? 'half' : undefined,
      credentials: 'include',
      signal: controller.signal,
    });

    const responseHeaders = new Headers();
    const responseHeaderAllowlist = new Set([
      'cache-control',
      'content-length',
      'content-type',
      'expires',
      'pragma',
      'www-authenticate',
    ]);
    response.headers.forEach((value, key) => {
      if (responseHeaderAllowlist.has(key.toLowerCase())) responseHeaders.set(key, value);
    });

    const responseBody = response.body;
    const streamedBody = responseBody
      ? new ReadableStream<Uint8Array>({
          async start(streamController) {
            const reader = responseBody.getReader();
            try {
              let result = await reader.read();
              while (!result.done) {
                streamController.enqueue(result.value);
                result = await reader.read();
              }
              streamController.close();
            } catch (error) {
              streamController.error(error);
            } finally {
              clearTimeout(timeoutId);
              reader.releaseLock();
            }
          },
          cancel() {
            clearTimeout(timeoutId);
            controller.abort();
          },
        })
      : null;
    if (!responseBody) clearTimeout(timeoutId);

    return new Response(streamedBody, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error(`[Git Proxy] Error for ${path}:`, error);
    return new Response(
      JSON.stringify({
        error: 'Failed to proxy git request',
        message: 'Upstream request failed',
      }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}
