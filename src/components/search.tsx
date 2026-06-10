"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  Brain,
  Library,
  MessageSquare,
  NotebookPen,
  Search,
  Telescope,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { SearchCategory, SearchHit } from "@/lib/search";

const CATEGORY_META: Record<SearchCategory, { label: string; icon: LucideIcon }> = {
  chat: { label: "Chat", icon: MessageSquare },
  agent: { label: "Agent", icon: Bot },
  research: { label: "Research", icon: Telescope },
  document: { label: "Document", icon: Library },
  editor: { label: "Editor", icon: NotebookPen },
  memory: { label: "Memory", icon: Brain },
};

/**
 * Global Ctrl/⌘K search palette over everything Loom stores (conversations,
 * messages, research reports, documents, editor docs, memories). Mounted once
 * in the root layout.
 */
export function SearchPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const openPalette = useCallback(() => {
    setQuery("");
    setResults([]);
    setSelected(0);
    setOpen(true);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (open) {
          setOpen(false);
        } else {
          openPalette();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    // Lets the nav search button (or anything else) open the palette.
    window.addEventListener("loom:search", openPalette);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("loom:search", openPalette);
    };
  }, [open, openPalette]);

  const tooShort = query.trim().length < 2;

  // Debounced search; state updates happen in async callbacks, never sync.
  useEffect(() => {
    if (!open || tooShort) return;
    const q = query.trim();
    const handle = window.setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((d: { results: SearchHit[] }) => {
          setResults(d.results);
          setSelected(0);
        })
        .catch(() => setResults([]));
    }, 180);
    return () => window.clearTimeout(handle);
  }, [query, open, tooShort]);

  const go = useCallback(
    (hit: SearchHit) => {
      setOpen(false);
      router.push(hit.href);
    },
    [router],
  );

  if (!open) return null;

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((s) => Math.min(results.length - 1, s + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((s) => Math.max(0, s - 1));
    } else if (event.key === "Enter" && results[selected]) {
      go(results[selected]);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="bg-popover text-popover-foreground mx-auto mt-24 w-full max-w-xl overflow-hidden rounded-lg border shadow-lg">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="text-muted-foreground size-4 shrink-0" />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Search conversations, documents, memories…"
            className="placeholder:text-muted-foreground h-11 w-full bg-transparent text-sm outline-none"
          />
          <kbd className="text-muted-foreground shrink-0 rounded border px-1.5 py-0.5 text-[10px]">
            ESC
          </kbd>
        </div>

        <div className="max-h-80 overflow-y-auto p-1.5">
          {query.trim().length < 2 ? (
            <p className="text-muted-foreground px-3 py-6 text-center text-xs">
              Type to search everything Loom has stored.
            </p>
          ) : results.length === 0 ? (
            <p className="text-muted-foreground px-3 py-6 text-center text-xs">
              No results for “{query.trim()}”.
            </p>
          ) : (
            results.map((hit, i) => {
              const meta = CATEGORY_META[hit.category];
              const Icon = meta.icon;
              return (
                <button
                  key={`${hit.href}-${i}`}
                  onClick={() => go(hit)}
                  onMouseEnter={() => setSelected(i)}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-md px-3 py-2 text-left",
                    i === selected ? "bg-accent text-accent-foreground" : "",
                  )}
                >
                  <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{hit.title}</span>
                    {hit.snippet ? (
                      <span className="text-muted-foreground block truncate text-xs">
                        {hit.snippet}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-[10px] uppercase">
                    {meta.label}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
