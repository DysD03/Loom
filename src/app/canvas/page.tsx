import "@xyflow/react/dist/style.css";

import { Workflow } from "lucide-react";

import { CanvasList } from "@/components/canvas/canvas-list";
import { CanvasView } from "@/components/canvas/canvas-view";
import { CanvasDescribe } from "@/components/canvas/describe";
import { getCanvas, listCanvases, loadCanvasGraph } from "@/lib/canvas";

export const dynamic = "force-dynamic";

export default async function CanvasPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c } = await searchParams;
  const canvases = listCanvases();
  const active = c ? getCanvas(c) : undefined;
  const graph = active ? loadCanvasGraph(active) : null;

  return (
    <div className="flex h-full">
      <CanvasList
        canvases={canvases.map((canvas) => ({ id: canvas.id, title: canvas.title }))}
        activeId={active?.id}
      />
      {active && graph ? (
        <CanvasView
          key={active.id}
          canvasId={active.id}
          title={active.title}
          initialNodes={graph.nodes}
          initialEdges={graph.edges}
        />
      ) : (
        <div className="animate-fade-in-up flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
          <Workflow className="text-neon-cyan size-9 drop-shadow-[0_0_10px_var(--neon-cyan)]" />
          <div className="space-y-3">
            <p className="font-pixel text-glow-magenta text-primary text-sm leading-relaxed">
              CANVAS
              <span className="bg-neon-cyan animate-blink ml-1 inline-block h-3 w-2 align-middle" />
            </p>
            <p className="text-muted-foreground text-sm">
              Describe what you want to map and the model builds the board — or create an empty
              canvas on the left.
            </p>
          </div>
          <CanvasDescribe />
        </div>
      )}
    </div>
  );
}
