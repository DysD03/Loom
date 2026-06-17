"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowUpRight, Lightbulb, Loader2, Sparkles } from "lucide-react";

import type { ConversationType } from "@/db/schema";
import type { Suggestion } from "@/lib/suggestions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatRate } from "@/components/chat/token-rate";
import { generateSuggestionsAction, launchSuggestionAction } from "@/app/memory/actions";

const SURFACE_LABEL: Record<ConversationType, string> = {
  chat: "Chat",
  agent: "Agent",
  research: "Research",
  experimental: "Experimental",
};

export function Suggestions({ hasMemories }: { hasMemories: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [rate, setRate] = useState<number | null>(null);
  const [launching, setLaunching] = useState<number | null>(null);

  async function generate() {
    setLoading(true);
    try {
      const result = await generateSuggestionsAction();
      if ("error" in result) {
        toast.error("Couldn’t generate ideas", { description: result.error });
        return;
      }
      setSuggestions(result.suggestions);
      setRate(result.tokensPerSecond);
      if (result.suggestions.length === 0) {
        toast.info("No suggestions came back — try adding a few more memories.");
      }
    } catch {
      toast.error("Couldn’t generate ideas", {
        description: "Check the model connection in Settings.",
      });
    } finally {
      setLoading(false);
    }
  }

  async function launch(index: number, s: Suggestion) {
    setLaunching(index);
    try {
      const path = await launchSuggestionAction(s.surface, s.title, s.prompt);
      router.push(path);
    } catch {
      toast.error("Couldn’t launch the session");
      setLaunching(null);
    }
  }

  return (
    <div className="border-border/70 bg-card/40 space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Lightbulb className="text-neon-yellow size-4" />
          Suggestions for you
          {rate ? (
            <span
              className="text-muted-foreground text-[11px] font-normal tabular-nums"
              title="Average generation speed of the last run"
            >
              ~{formatRate(rate)}
            </span>
          ) : null}
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={generate}
          disabled={loading || !hasMemories}
        >
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Thinking…
            </>
          ) : (
            <>
              <Sparkles className="size-4" /> {suggestions ? "Regenerate" : "Generate ideas"}
            </>
          )}
        </Button>
      </div>

      {!hasMemories ? (
        <p className="text-muted-foreground text-xs">
          Add a few memories first — suggestions are personalized from what Loom knows about you.
        </p>
      ) : suggestions === null ? (
        <p className="text-muted-foreground text-xs">
          Generate personalized prompts and project ideas from your memories, then launch a session
          in one click.
        </p>
      ) : suggestions.length === 0 ? (
        <p className="text-muted-foreground text-xs">No suggestions yet.</p>
      ) : (
        <ul className="space-y-2">
          {suggestions.map((s, i) => (
            <li
              key={i}
              className="border-border/60 hover:border-border group rounded-md border p-2.5 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="shrink-0">
                      {SURFACE_LABEL[s.surface]}
                    </Badge>
                    <span className="truncate text-sm font-medium">{s.title}</span>
                  </div>
                  <p className="text-muted-foreground line-clamp-2 text-xs">{s.prompt}</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0"
                  onClick={() => launch(i, s)}
                  disabled={launching !== null}
                >
                  {launching === i ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <>
                      Launch <ArrowUpRight className="size-4" />
                    </>
                  )}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
