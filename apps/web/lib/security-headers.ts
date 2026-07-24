/**
 * Production security headers for the TanStack Start / Nitro web app.
 * CSP is intentionally carefully scoped for Vite/TanStack, API, WebSocket, Shiki, Databuddy.
 */

export function buildWebSecurityHeaders(options: {
  isProduction: boolean;
  apiUrl?: string;
  wsUrl?: string;
  enableDatabuddy?: boolean;
}): Record<string, string> {
  const { isProduction, apiUrl, wsUrl, enableDatabuddy } = options;

  const connectSrc = new Set<string>(["'self'"]);
  if (apiUrl) {
    try {
      const u = new URL(apiUrl);
      connectSrc.add(u.origin);
      const wsOrigin = u.origin.replace(/^http/, "ws");
      connectSrc.add(wsOrigin);
    } catch {
      /* ignore */
    }
  }
  if (wsUrl) {
    try {
      connectSrc.add(new URL(wsUrl).origin);
    } catch {
      /* ignore */
    }
  }
  if (enableDatabuddy) {
    connectSrc.add("https://*.databuddy.cc");
    connectSrc.add("https://databuddy.cc");
  }

  // Scripts: self + inline only for framework bootstrap if needed.
  // Prefer avoiding unsafe-eval; TanStack/Vite production builds should not need it.
  const scriptSrc = ["'self'"];
  const styleSrc = ["'self'", "'unsafe-inline'"]; // Tailwind runtime-safe; minimize later with nonces
  const imgSrc = ["'self'", "data:", "blob:", "https:"];
  const fontSrc = ["'self'", "data:"];

  const csp = [
    `default-src 'self'`,
    `script-src ${scriptSrc.join(" ")}`,
    `style-src ${styleSrc.join(" ")}`,
    `img-src ${imgSrc.join(" ")}`,
    `font-src ${fontSrc.join(" ")}`,
    `connect-src ${[...connectSrc].join(" ")}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `worker-src 'self' blob:`,
    `manifest-src 'self'`,
  ];

  if (isProduction) {
    csp.push("upgrade-insecure-requests");
  }

  const headers: Record<string, string> = {
    "Content-Security-Policy": csp.join("; "),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-site",
    "X-XSS-Protection": "0",
  };

  if (isProduction) {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  }

  return headers;
}
