import "server-only";

import { desc, like, or, eq, and } from "drizzle-orm";

import { db } from "@/db/client";
import {
  conversations,
  documents,
  editorDocuments,
  memories,
  messages,
  researchReports,
} from "@/db/schema";

export type SearchCategory =
  | "chat"
  | "agent"
  | "research"
  | "document"
  | "editor"
  | "memory";

export interface SearchHit {
  category: SearchCategory;
  title: string;
  snippet: string;
  /** App-relative navigation target. */
  href: string;
}

const PER_GROUP = 5;
const SNIPPET_RADIUS = 60;

/** Short context window around the first match (case-insensitive). */
function snippetAround(text: string, needle: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const at = clean.toLowerCase().indexOf(needle.toLowerCase());
  if (at === -1) {
    return clean.slice(0, SNIPPET_RADIUS * 2);
  }
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(clean.length, at + needle.length + SNIPPET_RADIUS);
  return `${start > 0 ? "…" : ""}${clean.slice(start, end)}${end < clean.length ? "…" : ""}`;
}

function conversationHref(type: "chat" | "agent" | "research", id: string): string {
  if (type === "chat") return `/?c=${id}`;
  return `/${type === "agent" ? "agents" : "research"}?c=${id}`;
}

/**
 * Case-insensitive substring search across everything Loom stores:
 * conversations (titles + message content), research reports, documents,
 * editor documents, and memories. LIKE-based — plenty fast for a personal,
 * local SQLite database.
 */
export function globalSearch(query: string): SearchHit[] {
  // % and _ are LIKE wildcards; dropping them keeps the pattern literal.
  const needle = query.trim().replace(/[%_]/g, " ").replace(/\s+/g, " ").trim();
  if (needle.length < 2) {
    return [];
  }
  const pattern = `%${needle}%`;
  const hits: SearchHit[] = [];

  // Conversation titles.
  const convoRows = db
    .select()
    .from(conversations)
    .where(like(conversations.title, pattern))
    .orderBy(desc(conversations.updatedAt))
    .limit(PER_GROUP)
    .all();
  for (const c of convoRows) {
    hits.push({
      category: c.type,
      title: c.title,
      snippet: "",
      href: conversationHref(c.type, c.id),
    });
  }

  // Message content → the containing conversation (deduped).
  const messageRows = db
    .select({
      content: messages.content,
      conversationId: messages.conversationId,
      title: conversations.title,
      type: conversations.type,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(like(messages.content, pattern))
    .orderBy(desc(messages.createdAt))
    .limit(PER_GROUP * 4)
    .all();
  const seenConvos = new Set(convoRows.map((c) => c.id));
  for (const m of messageRows) {
    if (seenConvos.has(m.conversationId)) continue;
    seenConvos.add(m.conversationId);
    hits.push({
      category: m.type,
      title: m.title,
      snippet: snippetAround(m.content, needle),
      href: conversationHref(m.type, m.conversationId),
    });
    if (seenConvos.size >= convoRows.length + PER_GROUP) break;
  }

  // Research reports (question + report body).
  const reportRows = db
    .select({
      conversationId: researchReports.conversationId,
      question: researchReports.question,
      report: researchReports.report,
    })
    .from(researchReports)
    .where(or(like(researchReports.question, pattern), like(researchReports.report, pattern)))
    .orderBy(desc(researchReports.updatedAt))
    .limit(PER_GROUP)
    .all();
  const seenReports = new Set<string>();
  for (const r of reportRows) {
    if (seenReports.has(r.conversationId) || seenConvos.has(r.conversationId)) continue;
    seenReports.add(r.conversationId);
    hits.push({
      category: "research",
      title: r.question,
      snippet: snippetAround(r.report, needle),
      href: `/research?c=${r.conversationId}`,
    });
  }

  // Uploaded documents (title or filename).
  const docRows = db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.source, "upload"),
        or(like(documents.title, pattern), like(documents.filename, pattern)),
      ),
    )
    .orderBy(desc(documents.createdAt))
    .limit(PER_GROUP)
    .all();
  for (const d of docRows) {
    hits.push({
      category: "document",
      title: d.title,
      snippet: d.filename,
      href: "/documents",
    });
  }

  // Editor documents (title or content).
  const editorRows = db
    .select()
    .from(editorDocuments)
    .where(or(like(editorDocuments.title, pattern), like(editorDocuments.content, pattern)))
    .orderBy(desc(editorDocuments.updatedAt))
    .limit(PER_GROUP)
    .all();
  for (const e of editorRows) {
    hits.push({
      category: "editor",
      title: e.title,
      snippet: snippetAround(e.content, needle),
      href: `/editor?d=${e.id}`,
    });
  }

  // Memories.
  const memoryRows = db
    .select()
    .from(memories)
    .where(like(memories.content, pattern))
    .orderBy(desc(memories.createdAt))
    .limit(PER_GROUP)
    .all();
  for (const m of memoryRows) {
    hits.push({
      category: "memory",
      title: m.content.slice(0, 80),
      snippet: m.type,
      href: "/memory",
    });
  }

  return hits;
}
