import { getSettings } from "@/lib/settings";
import { listMemories } from "@/lib/memory";
import { MemoryManager } from "./memory-manager";

export const dynamic = "force-dynamic";

export default function MemoryPage() {
  const rows = listMemories();
  const embeddingsConfigured = Boolean(getSettings().embeddingsModel.trim());

  const memories = rows.map((m) => ({
    id: m.id,
    content: m.content,
    type: m.type,
    pinned: m.pinned,
    sourceConversationId: m.sourceConversationId,
    createdAt: m.createdAt,
  }));

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-6">
        <h1 className="text-base font-semibold">Memory</h1>
        <span className="text-xs text-muted-foreground">
          {memories.length} {memories.length === 1 ? "memory" : "memories"}
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <MemoryManager memories={memories} embeddingsConfigured={embeddingsConfigured} />
      </div>
    </div>
  );
}
