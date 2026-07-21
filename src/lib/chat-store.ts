"use client";

import { Chat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";

/**
 * Module-level registry of live `Chat` instances, keyed by conversation id.
 *
 * `useChat` keeps streaming state inside the React component, so navigating
 * between Loom's tabs (which unmounts the chat view) would throw away an
 * in-flight assistant response — it only reappears once the server has
 * persisted it. By owning the `Chat` instance here (outside the component
 * tree) the stream keeps running and its state survives unmount/remount, so
 * returning to the tab shows the live response exactly where it was.
 *
 * Instances live for the lifetime of the browser session. A full page reload
 * clears the map, and the view re-seeds from the DB-backed `initialMessages`.
 *
 * Pinned on globalThis because dev-mode Fast Refresh re-evaluates this module
 * (e.g. when a lib file in its import chain is edited), which would reset a
 * plain module-level map and orphan an in-flight stream — the streamed reply
 * then never shows until the next send. Same pattern as `lib/mcp.ts`.
 */
const g = globalThis as typeof globalThis & {
  __loomChatRegistry?: Map<string, Chat<UIMessage>>;
};
if (!g.__loomChatRegistry) {
  g.__loomChatRegistry = new Map();
}
const registry = g.__loomChatRegistry;

export function getChatInstance(opts: {
  id: string;
  api: string;
  body: Record<string, unknown>;
  initialMessages: UIMessage[];
  /** Auto-resubmit predicate (e.g. after tool approvals — Email assistant). */
  sendAutomaticallyWhen?: (options: { messages: UIMessage[] }) => boolean;
}): Chat<UIMessage> {
  const existing = registry.get(opts.id);
  if (existing) {
    return existing;
  }
  const chat = new Chat<UIMessage>({
    id: opts.id,
    messages: opts.initialMessages,
    transport: new DefaultChatTransport({ api: opts.api, body: opts.body }),
    sendAutomaticallyWhen: opts.sendAutomaticallyWhen,
  });
  registry.set(opts.id, chat);
  return chat;
}

/** Drops a cached chat instance (e.g. when its conversation is deleted). */
export function clearChatInstance(id: string): void {
  registry.delete(id);
}
