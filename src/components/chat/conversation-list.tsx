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
  deleteConversationAction,
  newConversationAction,
  renameConversationAction,
} from "@/app/actions";

interface ConversationSummary {
  id: string;
  title: string;
}

export function ConversationList({
  conversations,
  activeId,
}: {
  conversations: ConversationSummary[];
  activeId?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const editValue = useRef("");

  function handleNew() {
    startTransition(async () => {
      const id = await newConversationAction();
      router.push(`/?c=${id}`);
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteConversationAction(id);
      if (id === activeId) {
        router.push("/");
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
        await renameConversationAction(id, next);
        router.refresh();
      });
    }
  }

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r bg-sidebar/40">
      <div className="p-2">
        <Button onClick={handleNew} disabled={isPending} className="w-full justify-start gap-2">
          <Plus className="size-4" />
          New chat
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {conversations.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            No conversations yet.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {conversations.map((conversation) => {
              const active = conversation.id === activeId;
              if (editingId === conversation.id) {
                return (
                  <li key={conversation.id}>
                    <Input
                      autoFocus
                      defaultValue={conversation.title}
                      onChange={(e) => (editValue.current = e.target.value)}
                      onBlur={() => commitRename(conversation.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename(conversation.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="h-8 text-sm"
                    />
                  </li>
                );
              }
              return (
                <li key={conversation.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => router.push(`/?c=${conversation.id}`)}
                    className={cn(
                      "w-full truncate rounded-md py-2 pr-8 pl-3 text-left text-sm transition-colors",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                    )}
                  >
                    {conversation.title}
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label="Conversation actions"
                      className="absolute top-1.5 right-1 rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-accent data-[popup-open]:opacity-100"
                    >
                      <MoreHorizontal className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => {
                          editValue.current = conversation.title;
                          setEditingId(conversation.id);
                        }}
                      >
                        <Pencil className="size-4" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => handleDelete(conversation.id)}
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
