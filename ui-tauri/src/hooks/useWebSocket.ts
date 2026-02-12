import { useEffect, useRef } from "react";
import { websocket } from "@/services/websocket";
import { useChatStore } from "@/stores/chatStore";
import { useContactStore } from "@/stores/contactStore";
import { useUIStore } from "@/stores/uiStore";
import type { WSEvent } from "@/types/events";

export function useWebSocket() {
  const addMessage = useChatStore((s) => s.addMessage);
  const setTyping = useChatStore((s) => s.setTyping);
  const setOnline = useContactStore((s) => s.setOnline);
  const setOffline = useContactStore((s) => s.setOffline);
  const updateLastMessage = useContactStore((s) => s.updateLastMessage);
  const incrementUnread = useContactStore((s) => s.incrementUnread);
  const activeChat = useChatStore((s) => s.activeChat);
  const setWsConnected = useUIStore((s) => s.setWsConnected);
  const activeChatRef = useRef(activeChat);
  activeChatRef.current = activeChat;

  useEffect(() => {
    const handleEvent = (event: WSEvent) => {
      switch (event.event) {
        case "new_message":
          addMessage(event.data);
          updateLastMessage(
            event.data.from,
            event.data.text,
            event.data.timestamp
          );
          if (activeChatRef.current !== event.data.from) {
            incrementUnread(event.data.from);
          }
          break;
        case "friend_online":
          setOnline(event.data.username);
          break;
        case "friend_offline":
          setOffline(event.data.username);
          break;
        case "typing":
          setTyping(event.data.username, event.data.typing);
          break;
      }
    };

    const unsub = websocket.subscribe(handleEvent);
    websocket.connect();

    const interval = setInterval(() => {
      setWsConnected(websocket.connected);
    }, 1000);

    return () => {
      unsub();
      clearInterval(interval);
      websocket.disconnect();
    };
  }, [addMessage, setTyping, setOnline, setOffline, updateLastMessage, incrementUnread, setWsConnected]);
}
