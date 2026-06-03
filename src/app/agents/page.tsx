import { Bot } from "lucide-react";

import { ConversationList } from "@/components/chat/conversation-list";
import { ChatView } from "@/components/chat/chat-view";
import { AgentSettings } from "@/components/chat/agent-settings";
import {
  DEFAULT_SELF_DIALOGUE,
  getAgentConfig,
  getConversation,
  getMessages,
  listConversations,
  toUIMessages,
} from "@/lib/conversations";
import { checkToolSupport } from "@/lib/capabilities";
import { listPersonas } from "@/lib/personas";
import { AGENT_MAX_STEPS } from "@/lib/agent";

export const dynamic = "force-dynamic";

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c } = await searchParams;
  const conversations = listConversations("agent");
  const active = c ? getConversation(c) : undefined;
  const activeAgent = active?.type === "agent" ? active : undefined;
  const initialMessages = activeAgent ? toUIMessages(getMessages(activeAgent.id)) : [];

  // Probe tool capability only when a session is open (cached after the first call).
  const support = activeAgent ? await checkToolSupport() : null;
  const toolWarning = support && !support.supported ? (support.reason ?? null) : null;

  const agentConfig = activeAgent ? getAgentConfig(activeAgent.id) : null;
  const effectiveMaxSteps = agentConfig?.maxSteps ?? AGENT_MAX_STEPS;
  const personas = activeAgent ? listPersonas() : [];

  return (
    <div className="flex h-full">
      <ConversationList
        conversations={conversations.map((conversation) => ({
          id: conversation.id,
          title: conversation.title,
        }))}
        activeId={activeAgent?.id}
        type="agent"
        basePath="/agents"
        newLabel="New agent"
      />
      {activeAgent ? (
        <ChatView
          key={activeAgent.id}
          conversationId={activeAgent.id}
          title={activeAgent.title}
          model={activeAgent.model}
          initialMessages={initialMessages}
          api="/api/agent"
          type="agent"
          toolWarning={toolWarning}
          placeholder="Give the agent a task…  (Enter to send, Shift+Enter for newline)"
          maxSteps={effectiveMaxSteps}
          headerActions={
            <AgentSettings
              conversationId={activeAgent.id}
              maxSteps={effectiveMaxSteps}
              enabledKeys={agentConfig?.tools ?? null}
              personas={personas}
              personaId={agentConfig?.personaId ?? null}
              selfDialogue={agentConfig?.selfDialogue ?? DEFAULT_SELF_DIALOGUE}
            />
          }
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <Bot className="size-8 text-muted-foreground" />
          <div className="space-y-1">
            <p className="text-sm font-medium">Start an agent session</p>
            <p className="text-sm text-muted-foreground">
              Give the agent a task and it will use tools to get it done.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
