import { FlaskConical } from "lucide-react";

import { ConversationList } from "@/components/chat/conversation-list";
import { BidirectionalView } from "@/components/bidirectional/bidirectional-view";
import { getConversation, listConversations } from "@/lib/conversations";
import { getLatestRun, loadRun } from "@/lib/bidirectional";

export const dynamic = "force-dynamic";

export default async function ExperimentalPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c } = await searchParams;
  const conversations = listConversations("experimental");
  const active = c ? getConversation(c) : undefined;
  const activeRun = active?.type === "experimental" ? active : undefined;
  const runRow = activeRun ? getLatestRun(activeRun.id) : undefined;
  const run = runRow ? loadRun(runRow) : null;

  return (
    <div className="flex h-full">
      <ConversationList
        conversations={conversations.map((conversation) => ({
          id: conversation.id,
          title: conversation.title,
        }))}
        activeId={activeRun?.id}
        type="experimental"
        basePath="/experimental"
        newLabel="New goal search"
      />
      {activeRun ? (
        <BidirectionalView
          key={activeRun.id}
          conversationId={activeRun.id}
          title={activeRun.title}
          model={activeRun.model}
          initialRun={run}
        />
      ) : (
        <div className="animate-fade-in-up flex flex-1 flex-col items-center justify-center gap-5 text-center">
          <FlaskConical className="text-neon-magenta size-9 drop-shadow-[0_0_10px_var(--neon-magenta)]" />
          <div className="space-y-3">
            <p className="font-pixel text-glow-magenta text-primary text-sm leading-relaxed">
              EXPERIMENTAL AGENT
              <span className="bg-neon-cyan animate-blink ml-1 inline-block h-3 w-2 align-middle" />
            </p>
            <p className="text-muted-foreground max-w-md text-sm">
              Bidirectional goal-convergence search. A forward agent builds from the start, a
              backward agent regresses from the goal, and a reconciler detects when the two frontiers
              meet. Start a run on the left.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
