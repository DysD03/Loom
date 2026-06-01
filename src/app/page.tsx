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
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <MessageSquarePlus className="size-8 text-muted-foreground" />
          <div className="space-y-1">
            <p className="text-sm font-medium">Start a conversation</p>
            <p className="text-sm text-muted-foreground">
              Pick a conversation on the left or create a new chat.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
