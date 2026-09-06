"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { sanitizeUserUrl } from "@/lib/safe-html";

export const Markdown = memo(function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="markdown-body prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // Raw HTML intentionally disabled (default) — repository/user Markdown is untrusted.
        components={{
          a({ href, children, ...props }) {
            const safe = sanitizeUserUrl(href);
            if (!safe) {
              return <span {...props}>{children}</span>;
            }
            return (
              <a href={safe} rel="noopener noreferrer nofollow" target="_blank" {...props}>
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
