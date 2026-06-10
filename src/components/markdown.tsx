"use client";

import { memo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
// The async build lazy-loads the Prism core + language grammars in a separate
// chunk on first use, keeping the multi-MB highlighter out of the main bundle.
import { PrismAsync as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

import { CopyButton } from "@/components/copy-button";

/** Languages whose blocks can render live in a sandboxed iframe (artifacts-style). */
function isPreviewable(language: string, code: string): boolean {
  if (language === "html" || language === "svg") {
    return true;
  }
  // Untagged/xml blocks that are clearly a full document or an SVG image.
  const head = code.trimStart().slice(0, 200).toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("<svg");
}

/** Wraps a bare SVG (or HTML fragment) so it renders on a neutral background. */
function previewSrcDoc(code: string): string {
  const head = code.trimStart().slice(0, 200).toLowerCase();
  if (head.startsWith("<!doctype html") || head.startsWith("<html")) {
    return code;
  }
  return `<!doctype html><html><head><style>body{margin:12px;background:#fff;font-family:system-ui,sans-serif}</style></head><body>${code}</body></html>`;
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const previewable = isPreviewable(language, code);
  const [showPreview, setShowPreview] = useState(false);

  return (
    <div className="my-3 overflow-hidden rounded-lg border bg-[#282c34]">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
        <span className="text-xs text-white/60">{language || "code"}</span>
        <div className="flex items-center gap-1">
          {previewable ? (
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              className="rounded px-2 py-0.5 text-xs text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            >
              {showPreview ? "Code" : "Preview"}
            </button>
          ) : null}
          <CopyButton value={code} className="text-white/60 hover:bg-white/10 hover:text-white" />
        </div>
      </div>
      {showPreview ? (
        // allow-scripts only — no same-origin, so previewed code stays fully
        // isolated from the app (no cookies, storage, or parent DOM access).
        <iframe
          sandbox="allow-scripts"
          srcDoc={previewSrcDoc(code)}
          title="Code preview"
          className="h-80 w-full border-0 bg-white"
        />
      ) : (
        <SyntaxHighlighter
          language={language || "text"}
          style={oneDark}
          customStyle={{ margin: 0, background: "transparent", fontSize: "0.8125rem" }}
          codeTagProps={{ style: { fontFamily: "var(--font-geist-mono, monospace)" } }}
        >
          {code}
        </SyntaxHighlighter>
      )}
    </div>
  );
}

const components: Components = {
  code({ className, children, ...props }) {
    const text = String(children ?? "");
    const match = /language-(\w+)/.exec(className ?? "");
    const isBlock = Boolean(match) || text.includes("\n");

    if (!isBlock) {
      return (
        <code
          className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]"
          {...props}
        >
          {children}
        </code>
      );
    }

    return <CodeBlock language={match?.[1] ?? ""} code={text.replace(/\n$/, "")} />;
  },
  pre({ children }) {
    return <>{children}</>;
  },
  a({ children, ...props }) {
    return (
      <a
        className="text-primary underline underline-offset-2"
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      >
        {children}
      </a>
    );
  },
};

function MarkdownImpl({ children }: { children: string }) {
  return (
    <div className="prose-loom max-w-none text-sm leading-relaxed break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);
