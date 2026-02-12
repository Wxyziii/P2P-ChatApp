import { useEffect, useCallback } from "react";
import { useChatStore } from "@/stores/chatStore";
import { useContactStore } from "@/stores/contactStore";

export function useMessages(peer: string | null) {
  const messages = useChatStore((s) => (peer ? s.messages[peer] ?? [] : []));
  const hasMore = useChatStore((s) => (peer ? s.hasMore[peer] ?? true : false));
  const loading = useChatStore((s) => s.loadingMessages);
  const sending = useChatStore((s) => s.sendingMessage);
  const fetchMessages = useChatStore((s) => s.fetchMessages);
  const loadMore = useChatStore((s) => s.loadMoreMessages);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const typingUsers = useChatStore((s) => s.typingUsers);
  const updateLastMessage = useContactStore((s) => s.updateLastMessage);

  useEffect(() => {
    if (peer) {
      fetchMessages(peer);
    }
  }, [peer, fetchMessages]);

  const send = useCallback(
    async (text: string) => {
      if (!peer || !text.trim()) return;
      await sendMessage(peer, text.trim());
      updateLastMessage(peer, text.trim(), new Date().toISOString());
    },
    [peer, sendMessage, updateLastMessage]
  );

  const loadOlder = useCallback(() => {
    if (peer) loadMore(peer);
  }, [peer, loadMore]);

  const isTyping = peer ? typingUsers[peer] ?? false : false;

  return { messages, hasMore, loading, sending, send, loadOlder, isTyping };
}
