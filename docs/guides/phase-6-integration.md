# Phase 6 — Frontend–Backend Integration

> **Goal**: Wire the Tauri/React frontend to the C++ backend so they work as one app.
> This covers REST API calls, WebSocket real-time events, and end-to-end data flow.

---

## Table of Contents

1. [How Frontend & Backend Communicate](#1-how-frontend--backend-communicate)
2. [Step 1: REST API Service](#2-step-1-rest-api-service)
3. [Step 2: WebSocket Service](#3-step-2-websocket-service)
4. [Step 3: Hooks That Glue Everything](#4-step-3-hooks)
5. [Step 4: Adding WebSocket to the C++ Backend](#5-step-4-cpp-websocket)
6. [Step 5: End-to-End Message Flow](#6-step-5-message-flow)
7. [Step 6: Presence & Typing Indicators](#7-step-6-presence)
8. [Step 7: Error Handling & Retry Logic](#8-step-7-error-handling)
9. [Step 8: Testing the Integration](#9-step-8-testing)
10. [Learning Resources](#10-learning-resources)
11. [Common Pitfalls](#11-common-pitfalls)

---

## 1. How Frontend & Backend Communicate

```
┌─────────────────────────────────────────┐
│  React Frontend                         │
│                                         │
│  api.ts ──── HTTP REST ────┐            │
│  websocket.ts ── WS ──────┤            │
│                            ▼            │
│  ┌─────────────────────────────────┐    │
│  │  C++ Backend                    │    │
│  │  :8080 REST API                 │    │
│  │  :8081 WebSocket events         │    │
│  │  :9100 P2P TCP (peer-to-peer)   │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

| Channel | Direction | Purpose | When |
|---------|-----------|---------|------|
| **REST (HTTP)** | Frontend → Backend | Send commands (send message, add friend, get contacts) | User clicks a button |
| **WebSocket** | Backend → Frontend | Push notifications (new message, friend online, typing) | Something happens on backend |
| **P2P TCP** | Backend ↔ Backend | Direct chat between two users' backends | Always (automatic) |

**Key insight**: The frontend never talks to Supabase or to other peers directly. All of that goes through the C++ backend. The frontend is just a pretty window that sends HTTP requests and listens for WebSocket events.

---

## 2. Step 1: REST API Service

### The API Client

This is the frontend service that wraps every HTTP call:

```typescript
// services/api.ts

const API_BASE = "http://127.0.0.1:8080";

class ApiService {
  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${API_BASE}${path}`;

    const res = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      ...options,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API ${res.status}: ${body}`);
    }

    return res.json();
  }

  // ── Status ──────────────────────────────────
  async getStatus() {
    return this.request<StatusResponse>("/status");
  }

  // ── Friends ─────────────────────────────────
  async getFriends() {
    return this.request<Contact[]>("/friends");
  }

  async addFriend(username: string) {
    return this.request<{ success: boolean }>("/friends/add", {
      method: "POST",
      body: JSON.stringify({ username }),
    });
  }

  async removeFriend(username: string) {
    return this.request<{ success: boolean }>(`/friends/${username}`, {
      method: "DELETE",
    });
  }

  // ── Messages ────────────────────────────────
  async getMessages(peer: string, before?: string, limit = 50) {
    const params = new URLSearchParams({ peer, limit: String(limit) });
    if (before) params.set("before", before);
    return this.request<MessagesResponse>(`/messages?${params}`);
  }

  async sendMessage(to: string, text: string) {
    return this.request<SendMessageResponse>("/messages/send", {
      method: "POST",
      body: JSON.stringify({ to, text }),
    });
  }

  // ── Typing ──────────────────────────────────
  async sendTyping(to: string, typing: boolean) {
    return this.request<void>("/typing", {
      method: "POST",
      body: JSON.stringify({ to, typing }),
    });
  }
}

export const api = new ApiService();
```

### TypeScript Types for API Responses

```typescript
// types/api.ts

export interface StatusResponse {
  status: "online" | "offline";
  username: string;
  node_id: string;
  uptime_seconds: number;
  connected_peers: string[];
}

export interface SendMessageResponse {
  msg_id: string;
  delivered: boolean;
  delivery_method: "direct" | "offline";
  timestamp: string;
}

export interface MessagesResponse {
  messages: Message[];
  has_more: boolean;
}
```

### C++ Backend: HTTP Endpoint Example

This is what the C++ side looks like for the `/messages/send` endpoint:

```cpp
// api/ApiServer.cpp (handler registration)

void ApiServer::setupRoutes() {
    // POST /messages/send
    addRoute("POST", "/messages/send", [this](const json& body) -> json {
        std::string to = body.at("to").get<std::string>();
        std::string text = body.at("text").get<std::string>();

        // 1. Encrypt the message using peer's public key
        auto encrypted = crypto_manager_.encrypt(to, text);

        // 2. Try direct P2P delivery
        bool delivered = peer_manager_.sendDirect(to, encrypted);

        std::string method = "direct";
        if (!delivered) {
            // 3. Fallback: push to Supabase for offline delivery
            supabase_client_.pushOfflineMessage(to, encrypted);
            method = "offline";
        }

        // 4. Store in local SQLite
        auto msg_id = storage_.storeMessage(to, text, method, delivered);

        return {
            {"msg_id", msg_id},
            {"delivered", delivered},
            {"delivery_method", method},
            {"timestamp", getCurrentTimestamp()}
        };
    });
}
```

### All REST Endpoints

| Method | Path | Request Body | Response | Purpose |
|--------|------|-------------|----------|---------|
| `GET` | `/status` | — | `StatusResponse` | Check if backend is running |
| `GET` | `/friends` | — | `Contact[]` | List all friends |
| `POST` | `/friends/add` | `{ "username": "bob" }` | `{ "success": true }` | Add friend via Supabase lookup |
| `DELETE` | `/friends/:username` | — | `{ "success": true }` | Remove friend |
| `GET` | `/messages?peer=bob&limit=50` | — | `MessagesResponse` | Fetch chat history |
| `POST` | `/messages/send` | `{ "to": "bob", "text": "Hi" }` | `SendMessageResponse` | Send a message |
| `POST` | `/typing` | `{ "to": "bob", "typing": true }` | `{}` | Notify typing status |

---

## 3. Step 2: WebSocket Service

The WebSocket connection is how the backend **pushes** real-time events to the frontend. Without it, you'd have to poll `/messages` every second.

### Frontend WebSocket Client

```typescript
// services/websocket.ts

import { WS_URL, WS_RECONNECT_DELAY_MS } from "@/lib/constants";

type EventHandler = (data: any) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, EventHandler[]>();
  private reconnectTimer: number | null = null;
  private reconnectDelay = WS_RECONNECT_DELAY_MS; // starts at 3000ms

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.ws = new WebSocket(WS_URL); // "ws://127.0.0.1:8081/events"

    this.ws.onopen = () => {
      console.log("[WS] Connected");
      this.reconnectDelay = WS_RECONNECT_DELAY_MS; // reset on success
    };

    this.ws.onmessage = (event) => {
      try {
        const { event: eventType, data } = JSON.parse(event.data);
        this.dispatch(eventType, data);
      } catch (e) {
        console.error("[WS] Invalid message:", event.data);
      }
    };

    this.ws.onclose = () => {
      console.log("[WS] Disconnected, reconnecting...");
      this.scheduleReconnect();
    };

    this.ws.onerror = (err) => {
      console.error("[WS] Error:", err);
      this.ws?.close();
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 30_000);
      this.connect();
    }, this.reconnectDelay);
  }

  on(event: string, handler: EventHandler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event)!.push(handler);
  }

  off(event: string, handler: EventHandler) {
    const arr = this.handlers.get(event);
    if (arr) {
      this.handlers.set(event, arr.filter((h) => h !== handler));
    }
  }

  private dispatch(event: string, data: any) {
    const arr = this.handlers.get(event);
    if (arr) {
      arr.forEach((handler) => handler(data));
    }
  }

  send(event: string, data: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ event, data }));
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}

export const wsService = new WebSocketService();
```

### WebSocket Event Types

```typescript
// types/events.ts

// Backend → Frontend
export type WSEvent =
  | { event: "new_message"; data: Message }
  | { event: "friend_online"; data: { username: string } }
  | { event: "friend_offline"; data: { username: string } }
  | { event: "typing"; data: { username: string; typing: boolean } }
  | { event: "message_delivered"; data: { msg_id: string; peer: string } };

// Frontend → Backend
export type WSClientEvent =
  | { event: "typing"; data: { to: string; typing: boolean } }
  | { event: "mark_read"; data: { peer: string; msg_id: string } };
```

---

## 4. Step 3: Hooks That Glue Everything

Hooks are where we connect WebSocket events to Zustand stores.

### useWebSocket.ts

```typescript
import { useEffect } from "react";
import { wsService } from "@/services/websocket";
import { useChatStore } from "@/stores/chatStore";
import { useContactStore } from "@/stores/contactStore";
import type { Message } from "@/types/message";

export function useWebSocket() {
  useEffect(() => {
    // Connect on mount
    wsService.connect();

    // ── Handler: new_message ──
    const handleMessage = (data: Message) => {
      useChatStore.getState().addMessage(data);

      // Update contact's last message preview
      useContactStore.getState().updateLastMessage(
        data.from,
        data.text,
        data.timestamp
      );
    };

    // ── Handler: friend_online ──
    const handleOnline = (data: { username: string }) => {
      useContactStore.getState().setOnline(data.username, true);
    };

    // ── Handler: friend_offline ──
    const handleOffline = (data: { username: string }) => {
      useContactStore.getState().setOnline(data.username, false);
    };

    // ── Handler: typing ──
    const handleTyping = (data: { username: string; typing: boolean }) => {
      useChatStore.getState().setTyping(data.username, data.typing);
    };

    // Register all handlers
    wsService.on("new_message", handleMessage);
    wsService.on("friend_online", handleOnline);
    wsService.on("friend_offline", handleOffline);
    wsService.on("typing", handleTyping);

    // Cleanup on unmount
    return () => {
      wsService.off("new_message", handleMessage);
      wsService.off("friend_online", handleOnline);
      wsService.off("friend_offline", handleOffline);
      wsService.off("typing", handleTyping);
      wsService.disconnect();
    };
  }, []);
}
```

### useContacts.ts

```typescript
import { useEffect } from "react";
import { api } from "@/services/api";
import { useContactStore } from "@/stores/contactStore";

export function useContacts() {
  const setContacts = useContactStore((s) => s.setContacts);
  const setLoading = useContactStore((s) => s.setLoading);

  useEffect(() => {
    let cancelled = false;

    const fetchContacts = async () => {
      setLoading(true);
      try {
        const contacts = await api.getFriends();
        if (!cancelled) setContacts(contacts);
      } catch (err) {
        console.error("Failed to fetch contacts:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchContacts();
    return () => { cancelled = true; };
  }, [setContacts, setLoading]);
}
```

### Where Hooks Are Called

```tsx
// App.tsx
function App() {
  useWebSocket();   // ← Connects WS + dispatches to stores
  useContacts();    // ← Fetches friend list on mount
  useTheme();       // ← Applies light/dark theme

  return <AppShell />;
}
```

---

## 5. Step 4: Adding WebSocket to the C++ Backend

The C++ backend needs a WebSocket server on port 8081. Here's how to add one using standalone ASIO.

### Option A: Minimal WebSocket (Recommended for Learning)

For a minimal approach, you can implement a basic WebSocket server over raw TCP. WebSocket is just HTTP upgrade + framed messages.

```cpp
// network/WebSocketServer.h
#pragma once
#include <asio.hpp>
#include <functional>
#include <memory>
#include <set>
#include <mutex>
#include <nlohmann/json.hpp>

using json = nlohmann::json;
using asio::ip::tcp;

class WebSocketClient : public std::enable_shared_from_this<WebSocketClient> {
public:
    WebSocketClient(tcp::socket socket);

    void start();
    void send(const std::string& message);
    void close();

private:
    void doHandshake();
    void doRead();
    void handleFrame(const std::vector<uint8_t>& data);
    std::string encodeFrame(const std::string& payload);
    std::string computeAcceptKey(const std::string& clientKey);

    tcp::socket socket_;
    asio::streambuf read_buf_;
    bool handshake_done_ = false;
};

class WebSocketServer {
public:
    WebSocketServer(asio::io_context& ioc, uint16_t port);

    // Broadcast a JSON event to all connected clients
    void broadcast(const std::string& event, const json& data);

    // Send to a specific client (matched by some identifier)
    void sendTo(const std::string& clientId, const std::string& event,
                const json& data);

private:
    void doAccept();

    tcp::acceptor acceptor_;
    std::set<std::shared_ptr<WebSocketClient>> clients_;
    std::mutex clients_mutex_;
};
```

### WebSocket Handshake (the tricky part)

The WebSocket protocol starts with an HTTP upgrade handshake:

```cpp
// network/WebSocketServer.cpp

#include <openssl/sha.h>    // or use libsodium's crypto_hash_sha256
#include <sstream>
#include <regex>

// The magic GUID defined by the WebSocket spec (RFC 6455)
static const std::string WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

std::string WebSocketClient::computeAcceptKey(const std::string& clientKey) {
    std::string combined = clientKey + WS_MAGIC;

    // SHA-1 hash (required by WebSocket spec)
    unsigned char hash[20];
    SHA1(reinterpret_cast<const unsigned char*>(combined.c_str()),
         combined.size(), hash);

    // Base64 encode the hash
    return base64_encode(hash, 20);
}

void WebSocketClient::doHandshake() {
    auto self = shared_from_this();
    asio::async_read_until(socket_, read_buf_, "\r\n\r\n",
        [this, self](std::error_code ec, std::size_t) {
            if (ec) return;

            std::istream stream(&read_buf_);
            std::string request((std::istreambuf_iterator<char>(stream)),
                                 std::istreambuf_iterator<char>());

            // Extract Sec-WebSocket-Key header
            std::regex key_regex("Sec-WebSocket-Key: (.+)\r\n");
            std::smatch match;
            if (!std::regex_search(request, match, key_regex)) {
                close();
                return;
            }

            std::string accept_key = computeAcceptKey(match[1].str());

            // Send upgrade response
            std::string response =
                "HTTP/1.1 101 Switching Protocols\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                "Sec-WebSocket-Accept: " + accept_key + "\r\n"
                "\r\n";

            asio::async_write(socket_, asio::buffer(response),
                [this, self](std::error_code ec, std::size_t) {
                    if (!ec) {
                        handshake_done_ = true;
                        doRead();  // start reading WebSocket frames
                    }
                });
        });
}
```

> 📖 **WebSocket RFC 6455**: [datatracker.ietf.org/doc/html/rfc6455](https://datatracker.ietf.org/doc/html/rfc6455)
> 📺 **WebSockets Explained**: [youtube.com/watch?v=8ARodQ4Wlf4](https://www.youtube.com/watch?v=8ARodQ4Wlf4)

### Option B: Use a Library (Faster Development)

If you don't want to implement WebSocket from scratch, use **Boost.Beast** or **websocketpp**:

```cmake
# CMakeLists.txt — add websocketpp via FetchContent
FetchContent_Declare(
  websocketpp
  GIT_REPOSITORY https://github.com/zaphoyd/websocketpp.git
  GIT_TAG 0.8.2
)
FetchContent_MakeAvailable(websocketpp)
target_include_directories(backend PRIVATE ${websocketpp_SOURCE_DIR})
```

```cpp
// Using websocketpp (much simpler)
#include <websocketpp/config/asio_no_tls.hpp>
#include <websocketpp/server.hpp>

typedef websocketpp::server<websocketpp::config::asio> WsServer;

class WebSocketBridge {
public:
    WebSocketBridge(uint16_t port) {
        server_.init_asio();
        server_.set_open_handler([this](auto hdl) {
            std::lock_guard lock(mutex_);
            connections_.insert(hdl);
        });
        server_.set_close_handler([this](auto hdl) {
            std::lock_guard lock(mutex_);
            connections_.erase(hdl);
        });
        server_.set_message_handler([this](auto hdl, auto msg) {
            handleClientMessage(hdl, msg->get_payload());
        });
        server_.listen(port);
        server_.start_accept();
    }

    void run() { server_.run(); }

    void broadcast(const std::string& event, const json& data) {
        json envelope = {{"event", event}, {"data", data}};
        std::string payload = envelope.dump();
        std::lock_guard lock(mutex_);
        for (auto& conn : connections_) {
            server_.send(conn, payload,
                         websocketpp::frame::opcode::text);
        }
    }

private:
    void handleClientMessage(
        websocketpp::connection_hdl hdl,
        const std::string& payload
    ) {
        auto msg = json::parse(payload, nullptr, false);
        if (msg.is_discarded()) return;

        std::string event = msg.value("event", "");
        if (event == "typing") {
            // Forward typing notification to the appropriate peer
        } else if (event == "mark_read") {
            // Mark messages as read in local storage
        }
    }

    WsServer server_;
    std::set<websocketpp::connection_hdl,
             std::owner_less<websocketpp::connection_hdl>> connections_;
    std::mutex mutex_;
};
```

### Where to Trigger WebSocket Events in Backend

You need to call `ws_server.broadcast(...)` whenever something happens:

```cpp
// In PeerManager.cpp — when a message arrives from a peer
void PeerManager::onMessageReceived(const std::string& from,
                                      const std::string& plaintext) {
    json data = {
        {"msg_id", generateUUID()},
        {"from", from},
        {"text", plaintext},
        {"timestamp", getCurrentTimestamp()},
        {"direction", "received"},
        {"delivered", true},
        {"delivery_method", "direct"}
    };

    // Push to UI via WebSocket
    ws_server_.broadcast("new_message", data);

    // Also store in local SQLite
    storage_.storeMessage(from, plaintext, "direct", true);
}

// In SupabaseClient.cpp — when fetching offline messages
void SupabaseClient::onOfflineMessagesFetched(
    const std::vector<OfflineMessage>& messages
) {
    for (const auto& msg : messages) {
        std::string plaintext = crypto_.decrypt(msg.ciphertext, msg.from);

        json data = {
            {"msg_id", msg.id},
            {"from", msg.from},
            {"text", plaintext},
            {"timestamp", msg.created_at},
            {"direction", "received"},
            {"delivered", true},
            {"delivery_method", "offline"}
        };

        ws_server_.broadcast("new_message", data);
    }
}

// In PresenceManager — when a friend's status changes
void PresenceManager::onFriendStatusChanged(
    const std::string& username, bool online
) {
    ws_server_.broadcast(
        online ? "friend_online" : "friend_offline",
        {{"username", username}}
    );
}
```

---

## 6. Step 5: End-to-End Message Flow

### Sending a Message

```
User types "Hello Bob" → clicks Send

1. ComposeArea.tsx
   └─ calls useChatStore.sendMessage("bob", "Hello Bob")

2. chatStore.ts (sendMessage action)
   ├─ Adds optimistic message to local state (shows immediately in UI)
   └─ Calls api.sendMessage("bob", "Hello Bob")

3. api.ts
   └─ POST http://127.0.0.1:8080/messages/send
      Body: { "to": "bob", "text": "Hello Bob" }

4. C++ Backend (ApiServer)
   ├─ Encrypts message with Bob's public key
   ├─ Tries direct P2P delivery to Bob's node
   │   ├─ SUCCESS: Sends encrypted data over TCP
   │   └─ FAIL: Pushes encrypted message to Supabase
   ├─ Stores plaintext in local SQLite
   └─ Returns { "msg_id": "...", "delivered": true, "delivery_method": "direct" }

5. chatStore.ts (response handler)
   └─ Updates the optimistic message with real msg_id and delivery status

6. UI re-renders with ✓ (sent) or ✓✓ (delivered)
```

### Receiving a Message

```
Bob sends "Hey Alice" from his app

1. Bob's Backend → Alice's Backend (TCP P2P)
   └─ Encrypted message arrives on port 9100

2. Alice's C++ Backend
   ├─ Decrypts the message
   ├─ Stores in local SQLite
   └─ Broadcasts WebSocket event:
      { "event": "new_message", "data": { "from": "bob", "text": "Hey Alice", ... } }

3. websocket.ts (WebSocket client)
   └─ Receives the event, dispatches to handlers

4. useWebSocket.ts hook
   └─ Calls useChatStore.addMessage(data)
       + useContactStore.updateLastMessage("bob", "Hey Alice", timestamp)

5. React re-renders:
   ├─ MessageList shows new bubble with pop-in animation
   ├─ ContactItem for Bob shows "Hey Alice" preview
   └─ If chat is not active, Badge increments unread count
```

### Sequence Diagram

```
Frontend (React)          Backend (C++)           Peer Backend
      │                        │                       │
      │ POST /messages/send    │                       │
      │───────────────────────>│                       │
      │                        │ encrypt + TCP send    │
      │                        │──────────────────────>│
      │                        │        ACK            │
      │                        │<──────────────────────│
      │  { delivered: true }   │                       │
      │<───────────────────────│                       │
      │                        │                       │
      │                        │  incoming TCP message │
      │                        │<──────────────────────│
      │ WS: new_message        │                       │
      │<───────────────────────│                       │
      │ (re-render UI)         │                       │
```

---

## 7. Step 6: Presence & Typing Indicators

### Typing Indicator Flow

```typescript
// In ComposeArea.tsx
const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
  setText(e.target.value);

  // Debounced typing notification
  if (!typingRef.current) {
    api.sendTyping(activeChat, true);
    typingRef.current = true;
  }

  // Clear after 2 seconds of no typing
  clearTimeout(typingTimeoutRef.current);
  typingTimeoutRef.current = window.setTimeout(() => {
    api.sendTyping(activeChat, false);
    typingRef.current = false;
  }, 2000);
};
```

### C++ Backend: Forward Typing Events

```cpp
// In ApiServer.cpp
addRoute("POST", "/typing", [this](const json& body) -> json {
    std::string to = body.at("to").get<std::string>();
    bool typing = body.at("typing").get<bool>();

    // Forward via P2P to the peer
    peer_manager_.sendTypingNotification(to, typing);

    return {{"ok", true}};
});

// In PeerManager.cpp — when typing notification arrives from peer
void PeerManager::onTypingReceived(const std::string& from, bool typing) {
    ws_server_.broadcast("typing", {
        {"username", from},
        {"typing", typing}
    });
}
```

### Frontend: Display Typing Indicator

```tsx
// In ChatPanel.tsx
const typingUsers = useChatStore((s) => s.typingUsers);
const isTyping = activeChat && typingUsers.has(activeChat);

return (
  <div className="chat-panel">
    <ChatHeader />
    <MessageList />
    {isTyping && <TypingIndicator username={activeChat} />}
    <ComposeArea />
  </div>
);
```

### Presence (Online/Offline)

The backend periodically sends heartbeats to Supabase to update `last_seen`. When a friend's status changes:

```cpp
// C++ Backend — HeartbeatLoop
void PresenceManager::checkFriendStatuses() {
    for (const auto& friend_name : friends_list_) {
        bool was_online = friend_status_[friend_name];
        bool is_online = supabase_.isUserOnline(friend_name); // checks last_seen

        if (was_online != is_online) {
            friend_status_[friend_name] = is_online;
            ws_server_.broadcast(
                is_online ? "friend_online" : "friend_offline",
                {{"username", friend_name}}
            );
        }
    }
}
```

---

## 8. Step 7: Error Handling & Retry Logic

### Frontend Error Handling

```typescript
// chatStore.ts
sendMessage: async (to, text) => {
  const tempId = `temp-${Date.now()}`;

  // Optimistic: show message immediately
  get().addMessage({
    msg_id: tempId,
    from: "me",
    to,
    text,
    timestamp: new Date().toISOString(),
    direction: "sent",
    delivered: false,
    delivery_method: "direct",
  });

  try {
    const result = await api.sendMessage(to, text);

    // Replace temp message with real one
    get().replaceMessage(tempId, {
      msg_id: result.msg_id,
      delivered: result.delivered,
      delivery_method: result.delivery_method,
    });
  } catch (err) {
    // Mark message as failed
    get().markMessageFailed(tempId);
    console.error("Failed to send message:", err);
  }
},
```

### Backend Health Check

```typescript
// hooks/useBackendStatus.ts
export function useBackendStatus() {
  const [backendOnline, setBackendOnline] = useState(false);

  useEffect(() => {
    const check = async () => {
      try {
        await api.getStatus();
        setBackendOnline(true);
      } catch {
        setBackendOnline(false);
      }
    };

    check();
    const interval = setInterval(check, 5000); // poll every 5 seconds
    return () => clearInterval(interval);
  }, []);

  return backendOnline;
}
```

### Show Connection Status in UI

```tsx
function TitleBar() {
  const backendOnline = useBackendStatus();

  return (
    <div className="titlebar">
      <span className="titlebar__title">SecureChat</span>
      <div className={`titlebar__status ${
        backendOnline ? "titlebar__status--online" : "titlebar__status--offline"
      }`}>
        {backendOnline ? "Connected" : "Backend offline"}
      </div>
    </div>
  );
}
```

---

## 9. Step 8: Testing the Integration

### Step-by-Step Testing

#### Test 1: Backend Health

```powershell
# Start the C++ backend
.\backend\build\Release\backend.exe

# In another terminal, test REST
curl http://127.0.0.1:8080/status
# Expected: {"status":"online","username":"alice",...}
```

#### Test 2: WebSocket Connection

```powershell
# Install wscat globally
npm install -g wscat

# Connect to WebSocket
wscat -c ws://127.0.0.1:8081/events

# You should see events like:
# > {"event":"friend_online","data":{"username":"bob"}}
```

#### Test 3: Send Message via curl

```powershell
# Send a message
curl -X POST http://127.0.0.1:8080/messages/send `
  -H "Content-Type: application/json" `
  -d '{"to":"bob","text":"Hello from curl"}'

# Expected: {"msg_id":"...","delivered":true,"delivery_method":"direct"}
```

#### Test 4: Frontend → Backend

1. Start C++ backend
2. Start Tauri dev: `npm run tauri dev`
3. Open DevTools (F12) → Console
4. Check for `[WS] Connected` log
5. Type a message and click Send
6. Check Network tab for POST to `/messages/send`

#### Test 5: Full Flow (Two Users)

1. Alice: Start backend with `config_alice.json`
2. Bob: Start backend with `config_bob.json`  
3. Alice: Start Tauri frontend
4. Alice: Add Bob as friend
5. Alice: Send message to Bob
6. Bob's backend receives via TCP
7. Bob: Start Tauri frontend → message appears

### Using Browser DevTools

Press **F12** in the Tauri window to open Chrome DevTools:

- **Console**: See WebSocket events, API errors
- **Network**: Inspect HTTP requests to `:8080`
- **Application > Storage**: See Zustand persisted state

---

## 10. Learning Resources

### WebSocket Protocol

| Resource | Type | Link |
|----------|------|------|
| **WebSocket RFC 6455** | 📖 Spec | [datatracker.ietf.org/doc/html/rfc6455](https://datatracker.ietf.org/doc/html/rfc6455) |
| **WebSocket in 100 Seconds** | 📺 YouTube | [youtube.com/watch?v=1BfCnjr_Vjg](https://www.youtube.com/watch?v=1BfCnjr_Vjg) |
| **MDN WebSocket API** | 📖 Docs | [developer.mozilla.org/en-US/docs/Web/API/WebSocket](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket) |
| **websocketpp Tutorial** | 📖 GitHub | [github.com/zaphoyd/websocketpp/wiki](https://github.com/zaphoyd/websocketpp/wiki) |

### REST APIs with C++

| Resource | Type | Link |
|----------|------|------|
| **Building REST API in C++** | 📺 YouTube | [youtube.com/watch?v=t0GVJ-N_E4c](https://www.youtube.com/watch?v=t0GVJ-N_E4c) |
| **cpp-httplib (easy HTTP server)** | 📖 GitHub | [github.com/yhirose/cpp-httplib](https://github.com/yhirose/cpp-httplib) |
| **ASIO HTTP Server Example** | 📖 Code | [github.com/chriskohlhoff/asio/tree/master/asio/src/examples](https://github.com/chriskohlhoff/asio/tree/master/asio/src/examples) |

### React + TypeScript

| Resource | Type | Link |
|----------|------|------|
| **React TypeScript Cheatsheet** | 📖 Docs | [react-typescript-cheatsheet.netlify.app](https://react-typescript-cheatsheet.netlify.app/) |
| **Fetch API in TypeScript** | 📖 Docs | [developer.mozilla.org/en-US/docs/Web/API/Fetch_API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API) |

---

## 11. Common Pitfalls

### ❌ CORS Errors

**Problem**: Browser blocks requests to `localhost:8080` from Tauri's webview.
**Fix**: Add CORS headers in the C++ HTTP server:

```cpp
// In every HTTP response
response += "Access-Control-Allow-Origin: *\r\n";
response += "Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS\r\n";
response += "Access-Control-Allow-Headers: Content-Type\r\n";

// Handle preflight OPTIONS requests
if (method == "OPTIONS") {
    send204NoContent();
    return;
}
```

### ❌ WebSocket Disconnects Silently

**Problem**: WS closes without error after inactivity.
**Fix**: Add ping/pong frames. Every 30 seconds, backend sends a ping:

```cpp
void WebSocketServer::startPingLoop() {
    asio::steady_timer timer(ioc_, std::chrono::seconds(30));
    timer.async_wait([this](auto) {
        for (auto& client : clients_) {
            client->sendPing();
        }
        startPingLoop();
    });
}
```

### ❌ Messages Arrive But Don't Show

**Problem**: WebSocket event fires but Zustand doesn't update.
**Debug**: Check that `addMessage()` in chatStore creates a **new array** (immutable update):

```typescript
// BAD — mutating in place, React won't re-render
addMessage: (msg) => {
  get().messages[msg.from]?.push(msg);  // ❌ mutation!
},

// GOOD — new object reference
addMessage: (msg) => set((state) => ({
  messages: {
    ...state.messages,
    [msg.from]: [...(state.messages[msg.from] ?? []), msg],
  },
})),
```

### ❌ Backend Not Running When Tauri Starts

**Problem**: Tauri opens but can't reach the backend.
**Fix**: This is solved in Phase 7 (sidecar). For now, always start the backend manually before running `npm run tauri dev`.

### 💡 Tip: Test REST First, Then WebSocket

Before worrying about WebSocket, make sure all REST endpoints work with `curl`. If REST works, WebSocket is just an event bus on top.

### 💡 Tip: Log Everything

During development, add console.log to every WebSocket event handler:

```typescript
wsService.on("new_message", (data) => {
  console.log("[WS] new_message:", data);
  // ... actual handler
});
```

This saves hours of debugging "why isn't X showing up?"

---

**← [Phase 5 — Tauri Frontend](./phase-5-tauri-frontend.md) | [Phase 7 — Polish & Packaging →](./phase-7-polish-and-packaging.md)**
