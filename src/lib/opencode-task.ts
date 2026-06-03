import "server-only";

import { getConversation, getMessages } from "./conversations";
import { getLatestReport } from "./research";
import { getCanvas, loadCanvasGraph } from "./canvas";

const MAX = 8_000;

export type TaskKind = "conversation" | "research" | "canvas";

const PREAMBLE =
  "The following came from a planning session in Loom. Use it as the spec and implement it in " +
  "this project — create/modify the necessary files and run what you need. Ask if anything is ambiguous.\n\n";

function fromConversation(id: string): string {
  const transcript = getMessages(id)
    .filter((m) => m.content.trim())
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.trim()}`)
    .join("\n\n");
  return transcript;
}

function fromResearch(id: string): string {
  const report = getLatestReport(id);
  if (!report || !report.report.trim()) return "";
  return `Research question: ${report.question}\n\n${report.report}`;
}

function fromCanvas(id: string): string {
  const canvas = getCanvas(id);
  if (!canvas) return "";
  const { nodes, edges } = loadCanvasGraph(canvas);
  const labelOf = (nid: string) => {
    const n = nodes.find((x) => x.id === nid);
    const text = (n?.data as { text?: string } | undefined)?.text;
    return text?.trim() || nid;
  };
  const nodeLines = nodes
    .map((n) => {
      const text = ((n.data as { text?: string }).text ?? "").trim();
      return text ? `- ${n.type === "heading" ? `## ${text}` : text}` : "";
    })
    .filter(Boolean)
    .join("\n");
  const edgeLines = edges
    .map((e) => `- ${labelOf(e.source)} → ${labelOf(e.target)}`)
    .join("\n");
  return [`Canvas: ${canvas.title}`, "", "Nodes:", nodeLines, edgeLines ? `\nConnections:\n${edgeLines}` : ""]
    .filter(Boolean)
    .join("\n");
}

/** Builds a task prompt for opencode from a Loom source. Returns "" if empty. */
export function buildOpencodeTask(sourceId: string, kind: TaskKind): string {
  let body = "";
  if (kind === "research") body = fromResearch(sourceId);
  else if (kind === "canvas") body = fromCanvas(sourceId);
  else {
    if (!getConversation(sourceId)) return "";
    body = fromConversation(sourceId);
  }
  body = body.trim();
  if (!body) return "";
  return `${PREAMBLE}${body.slice(0, MAX)}`;
}
