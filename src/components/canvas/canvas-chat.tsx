"use client";

import { useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { toast } from "sonner";
import { Loader2, MessagesSquare, Send, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { CanvasNodeData } from "@/components/canvas/nodes";
import { talkToCanvasAction } from "@/app/canvas/actions";
import type { CanvasChatMessage, CanvasOp } from "@/lib/canvas-chat";

/**
 * "Talk to canvas" — a board-aware chat that both answers questions about the
 * current graph and edits it. It reads/writes the live React Flow store via
 * useReactFlow, so it must render inside the ReactFlowProvider.
 */
export function CanvasChat() {
  const { getNodes, getEdges, addNodes, addEdges, updateNodeData, deleteElements } =
    useReactFlow();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<CanvasChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  /** Applies the model's ops to the live board; returns how many were applied. */
  function applyOps(ops: CanvasOp[]): number {
    if (ops.length === 0) return 0;
    const existing = getNodes();
    // Place new nodes in a fresh column to the right of the current graph.
    const baseX = existing.length ? Math.max(...existing.map((n) => n.position.x)) + 300 : 0;
    const baseY = existing.length
      ? existing.reduce((sum, n) => sum + n.position.y, 0) / existing.length
      : 0;
    const idMap = new Map<string, string>(); // model id -> real node id
    const resolve = (id: string) => idMap.get(id) ?? id;
    let addedCount = 0;
    let applied = 0;

    for (const op of ops) {
      if (op.op === "add") {
        const realId = crypto.randomUUID();
        idMap.set(op.id, realId);
        addNodes({
          id: realId,
          type: op.nodeType,
          position: { x: baseX, y: baseY + addedCount * 130 },
          data: { text: op.text },
        });
        addedCount += 1;
        applied += 1;
      } else if (op.op === "connect") {
        addEdges({ id: crypto.randomUUID(), source: resolve(op.source), target: resolve(op.target) });
        applied += 1;
      } else if (op.op === "rename") {
        updateNodeData(resolve(op.id), { text: op.text });
        applied += 1;
      } else if (op.op === "remove") {
        deleteElements({ nodes: [{ id: resolve(op.id) }] });
        applied += 1;
      }
    }
    return applied;
  }

  async function send() {
    const message = input.trim();
    if (!message || loading) return;
    setInput("");
    const history = messages;
    setMessages((m) => [...m, { role: "user", content: message }]);
    setLoading(true);
    try {
      const graph = {
        nodes: getNodes().map((n) => ({
          id: n.id,
          type: String(n.type ?? "idea"),
          text: String((n.data as CanvasNodeData | undefined)?.text ?? ""),
        })),
        edges: getEdges().map((e) => ({ source: e.source, target: e.target })),
      };
      const result = await talkToCanvasAction({ message, graph, history });
      if ("error" in result) {
        toast.error("Canvas chat failed", { description: result.error });
        setMessages((m) => [...m, { role: "assistant", content: `⚠️ ${result.error}` }]);
        return;
      }
      const applied = applyOps(result.ops);
      setMessages((m) => [...m, { role: "assistant", content: result.reply }]);
      if (applied > 0) {
        toast.success(`Applied ${applied} change${applied === 1 ? "" : "s"} to the board`);
      }
    } catch {
      toast.error("Canvas chat failed", {
        description: "Check the model connection in Settings.",
      });
    } finally {
      setLoading(false);
      requestAnimationFrame(() =>
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }),
      );
    }
  }

  if (!open) {
    return (
      <Button
        size="sm"
        onClick={() => setOpen(true)}
        className="absolute right-3 bottom-3 z-20 shadow-md"
      >
        <MessagesSquare className="size-4" /> Talk to canvas
      </Button>
    );
  }

  return (
    <div className="border-border bg-card/95 absolute top-3 right-3 bottom-3 z-20 flex w-80 flex-col rounded-lg border shadow-[0_0_24px_-10px_var(--neon-magenta)] backdrop-blur">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase">
          <Sparkles className="text-neon-magenta size-3.5" /> Talk to canvas
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close canvas chat"
          className="text-muted-foreground hover:text-foreground rounded p-1"
        >
          <X className="size-4" />
        </button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <p className="text-muted-foreground text-[11px] leading-relaxed">
            Ask about the board — &ldquo;what&rsquo;s missing?&rdquo; — or tell it to change things —
            &ldquo;add a caching layer between API and DB and connect them&rdquo;. Edits apply to the
            board live.
          </p>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={
                m.role === "user"
                  ? "bg-primary/10 ml-6 rounded-md px-2.5 py-1.5 text-xs"
                  : "bg-muted/40 mr-6 rounded-md px-2.5 py-1.5 text-xs whitespace-pre-wrap"
              }
            >
              {m.content}
            </div>
          ))
        )}
        {loading ? (
          <div className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
            <Loader2 className="size-3 animate-spin" /> Thinking…
          </div>
        ) : null}
      </div>

      <div className="border-t p-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Ask or instruct… (Enter to send)"
          rows={2}
          disabled={loading}
          className="max-h-28 min-h-[44px] resize-none text-xs"
        />
        <div className="mt-1.5 flex justify-end">
          <Button size="sm" onClick={send} disabled={loading || !input.trim()}>
            <Send className="size-4" /> Send
          </Button>
        </div>
      </div>
    </div>
  );
}
