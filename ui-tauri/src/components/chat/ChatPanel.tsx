import { ChatHeader } from "./ChatHeader";
import { MessageList } from "./MessageList";
import { ComposeArea } from "./ComposeArea";
import { TypingIndicator } from "./TypingIndicator";
import { useMessages } from "@/hooks/useMessages";
import { useContactStore } from "@/stores/contactStore";
import { AnimatePresence } from "framer-motion";

interface ChatPanelProps {
  peer: string;
}

export function ChatPanel({ peer }: ChatPanelProps) {
  const { messages, hasMore, loading, send, loadOlder, isTyping } =
    useMessages(peer);
  const contact = useContactStore((s) =>
    s.contacts.find((c) => c.username === peer)
  );

  return (
    <div className="chat-panel">
      <ChatHeader
        username={peer}
        online={contact?.online ?? false}
        lastSeen={contact?.last_seen}
      />

      <div className="chat-panel__messages">
        <MessageList
          messages={messages}
          hasMore={hasMore}
          loading={loading}
          onLoadMore={loadOlder}
        />
        <AnimatePresence>
          {isTyping && (
            <div className="absolute bottom-2 left-4 z-10">
              <TypingIndicator username={peer} />
            </div>
          )}
        </AnimatePresence>
      </div>

      <ComposeArea onSend={send} peer={peer} />
    </div>
  );
}
