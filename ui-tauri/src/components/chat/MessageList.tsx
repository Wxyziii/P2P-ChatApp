import { useRef, useEffect, useCallback } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { AnimatePresence } from "framer-motion";
import { MessageGroup } from "./MessageGroup";
import type { Message, MessageGroup as MsgGroup } from "@/types/message";
import { Loader2, MessageCircle } from "lucide-react";
import { motion } from "framer-motion";

interface MessageListProps {
  messages: Message[];
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
}

function groupMessages(messages: Message[]): MsgGroup[] {
  const groups: MsgGroup[] = [];
  let current: MsgGroup | null = null;

  for (const msg of messages) {
    const sender = msg.direction === "sent" ? "__self__" : msg.from;
    if (
      current &&
      current.sender === sender &&
      new Date(msg.timestamp).getTime() -
        new Date(current.messages[current.messages.length - 1].timestamp).getTime() <
        120000
    ) {
      current.messages.push(msg);
    } else {
      current = {
        sender,
        direction: msg.direction,
        messages: [msg],
        timestamp: msg.timestamp,
      };
      groups.push(current);
    }
  }
  return groups;
}

export function MessageList({
  messages,
  hasMore,
  loading,
  onLoadMore,
}: MessageListProps) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const groups = groupMessages(messages);
  const prevLength = useRef(messages.length);

  useEffect(() => {
    if (messages.length > prevLength.current) {
      virtuosoRef.current?.scrollToIndex({
        index: groups.length - 1,
        behavior: "smooth",
        align: "end",
      });
    }
    prevLength.current = messages.length;
  }, [messages.length, groups.length]);

  const handleStartReached = useCallback(() => {
    if (hasMore && !loading) onLoadMore();
  }, [hasMore, loading, onLoadMore]);

  if (messages.length === 0 && !loading) {
    return (
      <div className="message-list__empty">
        <div className="message-list__empty-icon">
          <MessageCircle size={22} />
        </div>
        <p className="message-list__empty-text">
          No messages yet. Say hello! 👋
        </p>
      </div>
    );
  }

  return (
    <Virtuoso
      ref={virtuosoRef}
      data={groups}
      startReached={handleStartReached}
      initialTopMostItemIndex={groups.length - 1}
      followOutput="smooth"
      className="message-list"
      components={{
        Header: () =>
          loading ? (
            <div className="flex justify-center py-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <Loader2 size={18} className="animate-spin text-accent/50" />
              </motion.div>
            </div>
          ) : null,
      }}
      itemContent={(_index, group) => (
        <AnimatePresence mode="popLayout">
          <MessageGroup key={group.timestamp} group={group} />
        </AnimatePresence>
      )}
    />
  );
}
