"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ImageOff, Paperclip } from "lucide-react";

import { cn } from "@/lib/utils";
import { attachmentUrl, formatAddress, type EmailMessage } from "@/lib/gmail/types";
import { Button } from "@/components/ui/button";

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} B`;
}

/** True when the body pulls images off the network (trackers included). */
function hasRemoteImages(html: string): boolean {
  return /(?:src|background)\s*=\s*["']?https?:/i.test(html);
}

/**
 * Reports the rendered height to the parent so the frame can grow to fit the
 * mail instead of scrolling inside a fixed box. Runs under a CSP nonce, so the
 * message's own scripts stay blocked.
 */
const RESIZE_SCRIPT = `
new ResizeObserver(function () {
  parent.postMessage({ loomHeight: document.documentElement.scrollHeight }, "*");
}).observe(document.documentElement);
`;

/**
 * Sandboxed document for HTML bodies. `default-src 'none'` blocks every remote
 * load — including tracking pixels — until the user opts in; embedded `cid:`
 * images are already rewritten to same-origin attachment URLs by the parser, so
 * they render without leaking anything.
 */
function htmlSrcDoc(
  html: string,
  allowImages: boolean,
  origin: string,
  nonce: string,
): string {
  const imgSources = ["data:", origin, ...(allowImages ? ["https:", "http:"] : [])];
  const csp = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "font-src data:",
    `img-src ${imgSources.join(" ")}`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");

  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    // Ours comes first, so a <base> in the message can't retarget links.
    `<base target="_blank">` +
    `<style>body{margin:12px;font-family:system-ui,sans-serif;background:#fff;color:#111;` +
    `font-size:14px;line-height:1.5;word-break:break-word}` +
    `img{max-width:100%}</style></head><body>${html}` +
    `<script nonce="${nonce}">${RESIZE_SCRIPT}</script></body></html>`
  );
}

/** Renders the HTML body in a self-sizing sandboxed frame. */
function HtmlBody({
  html,
  allowImages,
  title,
}: {
  html: string;
  allowImages: boolean;
  title: string;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(320);
  // Unguessable per-frame nonce: the message HTML is fixed long before this
  // exists, so nothing in it can mint a matching <script>.
  const [nonce] = useState(() => Math.random().toString(36).slice(2, 14));

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as { loomHeight?: number } | null;
      if (typeof data?.loomHeight !== "number") return;
      setHeight(Math.min(Math.max(data.loomHeight + 24, 120), 6000));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Only ever rendered after a client-side thread fetch, so `window` is present.
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <iframe
      ref={frameRef}
      // Scripts run only under our nonce; popups let links open in a real tab.
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      srcDoc={htmlSrcDoc(html, allowImages, origin, nonce)}
      title={title}
      style={{ height }}
      className="w-full rounded-md border bg-white"
    />
  );
}

/** One message of an open thread — collapsed to a single row until expanded. */
export function Message({
  message,
  defaultOpen,
}: {
  message: EmailMessage;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // Mail is written as HTML; show it that way and keep plain text as an escape.
  const [showHtml, setShowHtml] = useState(Boolean(message.html));
  const [allowImages, setAllowImages] = useState(false);

  const dateLabel = message.date ? new Date(message.date).toLocaleString() : "";
  // Embedded images render in the body; only real files get a download chip.
  const files = message.attachments.filter((a) => !a.inline);
  const remoteImages = Boolean(message.html) && hasRemoteImages(message.html ?? "");

  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        {open ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm",
            message.unread ? "font-semibold" : "font-medium",
          )}
        >
          {message.from.name || message.from.email}
          {!open && message.snippet ? (
            <span className="ml-2 font-normal text-muted-foreground">
              — {message.snippet}
            </span>
          ) : null}
        </span>
        {files.length > 0 ? (
          <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
        ) : null}
        <span className="shrink-0 text-xs text-muted-foreground">{dateLabel}</span>
      </button>

      {open ? (
        <div className="space-y-3 border-t px-4 py-3">
          <div className="space-y-0.5 text-xs text-muted-foreground">
            <p className="truncate">From: {formatAddress(message.from)}</p>
            {message.to.length > 0 ? (
              <p className="truncate">To: {message.to.map(formatAddress).join(", ")}</p>
            ) : null}
            {message.cc.length > 0 ? (
              <p className="truncate">Cc: {message.cc.map(formatAddress).join(", ")}</p>
            ) : null}
          </div>

          {showHtml && message.html && remoteImages && !allowImages ? (
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <ImageOff className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1">
                Remote images are blocked to stop senders tracking you.
              </span>
              <Button variant="outline" size="xs" onClick={() => setAllowImages(true)}>
                Load images
              </Button>
            </div>
          ) : null}

          {showHtml && message.html ? (
            <HtmlBody
              html={message.html}
              allowImages={allowImages}
              title={`Message from ${message.from.email}`}
            />
          ) : (
            <div className="text-sm leading-relaxed break-words whitespace-pre-wrap">
              {message.text || message.snippet || "(empty message)"}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {message.html ? (
              <Button variant="ghost" size="xs" onClick={() => setShowHtml((v) => !v)}>
                {showHtml ? "Plain text" : "View HTML"}
              </Button>
            ) : null}
            {showHtml && message.html && remoteImages && allowImages ? (
              <Button variant="ghost" size="xs" onClick={() => setAllowImages(false)}>
                Block remote images
              </Button>
            ) : null}
          </div>

          {files.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {files.map((a) => (
                <a
                  key={a.attachmentId}
                  href={attachmentUrl(a, "attachment")}
                  download={a.filename}
                  className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs hover:bg-muted"
                >
                  <Paperclip className="size-3" />
                  <span className="max-w-48 truncate">{a.filename}</span>
                  <span className="text-muted-foreground">{formatSize(a.sizeBytes)}</span>
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
