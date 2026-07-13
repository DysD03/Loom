"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BenchmarkRunStatus } from "@/db/schema";
import { deleteRunAction, renameRunAction } from "@/app/benchmarks/actions";

export interface RunSummaryItem {
  id: string;
  title: string;
  status: BenchmarkRunStatus;
}

const STATUS_DOT: Record<BenchmarkRunStatus, string> = {
  pending: "bg-neon-yellow",
  running: "bg-neon-cyan animate-pulse",
  done: "bg-neon-green",
  error: "bg-destructive",
  cancelled: "bg-muted-foreground",
};

export function RunList({ runs, activeId }: { runs: RunSummaryItem[]; activeId?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const editValue = useRef("");

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteRunAction(id);
      if (id === activeId) {
        router.push("/benchmarks");
      } else {
        router.refresh();
      }
    });
  }

  function commitRename(id: string) {
    const next = editValue.current.trim();
    setEditingId(null);
    if (next) {
      startTransition(async () => {
        await renameRunAction(id, next);
        router.refresh();
      });
    }
  }

  return (
    <div className="bg-sidebar/40 flex h-full w-64 shrink-0 flex-col border-r">
      <div className="p-2">
        <Button
          onClick={() => router.push("/benchmarks")}
          disabled={isPending}
          className="w-full justify-start gap-2"
        >
          <Plus className="size-4" />
          New benchmark
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {runs.length === 0 ? (
          <p className="text-muted-foreground px-3 py-6 text-center text-xs">No runs yet.</p>
        ) : (
          <ul className="space-y-0.5">
            {runs.map((run) => {
              const active = run.id === activeId;
              if (editingId === run.id) {
                return (
                  <li key={run.id}>
                    <Input
                      autoFocus
                      defaultValue={run.title}
                      onChange={(e) => (editValue.current = e.target.value)}
                      onBlur={() => commitRename(run.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename(run.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="h-8 text-sm"
                    />
                  </li>
                );
              }
              return (
                <li key={run.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => router.push(`/benchmarks?r=${run.id}`)}
                    className={cn(
                      "flex w-full items-center gap-2 truncate rounded-md py-2 pr-8 pl-3 text-left text-sm transition-colors",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <span
                      className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[run.status])}
                    />
                    <span className="truncate">{run.title}</span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label="Run actions"
                      className="hover:bg-accent text-muted-foreground absolute top-1.5 right-1 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100 data-[popup-open]:opacity-100"
                    >
                      <MoreHorizontal className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => {
                          editValue.current = run.title;
                          setEditingId(run.id);
                        }}
                      >
                        <Pencil className="size-4" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={() => handleDelete(run.id)}>
                        <Trash2 className="size-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
