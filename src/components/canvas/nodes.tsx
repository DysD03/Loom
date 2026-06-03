"use client";

import { useEffect, useRef, useState } from "react";
import {
  Handle,
  NodeToolbar,
  Position,
  useReactFlow,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { toast } from "sonner";
import { Loader2, Sparkles, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { expandCanvasNodeAction } from "@/app/canvas/actions";

export interface CanvasNodeData extends Record<string, unknown> {
  text: string;
}

export type IdeaNode = Node<CanvasNodeData, "idea">;
export type HeadingNode = Node<CanvasNodeData, "heading">;
export type CanvasNode = IdeaNode | HeadingNode;

const HANDLES: { id: string; position: Position }[] = [
  { id: "t", position: Position.Top },
  { id: "r", position: Position.Right },
  { id: "b", position: Position.Bottom },
  { id: "l", position: Position.Left },
];

/** Four loose-mode handles (any side connects to any side). */
function SideHandles() {
  return (
    <>
      {HANDLES.map((h) => (
        <Handle
          key={h.id}
          id={h.id}
          type="source"
          position={h.position}
          className="!size-2.5 !rounded-full !border-2 !border-background !bg-neon-cyan opacity-0 transition-opacity group-hover:opacity-100"
        />
      ))}
    </>
  );
}

/** Textarea that grows to fit its content and reports the current selection range. */
function AutoTextarea({
  value,
  onChange,
  onSelectRange,
  className,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  onSelectRange?: (start: number, end: number) => void;
  className?: string;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onSelect={(e) =>
        onSelectRange?.(e.currentTarget.selectionStart, e.currentTarget.selectionEnd)
      }
      rows={1}
      className={cn(
        "nodrag nowheel w-full resize-none border-0 bg-transparent leading-relaxed outline-none placeholder:text-muted-foreground/60",
        className,
      )}
    />
  );
}

/** Shared editable node with an "expand with AI" affordance. */
function EditableNode({
  id,
  data,
  selected,
  variant,
}: {
  id: string;
  data: CanvasNodeData;
  selected: boolean | undefined;
  variant: "idea" | "heading";
}) {
  const { updateNodeData, addNodes, addEdges, getNode } = useReactFlow();
  const [expanding, setExpanding] = useState(false);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState({ start: 0, end: 0 });

  const hasSelection = sel.end > sel.start;
  function focusText(): string {
    const chosen = data.text.slice(sel.start, sel.end).trim();
    return chosen || data.text.trim();
  }

  async function runExpand() {
    const context = focusText();
    if (!context) {
      toast.error("Add some text to the node first.");
      return;
    }
    setLoading(true);
    try {
      const result = await expandCanvasNodeAction(context, question);
      if ("error" in result) {
        toast.error("Expand failed", { description: result.error });
        return;
      }
      const self = getNode(id);
      const base = self?.position ?? { x: 0, y: 0 };
      const width = self?.measured?.width ?? 240;
      const height = self?.measured?.height ?? 80;
      const newId = crypto.randomUUID();
      addNodes({
        id: newId,
        type: "idea",
        position: { x: base.x + width + 96, y: base.y + height / 2 },
        data: { text: result.text },
      });
      addEdges({ id: crypto.randomUUID(), source: id, target: newId });
      setExpanding(false);
      setQuestion("");
      toast.success("Added an expansion node");
    } catch {
      toast.error("Expand failed", { description: "Check the model connection in Settings." });
    } finally {
      setLoading(false);
    }
  }

  const focus = focusText();
  const previewSource = focus.length > 70 ? `${focus.slice(0, 70)}…` : focus;

  return (
    <>
      <NodeToolbar isVisible={selected || expanding} position={Position.Top} offset={8}>
        <Button
          size="xs"
          variant="secondary"
          onClick={() => setExpanding((e) => !e)}
          className="shadow-sm"
        >
          <Sparkles className="size-3" /> Expand with AI
        </Button>
      </NodeToolbar>

      <NodeToolbar isVisible={expanding} position={Position.Bottom} offset={8}>
        <div className="border-border bg-popover w-72 space-y-2 rounded-md border p-2.5 shadow-md">
          <p className="text-muted-foreground text-[11px]">
            Ask about{" "}
            <span className="text-foreground">{hasSelection ? "the selected text" : "this node"}</span>
            :
          </p>
          {previewSource ? (
            <p className="bg-muted/40 text-muted-foreground line-clamp-2 rounded px-1.5 py-1 text-[11px] italic">
              {previewSource}
            </p>
          ) : null}
          <Input
            autoFocus
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runExpand();
              if (e.key === "Escape") setExpanding(false);
            }}
            placeholder="Your question (optional)…"
            className="h-7 text-xs"
          />
          <div className="flex justify-end gap-1.5">
            <Button size="xs" variant="ghost" onClick={() => setExpanding(false)}>
              <X className="size-3" /> Cancel
            </Button>
            <Button size="xs" onClick={runExpand} disabled={loading}>
              {loading ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
              {loading ? "Asking…" : "Ask"}
            </Button>
          </div>
        </div>
      </NodeToolbar>

      {variant === "heading" ? (
        <div
          className={cn(
            "group bg-card/95 w-56 rounded-md border border-l-4 px-3 py-2.5 shadow-sm backdrop-blur transition-shadow",
            selected
              ? "border-neon-cyan border-l-neon-cyan shadow-[0_0_16px_-2px_var(--neon-cyan)]"
              : "border-border border-l-neon-cyan/70 hover:shadow-[0_0_18px_-8px_var(--neon-cyan)]",
          )}
        >
          <SideHandles />
          <AutoTextarea
            value={data.text}
            placeholder="Heading…"
            onChange={(text) => updateNodeData(id, { text })}
            onSelectRange={(s, e) => setSel({ start: s, end: e })}
            className="text-neon-cyan text-glow-cyan text-base font-bold tracking-wide uppercase"
          />
        </div>
      ) : (
        <div
          className={cn(
            "group bg-card/95 w-56 rounded-md border px-3 py-2.5 text-sm shadow-sm backdrop-blur transition-shadow",
            selected
              ? "border-primary shadow-[0_0_16px_-2px_var(--neon-magenta)]"
              : "border-border hover:shadow-[0_0_18px_-8px_var(--neon-cyan)]",
          )}
        >
          <SideHandles />
          <AutoTextarea
            value={data.text}
            placeholder="Idea…"
            onChange={(text) => updateNodeData(id, { text })}
            onSelectRange={(s, e) => setSel({ start: s, end: e })}
            className="text-foreground"
          />
        </div>
      )}
    </>
  );
}

export function IdeaNodeView({ id, data, selected }: NodeProps<IdeaNode>) {
  return <EditableNode id={id} data={data} selected={selected} variant="idea" />;
}

export function HeadingNodeView({ id, data, selected }: NodeProps<HeadingNode>) {
  return <EditableNode id={id} data={data} selected={selected} variant="heading" />;
}

export const nodeTypes = {
  idea: IdeaNodeView,
  heading: HeadingNodeView,
};
