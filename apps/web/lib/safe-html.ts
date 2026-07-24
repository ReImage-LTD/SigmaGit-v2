/**
 * Sanitize Shiki-generated HTML before dangerouslySetInnerHTML.
 * Allow only a tight tag/attribute set; strip event handlers and scripts.
 */

const ALLOWED_TAGS = new Set([
  "pre",
  "code",
  "span",
  "div",
  "br",
  "table",
  "tbody",
  "tr",
  "td",
  "th",
  "thead",
]);

const ALLOWED_ATTRS = new Set(["class", "style", "data-line"]);

/** Very small HTML sanitizer for syntax-highlighted code only. */
export function sanitizeShikiHtml(html: string): string {
  if (!html || typeof html !== "string") return "";

  // Drop script/style/iframe/object entirely
  let out = html.replace(/<\/?(script|style|iframe|object|embed|link|meta)[^>]*>/gi, "");

  // Remove on* event handlers and javascript: URLs
  out = out.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  out = out.replace(/\s(href|src|xlink:href)\s*=\s*("|')\s*javascript:[^"']*\2/gi, "");

  // Strip tags not in allowlist (keep text content)
  out = out.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (match, tag: string, attrs: string) => {
    const name = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(name)) {
      return "";
    }
    if (match.startsWith("</")) return `</${name}>`;
    const selfClose = match.endsWith("/>");
    const cleanAttrs = sanitizeAttrs(attrs);
    return `<${name}${cleanAttrs}${selfClose ? " /" : ""}>`;
  });

  return out;
}

function sanitizeAttrs(attrs: string): string {
  if (!attrs?.trim()) return "";
  const parts: string[] = [];
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrs))) {
    const name = m[1]!.toLowerCase();
    if (!ALLOWED_ATTRS.has(name)) continue;
    const value = m[3] ?? m[4] ?? m[5] ?? "";
    // style: only allow color/background-color used by shiki
    if (name === "style") {
      const safe = value
        .split(";")
        .map((s) => s.trim())
        .filter((s) => /^(color|background-color)\s*:/i.test(s) && !/expression|url\s*\(/i.test(s))
        .join("; ");
      if (safe) parts.push(`style="${escapeAttr(safe)}"`);
      continue;
    }
    parts.push(`${name}="${escapeAttr(value)}"`);
  }
  return parts.length ? " " + parts.join(" ") : "";
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Allow only http(s) URLs for user-controlled links. */
export function sanitizeUserUrl(href: string | undefined): string | undefined {
  if (!href || typeof href !== "string") return undefined;
  const trimmed = href.trim();
  try {
    const u = new URL(trimmed, "https://example.invalid");
    if (u.protocol === "https:" || u.protocol === "http:") {
      // Reject weird encodings of javascript
      if (/^javascript:/i.test(trimmed)) return undefined;
      return trimmed;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
