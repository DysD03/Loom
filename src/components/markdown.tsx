"use client";

import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
// The async build lazy-loads the Prism core + language grammars in a separate
// chunk on first use, keeping the multi-MB highlighter out of the main bundle.
import { PrismAsync as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

import { CopyButton } from "@/components/copy-button";

function CodeBlock({ language, code }: { language: string; code: string }) {
  return (
    <div className="my-3 overflow-hidden rounded-lg border bg-[#282c34]">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
        <span className="text-xs text-white/60">{language || "code"}</span>
        <CopyButton value={code} className="text-white/60 hover:bg-white/10 hover:text-white" />
      </div>
      <SyntaxHighlighter
        language={language || "text"}
        style={oneDark}
        customStyle={{ margin: 0, background: "transparent", fontSize: "0.8125rem" }}
        codeTagProps={{ style: { fontFamily: "var(--font-geist-mono, monospace)" } }}
      >
        {code}
      </SyntaxHighlighter>
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
