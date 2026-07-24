import { describe, expect, it } from "bun:test";
import { sanitizeShikiHtml, sanitizeUserUrl } from "./safe-html";

describe("sanitizeShikiHtml", () => {
  it("strips script tags and event handlers", () => {
    const dirty =
      '<pre class="shiki"><code><span onclick="alert(1)">x</span><script>evil()</script></code></pre>';
    const clean = sanitizeShikiHtml(dirty);
    expect(clean).not.toContain("script");
    expect(clean).not.toContain("onclick");
    expect(clean).toContain("<span");
  });

  it("keeps shiki span/class structure", () => {
    const html = '<pre class="shiki"><code><span class="line">const x = 1</span></code></pre>';
    expect(sanitizeShikiHtml(html)).toContain('class="shiki"');
    expect(sanitizeShikiHtml(html)).toContain("const x = 1");
  });

  it("strips javascript: urls", () => {
    const dirty = '<a href="javascript:alert(1)">x</a><span class="ok">y</span>';
    const clean = sanitizeShikiHtml(dirty);
    expect(clean).not.toContain("javascript:");
    expect(clean).toContain("y");
  });
});

describe("sanitizeUserUrl", () => {
  it("allows http(s) only", () => {
    expect(sanitizeUserUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(sanitizeUserUrl("http://example.com")).toBe("http://example.com");
    expect(sanitizeUserUrl("javascript:alert(1)")).toBeUndefined();
    expect(sanitizeUserUrl("data:text/html,hi")).toBeUndefined();
    expect(sanitizeUserUrl("vbscript:x")).toBeUndefined();
  });
});
