import { MessageSquarePlus } from "lucide-react";

import { ConversationList } from "@/components/chat/conversation-list";
import { ChatView } from "@/components/chat/chat-view";
import {
  getConversation,
  getMessages,
  listConversations,
  toUIMessages,
} from "@/lib/conversations";

export const dynamic = "force-dynamic";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c } = await searchParams;
  const conversations = listConversations("chat");
  const active = c ? getConversation(c) : undefined;
  const activeChat = active?.type === "chat" ? active : undefined;
  const initialMessages = activeChat ? toUIMessages(getMessages(activeChat.id)) : [];

  return (
    <div className="flex h-full">
      <ConversationList
        conversations={conversations.map((conversation) => ({
          id: conversation.id,
          title: conversation.title,
        }))}
        activeId={activeChat?.id}
      />
      {activeChat ? (
        <ChatView
          key={activeChat.id}
          conversationId={activeChat.id}
          title={activeChat.title}
          model={activeChat.model}
          initialMessages={initialMessages}
        />
      ) : (
        <div className="animate-fade-in-up flex flex-1 flex-col items-center justify-center gap-5 text-center">
          <MessageSquarePlus className="text-neon-cyan size-9 drop-shadow-[0_0_10px_var(--neon-cyan)]" />
          <div className="space-y-3">
            <p className="font-pixel text-glow-magenta text-primary text-sm leading-relaxed">
              START A CONVERSATION
              <span className="bg-neon-cyan animate-blink ml-1 inline-block h-3 w-2 align-middle" />
            </p>
            <p className="text-muted-foreground text-sm">
              Pick a conversation on the left or create a new chat.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
