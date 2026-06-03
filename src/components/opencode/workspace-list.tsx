"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FolderPlus, MoreHorizontal, Pencil, Trash2, X } from "lucide-react";

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
  deleteWorkspaceAction,
  newWorkspaceAction,
  renameWorkspaceAction,
} from "@/app/opencode/actions";

interface WorkspaceSummary {
  id: string;
  title: string;
  path: string;
}

export function WorkspaceList({
  workspaces,
  activeId,
}: {
  workspaces: WorkspaceSummary[];
  activeId?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [path, setPath] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const editValue = useRef("");

  function handleCreate() {
    const value = path.trim();
    if (!value) return;
    startTransition(async () => {
      const result = await newWorkspaceAction(value);
      if ("error" in result) {
        toast.error("Couldn’t add workspace", { description: result.error });
        return;
      }
      setPath("");
      setCreating(false);
      router.push(`/opencode?w=${result.id}`);
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteWorkspaceAction(id);
      if (id === activeId) router.push("/opencode");
      else router.refresh();
    });
  }

  function commitRename(id: string) {
    const next = editValue.current.trim();
    setEditingId(null);
    if (next) {
      startTransition(async () => {
        await renameWorkspaceAction(id, next);
        router.refresh();
      });
    }
  }

  return (
    <div className="bg-sidebar/40 flex h-full w-64 shrink-0 flex-col border-r">
      <div className="space-y-2 p-2">
        {creating ? (
          <div className="border-border/70 space-y-2 rounded-md border p-2">
            <Input
              autoFocus
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") setCreating(false);
              }}
              placeholder="/path/to/project  (or ~/dev/app)"
              className="h-8 text-xs"
            />
            <div className="flex justify-end gap-1.5">
              <Button size="xs" variant="ghost" onClick={() => setCreating(false)}>
                <X className="size-3" /> Cancel
              </Button>
              <Button size="xs" onClick={handleCreate} disabled={isPending || !path.trim()}>
                Add
              </Button>
            </div>
          </div>
        ) : (
          <Button
            onClick={() => setCreating(true)}
            disabled={isPending}
            className="w-full justify-start gap-2"
          >
            <FolderPlus className="size-4" />
            New workspace
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {workspaces.length === 0 ? (
          <p className="text-muted-foreground px-3 py-6 text-center text-xs">
            No workspaces yet. Add a project folder to start.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {workspaces.map((workspace) => {
              const active = workspace.id === activeId;
              if (editingId === workspace.id) {
                return (
                  <li key={workspace.id}>
                    <Input
                      autoFocus
                      defaultValue={workspace.title}
                      onChange={(e) => (editValue.current = e.target.value)}
                      onBlur={() => commitRename(workspace.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename(workspace.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="h-8 text-sm"
                    />
                  </li>
                );
              }
              return (
                <li key={workspace.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => router.push(`/opencode?w=${workspace.id}`)}
                    className={cn(
                      "w-full rounded-md py-2 pr-8 pl-3 text-left transition-colors",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <span className="block truncate text-sm">{workspace.title}</span>
                    <span className="block truncate text-[11px] opacity-70">{workspace.path}</span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label="Workspace actions"
                      className="text-muted-foreground hover:bg-accent absolute top-2 right-1 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100 data-[popup-open]:opacity-100"
                    >
                      <MoreHorizontal className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => {
                          editValue.current = workspace.title;
                          setEditingId(workspace.id);
                        }}
                      >
                        <Pencil className="size-4" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => handleDelete(workspace.id)}
                      >
                        <Trash2 className="size-4" />
                        Remove
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
