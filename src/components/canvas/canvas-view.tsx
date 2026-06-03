"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  ConnectionMode,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import dagre from "dagre";
import { Heading, LayoutGrid, Maximize, StickyNote } from "lucide-react";

import { Button } from "@/components/ui/button";
import { nodeTypes, type CanvasNode } from "@/components/canvas/nodes";
import { saveCanvasAction } from "@/app/canvas/actions";
import { SendToOpencodeButton } from "@/components/opencode/send-button";

const defaultEdgeOptions = {
  type: "smoothstep" as const,
  style: { stroke: "var(--neon-magenta)", strokeWidth: 2 },
};

/** Positions nodes with dagre (top-to-bottom), respecting measured sizes when known. */
function autoLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 90 });

  for (const node of nodes) {
    g.setNode(node.id, {
      width: node.measured?.width ?? 220,
      height: node.measured?.height ?? 70,
    });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }
  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: { x: pos.x - pos.width / 2, y: pos.y - pos.height / 2 },
    };
  });
}

function Board({
  canvasId,
  initialNodes,
  initialEdges,
}: {
  canvasId: string;
  initialNodes: Node[];
  initialEdges: Edge[];
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [saved, setSaved] = useState(true);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const firstRun = useRef(true);
  const addCount = useRef(0);

  // Debounced autosave whenever the graph changes (skip the initial load).
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    setSaved(false);
    const timer = setTimeout(() => {
      saveCanvasAction(canvasId, { nodes, edges }).then(() => setSaved(true));
    }, 700);
    return () => clearTimeout(timer);
  }, [nodes, edges, canvasId]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges],
  );

  const addNode = useCallback(
    (type: CanvasNode["type"]) => {
      // Cascade new nodes from near the viewport center so they don't stack.
      const step = (addCount.current % 6) + 1;
      addCount.current += 1;
      const position = screenToFlowPosition({
        x: window.innerWidth / 2 - 110 + step * 28,
        y: window.innerHeight / 3 + step * 26,
      });
      const node: CanvasNode = {
        id: crypto.randomUUID(),
        type,
        position,
        data: { text: "" },
      };
      setNodes((nds) => [...nds, node]);
    },
    [screenToFlowPosition, setNodes],
  );

  const onLayout = useCallback(() => {
    setNodes((nds) => autoLayout(nds, edges));
    window.requestAnimationFrame(() => fitView({ duration: 400, padding: 0.2 }));
  }, [edges, fitView, setNodes]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      nodeTypes={nodeTypes}
      defaultEdgeOptions={defaultEdgeOptions}
      connectionMode={ConnectionMode.Loose}
      deleteKeyCode={["Backspace", "Delete"]}
      multiSelectionKeyCode={["Meta", "Shift"]}
      snapToGrid
      snapGrid={[16, 16]}
      fitView
      proOptions={{ hideAttribution: true }}
      className="bg-transparent"
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={22}
        size={1}
        color="color-mix(in oklch, var(--neon-cyan), transparent 80%)"
      />
      <Controls className="!border-border !bg-card/80 !shadow-none [&_button]:!border-border [&_button]:!bg-card/80 [&_button:hover]:!bg-accent [&_button]:!fill-foreground" />
      <MiniMap
        pannable
        zoomable
        className="!bg-card/70 !border-border rounded-md border"
        maskColor="color-mix(in oklch, var(--background), transparent 25%)"
        nodeColor="var(--neon-magenta)"
      />
      <Panel position="top-left" className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="outline" onClick={() => addNode("idea")}>
          <StickyNote className="size-4" /> Idea
        </Button>
        <Button size="sm" variant="outline" onClick={() => addNode("heading")}>
          <Heading className="size-4" /> Heading
        </Button>
        <Button size="sm" variant="outline" onClick={onLayout} disabled={nodes.length === 0}>
          <LayoutGrid className="size-4" /> Auto-layout
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => fitView({ duration: 400, padding: 0.2 })}
          aria-label="Fit view"
        >
          <Maximize className="size-4" />
        </Button>
        <span className="text-muted-foreground ml-1 text-[11px]">
          {saved ? "Saved" : "Saving…"}
        </span>
      </Panel>
    </ReactFlow>
  );
}

export function CanvasView({
  canvasId,
  title,
  initialNodes,
  initialEdges,
}: {
  canvasId: string;
  title: string;
  initialNodes: Node[];
  initialEdges: Edge[];
}) {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-6">
        <h1 className="truncate text-base font-semibold">{title}</h1>
        <div className="flex items-center gap-3">
          <p className="text-muted-foreground hidden text-[11px] lg:block">
            Drag to connect · double-click to edit · Del to remove
          </p>
          <SendToOpencodeButton sourceId={canvasId} kind="canvas" />
        </div>
      </header>
      <div className="relative min-h-0 flex-1">
        <ReactFlowProvider>
          <Board canvasId={canvasId} initialNodes={initialNodes} initialEdges={initialEdges} />
        </ReactFlowProvider>
      </div>
    </div>
  );
}
