"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";

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
  deleteEditorDocAction,
  newEditorDocAction,
  renameEditorDocAction,
} from "@/app/editor/actions";

interface DocSummary {
  id: string;
  title: string;
}

export function EditorList({
  documents,
  activeId,
}: {
  documents: DocSummary[];
  activeId?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const editValue = useRef("");

  function handleNew() {
    startTransition(async () => {
      const id = await newEditorDocAction();
      router.push(`/editor?d=${id}`);
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteEditorDocAction(id);
      if (id === activeId) {
        router.push("/editor");
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
        await renameEditorDocAction(id, next);
        router.refresh();
      });
    }
  }

  return (
    <div className="bg-sidebar/40 flex h-full w-64 shrink-0 flex-col border-r">
      <div className="p-2">
        <Button onClick={handleNew} disabled={isPending} className="w-full justify-start gap-2">
          <Plus className="size-4" />
          New document
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {documents.length === 0 ? (
          <p className="text-muted-foreground px-3 py-6 text-center text-xs">
            No documents yet.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {documents.map((doc) => {
              const active = doc.id === activeId;
              if (editingId === doc.id) {
                return (
                  <li key={doc.id}>
                    <Input
                      autoFocus
                      defaultValue={doc.title}
                      onChange={(e) => (editValue.current = e.target.value)}
                      onBlur={() => commitRename(doc.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename(doc.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="h-8 text-sm"
                    />
                  </li>
                );
              }
              return (
                <li key={doc.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => router.push(`/editor?d=${doc.id}`)}
                    className={cn(
                      "flex w-full items-center gap-2 truncate rounded-md py-2 pr-8 pl-3 text-left text-sm transition-colors",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <FileText className="size-3.5 shrink-0 opacity-70" />
                    <span className="truncate">{doc.title}</span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label="Document actions"
                      className="hover:bg-accent text-muted-foreground absolute top-1.5 right-1 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100 data-[popup-open]:opacity-100"
                    >
                      <MoreHorizontal className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => {
                          editValue.current = doc.title;
                          setEditingId(doc.id);
                        }}
                      >
                        <Pencil className="size-4" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => handleDelete(doc.id)}
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
