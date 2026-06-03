"use client";

import { useEffect, useRef } from "react";
import {
  Handle,
  Position,
  useReactFlow,
  type Node,
  type NodeProps,
} from "@xyflow/react";

import { cn } from "@/lib/utils";

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
          className="!size-2 !rounded-none !border-0 !bg-neon-cyan opacity-0 transition-opacity group-hover:opacity-100"
        />
      ))}
    </>
  );
}

/** Textarea that grows to fit its content; tagged `nodrag`/`nowheel` for React Flow. */
function AutoTextarea({
  value,
  onChange,
  className,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
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
      rows={1}
      className={cn(
        "nodrag nowheel w-full resize-none border-0 bg-transparent outline-none placeholder:text-muted-foreground/60",
        className,
      )}
    />
  );
}

export function IdeaNodeView({ id, data, selected }: NodeProps<IdeaNode>) {
  const { updateNodeData } = useReactFlow();
  return (
    <div
      className={cn(
        "group bg-card/90 min-w-44 max-w-72 rounded-md border px-3 py-2 text-sm shadow-sm backdrop-blur transition-shadow",
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
        className="text-foreground"
      />
    </div>
  );
}

export function HeadingNodeView({ id, data, selected }: NodeProps<HeadingNode>) {
  const { updateNodeData } = useReactFlow();
  return (
    <div className={cn("group min-w-44 max-w-96 px-1", selected && "rounded-sm ring-1 ring-primary")}>
      <SideHandles />
      <AutoTextarea
        value={data.text}
        placeholder="Heading…"
        onChange={(text) => updateNodeData(id, { text })}
        className="text-neon-cyan text-glow-cyan text-lg font-bold tracking-wide uppercase"
      />
    </div>
  );
}

export const nodeTypes = {
  idea: IdeaNodeView,
  heading: HeadingNodeView,
};
