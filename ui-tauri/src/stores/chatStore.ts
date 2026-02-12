import { create } from "zustand";
import type { Message } from "@/types/message";
import { api } from "@/services/api";
import { MESSAGE_PAGE_SIZE } from "@/lib/constants";

interface ChatState {
  activeChat: string | null;
  messages: Record<string, Message[]>;
  hasMore: Record<string, boolean>;
  loadingMessages: boolean;
  sendingMessage: boolean;
  typingUsers: Record<string, boolean>;

  // Actions
  setActiveChat: (username: string | null) => void;
  fetchMessages: (peer: string, offset?: number) => Promise<void>;
  loadMoreMessages: (peer: string) => Promise<void>;
  addMessage: (msg: Message) => void;
  sendMessage: (to: string, text: string) => Promise<void>;
  setTyping: (username: string, typing: boolean) => void;
  clearTypingTimeout: (username: string) => void;
}

const typingTimers: Record<string, ReturnType<typeof setTimeout>> = {};

export const useChatStore = create<ChatState>((set, get) => ({
  activeChat: null,
  messages: {},
  hasMore: {},
  loadingMessages: false,
  sendingMessage: false,
  typingUsers: {},

  setActiveChat: (username) => set({ activeChat: username }),

  fetchMessages: async (peer, offset = 0) => {
    set({ loadingMessages: true });
    try {
      const res = await api.getMessages(peer, MESSAGE_PAGE_SIZE, offset);
      set((state) => ({
        messages: {
          ...state.messages,
          [peer]: offset === 0
            ? res.messages
            : [...res.messages, ...(state.messages[peer] ?? [])],
        },
        hasMore: { ...state.hasMore, [peer]: res.has_more },
        loadingMessages: false,
      }));
    } catch (err) {
      console.error("Failed to fetch messages:", err);
      set({ loadingMessages: false });
    }
  },

  loadMoreMessages: async (peer) => {
    const existing = get().messages[peer] ?? [];
    if (!get().hasMore[peer] || get().loadingMessages) return;
    await get().fetchMessages(peer, existing.length);
  },

  addMessage: (msg) =>
    set((state) => {
      const peer = msg.direction === "sent" ? msg.to : msg.from;
      const existing = state.messages[peer] ?? [];
      if (existing.some((m) => m.msg_id === msg.msg_id)) return state;
      return {
        messages: {
          ...state.messages,
          [peer]: [...existing, msg],
        },
      };
    }),

  sendMessage: async (to, text) => {
    set({ sendingMessage: true });
    try {
      const res = await api.sendMessage(to, text);
      const optimistic: Message = {
        msg_id: res.msg_id,
        from: "", // filled by backend status
        to,
        text,
        timestamp: new Date().toISOString(),
        direction: "sent",
        delivered: res.delivered,
        delivery_method: res.delivery_method as "direct" | "offline",
      };
      get().addMessage(optimistic);
    } catch (err) {
      console.error("Failed to send message:", err);
      throw err;
    } finally {
      set({ sendingMessage: false });
    }
  },

  setTyping: (username, typing) => {
    if (typingTimers[username]) clearTimeout(typingTimers[username]);
    set((state) => ({
      typingUsers: { ...state.typingUsers, [username]: typing },
    }));
    if (typing) {
      typingTimers[username] = setTimeout(() => {
        set((state) => ({
          typingUsers: { ...state.typingUsers, [username]: false },
        }));
      }, 5000);
    }
  },

  clearTypingTimeout: (username) => {
    if (typingTimers[username]) {
      clearTimeout(typingTimers[username]);
      delete typingTimers[username];
    }
  },
}));
