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

```
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
 │  │  │  services/api.ts ───► HTTP ─────────────► localhost:8080     │
 │  │  │  services/websocket.ts ─► WS ───────────► localhost:8081     │
 │  │  │                                   │   │        │    │          │
 │  │  └───────────────────────────────────┘   │        │    │          │
 │  └─────────────────────────────────────────┘        │    │          │
 │                                                          │    │          │
 │  ┌─────────────────────────────────────────┐        │    │          │
 │  │      C++ Backend (Sidecar Process)      │────────┘    │          │
 │  │                                         │              │          │
 │  │  :8080  REST API   (LocalAPI)           │              │          │
 │  │  :8081  WebSocket  (WSEventServer)  ────┘              │          │
 │  │  :9100  TCP P2P    (PeerServer)     ───────────────┘          │
 │  │                                         │                        │
 │  │  Internal:                               │                        │
 │  │    libsodium (encryption)                │                        │
 │  │    SQLite   (local message store)        │                        │
 │  │    libcurl  (HTTP to Supabase)           │                        │
 │  │                                         │                        │
 │  └─────────────────────────────────────────┘                        │
 │          │                 │                                          │
 └──────────┴─────────────────┴──────────────────────────────────────────┘
          │                 │
          │  TCP            │  HTTPS
          ▼                 ▼
   ┌───────────┐    ┌─────────────────┐
   │  Peer's   │    │    Supabase      │
   │  Backend  │    │  (PostgreSQL +  │
   │  :9100    │    │   REST API)     │
   └───────────┘    └─────────────────┘
```

### Simple Summary

```
User → React UI → Tauri → HTTP/WS → C++ Backend → TCP to peer / Supabase
```

### Golden Rules (Read This Twice)

| Rule | Why |
|------|-----|
| Frontend **NEVER** does encryption | All crypto happens in C++ with libsodium |
| Frontend **NEVER** talks to Supabase directly | Backend handles all Supabase communication via libcurl |
| Frontend **NEVER** does any networking beyond localhost | Security: only 127.0.0.1 connections |
| Frontend **NEVER** touches the SQLite database | Backend owns the database exclusively |
| Frontend **ONLY** talks to `127.0.0.1:8080` (REST) and `127.0.0.1:8081` (WebSocket) | These are the only two connection points |

---

## 2. Where Backend Connections Live in Frontend Code

This section shows you **every file** that talks to the backend,
with the **complete source code** and explanations.

### 2.1 `lib/constants.ts` — Connection Configuration

**Location:** `ui-tauri/src/lib/constants.ts`

This file defines ALL connection parameters. Every other file imports from here.

```typescript
export const API_BASE_URL = "http://127.0.0.1:8080";
export const WS_URL = "ws://127.0.0.1:8081/events";

export const POLL_INTERVAL_MS = 2000;
export const WS_RECONNECT_DELAY_MS = 3000;
export const WS_MAX_RECONNECT_ATTEMPTS = 10;

export const MESSAGE_PAGE_SIZE = 50;
export const TYPING_DEBOUNCE_MS = 1000;
export const TYPING_TIMEOUT_MS = 5000;

export const APP_NAME = "P2P Chat";
export const APP_VERSION = "0.1.0";
```

**What each constant does:**

| Constant | Value | Used By | Purpose |
|----------|-------|---------|---------|
| `API_BASE_URL` | `http://127.0.0.1:8080` | `api.ts` | Base URL for all REST API calls |
| `WS_URL` | `ws://127.0.0.1:8081/events` | `websocket.ts` | WebSocket endpoint for real-time events |
| `POLL_INTERVAL_MS` | `2000` (2s) | `App.tsx`, `useContacts.ts` | Base interval for polling |
| `WS_RECONNECT_DELAY_MS` | `3000` (3s) | `websocket.ts` | Base delay before WS reconnect |
| `WS_MAX_RECONNECT_ATTEMPTS` | `10` | `websocket.ts` | Give up after 10 failed reconnects |
| `MESSAGE_PAGE_SIZE` | `50` | `api.ts`, `chatStore.ts` | Messages per page (pagination) |
| `TYPING_DEBOUNCE_MS` | `1000` (1s) | Components | Wait 1s before sending typing event |
| `TYPING_TIMEOUT_MS` | `5000` (5s) | `chatStore.ts` | Clear typing indicator after 5s |

### 2.2 `services/api.ts` — REST API Client (The Main Connection)

**Location:** `ui-tauri/src/services/api.ts`

This is the **most important file** for backend integration. Every REST call
goes through this class. It’s a thin wrapper around `fetch()`.

```typescript
import { API_BASE_URL, MESSAGE_PAGE_SIZE } from "@/lib/constants";
import type { Contact } from "@/types/contact";
import type { StatusResponse, MessagesResponse } from "@/types/api";

class ApiService {
  private baseUrl: string;

  constructor(baseUrl = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    path: string,
    options?: RequestInit
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    if (res.status === 204) return undefined as T;
    return res.json();
  }

  // ── Status ──────────────────────────────────────────────────
  async getStatus(): Promise<StatusResponse> {
    return this.request<StatusResponse>("/status");
  }

  // ── Friends ─────────────────────────────────────────────────
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
    return this.request<void>(`/friends/${encodeURIComponent(username)}`, {
      method: "DELETE",
    });
  }

  // ── Messages ────────────────────────────────────────────────
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
    return this.request<MessagesResponse>(`/messages?${params}`);
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
    return this.request<void>(`/messages/${encodeURIComponent(msgId)}`, {
      method: "DELETE",
    });
  }
}

export const api = new ApiService();
```

**Endpoint Map (api.ts):**

| Method | HTTP Request | Expected Response | Used By |
|--------|-------------|-------------------|---------|
| `getStatus()` | `GET /status` | `StatusResponse` JSON | `App.tsx` health check |
| `listFriends()` | `GET /friends` | `Contact[]` JSON array | `contactStore.fetchContacts` |
| `addFriend(username)` | `POST /friends` `{username}` | `Contact` JSON | `contactStore.addFriend` |
| `removeFriend(username)` | `DELETE /friends/:username` | `204 No Content` | `contactStore.removeFriend` |
| `getMessages(peer, limit, offset)` | `GET /messages?peer=X&limit=50&offset=0` | `MessagesResponse` JSON | `chatStore.fetchMessages` |
| `sendMessage(to, text)` | `POST /messages` `{to, text}` | `{msg_id, delivered, delivery_method}` | `chatStore.sendMessage` |
| `deleteMessage(msgId)` | `DELETE /messages/:id` | `204 No Content` | Chat context menu |

### 2.3 `services/websocket.ts` — Real-Time Event Stream

**Location:** `ui-tauri/src/services/websocket.ts`

This service maintains a persistent WebSocket connection for real-time events.
When a friend sends a message or comes online, the backend pushes an event here
instead of making the frontend poll for it.

```typescript
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
    this.url = url;
  }

  get connected() {
    return this._connected;
  }

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
        console.log("[WS] Disconnected");
        this.scheduleReconnect();
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

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this._connected = false;
  }

  send(event: WSClientEvent) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    }
  }

  subscribe(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= WS_MAX_RECONNECT_ATTEMPTS) {
      console.error("[WS] Max reconnect attempts reached");
      return;
    }
    const delay = WS_RECONNECT_DELAY_MS * Math.pow(1.5, this.reconnectAttempts);
    this.reconnectAttempts++;
    console.log(`[WS] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}

export const websocket = new WebSocketService();
```

**Events Received from Backend (server → frontend):**

| Event | Data Fields | What Happens |
|-------|-------------|-------------|
| `new_message` | `{msg_id, from, to, text, timestamp, direction, delivered, delivery_method}` | New message from a friend |
| `friend_online` | `{username}` | Friend’s backend started / heartbeat detected |
| `friend_offline` | `{username}` | Friend’s heartbeat stopped |
| `typing` | `{username, typing: boolean}` | Friend is typing / stopped typing |

**Events Sent to Backend (frontend → server):**

| Event | Data Fields | When Sent |
|-------|-------------|-----------|
| `typing` | `{to: string, typing: boolean}` | User starts/stops typing in chat |
| `mark_read` | `{peer: string}` | User opens a chat (clear unread) |

**Reconnection Strategy:**

The WebSocket uses exponential backoff: `delay = 3000ms × 1.5^attempt`

| Attempt | Delay |
|---------|-------|
| 1 | 3.0s |
| 2 | 4.5s |
| 3 | 6.75s |
| 4 | 10.1s |
| 5 | 15.2s |
| ... | ... |
| 10 | **Give up** |

### 2.4 `hooks/useWebSocket.ts` — The Event Router

**Location:** `ui-tauri/src/hooks/useWebSocket.ts`

This React hook connects the WebSocket service to the Zustand stores.
It’s the “router” that decides what to do with each incoming event.

```typescript
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
```

**Event Routing Table:**

| WS Event | Store Action | UI Effect |
|----------|-------------|-----------|
| `new_message` | `chatStore.addMessage` + `contactStore.updateLastMessage` + `contactStore.incrementUnread` | Message appears in chat; sidebar shows preview; badge count increases (if not active chat) |
| `friend_online` | `contactStore.setOnline` | Green dot appears next to friend’s name |
| `friend_offline` | `contactStore.setOffline` | Green dot disappears; last_seen updates |
| `typing` | `chatStore.setTyping` | “Alice is typing...” indicator appears in chat |

### 2.5 `hooks/useMessages.ts` — Message Management

**Location:** `ui-tauri/src/hooks/useMessages.ts`

This hook manages messages for the currently open chat. It handles fetching,
sending, loading older messages, and typing indicators.

```typescript
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
```

**User Action → API Call Map:**

| User Action | Hook Method | Store Action | API Call | Endpoint |
|-------------|-------------|-------------|----------|----------|
| Opens a chat | (auto on mount) | `chatStore.fetchMessages` | `api.getMessages(peer)` | `GET /messages?peer=X` |
| Presses Enter | `send(text)` | `chatStore.sendMessage` | `api.sendMessage(to, text)` | `POST /messages` |
| Scrolls to top | `loadOlder()` | `chatStore.loadMoreMessages` | `api.getMessages(peer, 50, offset)` | `GET /messages?peer=X&offset=50` |

### 2.6 `hooks/useContacts.ts` — Contact Polling

**Location:** `ui-tauri/src/hooks/useContacts.ts`

This hook fetches the friend list on mount and polls every 10 seconds
(`POLL_INTERVAL_MS * 5 = 2000 * 5 = 10000ms`) to pick up online/offline changes.

```typescript
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
    fetchContacts();
    const interval = setInterval(fetchContacts, POLL_INTERVAL_MS * 5);
    return () => clearInterval(interval);
  }, [fetchContacts]);

  const filtered = searchQuery
    ? contacts.filter((c) =>
        c.username.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : contacts;

  const sorted = [...filtered].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    if (a.lastMessageTime && b.lastMessageTime) {
      return new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime();
    }
    return a.username.localeCompare(b.username);
  });

  return { contacts: sorted, loading, error, searchQuery, setSearchQuery };
}
```

**Sorting priority:** Online friends first → then by most recent message → then alphabetically.

### 2.7 `stores/chatStore.ts` — Message State Management

**Location:** `ui-tauri/src/stores/chatStore.ts`

The chat store holds all messages in memory, organized by peer username.
It calls the API and handles optimistic updates (showing the message before
the server confirms it).

```typescript
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
```

**Key behaviors:**

- **Deduplication:** `addMessage` checks `msg_id` to prevent duplicate messages
- **Optimistic updates:** `sendMessage` adds the message to the UI immediately after the API responds
- **Pagination:** `loadMoreMessages` uses the current message count as `offset`
- **Typing auto-clear:** `setTyping(username, true)` automatically clears after 5 seconds

### 2.8 `stores/contactStore.ts` — Friend List State Management

**Location:** `ui-tauri/src/stores/contactStore.ts`

The contact store manages the friend list, online/offline status, and
sidebar preview data (last message, unread count).

```typescript
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
```

**Key behaviors:**

- **Preserves frontend-only data:** When re-fetching from backend, `lastMessage`, `lastMessageTime`, and `unreadCount` are preserved from the previous state (the backend doesn’t track these)
- **Error propagation:** `addFriend` and `removeFriend` both `throw` so the calling component can show error toasts
- **Optimistic removal:** `removeFriend` removes the contact from the list immediately after the API succeeds

### 2.9 `App.tsx` — Backend Health Check

**Location:** `ui-tauri/src/App.tsx`

The root component polls the backend health endpoint every 6 seconds
(`POLL_INTERVAL_MS * 3 = 2000 * 3 = 6000ms`). This determines whether
to show the “backend disconnected” warning banner.

```typescript
import { useEffect } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useTheme } from "@/hooks/useTheme";
import { useUIStore } from "@/stores/uiStore";
import { api } from "@/services/api";
import { POLL_INTERVAL_MS } from "@/lib/constants";

export default function App() {
  useTheme();
  useWebSocket();

  const setBackendConnected = useUIStore((s) => s.setBackendConnected);

  // Poll backend health
  useEffect(() => {
    const check = async () => {
      try {
        await api.getStatus();
        setBackendConnected(true);
      } catch {
        setBackendConnected(false);
      }
    };
    check();
    const interval = setInterval(check, POLL_INTERVAL_MS * 3);
    return () => clearInterval(interval);
  }, [setBackendConnected]);

  return <AppShell />;
}
```

**What happens when the backend is offline:**

1. `api.getStatus()` throws (connection refused)
2. `setBackendConnected(false)` is called
3. UI shows a “Backend not connected” warning banner
4. All API calls will fail gracefully until the backend comes back
5. When backend starts up, next health check succeeds → banner disappears

### 2.10 Complete File → Endpoint Map

```
  Frontend Files                    Backend Endpoints
  ──────────────────────────────────    ──────────────────────────────

  App.tsx                           GET /status
    └─ useEffect (health poll)
       └─ api.getStatus() ────────► :8080

  useWebSocket.ts                   ws://127.0.0.1:8081/events
    └─ websocket.connect()
       └─ WebSocket() ────────────► :8081

  useContacts.ts                    GET /friends
    └─ contactStore.fetchContacts()
       └─ api.listFriends() ──────► :8080

  contactStore.ts                   POST /friends
    ├─ addFriend()                    DELETE /friends/:username
    │    └─ api.addFriend() ───────► :8080
    └─ removeFriend()
         └─ api.removeFriend() ────► :8080

  chatStore.ts                      GET /messages?peer=X
    ├─ fetchMessages()                POST /messages
    │    └─ api.getMessages() ─────► :8080
    └─ sendMessage()
         └─ api.sendMessage() ────► :8080
```

---

## 3. What You Need to Add to the C++ Backend

### 3.1 What Already Exists

Here’s the current backend file tree:

```
backend/
├── CMakeLists.txt
├── config.example.json
├── include/
│   ├── api/
│   │   └── local_api.h         ← REST API (headers only)
│   ├── crypto/
│   │   └── crypto_manager.h    ← Encryption (headers only)
│   ├── network/
│   │   ├── peer_client.h       ← TCP client (headers only)
│   │   └── peer_server.h       ← TCP server (headers only)
│   ├── node/
│   │   └── node.h              ← Node identity (headers only)
│   └── supabase/
│       └── supabase_client.h   ← Supabase REST (headers only)
└── src/
    ├── main.cpp                ← Entry point (scaffolding)
    ├── api/
    │   └── local_api.cpp        ← REST handler stubs
    ├── crypto/
    │   └── crypto_manager.cpp   ← Crypto stubs
    ├── network/
    │   ├── peer_client.cpp      ← TCP client stubs
    │   └── peer_server.cpp      ← TCP server stubs
    ├── node/
    │   └── node.cpp             ← Node stubs
    └── supabase/
        └── supabase_client.cpp  ← Supabase stubs
```

> **Status:** All modules have header files and stub implementations.
> The actual logic needs to be built.

### 3.2 New: WebSocket Event Server

The frontend expects a WebSocket server at `ws://127.0.0.1:8081/events`.
You need to create two new files:

#### `include/api/ws_event_server.h`

```cpp
#pragma once

#include <boost/beast/core.hpp>
#include <boost/beast/websocket.hpp>
#include <boost/asio.hpp>
#include <nlohmann/json.hpp>
#include <memory>
#include <set>
#include <mutex>
#include <string>

namespace beast = boost::beast;
namespace websocket = beast::websocket;
namespace net = boost::asio;
using tcp = net::ip::tcp;
using json = nlohmann::json;

// Represents one connected frontend client
class WSSession : public std::enable_shared_from_this<WSSession> {
public:
    explicit WSSession(tcp::socket socket);
    void start();
    void send(const std::string& msg);
    void close();

private:
    void do_accept();
    void do_read();
    void on_read(beast::error_code ec, std::size_t bytes);
    void on_write(beast::error_code ec, std::size_t bytes);

    websocket::stream<beast::tcp_stream> ws_;
    beast::flat_buffer buffer_;
    std::function<void(const std::string&)> on_message_;

    friend class WSEventServer;
};

// Manages all WebSocket connections and broadcasts events
class WSEventServer {
public:
    WSEventServer(net::io_context& ioc, unsigned short port);
    void start();

    // Push events to ALL connected frontends
    void broadcast(const json& event);
    void push_new_message(const json& message_data);
    void push_friend_online(const std::string& username);
    void push_friend_offline(const std::string& username);
    void push_typing(const std::string& username, bool typing);

    // Callback for client events (typing, mark_read)
    std::function<void(const json&)> on_client_event;

private:
    void do_accept();

    net::io_context& ioc_;
    tcp::acceptor acceptor_;
    std::set<std::shared_ptr<WSSession>> sessions_;
    std::mutex sessions_mutex_;
};
```

#### `src/api/ws_event_server.cpp`

```cpp
#include "api/ws_event_server.h"
#include <spdlog/spdlog.h>
#include <iostream>

// ============================================================
// WSSession Implementation
// ============================================================

WSSession::WSSession(tcp::socket socket)
    : ws_(std::move(socket)) {}

void WSSession::start() {
    ws_.set_option(websocket::stream_base::timeout::suggested(beast::role_type::server));
    ws_.async_accept([self = shared_from_this()](beast::error_code ec) {
        if (ec) {
            spdlog::error("[WS] Accept failed: {}", ec.message());
            return;
        }
        spdlog::info("[WS] Client connected");
        self->do_read();
    });
}

void WSSession::do_read() {
    ws_.async_read(buffer_,
        [self = shared_from_this()](beast::error_code ec, std::size_t bytes) {
            self->on_read(ec, bytes);
        });
}

void WSSession::on_read(beast::error_code ec, std::size_t /*bytes*/) {
    if (ec == websocket::error::closed) {
        spdlog::info("[WS] Client disconnected");
        return;
    }
    if (ec) {
        spdlog::error("[WS] Read error: {}", ec.message());
        return;
    }

    std::string msg = beast::buffers_to_string(buffer_.data());
    buffer_.consume(buffer_.size());

    // Forward client events (typing, mark_read) to handler
    if (on_message_) {
        on_message_(msg);
    }

    do_read();  // Continue reading
}

void WSSession::send(const std::string& msg) {
    auto self = shared_from_this();
    net::post(ws_.get_executor(), [self, msg]() {
        self->ws_.async_write(
            net::buffer(msg),
            [self](beast::error_code ec, std::size_t /*bytes*/) {
                if (ec) {
                    spdlog::error("[WS] Write error: {}", ec.message());
                }
            });
    });
}

void WSSession::close() {
    beast::error_code ec;
    ws_.close(websocket::close_code::normal, ec);
}

// ============================================================
// WSEventServer Implementation
// ============================================================

WSEventServer::WSEventServer(net::io_context& ioc, unsigned short port)
    : ioc_(ioc)
    , acceptor_(ioc, tcp::endpoint(tcp::v4(), port)) {
    spdlog::info("[WS] Event server listening on port {}", port);
}

void WSEventServer::start() {
    do_accept();
}

void WSEventServer::do_accept() {
    acceptor_.async_accept([this](beast::error_code ec, tcp::socket socket) {
        if (ec) {
            spdlog::error("[WS] Accept error: {}", ec.message());
        } else {
            auto session = std::make_shared<WSSession>(std::move(socket));

            // Wire up client event handler
            session->on_message_ = [this](const std::string& msg) {
                try {
                    auto event = json::parse(msg);
                    if (on_client_event) {
                        on_client_event(event);
                    }
                } catch (const std::exception& e) {
                    spdlog::error("[WS] Failed to parse client event: {}", e.what());
                }
            };

            {
                std::lock_guard<std::mutex> lock(sessions_mutex_);
                sessions_.insert(session);
            }

            session->start();
        }

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
    broadcast({{"event", "typing"}, {"data", {{"username", username}, {"typing", typing}}}});
}
```

### 3.3 Wire into `main.cpp`

Add the WebSocket server to your main function alongside the REST API:

```cpp
#include "api/ws_event_server.h"

int main() {
    net::io_context ioc;

    // Start REST API on :8080
    LocalAPI rest_api(ioc, 8080);
    rest_api.start();

    // Start WebSocket event server on :8081
    WSEventServer ws_server(ioc, 8081);
    ws_server.start();

    // Wire up: when a message is received from a peer, push to frontend
    peer_server.on_message_received = [&ws_server](const json& msg) {
        ws_server.push_new_message(msg);
    };

    // Wire up: when friend online status changes
    supabase_client.on_friend_online = [&ws_server](const std::string& username) {
        ws_server.push_friend_online(username);
    };
    supabase_client.on_friend_offline = [&ws_server](const std::string& username) {
        ws_server.push_friend_offline(username);
    };

    // Wire up: client events from frontend
    ws_server.on_client_event = [&peer_client](const json& event) {
        if (event["event"] == "typing") {
            // Forward typing indicator to peer
        }
        if (event["event"] == "mark_read") {
            // Update read status in database
        }
    };

    ioc.run();  // Blocks forever
}
```

### 3.4 CMakeLists.txt Addition

Add the new source file and Boost.Beast dependency:

```cmake
# Add to your existing sources list:
set(SOURCES
    src/main.cpp
    src/api/local_api.cpp
    src/api/ws_event_server.cpp    # <-- NEW
    src/crypto/crypto_manager.cpp
    src/network/peer_client.cpp
    src/network/peer_server.cpp
    src/node/node.cpp
    src/supabase/supabase_client.cpp
)

# Add Boost.Beast (WebSocket library)
find_package(Boost REQUIRED COMPONENTS system)
target_link_libraries(${PROJECT_NAME} PRIVATE Boost::system)
```

---

## 4. Message Flow Walkthroughs

These step-by-step walkthroughs show exactly what happens for each major
user action, from click to screen update.

### 4.1 Sending a Message

```
  Alice types "Hello Bob" and presses Enter

  Step 1: ChatInput component
          └─ calls useMessages().send("Hello Bob")

  Step 2: useMessages hook
          └─ calls chatStore.sendMessage("bob", "Hello Bob")

  Step 3: chatStore.sendMessage()
          └─ calls api.sendMessage("bob", "Hello Bob")

  Step 4: api.ts
          └─ POST http://127.0.0.1:8080/messages
            Body: {"to": "bob", "text": "Hello Bob"}

  Step 5: C++ Backend receives POST /messages
          ├─ Encrypts message with Bob’s public key (libsodium)
          ├─ Signs message with Alice’s signing key
          ├─ Stores in local SQLite database
          └─ Attempts direct TCP delivery to Bob’s :9100

  Step 6a: Bob is ONLINE (direct delivery)
           ├─ TCP connection to bob_ip:9100 succeeds
           ├─ Sends encrypted message
           └─ Response: {"msg_id": "abc-123", "delivered": true,
                       "delivery_method": "direct"}

  Step 6b: Bob is OFFLINE (store for later)
           ├─ TCP connection fails
           ├─ Stores message in Supabase for offline delivery
           └─ Response: {"msg_id": "abc-123", "delivered": false,
                       "delivery_method": "offline"}

  Step 7: chatStore receives response
          ├─ Creates optimistic Message object
          └─ addMessage() adds to messages["bob"] array

  Step 8: React re-renders
          └─ New message bubble appears in chat
             (with ✓ if delivered, clock icon if pending)
```

### 4.2 Receiving a Message

```
  Bob sends "Hey Alice!" from his app

  Step 1: Bob’s backend encrypts and sends via TCP
          └─ TCP connection to alice_ip:9100

  Step 2: Alice’s PeerServer (:9100) receives TCP data
          ├─ Decrypts with Alice’s private key (libsodium)
          ├─ Verifies signature with Bob’s signing key
          └─ Stores in local SQLite database

  Step 3: C++ Backend pushes event via WebSocket
          └─ ws_server.push_new_message({
               "msg_id": "xyz-789",
               "from": "bob",
               "to": "alice",
               "text": "Hey Alice!",
               "timestamp": "2025-01-15T10:30:00Z",
               "direction": "received",
               "delivered": true,
               "delivery_method": "direct"
             })

  Step 4: websocket.ts receives WS message
          └─ Parses JSON, calls all registered handlers

  Step 5: useWebSocket.ts handleEvent()
          ├─ case "new_message":
          ├─ chatStore.addMessage(event.data)
          ├─ contactStore.updateLastMessage("bob", "Hey Alice!", timestamp)
          └─ if bob is NOT the active chat:
              contactStore.incrementUnread("bob")

  Step 6: React re-renders
          ├─ If viewing Bob’s chat: message bubble appears
          └─ If viewing another chat: sidebar shows preview + badge
```

### 4.3 Friend Going Online

```
  Bob starts his app

  Step 1: Bob’s backend starts up
          └─ Sends heartbeat to Supabase (POST /rest/v1/users)
             Sets online=true, updates last_ip and last_seen

  Step 2: Alice’s backend polls Supabase (every ~30 seconds)
          └─ GET /rest/v1/users?username=in.(friend1,friend2,...)
             Detects Bob’s online=true (was false before)

  Step 3: Alice’s backend pushes WebSocket event
          └─ ws_server.push_friend_online("bob")
             Sends: {"event": "friend_online", "data": {"username": "bob"}}

  Step 4: useWebSocket.ts handleEvent()
          └─ case "friend_online":
              contactStore.setOnline("bob")

  Step 5: React re-renders
          └─ Green dot appears next to Bob’s name in sidebar
```

### 4.4 Adding a Friend

```
  Alice clicks "Add Friend" and types "bob"

  Step 1: AddFriendDialog component
          └─ calls contactStore.addFriend("bob")

  Step 2: contactStore.addFriend()
          └─ calls api.addFriend("bob")

  Step 3: api.ts
          └─ POST http://127.0.0.1:8080/friends
            Body: {"username": "bob"}

  Step 4: C++ Backend
          ├─ Queries Supabase: GET /rest/v1/users?username=eq.bob
          └─ Three possible outcomes:

  Step 5a: Bob FOUND
           ├─ Stores Bob’s public key in local database
           └─ Response: 200 {"username": "bob", "public_key": "...",
                     "signing_key": "...", "online": true, ...}

  Step 5b: Bob NOT FOUND
           └─ Response: 404 {"error": "User not found"}

  Step 5c: Already friends
           └─ Response: 409 {"error": "Already friends with bob"}

  Step 6: contactStore receives response
          ├─ On success: adds Bob to contacts array
          └─ On error: sets error state, throws for component to handle

  Step 7: React re-renders
          ├─ On success: Bob appears in sidebar
          └─ On error: Error toast shown in dialog
```

---

## 5. Error Handling

### Error Responses by Endpoint

#### GET /status

| Status | Body | Frontend Behavior |
|--------|------|-------------------|
| `200` | `StatusResponse` JSON | `backendConnected = true` |
| Connection refused | (none) | `backendConnected = false`, warning banner shown |

#### GET /friends

| Status | Body | Frontend Behavior |
|--------|------|-------------------|
| `200` | `Contact[]` JSON array | Updates contact list |
| `500` | `{"error": "Database error"}` | Shows error in sidebar |

#### POST /friends

| Status | Body | Frontend Behavior |
|--------|------|-------------------|
| `200` | `Contact` JSON | Adds friend to list |
| `404` | `{"error": "User not found"}` | Shows error toast in dialog |
| `409` | `{"error": "Already friends with X"}` | Shows error toast in dialog |
| `500` | `{"error": "..."}` | Shows generic error toast |

#### DELETE /friends/:username

| Status | Body | Frontend Behavior |
|--------|------|-------------------|
| `204` | (none) | Removes friend from list |
| `404` | `{"error": "Friend not found"}` | Shows error toast |

#### GET /messages

| Status | Body | Frontend Behavior |
|--------|------|-------------------|
| `200` | `MessagesResponse` JSON | Shows messages in chat |
| `404` | `{"error": "Peer not found"}` | Shows empty chat with error |

#### POST /messages

| Status | Body | Frontend Behavior |
|--------|------|-------------------|
| `200` | `{msg_id, delivered, delivery_method}` | Message appears with status icon |
| `404` | `{"error": "Recipient not found"}` | Error toast, message not sent |
| `500` | `{"error": "Encryption failed"}` | Error toast, message not sent |

#### DELETE /messages/:id

| Status | Body | Frontend Behavior |
|--------|------|-------------------|
| `204` | (none) | Message removed from chat |
| `404` | `{"error": "Message not found"}` | Error toast |

### Error Flow Pattern

```
  api.ts throws Error
     │
     ▼
  Store catches in try/catch
     ├─ Sets error state (for components to display)
     └─ Re-throws (for component-level error handling)
     │
     ▼
  Component catches (optional)
     └─ Shows toast notification or error banner
```

### Backend Offline Handling

When the C++ backend is not running:

1. **REST API calls fail:** `fetch()` throws `TypeError: Failed to fetch`
   - `api.ts` converts this to a thrown `Error`
   - `App.tsx` health check sets `backendConnected = false`
   - UI shows warning banner: “Backend not connected”

2. **WebSocket disconnects:** `ws.onclose` fires
   - `websocket.ts` starts exponential backoff reconnection
   - `useWebSocket.ts` updates `wsConnected = false` every second
   - After 10 failed attempts, gives up

3. **Recovery:** When backend starts up:
   - Next health check (within 6s) succeeds → banner disappears
   - WebSocket reconnects automatically
   - Contact list refreshes (within 10s)

---

## 6. Testing the Connection

### Prerequisites

You need two tools to test the backend:

```bash
# curl - usually pre-installed on macOS/Linux
# On Windows, use Git Bash or install via chocolatey:
choco install curl

# wscat - WebSocket testing tool
npm install -g wscat
```

### Testing REST Endpoints

Start your C++ backend first, then test each endpoint:

#### 1. Health Check

```bash
curl http://127.0.0.1:8080/status
```

Expected response:

```json
{
  "status": "ok",
  "username": "alice",
  "node_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "uptime_seconds": 42,
  "friends_count": 3,
  "peer_port": 9100,
  "supabase_connected": true,
  "version": "0.1.0"
}
```

#### 2. List Friends

```bash
curl http://127.0.0.1:8080/friends
```

Expected response:

```json
[
  {
    "username": "bob",
    "public_key": "base64...",
    "signing_key": "base64...",
    "online": true,
    "last_seen": "2025-01-15T10:30:00Z",
    "last_ip": "192.168.1.42",
    "added_at": "2025-01-10T08:00:00Z"
  }
]
```

#### 3. Add Friend

```bash
curl -X POST http://127.0.0.1:8080/friends \
  -H "Content-Type: application/json" \
  -d '{"username": "charlie"}'
```

Expected response (200 OK):

```json
{
  "username": "charlie",
  "public_key": "base64...",
  "signing_key": "base64...",
  "online": false,
  "last_seen": "2025-01-14T22:00:00Z",
  "last_ip": "10.0.0.5",
  "added_at": "2025-01-15T10:35:00Z"
}
```

Error response (404):

```json
{  "error": "User not found"  }
```

#### 4. Remove Friend

```bash
curl -X DELETE http://127.0.0.1:8080/friends/charlie
```

Expected response: `204 No Content` (empty body)

#### 5. Get Messages

```bash
curl "http://127.0.0.1:8080/messages?peer=bob&limit=50&offset=0"
```

Expected response:

```json
{
  "messages": [
    {
      "msg_id": "abc-123-def-456",
      "from": "bob",
      "to": "alice",
      "text": "Hey Alice!",
      "timestamp": "2025-01-15T10:30:00Z",
      "direction": "received",
      "delivered": true,
      "delivery_method": "direct"
    },
    {
      "msg_id": "ghi-789-jkl-012",
      "from": "alice",
      "to": "bob",
      "text": "Hello Bob!",
      "timestamp": "2025-01-15T10:31:00Z",
      "direction": "sent",
      "delivered": true,
      "delivery_method": "direct"
    }
  ],
  "total": 2,
  "has_more": false
}
```

#### 6. Send Message

```bash
curl -X POST http://127.0.0.1:8080/messages \
  -H "Content-Type: application/json" \
  -d '{"to": "bob", "text": "Hello from curl!"}'
```

Expected response:

```json
{
  "msg_id": "new-uuid-here",
  "delivered": true,
  "delivery_method": "direct"
}
```

#### 7. Delete Message

```bash
curl -X DELETE http://127.0.0.1:8080/messages/abc-123-def-456
```

Expected response: `204 No Content` (empty body)

### Testing WebSocket Events

```bash
# Connect to the WebSocket server
wscat -c ws://127.0.0.1:8081/events
```

Once connected, you should see events when things happen:

```json
// When a friend sends you a message:
{"event": "new_message", "data": {"msg_id": "...", "from": "bob", "text": "Hi!", ...}}

// When a friend comes online:
{"event": "friend_online", "data": {"username": "bob"}}

// When a friend goes offline:
{"event": "friend_offline", "data": {"username": "bob"}}

// When a friend is typing:
{"event": "typing", "data": {"username": "bob", "typing": true}}
```

You can also **send** events from wscat:

```json
// Tell backend you're typing (sends to your peer)
{"event": "typing", "data": {"to": "bob", "typing": true}}

// Mark messages as read
{"event": "mark_read", "data": {"peer": "bob"}}
```

### Frontend + Backend Integration Test

1. Start the C++ backend
2. Start the Tauri frontend (`cd ui-tauri && npm run tauri dev`)
3. Open browser dev tools (F12) → Network tab
4. You should see:
   - `GET /status` every 6 seconds (health check)
   - `GET /friends` on load and every 10 seconds
   - WebSocket connection to `ws://127.0.0.1:8081/events`
5. Click on a friend → should see `GET /messages?peer=...`
6. Type a message and press Enter → should see `POST /messages`

### Two-Node P2P Test

1. Run two instances of the backend with different configs:

```bash
# Terminal 1 (Alice)
./p2p_chat --config alice_config.json    # ports 8080, 8081, 9100

# Terminal 2 (Bob)
./p2p_chat --config bob_config.json      # ports 8082, 8083, 9101
```

2. Add each other as friends
3. Send messages between them
4. Verify messages appear in both UIs

---

## 7. Data Types & JSON Contracts

These are the **exact** TypeScript types the frontend uses.
Your C++ backend must produce JSON that matches these shapes **exactly**.

### StatusResponse

```typescript
// Frontend type (ui-tauri/src/types/api.ts)
interface StatusResponse {
  status: string;            // always "ok" when backend is running
  username: string;          // this node's username
  node_id: string;           // UUID for this node
  uptime_seconds: number;    // seconds since backend started
  friends_count: number;     // number of friends in local database
  peer_port: number;         // P2P listening port (usually 9100)
  supabase_connected: boolean; // true if Supabase is reachable
  version: string;           // app version (e.g., "0.1.0")
}
```

```cpp
// C++ equivalent (use nlohmann/json)
json status_response = {
    {"status", "ok"},
    {"username", node.username()},
    {"node_id", node.id()},
    {"uptime_seconds", get_uptime()},
    {"friends_count", node.friends().size()},
    {"peer_port", 9100},
    {"supabase_connected", supabase.is_connected()},
    {"version", "0.1.0"}
};
```

### Contact

```typescript
// Frontend type (ui-tauri/src/types/contact.ts)
interface Contact {
  username: string;          // unique identifier
  public_key: string;        // Base64-encoded X25519 public key
  signing_key: string;       // Base64-encoded Ed25519 public key
  online: boolean;           // true if friend's heartbeat is recent
  last_seen: string;         // ISO 8601 timestamp (e.g., "2025-01-15T10:30:00Z")
  last_ip: string;           // last known IP address
  added_at: string;          // ISO 8601 timestamp when friendship was created
}

// Extended type for sidebar (frontend-only fields)
interface ContactWithPreview extends Contact {
  lastMessage?: string;      // preview text for sidebar (NOT from backend)
  lastMessageTime?: string;  // ISO 8601 (NOT from backend)
  unreadCount: number;       // unread badge count (NOT from backend)
}
```

> **Important:** `ContactWithPreview` fields (`lastMessage`, `lastMessageTime`,
> `unreadCount`) are **frontend-only**. The backend returns plain `Contact` objects.
> The frontend preserves these fields when re-fetching the contact list.

### Message

```typescript
// Frontend type (ui-tauri/src/types/message.ts)
interface Message {
  msg_id: string;            // UUID - NOTE: "msg_id" NOT "id"!
  from: string;              // sender username
  to: string;                // recipient username
  text: string;              // decrypted message text
  timestamp: string;         // ISO 8601 with Z suffix
  direction: "sent" | "received";  // relative to this user
  delivered: boolean;        // true if peer received it
  delivery_method: "direct" | "offline";  // how it was delivered
  reactions?: string[];      // optional emoji reactions
}
```

> **⚠️ CRITICAL:** The field is called `msg_id`, **NOT** `id`.
> The frontend uses `msg_id` for deduplication in `chatStore.addMessage()`.
> If your backend returns `id` instead, messages will appear as duplicates!

### MessagesResponse

```typescript
interface MessagesResponse {
  messages: Message[];       // array of messages, newest last
  total: number;             // total message count for this peer
  has_more: boolean;         // true if more older messages exist
}
```

### WebSocket Event Types

```typescript
// Events sent from backend TO frontend
type WSEvent =
  | { event: "new_message"; data: Message }
  | { event: "friend_online"; data: { username: string } }
  | { event: "friend_offline"; data: { username: string } }
  | { event: "typing"; data: { username: string; typing: boolean } };

// Events sent from frontend TO backend
type WSClientEvent =
  | { event: "typing"; data: { to: string; typing: boolean } }
  | { event: "mark_read"; data: { peer: string } };
```

### ApiError

```typescript
// Error responses from the backend always have this shape:
interface ApiError {
  error: string;  // human-readable error message
}
```

```cpp
// C++ error response helper
std::string make_error(const std::string& message) {
    json err = {{"error", message}};
    return err.dump();
}

// Usage in endpoint handler:
// send_response(404, make_error("User not found"));
```

---

## 8. Integration Checklist by Phase

### Phase 1: Basic Backend → Frontend Connection

- [ ] C++ backend starts and listens on `:8080`
- [ ] `GET /status` returns valid `StatusResponse` JSON
- [ ] Frontend health check succeeds (no warning banner)
- [ ] CORS headers are set on all responses
- [ ] `Content-Type: application/json` on all responses

### Phase 2: Friend Management

- [ ] `GET /friends` returns `Contact[]` from local database
- [ ] `POST /friends` looks up user in Supabase, stores locally
- [ ] `DELETE /friends/:username` removes from local database
- [ ] Frontend sidebar shows friend list
- [ ] Add/remove friend dialogs work end-to-end

### Phase 3: Messaging

- [ ] `POST /messages` encrypts and stores message
- [ ] `POST /messages` attempts direct TCP delivery
- [ ] `POST /messages` falls back to Supabase offline storage
- [ ] `GET /messages?peer=X` returns decrypted chat history
- [ ] `DELETE /messages/:id` removes message from local database
- [ ] Frontend chat view shows messages
- [ ] Sending a message works end-to-end
- [ ] Pagination works (scroll to top loads older messages)

### Phase 4: Real-Time Events (WebSocket)

- [ ] WebSocket server listens on `:8081`
- [ ] Frontend connects to `ws://127.0.0.1:8081/events`
- [ ] `new_message` events push incoming messages to frontend
- [ ] `friend_online` / `friend_offline` events update status dots
- [ ] `typing` events show typing indicators
- [ ] Client `typing` events forward to peer
- [ ] Client `mark_read` events update read status
- [ ] WebSocket reconnection works after disconnect

### Phase 5: Polish & Edge Cases

- [ ] Backend handles multiple simultaneous frontend connections
- [ ] Offline messages are delivered when peer comes online
- [ ] Message deduplication works (no duplicate bubbles)
- [ ] Error responses match the expected JSON format
- [ ] Health check recovers after backend restart
- [ ] Contact list preserves `lastMessage` and `unreadCount` across refreshes

---

## 9. Common Pitfalls & Tips

### Pitfall 1: Missing CORS Headers

The frontend runs on `http://localhost:1420` (Tauri dev server) but the
backend runs on `http://127.0.0.1:8080`. Browsers block cross-origin requests
unless the backend sends CORS headers.

**Fix:** Add these headers to EVERY response from your C++ backend:

```cpp
// Add to every HTTP response in local_api.cpp
response.set("Access-Control-Allow-Origin", "*");
response.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
response.set("Access-Control-Allow-Headers", "Content-Type");

// Handle preflight OPTIONS requests
if (request.method() == "OPTIONS") {
    send_response(204, "");
    return;
}
```

### Pitfall 2: Wrong Content-Type

The frontend sends `Content-Type: application/json` and expects the same back.
If your backend returns `text/plain`, the frontend’s `res.json()` will fail.

**Fix:** Always set the response content type:

```cpp
response.set("Content-Type", "application/json");
```

### Pitfall 3: `msg_id` vs `id`

The frontend uses `msg_id` (not `id`) as the message identifier.
The deduplication logic in `chatStore.addMessage()` checks `msg_id`:

```typescript
// This line in chatStore.ts prevents duplicates:
if (existing.some((m) => m.msg_id === msg.msg_id)) return state;
//                       ^^^^^^ NOT .id
```

**Fix:** Always return `msg_id` in your JSON responses, never `id`.

### Pitfall 4: Timestamps Must Be ISO 8601 with Z

The frontend expects timestamps in ISO 8601 format with the `Z` suffix
(UTC timezone). Other formats will cause date parsing errors.

```
✓ Good: "2025-01-15T10:30:00Z"
✗ Bad:  "2025-01-15 10:30:00"
✗ Bad:  "1705312200"  (Unix timestamp)
✗ Bad:  "2025-01-15T10:30:00+00:00"  (offset instead of Z)
```

### Pitfall 5: UUID Generation in C++

Message IDs must be UUIDs. Here’s a simple UUID v4 generator:

```cpp
#include <random>
#include <sstream>
#include <iomanip>

std::string generate_uuid() {
    static std::random_device rd;
    static std::mt19937 gen(rd());
    static std::uniform_int_distribution<uint32_t> dist;

    auto r = [&]() { return dist(gen); };

    std::ostringstream ss;
    ss << std::hex << std::setfill('0');
    ss << std::setw(8) << r() << '-';
    ss << std::setw(4) << (r() & 0xFFFF) << '-';
    ss << std::setw(4) << ((r() & 0x0FFF) | 0x4000) << '-';  // version 4
    ss << std::setw(4) << ((r() & 0x3FFF) | 0x8000) << '-';  // variant 1
    ss << std::setw(12) << (static_cast<uint64_t>(r()) << 16 | (r() & 0xFFFF));
    return ss.str();
}
```

### Pitfall 6: Port Conflicts

If another app is using port 8080, 8081, or 9100, the backend will fail to start.

**Debug:** Check what’s using the ports:

```bash
# Linux/macOS
lsof -i :8080
lsof -i :8081
lsof -i :9100

# Windows
netstat -ano | findstr :8080
netstat -ano | findstr :8081
netstat -ano | findstr :9100
```

### Tip: Mock Backend for Frontend Development

If the C++ backend isn’t ready yet, you can create a quick mock server
with Node.js to unblock frontend development:

```bash
# Install json-server (quick REST mock)
npm install -g json-server

# Create a db.json with mock data and run:
json-server --port 8080 db.json
```

### Tip: Use Browser Dev Tools

In the Tauri app, press F12 to open dev tools:

- **Network tab:** See all HTTP requests and responses
- **Console tab:** See WebSocket connection logs (`[WS] Connected`, etc.)
- **Application tab:** See stored state

---

## 10. Quick Reference Card

```
╔══════════════════════════════════════════════════════════════════╗
║  P2P CHAT — BACKEND INTEGRATION QUICK REFERENCE              ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  REST ENDPOINTS (http://127.0.0.1:8080)                          ║
║  ──────────────────────────────────────────────────────────────   ║
║  GET    /status                    Health check                  ║
║  GET    /friends                   List all friends              ║
║  POST   /friends       {username}  Add friend                   ║
║  DELETE /friends/:usr              Remove friend                 ║
║  GET    /messages?peer=X           Get chat history              ║
║  POST   /messages      {to, text}  Send message                 ║
║  DELETE /messages/:id              Delete message                ║
║                                                                  ║
║  WEBSOCKET EVENTS (ws://127.0.0.1:8081/events)                   ║
║  ──────────────────────────────────────────────────────────────   ║
║  Server → Frontend:                                             ║
║    new_message      Incoming message from peer                   ║
║    friend_online    Friend came online                           ║
║    friend_offline   Friend went offline                          ║
║    typing           Friend typing indicator                      ║
║  Frontend → Server:                                             ║
║    typing           Send typing status to peer                   ║
║    mark_read        Mark messages as read                        ║
║                                                                  ║
║  KEY FILES                                                       ║
║  ──────────────────────────────────────────────────────────────   ║
║  lib/constants.ts        Connection URLs and intervals           ║
║  services/api.ts          REST API client (all endpoints)        ║
║  services/websocket.ts    WebSocket client + reconnection        ║
║  hooks/useWebSocket.ts    Event router (WS → stores)            ║
║  hooks/useMessages.ts     Message fetch/send/paginate            ║
║  hooks/useContacts.ts     Contact polling + filtering            ║
║  stores/chatStore.ts      Message state + optimistic updates     ║
║  stores/contactStore.ts   Friend list + online status            ║
║  App.tsx                  Health check polling                   ║
║                                                                  ║
║  INTERVALS                                                       ║
║  ──────────────────────────────────────────────────────────────   ║
║  Health check:     every 6s   (POLL_INTERVAL_MS * 3)             ║
║  Contact refresh:  every 10s  (POLL_INTERVAL_MS * 5)             ║
║  WS reconnect:     3s base    (exponential backoff, max 10)      ║
║  Typing timeout:   5s         (auto-clear indicator)             ║
║  Typing debounce:  1s         (before sending typing event)      ║
║                                                                  ║
║  PORTS                                                           ║
║  ──────────────────────────────────────────────────────────────   ║
║  :8080  REST API    (frontend → backend)                        ║
║  :8081  WebSocket   (backend → frontend, bidirectional)         ║
║  :9100  P2P TCP     (backend → peer backend)                    ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
```
