import { create } from "zustand";
import type { Contact, ContactWithPreview } from "@/types/contact";
import { api } from "@/services/api";

interface ContactState {
  contacts: ContactWithPreview[];
  loading: boolean;
  error: string | null;
  searchQuery: string;

  // Actions
  fetchContacts: () => Promise<void>;
  addFriend: (username: string) => Promise<void>;
  removeFriend: (username: string) => Promise<void>;
  setOnline: (username: string) => void;
  setOffline: (username: string) => void;
  setSearchQuery: (query: string) => void;
  updateLastMessage: (username: string, text: string, time: string) => void;
  incrementUnread: (username: string) => void;
  clearUnread: (username: string) => void;
}

export const useContactStore = create<ContactState>((set, get) => ({
  contacts: [],
  loading: false,
  error: null,
  searchQuery: "",

  fetchContacts: async () => {
    set({ loading: true, error: null });
    try {
      const friends: Contact[] = await api.listFriends();
      const existing = get().contacts;
      const contacts: ContactWithPreview[] = friends.map((f) => {
        const prev = existing.find((c) => c.username === f.username);
        return {
          ...f,
          lastMessage: prev?.lastMessage,
          lastMessageTime: prev?.lastMessageTime,
          unreadCount: prev?.unreadCount ?? 0,
        };
      });
      set({ contacts, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  addFriend: async (username: string) => {
    try {
      const friend = await api.addFriend(username);
      set((state) => ({
        contacts: [
          ...state.contacts,
          { ...friend, unreadCount: 0 },
        ],
        error: null,
      }));
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  removeFriend: async (username: string) => {
    try {
      await api.removeFriend(username);
      set((state) => ({
        contacts: state.contacts.filter((c) => c.username !== username),
      }));
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  setOnline: (username) =>
    set((state) => ({
      contacts: state.contacts.map((c) =>
        c.username === username ? { ...c, online: true } : c
      ),
    })),

  setOffline: (username) =>
    set((state) => ({
      contacts: state.contacts.map((c) =>
        c.username === username
          ? { ...c, online: false, last_seen: new Date().toISOString() }
          : c
      ),
    })),

  setSearchQuery: (query) => set({ searchQuery: query }),

  updateLastMessage: (username, text, time) =>
    set((state) => ({
      contacts: state.contacts.map((c) =>
        c.username === username
          ? { ...c, lastMessage: text, lastMessageTime: time }
          : c
      ),
    })),

  incrementUnread: (username) =>
    set((state) => ({
      contacts: state.contacts.map((c) =>
        c.username === username
          ? { ...c, unreadCount: c.unreadCount + 1 }
          : c
      ),
    })),

  clearUnread: (username) =>
    set((state) => ({
      contacts: state.contacts.map((c) =>
        c.username === username ? { ...c, unreadCount: 0 } : c
      ),
    })),
}));
