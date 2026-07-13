"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileCode, Loader2, RefreshCw, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DashboardRenderer } from "./widgets";
import {
  regenerateDashboardAction,
  saveDashboardSourceAction,
} from "@/app/dashboards/actions";
import type { DashboardSpec } from "@/lib/dashboard-spec";

export interface DashboardViewData {
  id: string;
  title: string;
  sourceMarkdown: string;
  sourceName: string;
  generatedBy: "model" | "fallback";
  model: string | null;
  error: string | null;
}

export function DashboardView({
  dashboard,
  spec,
}: {
  dashboard: DashboardViewData;
  spec: DashboardSpec | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showSource, setShowSource] = useState(false);
  const [source, setSource] = useState(dashboard.sourceMarkdown);
  const [instructions, setInstructions] = useState("");

  const sourceDirty = source !== dashboard.sourceMarkdown;

  function regenerate(withSource: boolean) {
    startTransition(async () => {
      if (withSource && sourceDirty) {
        const saved = await saveDashboardSourceAction(dashboard.id, source);
        if ("error" in saved) {
          toast.error(saved.error);
          return;
        }
      }
      const result = await regenerateDashboardAction(dashboard.id, instructions || undefined);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Dashboard regenerated.");
      setShowSource(false);
      router.refresh();
    });
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{dashboard.title}</p>
        {dashboard.generatedBy === "model" && dashboard.model ? (
          <span className="text-muted-foreground hidden text-xs sm:inline">
            {dashboard.model}
          </span>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowSource((v) => !v)}
          disabled={isPending}
          className="gap-1.5"
        >
          {showSource ? <X className="size-4" /> : <FileCode className="size-4" />}
          {showSource ? "Close" : "Source"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => regenerate(false)}
          disabled={isPending}
          className="gap-1.5"
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Regenerate
        </Button>
      </header>

      {dashboard.generatedBy === "fallback" ? (
        <div className="border-neon-yellow/40 bg-neon-yellow/5 flex shrink-0 items-start gap-2.5 border-b px-4 py-2.5">
          <TriangleAlert className="text-neon-yellow mt-0.5 size-4 shrink-0" />
          <p className="text-muted-foreground text-xs leading-relaxed">
            Built without the model{dashboard.error ? ` — ${dashboard.error}` : "."}{" "}
            This layout comes from Loom&apos;s built-in Markdown parser. Start your local LLM
            and hit Regenerate for a smarter dashboard.
          </p>
        </div>
      ) : null}

      {showSource ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
          <p className="text-muted-foreground text-xs">
            Source: {dashboard.sourceName || "Pasted Markdown"}
          </p>
          <Textarea
            value={source}
            onChange={(e) => setSource(e.target.value)}
            disabled={isPending}
            className="min-h-0 flex-1 resize-none font-mono text-xs"
          />
          <div className="flex items-center gap-2">
            <Input
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Optional guidance, e.g. “focus on the revenue numbers”"
              disabled={isPending}
              className="flex-1"
            />
            <Button onClick={() => regenerate(true)} disabled={isPending} className="gap-1.5">
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              {sourceDirty ? "Save & regenerate" : "Regenerate"}
            </Button>
          </div>
        </div>
      ) : (
        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto transition-opacity",
            isPending && "pointer-events-none opacity-60",
          )}
        >
          {spec ? (
            <div className="mx-auto max-w-6xl px-6 py-6">
              <DashboardRenderer spec={spec} />
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <p className="text-muted-foreground text-sm">
                Nothing generated yet — hit Regenerate to build this dashboard.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
