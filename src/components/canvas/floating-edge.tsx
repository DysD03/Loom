import { BaseEdge, getBezierPath, useInternalNode, type EdgeProps } from "@xyflow/react";

import { getEdgeParams } from "./floating";

/** Edge that connects the nearest borders of its two nodes and follows them as they move. */
export function FloatingEdge({ id, source, target, markerEnd, style }: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (!sourceNode || !targetNode) {
    return null;
  }

  const { sx, sy, tx, ty, sourcePos, targetPos } = getEdgeParams(sourceNode, targetNode);
  const [path] = getBezierPath({
    sourceX: sx,
    sourceY: sy,
    sourcePosition: sourcePos,
    targetPosition: targetPos,
    targetX: tx,
    targetY: ty,
  });

  return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />;
}
