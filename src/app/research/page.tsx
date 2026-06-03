import { Telescope } from "lucide-react";

import { ConversationList } from "@/components/chat/conversation-list";
import { ResearchView } from "@/components/research/research-view";
import { getConversation, listConversations } from "@/lib/conversations";
import { getLatestReport, loadReport } from "@/lib/research";

export const dynamic = "force-dynamic";

export default async function ResearchPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c } = await searchParams;
  const conversations = listConversations("research");
  const active = c ? getConversation(c) : undefined;
  const activeResearch = active?.type === "research" ? active : undefined;
  const reportRow = activeResearch ? getLatestReport(activeResearch.id) : undefined;
  const report = reportRow ? loadReport(reportRow) : null;

  return (
    <div className="flex h-full">
      <ConversationList
        conversations={conversations.map((conversation) => ({
          id: conversation.id,
          title: conversation.title,
        }))}
        activeId={activeResearch?.id}
        type="research"
        basePath="/research"
        newLabel="New research"
      />
      {activeResearch ? (
        <ResearchView
          key={activeResearch.id}
          conversationId={activeResearch.id}
          title={activeResearch.title}
          model={activeResearch.model}
          initialReport={report}
        />
      ) : (
        <div className="animate-fade-in-up flex flex-1 flex-col items-center justify-center gap-5 text-center">
          <Telescope className="text-neon-cyan size-9 drop-shadow-[0_0_10px_var(--neon-cyan)]" />
          <div className="space-y-3">
            <p className="font-pixel text-glow-magenta text-primary text-sm leading-relaxed">
              DEEP RESEARCH
              <span className="bg-neon-cyan animate-blink ml-1 inline-block h-3 w-2 align-middle" />
            </p>
            <p className="text-muted-foreground text-sm">
              Start a research run on the left — Loom will plan, search the web, read sources, and
              write a cited report.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
