import { describe, expect, it } from "vitest";
import { buildWebSecurityHeaders } from "./security-headers";

describe("buildWebSecurityHeaders", () => {
  it("includes CSP and frame protection", () => {
    const h = buildWebSecurityHeaders({
      isProduction: false,
      apiUrl: "http://localhost:3001",
    });
    expect(h["Content-Security-Policy"]).toContain("default-src 'self'");
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(h["Content-Security-Policy"]).toContain("object-src 'none'");
    expect(h["Content-Security-Policy"]).toContain("connect-src");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(h["Strict-Transport-Security"]).toBeUndefined();
  });

  it("adds HSTS in production and API/ws to connect-src", () => {
    const h = buildWebSecurityHeaders({
      isProduction: true,
      apiUrl: "https://api.example.com",
      enableDatabuddy: true,
    });
    expect(h["Strict-Transport-Security"]).toContain("max-age=");
    expect(h["Content-Security-Policy"]).toContain("https://api.example.com");
    expect(h["Content-Security-Policy"]).toContain("wss://api.example.com");
    expect(h["Content-Security-Policy"]).toContain("databuddy");
    expect(h["Content-Security-Policy"]).not.toContain("unsafe-eval");
  });
});
