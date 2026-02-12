# Backend Integration Guide

> **Audience:** 2-person beginner team building a P2P encrypted chat app.
> **Purpose:** Explains EXACTLY where in the frontend code every backend connection
> happens, what the backend expects, and what you still need to build.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Where Backend Connections Live in Frontend Code](#2-where-backend-connections-live-in-frontend-code)
3. [What You Need to Add to the C++ Backend](#3-what-you-need-to-add-to-the-c-backend)
4. [Message Flow Walkthroughs](#4-message-flow-walkthroughs)
5. [Error Handling](#5-error-handling)
6. [Testing the Connection](#6-testing-the-connection)
7. [Data Types & JSON Contracts](#7-data-types--json-contracts)
8. [Integration Checklist by Phase](#8-integration-checklist-by-phase)
9. [Common Pitfalls & Tips](#9-common-pitfalls--tips)
10. [Quick Reference Card](#10-quick-reference-card)

---

## 1. Architecture Overview

### The Big Picture

Our app has **three pieces**:

| Piece | Tech | Runs Where |
|-------|------|-----------|
| **Frontend** | React + TypeScript (inside Tauri) | Your desktop (window) |
| **Backend** | C++ with ASIO | Your desktop (background process) |
| **Supabase** | Hosted PostgreSQL + REST API | Cloud (free tier) |

### How They Talk to Each Other

`
 ┌──────────────────────────────────────────────────────────────────────┐
 │  YOUR COMPUTER                                                      │
 │                                                                     │
 │  ┌─────────────────────────────────────────┐                        │
 │  │         Tauri Window (Desktop App)       │                        │
 │  │  ┌───────────────────────────────────┐   │                        │
 │  │  │     React UI (TypeScript)         │   │                        │
 │  │  │                                   │   │                        │
 │  │  │  User types message               │   │                        │
 │  │  │       │                           │   │                        │
 │  │  │       ▼                           │   │                        │
 │  │  │  services/api.ts ───► HTTP ───────────────► localhost:8080     │
 │  │  │  services/websocket.ts ► WS ──────────────► localhost:8081     │
 │  │  └───────────────────────────────────┘   │                        │
 │  └─────────────────────────────────────────┘                        │
 │                                                                     │
 │  ┌─────────────────────────────────────────┐                        │
 │  │         C++ Backend (sidecar)            │                        │
 │  │                                         │                        │
 │  │  :8080  REST API   (LocalAPI class)      │                        │
 │  │  :8081  WebSocket  (WSEventServer)        │                        │
 │  │  :9100  P2P TCP    (PeerServer class)     │                        │
 │  │                                         │                        │
 │  │  ┌─ libsodium ── encrypt/decrypt ──┐    │                        │
 │  │  ├─ SQLite ────── local history ───┤    │                        │
 │  │  └─ libcurl ───── Supabase calls ──┘    │                        │
 │  └──────────────┬──────────────────────────┘                        │
 └─────────────────┼───────────────────────────────────────────────────┘
                   │
          ┌────────▼────────┐        ┌──────────────────┐
          │   TCP to Peer   │        │     Supabase      │
          │  (direct P2P)   │        │  (discovery +     │
          │                 │        │   offline msgs)   │
          └─────────────────┘        └──────────────────┘
`

### Data Flow Summary

`
 User ──► React UI ──► Tauri ──► HTTP/WS ──► C++ Backend ──► TCP to peer
                                                         └──► Supabase
`

### The Golden Rules

| Rule | Explanation |
|------|-------------|
| **Frontend NEVER does encryption** | libsodium runs in C++ only. Frontend sends/receives plaintext. |
| **Frontend NEVER talks to Supabase** | All Supabase calls go through the C++ backend. |
| **Frontend NEVER does networking** | No TCP, no peer discovery. Backend handles everything. |
| **Frontend NEVER touches the database** | SQLite is managed by C++ only. |
| **Frontend only talks to 127.0.0.1** | HTTP on port 8080, WebSocket on port 8081. That's it. |

**Why?** The frontend is a "dumb" display. The backend is the brain. This keeps the security
boundary clean — all sensitive operations (crypto, networking, storage) happen in one place.

---

## 2. Where Backend Connections Live in Frontend Code

> This section maps EVERY file in the frontend that touches the backend.
> For each file, we show the exact code, what endpoint it calls, and what data it sends/receives.

### 2.1 Configuration — `src/lib/constants.ts`

This file defines ALL connection settings. If you change a port, change it here:

`	ypescript
// ui-tauri/src/lib/constants.ts
export const API_BASE_URL = "http://127.0.0.1:8080";       // REST API
export const WS_URL = "ws://127.0.0.1:8081/events";        // WebSocket

export const POLL_INTERVAL_MS = 2000;                       // Base polling interval
export const WS_RECONNECT_DELAY_MS = 3000;                  // Initial WS reconnect wait
export const WS_MAX_RECONNECT_ATTEMPTS = 10;                // Give up after 10 tries

export const MESSAGE_PAGE_SIZE = 50;                        // Messages per page
export const TYPING_DEBOUNCE_MS = 1000;                     // Typing indicator debounce
export const TYPING_TIMEOUT_MS = 5000;                      // Auto-clear typing after 5s
`

---

### 2.2 REST API Client — `src/services/api.ts`

**This is the most important file for backend integration.** Every REST call lives here.

`	ypescript
// ui-tauri/src/services/api.ts — ACTUAL CODE FROM THE PROJECT

import { API_BASE_URL, MESSAGE_PAGE_SIZE } from "@/lib/constants";
import type { Contact } from "@/types/contact";
import type { StatusResponse, MessagesResponse } from "@/types/api";

class ApiService {
  private baseUrl: string;

  constructor(baseUrl = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  // Generic request helper — handles errors for ALL endpoints
  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(${"$"}{this.baseUrl}{path}, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || HTTP {res.status});
    }
    if (res.status === 204) return undefined as T;
    return res.json();
  }

  // ── Each method below = one backend endpoint ──────────────

  async getStatus(): Promise<StatusResponse> {
    return this.request<StatusResponse>("/status");
  }

  async listFriends(): Promise<Contact[]> {
    return this.request<Contact[]>("/friends");
  }

  async addFriend(username: string): Promise<Contact> {
    return this.request<Contact>("/friends", {
      method: "POST",
      body: JSON.stringify({ username }),
    });
  }

  async removeFriend(username: string): Promise<void> {
    return this.request<void>(/friends/{encodeURIComponent(username)}, {
      method: "DELETE",
    });
  }

  async getMessages(
    peer: string,
    limit = MESSAGE_PAGE_SIZE,
    offset = 0
  ): Promise<MessagesResponse> {
    const params = new URLSearchParams({
      peer,
      limit: String(limit),
      offset: String(offset),
    });
    return this.request<MessagesResponse>(/messages?{params});
  }

  async sendMessage(
    to: string,
    text: string
  ): Promise<{ msg_id: string; delivered: boolean; delivery_method: string }> {
    return this.request("/messages", {
      method: "POST",
      body: JSON.stringify({ to, text }),
    });
  }

  async deleteMessage(msgId: string): Promise<void> {
    return this.request<void>(/messages/{encodeURIComponent(msgId)}, {
      method: "DELETE",
    });
  }
}

export const api = new ApiService();
`

#### Endpoint-by-Endpoint Breakdown

| Method | Code | HTTP Request | What Backend Must Return |
|--------|------|-------------|------------------------|
| getStatus() | `api.getStatus()` | `GET /status` | `StatusResponse` JSON (username, uptime, peer count) |
| listFriends() | `api.listFriends()` | `GET /friends` | `Contact[]` array with online status, keys, last_seen |
| ddFriend(username) | `api.addFriend("bob")` | `POST /friends` with `{"username":"bob"}` | `Contact` object (201), or error 404 (not found) / 409 (already friends) |
| emoveFriend(username) | `api.removeFriend("bob")` | `DELETE /friends/bob` | Empty (204), or error 404 |
| getMessages(peer, limit, offset) | `api.getMessages("bob", 50, 0)` | `GET /messages?peer=bob&limit=50&offset=0` | `MessagesResponse` with messages array, total count, has_more flag |
| sendMessage(to, text) | `api.sendMessage("bob", "hi")` | `POST /messages` with `{"to":"bob","text":"hi"}` | `{msg_id, delivered, delivery_method}` |
| deleteMessage(id) | `api.deleteMessage("abc-123")` | `DELETE /messages/abc-123` | Empty (204) |

---

### 2.3 WebSocket Client — `src/services/websocket.ts`

**Handles real-time events from the backend.** The backend pushes events here instead of
the frontend having to poll constantly.

`	ypescript
// ui-tauri/src/services/websocket.ts — ACTUAL CODE

import { WS_URL, WS_RECONNECT_DELAY_MS, WS_MAX_RECONNECT_ATTEMPTS } from "@/lib/constants";
import type { WSEvent, WSClientEvent } from "@/types/events";

type EventHandler = (event: WSEvent) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private handlers: Set<EventHandler> = new Set();
  private _connected = false;

  constructor(url = WS_URL) {
    this.url = url;   // Default: "ws://127.0.0.1:8081/events"
  }

  get connected() { return this._connected; }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this._connected = true;
        this.reconnectAttempts = 0;
        console.log("[WS] Connected");
      };

      this.ws.onmessage = (event) => {
        try {
          const parsed: WSEvent = JSON.parse(event.data);
          this.handlers.forEach((handler) => handler(parsed));
        } catch (err) {
          console.error("[WS] Failed to parse message:", err);
        }
      };

      this.ws.onclose = () => {
        this._connected = false;
        this.scheduleReconnect();    // Auto-reconnect!
      };

      this.ws.onerror = (err) => {
        console.error("[WS] Error:", err);
        this.ws?.close();
      };
    } catch (err) {
      console.error("[WS] Connection failed:", err);
      this.scheduleReconnect();
    }
  }

  disconnect() { /* cleanup */ }

  // Send events TO the backend (typing, mark_read)
  send(event: WSClientEvent) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    }
  }

  // Subscribe to events FROM the backend
  subscribe(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  // Exponential backoff: 3s → 4.5s → 6.75s → ... (max 10 attempts)
  private scheduleReconnect() {
    if (this.reconnectAttempts >= WS_MAX_RECONNECT_ATTEMPTS) {
      console.error("[WS] Max reconnect attempts reached");
      return;
    }
    const delay = WS_RECONNECT_DELAY_MS * Math.pow(1.5, this.reconnectAttempts);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}

export const websocket = new WebSocketService();
`

#### What the WebSocket Receives (Backend → Frontend)

| Event | JSON from backend | When it fires |
|-------|------------------|---------------|
| `new_message` | `{"event":"new_message","data":{"msg_id":"...","from":"bob","to":"alice","text":"Hey!","timestamp":"2025-06-15T10:31:00Z","direction":"received","delivered":true,"delivery_method":"direct"}}` | A peer sends you a message |
| `friend_online` | `{"event":"friend_online","data":{"username":"bob"}}` | Friend's heartbeat appears in Supabase |
| `friend_offline` | `{"event":"friend_offline","data":{"username":"bob"}}` | Friend's heartbeat expires |
| `typing` | `{"event":"typing","data":{"username":"bob","typing":true}}` | Friend is typing a message |

#### What the WebSocket Sends (Frontend → Backend)

| Event | JSON to backend | When it fires |
|-------|----------------|---------------|
| `typing` | `{"event":"typing","data":{"to":"bob","typing":true}}` | User starts typing in compose area |
| `mark_read` | `{"event":"mark_read","data":{"peer":"bob","msg_id":"abc-123"}}` | User opens a chat (marks messages as read) |

---

### 2.4 WebSocket Hook — `src/hooks/useWebSocket.ts`

**Subscribes to WebSocket events and dispatches them to Zustand stores.** This is the
"router" that decides what to do with each event type.

`	ypescript
// ui-tauri/src/hooks/useWebSocket.ts — ACTUAL CODE

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
          addMessage(event.data);                          // Add to chat
          updateLastMessage(                               // Update sidebar
            event.data.from, event.data.text, event.data.timestamp
          );
          if (activeChatRef.current !== event.data.from) {
            incrementUnread(event.data.from);              // Badge +1
          }
          break;
        case "friend_online":
          setOnline(event.data.username);                  // Green dot
          break;
        case "friend_offline":
          setOffline(event.data.username);                 // Grey dot
          break;
        case "typing":
          setTyping(event.data.username, event.data.typing); // "typing..."
          break;
      }
    };

    const unsub = websocket.subscribe(handleEvent);
    websocket.connect();

    // Poll WS connection status every second for the status indicator
    const interval = setInterval(() => {
      setWsConnected(websocket.connected);
    }, 1000);

    return () => { unsub(); clearInterval(interval); websocket.disconnect(); };
  }, [/* deps */]);
}
`

**What happens for each event:**

| Event | Store Action | UI Effect |
|-------|-------------|-----------|
| `new_message` | `chatStore.addMessage()` + `contactStore.updateLastMessage()` + `contactStore.incrementUnread()` | New bubble in chat, sidebar preview updates, unread badge appears |
| `friend_online` | `contactStore.setOnline(username)` | Green dot next to friend's name |
| `friend_offline` | `contactStore.setOffline(username)` | Grey dot, last_seen timestamp updates |
| `typing` | `chatStore.setTyping(username, true)` | "typing..." indicator below messages (auto-clears after 5s) |

---

### 2.5 Messages Hook — `src/hooks/useMessages.ts`

**Manages messages for the currently active chat.** Handles fetching history, sending new
messages, pagination ("load older"), and typing indicators.

`	ypescript
// ui-tauri/src/hooks/useMessages.ts — ACTUAL CODE

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

  // Fetch messages when the active chat changes
  useEffect(() => {
    if (peer) fetchMessages(peer);     // Calls: GET /messages?peer=X&limit=50&offset=0
  }, [peer, fetchMessages]);

  // Send a message (called when user presses Enter)
  const send = useCallback(async (text: string) => {
    if (!peer || !text.trim()) return;
    await sendMessage(peer, text.trim());   // Calls: POST /messages
    updateLastMessage(peer, text.trim(), new Date().toISOString());
  }, [peer, sendMessage, updateLastMessage]);

  // Load older messages (called when user scrolls to top)
  const loadOlder = useCallback(() => {
    if (peer) loadMore(peer);    // Calls: GET /messages?peer=X&limit=50&offset=<current_count>
  }, [peer, loadMore]);

  const isTyping = peer ? typingUsers[peer] ?? false : false;

  return { messages, hasMore, loading, sending, send, loadOlder, isTyping };
}
`

**Backend calls triggered by this hook:**

| User Action | Hook Method | API Call | Backend Endpoint |
|-------------|-------------|----------|-----------------|
| Opens a chat with "bob" | `useEffect → fetchMessages("bob")` | `api.getMessages("bob", 50, 0)` | `GET /messages?peer=bob&limit=50&offset=0` |
| Scrolls to top of chat | `loadOlder()` | `api.getMessages("bob", 50, 50)` | `GET /messages?peer=bob&limit=50&offset=50` |
| Presses Enter to send | `send("hello!")` | `api.sendMessage("bob", "hello!")` | `POST /messages` with `{"to":"bob","text":"hello!"}` |

---

### 2.6 Contacts Hook — `src/hooks/useContacts.ts`

**Fetches the friends list and polls for updates every 10 seconds.**

`	ypescript
// ui-tauri/src/hooks/useContacts.ts — ACTUAL CODE

import { useEffect } from "react";
import { useContactStore } from "@/stores/contactStore";
import { POLL_INTERVAL_MS } from "@/lib/constants";

export function useContacts() {
  const contacts = useContactStore((s) => s.contacts);
  const loading = useContactStore((s) => s.loading);
  const error = useContactStore((s) => s.error);
  const searchQuery = useContactStore((s) => s.searchQuery);
  const fetchContacts = useContactStore((s) => s.fetchContacts);
  const setSearchQuery = useContactStore((s) => s.setSearchQuery);

  useEffect(() => {
    fetchContacts();                                    // Initial fetch
    const interval = setInterval(fetchContacts, POLL_INTERVAL_MS * 5);  // Every 10s
    return () => clearInterval(interval);
  }, [fetchContacts]);

  // Filter + sort: online friends first, then by most recent message
  const filtered = searchQuery
    ? contacts.filter((c) => c.username.toLowerCase().includes(searchQuery.toLowerCase()))
    : contacts;

  const sorted = [...filtered].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;    // Online first
    if (a.lastMessageTime && b.lastMessageTime) {
      return new Date(b.lastMessageTime).getTime()
           - new Date(a.lastMessageTime).getTime();          // Recent first
    }
    return a.username.localeCompare(b.username);             // Alphabetical
  });

  return { contacts: sorted, loading, error, searchQuery, setSearchQuery };
}
`

**Backend calls:**

| Trigger | API Call | Backend Endpoint |
|---------|----------|-----------------|
| Component mounts | `api.listFriends()` | `GET /friends` |
| Every 10 seconds | `api.listFriends()` | `GET /friends` |

**Why poll?** The WebSocket handles online/offline events in real-time, but polling
`/friends` catches any changes the WebSocket might miss (like a new friend added
from another device, or backend restart).

---

### 2.7 Chat Store — `src/stores/chatStore.ts`

**Zustand store that holds all message data and calls the API.**

`	ypescript
// ui-tauri/src/stores/chatStore.ts — KEY PARTS

export const useChatStore = create<ChatState>((set, get) => ({
  activeChat: null,                    // Currently open chat (username or null)
  messages: {},                        // Record<peer, Message[]>
  hasMore: {},                         // Record<peer, boolean> — for pagination
  loadingMessages: false,
  sendingMessage: false,
  typingUsers: {},                     // Record<peer, boolean>

  fetchMessages: async (peer, offset = 0) => {
    set({ loadingMessages: true });
    try {
      // ──► BACKEND CALL: GET /messages?peer=X&limit=50&offset=Y
      const res = await api.getMessages(peer, MESSAGE_PAGE_SIZE, offset);

      set((state) => ({
        messages: {
          ...state.messages,
          [peer]: offset === 0
            ? res.messages                                         // Fresh load
            : [...res.messages, ...(state.messages[peer] ?? [])],  // Prepend older
        },
        hasMore: { ...state.hasMore, [peer]: res.has_more },
        loadingMessages: false,
      }));
    } catch (err) {
      console.error("Failed to fetch messages:", err);
      set({ loadingMessages: false });
    }
  },

  sendMessage: async (to, text) => {
    set({ sendingMessage: true });
    try {
      // ──► BACKEND CALL: POST /messages with {"to":"...","text":"..."}
      const res = await api.sendMessage(to, text);

      // Optimistic update: add the message to the UI immediately
      const optimistic: Message = {
        msg_id: res.msg_id,
        from: "",                       // Our username (filled by store context)
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
      throw err;                        // Re-throw so the UI can show an error
    } finally {
      set({ sendingMessage: false });
    }
  },

  addMessage: (msg) => set((state) => {
    const peer = msg.direction === "sent" ? msg.to : msg.from;
    const existing = state.messages[peer] ?? [];
    // Deduplicate by msg_id (prevents double-adds from WS + optimistic)
    if (existing.some((m) => m.msg_id === msg.msg_id)) return state;
    return { messages: { ...state.messages, [peer]: [...existing, msg] } };
  }),

  setTyping: (username, typing) => {
    set((state) => ({
      typingUsers: { ...state.typingUsers, [username]: typing },
    }));
    // Auto-clear typing after 5 seconds if no update
    if (typing) {
      setTimeout(() => {
        set((state) => ({
          typingUsers: { ...state.typingUsers, [username]: false },
        }));
      }, 5000);
    }
  },
}));
`

**Backend calls from this store:**

| Store Method | API Call | Backend Endpoint |
|-------------|----------|-----------------|
| `fetchMessages(peer)` | `api.getMessages(peer, 50, offset)` | `GET /messages?peer=X&limit=50&offset=Y` |
| `sendMessage(to, text)` | `api.sendMessage(to, text)` | `POST /messages` |

**Important: Optimistic Updates.** When the user sends a message, the store adds it to the
UI immediately (before the server confirms). This makes the app feel instant. The `msg_id`
from the server response prevents duplicates if the WebSocket also delivers the same message.

---

### 2.8 Contact Store — `src/stores/contactStore.ts`

**Zustand store that holds the friends list and manages online/offline state.**

`	ypescript
// ui-tauri/src/stores/contactStore.ts — KEY PARTS

export const useContactStore = create<ContactState>((set, get) => ({
  contacts: [],          // ContactWithPreview[]
  loading: false,
  error: null,
  searchQuery: "",

  fetchContacts: async () => {
    set({ loading: true, error: null });
    try {
      // ──► BACKEND CALL: GET /friends
      const friends: Contact[] = await api.listFriends();

      // Merge with existing UI-only data (lastMessage, unreadCount)
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
      // ──► BACKEND CALL: POST /friends with {"username":"bob"}
      const friend = await api.addFriend(username);
      set((state) => ({
        contacts: [...state.contacts, { ...friend, unreadCount: 0 }],
        error: null,
      }));
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  removeFriend: async (username: string) => {
    try {
      // ──► BACKEND CALL: DELETE /friends/bob
      await api.removeFriend(username);
      set((state) => ({
        contacts: state.contacts.filter((c) => c.username !== username),
      }));
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  // These are called by useWebSocket when WS events arrive:
  setOnline: (username) => set((state) => ({
    contacts: state.contacts.map((c) =>
      c.username === username ? { ...c, online: true } : c
    ),
  })),

  setOffline: (username) => set((state) => ({
    contacts: state.contacts.map((c) =>
      c.username === username
        ? { ...c, online: false, last_seen: new Date().toISOString() }
        : c
    ),
  })),
}));
`

**Backend calls from this store:**

| Store Method | API Call | Backend Endpoint |
|-------------|----------|-----------------|
| `fetchContacts()` | `api.listFriends()` | `GET /friends` |
| `addFriend(username)` | `api.addFriend(username)` | `POST /friends` |
| `removeFriend(username)` | `api.removeFriend(username)` | `DELETE /friends/:username` |

---

### 2.9 App Root — `src/App.tsx`

**Polls the backend health check every 6 seconds to show connection status.**

`	ypescript
// ui-tauri/src/App.tsx — ACTUAL CODE

import { useEffect } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useTheme } from "@/hooks/useTheme";
import { useUIStore } from "@/stores/uiStore";
import { api } from "@/services/api";
import { POLL_INTERVAL_MS } from "@/lib/constants";

export default function App() {
  useTheme();
  useWebSocket();    // ◄── Connects WebSocket on app start

  const setBackendConnected = useUIStore((s) => s.setBackendConnected);

  // Poll backend health every 6 seconds (POLL_INTERVAL_MS * 3 = 2000 * 3)
  useEffect(() => {
    const check = async () => {
      try {
        await api.getStatus();            // ──► GET /status
        setBackendConnected(true);         // Green indicator
      } catch {
        setBackendConnected(false);        // Red indicator
      }
    };
    check();                               // Check immediately on mount
    const interval = setInterval(check, POLL_INTERVAL_MS * 3);
    return () => clearInterval(interval);
  }, [setBackendConnected]);

  return <AppShell />;
}
`

**Backend calls from App.tsx:**

| Trigger | API Call | Backend Endpoint | On Success | On Failure |
|---------|----------|-----------------|------------|-----------|
| App starts + every 6s | `api.getStatus()` | `GET /status` | `uiStore.backendConnected = true` | `uiStore.backendConnected = false` |

---

### 2.10 Complete File → Endpoint Map

Here's the full picture of which files call which endpoints:

`
Frontend File                    Backend Endpoint
─────────────────────────────    ─────────────────────────────
src/App.tsx                  ──► GET  /status  (every 6s)

src/services/api.ts          ──► ALL REST endpoints (the HTTP client)
src/services/websocket.ts    ──► ws://127.0.0.1:8081/events

src/hooks/useWebSocket.ts    ──► Subscribes to WS events
src/hooks/useContacts.ts     ──► GET  /friends  (every 10s via contactStore)
src/hooks/useMessages.ts     ──► GET  /messages  (on chat open, via chatStore)
                             ──► POST /messages  (on send, via chatStore)

src/stores/chatStore.ts      ──► GET  /messages?peer=X  (via api.getMessages)
                             ──► POST /messages          (via api.sendMessage)

src/stores/contactStore.ts   ──► GET    /friends         (via api.listFriends)
                             ──► POST   /friends         (via api.addFriend)
                             ──► DELETE /friends/:user   (via api.removeFriend)
`

---

## 3. What You Need to Add to the C++ Backend

The C++ backend currently has the REST API structure (`local_api.cpp`), but the
**WebSocket server does not exist yet**. You need to create it.

### 3.1 What Already Exists

`
backend/
├── src/api/local_api.cpp      ← REST API on :8080 (endpoints are TODO stubs)
├── include/api/local_api.h    ← Header for REST API
├── src/main.cpp               ← Entry point
├── src/network/               ← P2P networking (peer_server, peer_client)
├── src/crypto/                ← libsodium encryption
├── src/supabase/              ← Supabase REST client
└── config.example.json        ← Configuration template
`

### 3.2 What You Need to Create: WebSocket Event Server

**New files to create:**
- `backend/include/network/ws_event_server.h`
- `backend/src/network/ws_event_server.cpp`

The WebSocket server runs on port **8081** and has one path: `/events`.

#### Header File

`cpp
// backend/include/network/ws_event_server.h
#pragma once

#include <boost/beast/core.hpp>
#include <boost/beast/websocket.hpp>
#include <boost/asio.hpp>
#include <nlohmann/json.hpp>
#include <memory>
#include <set>
#include <string>
#include <mutex>
#include <functional>

namespace beast     = boost::beast;
namespace websocket = beast::websocket;
namespace net       = boost::asio;
using tcp           = net::ip::tcp;
using json          = nlohmann::json;

// Represents one connected frontend WebSocket client
class WSSession : public std::enable_shared_from_this<WSSession> {
public:
    explicit WSSession(tcp::socket socket);
    void start();
    void send(const std::string& msg);

private:
    void do_read();
    void on_read(beast::error_code ec, std::size_t bytes_transferred);

    websocket::stream<beast::tcp_stream> ws_;
    beast::flat_buffer buffer_;

public:
    // Callback for messages from frontend (typing, mark_read)
    using ClientEventHandler = std::function<void(const json&)>;
    ClientEventHandler on_client_event;
};

// The WebSocket server — accepts connections, broadcasts events
class WSEventServer {
public:
    WSEventServer(net::io_context& io, uint16_t port);

    void start();
    void stop();

    // Broadcast a JSON event to ALL connected frontends
    void broadcast(const json& event);

    // Convenience methods for common events
    void push_new_message(const json& message_data);
    void push_friend_online(const std::string& username);
    void push_friend_offline(const std::string& username);
    void push_typing(const std::string& username, bool typing);

    // Callback for events received from frontend
    using ClientEventHandler = std::function<void(const json&)>;
    void set_on_client_event(ClientEventHandler handler);

private:
    void do_accept();

    tcp::acceptor acceptor_;
    std::set<std::shared_ptr<WSSession>> sessions_;
    std::mutex sessions_mutex_;
    ClientEventHandler on_client_event_;
};
`

#### Implementation File

`cpp
// backend/src/network/ws_event_server.cpp

#include "network/ws_event_server.h"
#include <spdlog/spdlog.h>
#include <iostream>

// ── WSSession ───────────────────────────────────────────────

WSSession::WSSession(tcp::socket socket)
    : ws_(std::move(socket)) {}

void WSSession::start() {
    // Accept the WebSocket handshake
    ws_.async_accept([self = shared_from_this()](beast::error_code ec) {
        if (ec) {
            spdlog::error("[WS] Accept failed: {}", ec.message());
            return;
        }
        spdlog::info("[WS] Client connected");
        self->do_read();
    });
}

void WSSession::send(const std::string& msg) {
    // Post to the strand to be thread-safe
    net::post(ws_.get_executor(), [self = shared_from_this(), msg]() {
        beast::error_code ec;
        self->ws_.text(true);
        self->ws_.write(net::buffer(msg), ec);
        if (ec) {
            spdlog::error("[WS] Send failed: {}", ec.message());
        }
    });
}

void WSSession::do_read() {
    ws_.async_read(buffer_,
        [self = shared_from_this()](beast::error_code ec, std::size_t bytes) {
            self->on_read(ec, bytes);
        });
}

void WSSession::on_read(beast::error_code ec, std::size_t /*bytes_transferred*/) {
    if (ec == websocket::error::closed) {
        spdlog::info("[WS] Client disconnected");
        return;
    }
    if (ec) {
        spdlog::error("[WS] Read error: {}", ec.message());
        return;
    }

    // Parse the message from the frontend (typing, mark_read events)
    try {
        std::string data = beast::buffers_to_string(buffer_.data());
        json event = json::parse(data);

        spdlog::debug("[WS] Received from client: {}", event.dump());

        if (on_client_event) {
            on_client_event(event);
        }
    } catch (const json::parse_error& e) {
        spdlog::error("[WS] JSON parse error: {}", e.what());
    }

    buffer_.consume(buffer_.size());
    do_read();  // Keep reading
}

// ── WSEventServer ───────────────────────────────────────────

WSEventServer::WSEventServer(net::io_context& io, uint16_t port)
    : acceptor_(io, tcp::endpoint(tcp::v4(), port)) {
    spdlog::info("[WS] Event server will listen on port {}", port);
}

void WSEventServer::start() {
    do_accept();
    spdlog::info("[WS] Event server started");
}

void WSEventServer::stop() {
    acceptor_.close();
    std::lock_guard<std::mutex> lock(sessions_mutex_);
    sessions_.clear();
    spdlog::info("[WS] Event server stopped");
}

void WSEventServer::do_accept() {
    acceptor_.async_accept([this](beast::error_code ec, tcp::socket socket) {
        if (ec) {
            spdlog::error("[WS] Accept error: {}", ec.message());
            return;
        }

        auto session = std::make_shared<WSSession>(std::move(socket));

        // Forward client events (typing, mark_read) to the handler
        session->on_client_event = [this](const json& event) {
            if (on_client_event_) {
                on_client_event_(event);
            }
        };

        {
            std::lock_guard<std::mutex> lock(sessions_mutex_);
            sessions_.insert(session);
        }

        session->start();
        do_accept();  // Accept next connection
    });
}

void WSEventServer::broadcast(const json& event) {
    std::string msg = event.dump();
    std::lock_guard<std::mutex> lock(sessions_mutex_);
    for (auto& session : sessions_) {
        session->send(msg);
    }
}

// ── Convenience Methods ─────────────────────────────────────

void WSEventServer::push_new_message(const json& message_data) {
    broadcast({{"event", "new_message"}, {"data", message_data}});
}

void WSEventServer::push_friend_online(const std::string& username) {
    broadcast({{"event", "friend_online"}, {"data", {{"username", username}}}});
}

void WSEventServer::push_friend_offline(const std::string& username) {
    broadcast({{"event", "friend_offline"}, {"data", {{"username", username}}}});
}

void WSEventServer::push_typing(const std::string& username, bool typing) {
    broadcast({
        {"event", "typing"},
        {"data", {{"username", username}, {"typing", typing}}}
    });
}

void WSEventServer::set_on_client_event(ClientEventHandler handler) {
    on_client_event_ = std::move(handler);
}
`

#### Wire It Into `main.cpp`

`cpp
// In backend/src/main.cpp — add these lines:

#include "network/ws_event_server.h"

int main() {
    // ... existing code ...

    // Create the WebSocket event server on port 8081
    uint16_t ws_port = 8081;  // or read from config.json
    WSEventServer ws_server(io_context, ws_port);
    ws_server.start();

    // Handle typing/mark_read events from the frontend
    ws_server.set_on_client_event([&](const json& event) {
        std::string type = event["event"];
        if (type == "typing") {
            // Forward typing indicator to the peer via TCP
            std::string to = event["data"]["to"];
            bool typing = event["data"]["typing"];
            // node.send_typing_indicator(to, typing);
        } else if (type == "mark_read") {
            // Mark messages as read in the database
            std::string peer = event["data"]["peer"];
            std::string msg_id = event["data"]["msg_id"];
            // node.mark_messages_read(peer, msg_id);
        }
    });

    // When a P2P message arrives, push it to the frontend:
    node.set_on_message_received([&](const Message& msg) {
        json data;
        data["msg_id"] = msg.id;
        data["from"] = msg.from;
        data["to"] = msg.to;
        data["text"] = msg.plaintext;
        data["timestamp"] = msg.timestamp;
        data["direction"] = "received";
        data["delivered"] = true;
        data["delivery_method"] = "direct";
        ws_server.push_new_message(data);
    });

    // When a friend comes online/offline (from Supabase polling):
    node.set_on_friend_online([&](const std::string& username) {
        ws_server.push_friend_online(username);
    });
    node.set_on_friend_offline([&](const std::string& username) {
        ws_server.push_friend_offline(username);
    });

    io_context.run();
}
`

#### Add to `CMakeLists.txt`

`cmake
# Add the new source file to your existing target:
target_sources(secure-p2p-chat PRIVATE
    src/network/ws_event_server.cpp
    # ... other source files ...
)

# Make sure Boost.Beast is linked (it's header-only, but needs Boost):
find_package(Boost REQUIRED COMPONENTS system)
target_link_libraries(secure-p2p-chat PRIVATE Boost::system)
`

---

## 4. Message Flow Walkthroughs

### 4.1 Sending a Message

**Scenario:** Alice types "Hey Bob!" and presses Enter.

`
Step 1: USER TYPES AND PRESSES ENTER
  ┌─────────────────────────────────────────────────┐
  │  ComposeArea.tsx                                 │
  │  User types "Hey Bob!" → presses Enter          │
  │  Calls: useMessages.send("Hey Bob!")             │
  └──────────────────┬──────────────────────────────┘
                     │
Step 2: HOOK CALLS THE STORE
  ┌──────────────────▼──────────────────────────────┐
  │  chatStore.sendMessage("bob", "Hey Bob!")        │
  │  Sets: sendingMessage = true                     │
  └──────────────────┬──────────────────────────────┘
                     │
Step 3: STORE CALLS THE API
  ┌──────────────────▼──────────────────────────────┐
  │  api.sendMessage("bob", "Hey Bob!")              │
  │  HTTP: POST http://127.0.0.1:8080/messages       │
  │  Body: {"to": "bob", "text": "Hey Bob!"}        │
  └──────────────────┬──────────────────────────────┘
                     │
Step 4: C++ BACKEND PROCESSES
  ┌──────────────────▼──────────────────────────────┐
  │  local_api.cpp receives POST /messages           │
  │  1. Parse JSON body                              │
  │  2. Look up bob's public key from SQLite         │
  │  3. Encrypt with libsodium (crypto_box_easy)     │
  │  4. Sign with Ed25519                            │
  │  5. Check if bob is online (Supabase heartbeat)  │
  └──────────────────┬──────────────────────────────┘
                     │
              ┌──────┴──────┐
              │             │
Step 5a: BOB IS ONLINE      Step 5b: BOB IS OFFLINE
  ┌───────────▼────────┐    ┌──────────▼────────────┐
  │  Send via TCP      │    │  Push to Supabase      │
  │  to bob's IP:port  │    │  POST /rest/v1/messages │
  │  (direct P2P)      │    │  (encrypted blob)      │
  └───────────┬────────┘    └──────────┬────────────┘
              │                        │
Step 6: BACKEND RESPONDS
  ┌───────────▼────────────────────────▼────────────┐
  │  HTTP Response:                                  │
  │  {                                               │
  │    "msg_id": "a1b2c3d4-...",                     │
  │    "delivered": true,          // or false        │
  │    "delivery_method": "direct" // or "offline"    │
  │  }                                               │
  └──────────────────┬──────────────────────────────┘
                     │
Step 7: FRONTEND SHOWS IT
  ┌──────────────────▼──────────────────────────────┐
  │  chatStore.addMessage(optimisticMessage)          │
  │  Message appears in chat with:                   │
  │  - ✓ check if delivered=true                     │
  │  - 🕐 clock if delivered=false                   │
  │  - "direct" or "offline" delivery label          │
  └─────────────────────────────────────────────────┘
`

**What the backend MUST return:**

`json
// Success — message delivered directly to online peer
{
  "msg_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "delivered": true,
  "delivery_method": "direct"
}

// Success — peer offline, stored in Supabase for later
{
  "msg_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "delivered": false,
  "delivery_method": "offline"
}

// Error — friend not found
// HTTP 404
{
  "error": "User 'bob' not found in friends list"
}
`

---

### 4.2 Receiving a Message

**Scenario:** Bob sends Alice a message. Alice's app is open.

`
Step 1: BOB'S BACKEND SENDS TCP
  ┌─────────────────────────────────────────────────┐
  │  Bob's C++ backend sends encrypted message       │
  │  via TCP to Alice's IP:9100                      │
  └──────────────────┬──────────────────────────────┘
                     │
Step 2: ALICE'S BACKEND RECEIVES
  ┌──────────────────▼──────────────────────────────┐
  │  peer_server.cpp accepts TCP connection          │
  │  1. Read length-prefixed message                 │
  │  2. Parse JSON envelope                          │
  │  3. Verify Ed25519 signature                     │
  │  4. Decrypt with libsodium (crypto_box_open_easy)│
  │  5. Store plaintext in local SQLite              │
  └──────────────────┬──────────────────────────────┘
                     │
Step 3: BACKEND PUSHES VIA WEBSOCKET
  ┌──────────────────▼──────────────────────────────┐
  │  ws_event_server.cpp broadcasts:                 │
  │  {                                               │
  │    "event": "new_message",                       │
  │    "data": {                                     │
  │      "msg_id": "x9y8z7...",                      │
  │      "from": "bob",                              │
  │      "to": "alice",                              │
  │      "text": "Hey Alice!",                       │
  │      "timestamp": "2025-06-15T10:31:00Z",        │
  │      "direction": "received",                    │
  │      "delivered": true,                          │
  │      "delivery_method": "direct"                 │
  │    }                                             │
  │  }                                               │
  └──────────────────┬──────────────────────────────┘
                     │
Step 4: FRONTEND HOOK HANDLES IT
  ┌──────────────────▼──────────────────────────────┐
  │  useWebSocket.ts → handleEvent:                  │
  │  case "new_message":                             │
  │    chatStore.addMessage(event.data)              │
  │    contactStore.updateLastMessage("bob", ...)    │
  │    if (activeChat !== "bob")                     │
  │      contactStore.incrementUnread("bob")         │
  └──────────────────┬──────────────────────────────┘
                     │
Step 5: UI UPDATES
  ┌──────────────────▼──────────────────────────────┐
  │  - New message bubble appears in bob's chat      │
  │  - Sidebar shows "Hey Alice!" as last message    │
  │  - If bob's chat isn't open: unread badge +1     │
  │  - Desktop notification (if enabled)             │
  └─────────────────────────────────────────────────┘
`

---

### 4.3 Friend Going Online

**Scenario:** Bob starts his app. Alice sees him come online.

`
Step 1: BOB STARTS HIS APP
  ┌─────────────────────────────────────────────────┐
  │  Bob's backend starts up                         │
  │  Sends heartbeat to Supabase:                    │
  │  PATCH /rest/v1/users?username=eq.bob            │
  │  Body: {"last_seen": "now", "last_ip": "1.2.3.4",│
  │         "listen_port": 9100}                     │
  └─────────────────────────────────────────────────┘

Step 2: ALICE'S BACKEND DETECTS IT
  ┌─────────────────────────────────────────────────┐
  │  Alice's backend polls Supabase every 30s:       │
  │  GET /rest/v1/users?username=in.(bob,charlie)    │
  │                                                  │
  │  Sees bob's last_seen is recent → "he's online!" │
  └──────────────────┬──────────────────────────────┘
                     │
Step 3: BACKEND PUSHES WEBSOCKET EVENT
  ┌──────────────────▼──────────────────────────────┐
  │  ws_event_server.push_friend_online("bob")       │
  │  Sends: {"event":"friend_online",                │
  │          "data":{"username":"bob"}}               │
  └──────────────────┬──────────────────────────────┘
                     │
Step 4: FRONTEND UPDATES
  ┌──────────────────▼──────────────────────────────┐
  │  useWebSocket.ts → handleEvent:                  │
  │  case "friend_online":                           │
  │    contactStore.setOnline("bob")                 │
  │                                                  │
  │  UI: Green dot appears next to Bob's name        │
  └─────────────────────────────────────────────────┘
`

---

### 4.4 Adding a Friend

**Scenario:** Alice wants to add Bob as a friend. She only knows his username.

`
Step 1: ALICE OPENS ADD FRIEND DIALOG
  ┌─────────────────────────────────────────────────┐
  │  AddFriendDialog.tsx                             │
  │  Alice types "bob" and clicks Add                │
  │  Calls: contactStore.addFriend("bob")            │
  └──────────────────┬──────────────────────────────┘
                     │
Step 2: STORE CALLS THE API
  ┌──────────────────▼──────────────────────────────┐
  │  api.addFriend("bob")                            │
  │  HTTP: POST http://127.0.0.1:8080/friends        │
  │  Body: {"username": "bob"}                       │
  └──────────────────┬──────────────────────────────┘
                     │
Step 3: C++ BACKEND LOOKS UP BOB IN SUPABASE
  ┌──────────────────▼──────────────────────────────┐
  │  local_api.cpp receives POST /friends            │
  │  1. Parse {"username": "bob"}                    │
  │  2. Query Supabase:                              │
  │     GET /rest/v1/users?username=eq.bob           │
  │  3. If found: get bob's public_key, signing_key  │
  │  4. Store in local SQLite friends table          │
  └──────────────────┬──────────────────────────────┘
                     │
              ┌──────┴──────────────┐
              │                     │
       BOB FOUND               BOB NOT FOUND
  ┌───────────▼────────┐    ┌──────▼────────────────┐
  │  HTTP 201 Created  │    │  HTTP 404 Not Found    │
  │  {                 │    │  {                     │
  │    "username":"bob",│    │    "error":"User       │
  │    "public_key":".",│    │     'bob' not found"   │
  │    "signing_key":".",│   │  }                     │
  │    "online": true,  │    └───────────────────────┘
  │    "last_seen":".",  │
  │    "last_ip":".",    │    ALREADY FRIENDS
  │    "added_at":"."   │    ┌──────────────────────┐
  │  }                 │    │  HTTP 409 Conflict    │
  └───────────┬────────┘    │  {                    │
              │             │    "error":"Already    │
              │             │     friends with bob"  │
              │             │  }                     │
              │             └──────────────────────┘
              │
Step 4: FRONTEND UPDATES
  ┌───────────▼────────────────────────────────────┐
  │  contactStore.addFriend() success:              │
  │  - Adds bob to contacts list                   │
  │  - Closes the dialog                           │
  │  - Bob appears in sidebar                      │
  │                                                │
  │  contactStore.addFriend() failure:              │
  │  - Sets store.error = "User not found"         │
  │  - Dialog shows red error message              │
  └────────────────────────────────────────────────┘
`

---
