"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Check, Pencil, Pin, PinOff, Plus, Trash2, X } from "lucide-react";

import type { MemoryType } from "@/db/schema";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addMemoryAction,
  deleteMemoryAction,
  togglePinAction,
  updateMemoryAction,
} from "./actions";

interface MemoryView {
  id: string;
  content: string;
  type: MemoryType;
  pinned: boolean;
  sourceConversationId: string | null;
  createdAt: string;
}

const TYPE_OPTIONS: { value: MemoryType; label: string }[] = [
  { value: "preference", label: "Preference" },
  { value: "project", label: "Project" },
  { value: "goal", label: "Goal" },
  { value: "context", label: "Context" },
  { value: "fact", label: "Fact" },
];

function formatDate(value: string): string {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

function TypeSelect({
  value,
  onChange,
}: {
  value: MemoryType;
  onChange: (value: MemoryType) => void;
}) {
  return (
    <Select value={value} onValueChange={(next) => next && onChange(next as MemoryType)}>
      <SelectTrigger size="sm" className="w-[150px]" aria-label="Memory type">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TYPE_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AddMemory() {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [type, setType] = useState<MemoryType>("fact");
  const [isPending, startTransition] = useTransition();

  function handleAdd() {
    const trimmed = content.trim();
    if (!trimmed) {
      return;
    }
    startTransition(async () => {
      await addMemoryAction(trimmed, type);
      setContent("");
      setType("fact");
      router.refresh();
      toast.success("Memory added");
    });
  }

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Add a durable fact about yourself…"
        rows={2}
        className="resize-none"
      />
      <div className="flex items-center justify-between gap-2">
        <TypeSelect value={type} onChange={setType} />
        <Button onClick={handleAdd} disabled={isPending || !content.trim()} size="sm">
          <Plus className="size-4" />
          Add memory
        </Button>
      </div>
    </div>
  );
}

function MemoryRow({ memory }: { memory: MemoryView }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(memory.content);
  const [draftType, setDraftType] = useState<MemoryType>(memory.type);

  function run(action: () => Promise<void>) {
    startTransition(async () => {
      await action();
      router.refresh();
    });
  }

  function saveEdit() {
    const trimmed = draft.trim();
    if (!trimmed) {
      return;
    }
    setEditing(false);
    run(async () => {
      await updateMemoryAction(memory.id, trimmed, draftType);
    });
  }

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        {editing ? (
          <TypeSelect value={draftType} onChange={setDraftType} />
        ) : (
          <Badge variant="secondary" className="capitalize">
            {memory.type}
          </Badge>
        )}
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            aria-label={memory.pinned ? "Unpin" : "Pin"}
            disabled={isPending}
            onClick={() => run(() => togglePinAction(memory.id, !memory.pinned))}
          >
            {memory.pinned ? (
              <Pin className="size-4 fill-current" />
            ) : (
              <PinOff className="size-4" />
            )}
          </Button>
          {editing ? (
            <>
              <Button variant="ghost" size="icon" aria-label="Save" onClick={saveEdit}>
                <Check className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Cancel"
                onClick={() => {
                  setEditing(false);
                  setDraft(memory.content);
                  setDraftType(memory.type);
                }}
              >
                <X className="size-4" />
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Edit"
                onClick={() => setEditing(true)}
              >
                <Pencil className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete"
                disabled={isPending}
                onClick={() => run(() => deleteMemoryAction(memory.id))}
              >
                <Trash2 className="size-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      {editing ? (
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          className="resize-none"
          autoFocus
        />
      ) : (
        <p className={cn("text-sm", memory.pinned && "font-medium")}>{memory.content}</p>
      )}

      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
        <span>{formatDate(memory.createdAt)}</span>
        {memory.sourceConversationId ? (
          <Link
            href={`/?c=${memory.sourceConversationId}`}
            className="underline underline-offset-2 hover:text-foreground"
          >
            source chat
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export function MemoryManager({
  memories,
  embeddingsConfigured,
}: {
  memories: MemoryView[];
  embeddingsConfigured: boolean;
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {!embeddingsConfigured ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
          No embeddings model set in Settings. Memories are still stored, but semantic
          de-duplication and relevance retrieval are disabled (recent and pinned memories are
          used instead).
        </div>
      ) : null}

      <AddMemory />

      {memories.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No memories yet. Add one above, or use “Extract memories” from a chat.
        </p>
      ) : (
        <div className="space-y-2">
          {memories.map((memory) => (
            <MemoryRow key={memory.id} memory={memory} />
          ))}
        </div>
      )}
    </div>
  );
}
