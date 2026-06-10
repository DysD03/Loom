"use client";

import { useState } from "react";
import { BookOpenText, ChevronDown, ChevronRight } from "lucide-react";

import type { RetrievalInfo } from "@/lib/retrieval";

/**
 * Collapsible "Context used" block showing which memories and document chunks
 * were injected into the system prompt for this reply, with similarity scores.
 */
export function RetrievalBlock({ data }: { data: RetrievalInfo }) {
  const [open, setOpen] = useState(false);
  const memoryCount = data.memories.length;
  const chunkCount = data.chunks.length;
  if (memoryCount === 0 && chunkCount === 0) return null;

  const summary = [
    memoryCount ? `${memoryCount} ${memoryCount === 1 ? "memory" : "memories"}` : "",
    chunkCount ? `${chunkCount} document ${chunkCount === 1 ? "excerpt" : "excerpts"}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="rounded-md border border-border/50 bg-muted/20 text-xs">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-muted-foreground hover:text-foreground"
      >
        <BookOpenText className="size-3 shrink-0" />
        <span className="flex-1 italic">Context used · {summary}</span>
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
      </button>

      {open ? (
        <div className="space-y-2 border-t border-border/50 px-3 py-2 text-muted-foreground">
          {memoryCount > 0 ? (
            <div>
              <p className="mb-1 font-medium">Memories</p>
              <ul className="space-y-0.5">
                {data.memories.map((m, i) => (
                  <li key={i}>
                    <span className="uppercase opacity-60">({m.type})</span> {m.content}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {chunkCount > 0 ? (
            <div>
              <p className="mb-1 font-medium">Document excerpts</p>
              <ul className="space-y-1.5">
                {data.chunks.map((c, i) => (
                  <li key={i}>
                    <p className="font-medium">
                      {c.documentTitle}{" "}
                      <span className="font-normal opacity-60">
                        · chunk {c.chunkIndex + 1} · score {c.score.toFixed(2)}
                      </span>
                    </p>
                    <p className="line-clamp-3 opacity-80">{c.excerpt}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
