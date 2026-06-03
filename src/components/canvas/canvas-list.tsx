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
import {
  deleteCanvasAction,
  newCanvasAction,
  renameCanvasAction,
} from "@/app/canvas/actions";

interface CanvasSummary {
  id: string;
  title: string;
}

export function CanvasList({
  canvases,
  activeId,
}: {
  canvases: CanvasSummary[];
  activeId?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const editValue = useRef("");

  function handleNew() {
    startTransition(async () => {
      const id = await newCanvasAction();
      router.push(`/canvas?c=${id}`);
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteCanvasAction(id);
      if (id === activeId) router.push("/canvas");
      else router.refresh();
    });
  }

  function commitRename(id: string) {
    const next = editValue.current.trim();
    setEditingId(null);
    if (next) {
      startTransition(async () => {
        await renameCanvasAction(id, next);
        router.refresh();
      });
    }
  }

  return (
    <div className="bg-sidebar/40 flex h-full w-64 shrink-0 flex-col border-r">
      <div className="p-2">
        <Button onClick={handleNew} disabled={isPending} className="w-full justify-start gap-2">
          <Plus className="size-4" />
          New canvas
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {canvases.length === 0 ? (
          <p className="text-muted-foreground px-3 py-6 text-center text-xs">No canvases yet.</p>
        ) : (
          <ul className="space-y-0.5">
            {canvases.map((canvas) => {
              const active = canvas.id === activeId;
              if (editingId === canvas.id) {
                return (
                  <li key={canvas.id}>
                    <Input
                      autoFocus
                      defaultValue={canvas.title}
                      onChange={(e) => (editValue.current = e.target.value)}
                      onBlur={() => commitRename(canvas.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename(canvas.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="h-8 text-sm"
                    />
                  </li>
                );
              }
              return (
                <li key={canvas.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => router.push(`/canvas?c=${canvas.id}`)}
                    className={cn(
                      "w-full truncate rounded-md py-2 pr-8 pl-3 text-left text-sm transition-colors",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                    )}
                  >
                    {canvas.title}
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label="Canvas actions"
                      className="text-muted-foreground hover:bg-accent absolute top-1.5 right-1 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100 data-[popup-open]:opacity-100"
                    >
                      <MoreHorizontal className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => {
                          editValue.current = canvas.title;
                          setEditingId(canvas.id);
                        }}
                      >
                        <Pencil className="size-4" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => handleDelete(canvas.id)}
                      >
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
