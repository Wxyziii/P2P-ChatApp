# WebSocket Events Guide

> Real-time event communication between the C++ backend and Tauri/React frontend.

**Status:** Frontend implemented · Backend **not yet implemented** (this guide serves as the specification)

---

## Table of Contents

1. [Connection Setup](#1-connection-setup)
2. [Server → Client Events](#2-server--client-events)
3. [Client → Server Events](#3-client--server-events)
4. [How to Add WebSocket Support to the C++ Backend](#4-how-to-add-websocket-support-to-the-c-backend)
5. [Testing WebSocket Events](#5-testing-websocket-events)
6. [Frontend WebSocket Architecture](#6-frontend-websocket-architecture)

---

## 1. Connection Setup

### Endpoint

| Property | Value |
|---|---|
| URL | `ws://127.0.0.1:8081/events` |
| Protocol | WebSocket (RFC 6455) |
| Message Format | JSON text frames |
| Port | `8081` (separate from REST API on `8080`) |

The WebSocket URL is defined in `ui-tauri/src/lib/constants.ts`:

```ts
export const API_BASE_URL = "http://127.0.0.1:8080";   // REST API
export const WS_URL = "ws://127.0.0.1:8081/events";    // WebSocket events
```

### Auto-Reconnect with Exponential Backoff

The frontend reconnects automatically when the connection drops. The reconnect strategy is implemented in `ui-tauri/src/services/websocket.ts`:

| Parameter | Value | Source constant |
|---|---|---|
| Base delay | 3 000 ms | `WS_RECONNECT_DELAY_MS` |
| Backoff multiplier | ×1.5 per attempt | hardcoded in `scheduleReconnect()` |
| Max attempts | 10 | `WS_MAX_RECONNECT_ATTEMPTS` |

**Delay progression:**

| Attempt | Delay (ms) | Delay (approx) |
|---|---|---|
| 1 | 3 000 | 3 s |
| 2 | 4 500 | 4.5 s |
| 3 | 6 750 | 6.75 s |
| 4 | 10 125 | ~10 s |
| 5 | 15 188 | ~15 s |
| 6 | 22 781 | ~23 s |
| 7 | 34 172 | ~34 s |
| 8 | 51 258 | ~51 s |
| 9 | 76 887 | ~77 s |
| 10 | 115 330 | ~115 s |

After 10 failed attempts the service logs `"[WS] Max reconnect attempts reached"` and stops trying. The user must reload the app or the app must call `websocket.connect()` again to retry.

### Reconnect Logic (from source)

```ts
// ui-tauri/src/services/websocket.ts — scheduleReconnect()
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
```

The attempt counter resets to `0` on a successful connection (`onopen`).

### Connection Lifecycle

```
App mounts <App />
  └─► useWebSocket() hook runs (inside useEffect)
        ├─► websocket.subscribe(handleEvent)   // register event handler
        ├─► websocket.connect()                // open WS connection
        └─► setInterval (1s) polls websocket.connected → uiStore.wsConnected

App unmounts
  └─► cleanup function
        ├─► unsub()                   // remove event handler
        ├─► clearInterval(interval)   // stop polling
        └─► websocket.disconnect()    // close WS + cancel reconnect timer
```

### Connection Status Tracking

The `uiStore` Zustand store tracks the WebSocket connection state via `wsConnected: boolean`. A 1-second polling interval in `useWebSocket` continuously syncs this value:

```ts
// ui-tauri/src/hooks/useWebSocket.ts
const interval = setInterval(() => {
    setWsConnected(websocket.connected);
}, 1000);
```

Components can read `useUIStore((s) => s.wsConnected)` to show a connection indicator.

---

## 2. Server → Client Events

All server events follow this envelope format:

```json
{
  "event": "<event_name>",
  "data": { ... }
}
```

The TypeScript type union is defined in `ui-tauri/src/types/events.ts`:

```ts
export type WSEvent =
  | { event: "new_message"; data: Message }
  | { event: "friend_online"; data: { username: string } }
  | { event: "friend_offline"; data: { username: string } }
  | { event: "typing"; data: { username: string; typing: boolean } };
```

---

### 2.1 `new_message`

**When emitted:** A new message arrives — either via direct P2P TCP connection or fetched from the Supabase offline message queue.

**Payload:**

```json
{
  "event": "new_message",
  "data": {
    "msg_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "from": "alice",
    "to": "bob",
    "text": "Hey there!",
    "timestamp": "2024-01-15T10:30:00Z",
    "direction": "received",
    "delivered": true,
    "delivery_method": "direct"
  }
}
```

**Full payload schema** (matches `Message` interface in `ui-tauri/src/types/message.ts`):

| Field | Type | Description |
|---|---|---|
| `msg_id` | `string` (UUID) | Unique message identifier |
| `from` | `string` | Sender username |
| `to` | `string` | Recipient username |
| `text` | `string` | Decrypted plaintext content |
| `timestamp` | `string` (ISO 8601) | When the message was sent |
| `direction` | `"sent" \| "received"` | Direction relative to the local user |
| `delivered` | `boolean` | Whether delivery is confirmed |
| `delivery_method` | `"direct" \| "offline"` | `"direct"` = P2P TCP, `"offline"` = via Supabase queue |
| `reactions` | `Reaction[]` (optional) | Array of `{ emoji: string, from: string }` |

**Frontend handling** (`useWebSocket.ts` → `handleEvent`):

```
new_message received
  │
  ├─► chatStore.addMessage(event.data)
  │     • Determines the peer: if direction === "sent" → peer = msg.to, else peer = msg.from
  │     • Deduplicates by msg_id (skips if already in array)
  │     • Appends to messages[peer] array
  │
  ├─► contactStore.updateLastMessage(from, text, timestamp)
  │     • Updates sidebar preview text and time for the contact
  │
  ├─► contactStore.incrementUnread(from)     ← only if chat is NOT active
  │     • Bumps unreadCount for that contact by 1
  │     • Condition: activeChatRef.current !== event.data.from
  │
  └─► useNotification.notify(...)            ← optional, if integrated
        • Shows a desktop notification via the browser Notification API
        • Title: sender username, Body: message text preview
```

**Example sequence — Alice sends "Hello!" to Bob while Bob has Charlie's chat open:**

```json
// Bob's WebSocket receives:
{
  "event": "new_message",
  "data": {
    "msg_id": "550e8400-e29b-41d4-a716-446655440000",
    "from": "alice",
    "to": "bob",
    "text": "Hello!",
    "timestamp": "2024-01-15T14:22:00Z",
    "direction": "received",
    "delivered": true,
    "delivery_method": "direct"
  }
}
```

Result:
- `chatStore.messages["alice"]` gets the new message appended
- Sidebar shows **alice** with preview "Hello!" and timestamp
- `alice` contact gets `unreadCount++` (because `activeChat === "charlie"`, not `"alice"`)

---

### 2.2 `friend_online`

**When emitted:** A friend's status changes to online — detected via Supabase `last_seen` polling or when a direct P2P connection is established.

**Payload:**

```json
{
  "event": "friend_online",
  "data": {
    "username": "alice"
  }
}
```

| Field | Type | Description |
|---|---|---|
| `username` | `string` | The friend who came online |

**Frontend handling:**

```
friend_online received
  └─► contactStore.setOnline(username)
        • Finds contact in contacts array by username
        • Sets contact.online = true
        • Triggers re-render of contact list (green dot appears)
```

**Store implementation** (`contactStore.ts`):

```ts
setOnline: (username) =>
    set((state) => ({
        contacts: state.contacts.map((c) =>
            c.username === username ? { ...c, online: true } : c
        ),
    })),
```

---

### 2.3 `friend_offline`

**When emitted:** A friend goes offline — detected via Supabase `last_seen` timeout or when their P2P connection closes.

**Payload:**

```json
{
  "event": "friend_offline",
  "data": {
    "username": "alice"
  }
}
```

| Field | Type | Description |
|---|---|---|
| `username` | `string` | The friend who went offline |

**Frontend handling:**

```
friend_offline received
  └─► contactStore.setOffline(username)
        • Finds contact in contacts array by username
        • Sets contact.online = false
        • Sets contact.last_seen = new Date().toISOString()
        • Triggers re-render (grey dot / "last seen" timestamp appears)
```

**Store implementation** (`contactStore.ts`):

```ts
setOffline: (username) =>
    set((state) => ({
        contacts: state.contacts.map((c) =>
            c.username === username
                ? { ...c, online: false, last_seen: new Date().toISOString() }
                : c
        ),
    })),
```

---

### 2.4 `typing`

**When emitted:** A friend starts or stops typing in their compose area.

**Payload:**

```json
{
  "event": "typing",
  "data": {
    "username": "alice",
    "typing": true
  }
}
```

| Field | Type | Description |
|---|---|---|
| `username` | `string` | The friend who is typing |
| `typing` | `boolean` | `true` = started typing, `false` = stopped |

**Frontend handling:**

```
typing received
  └─► chatStore.setTyping(username, typing)
        • Sets typingUsers[username] = typing
        • If typing === true, starts a 5-second auto-clear timeout
        • After 5s of no further "typing" event, automatically sets typing to false
        • Prevents stale "typing..." indicators if the stop event is lost
```

**Store implementation** (`chatStore.ts`):

```ts
const typingTimers: Record<string, ReturnType<typeof setTimeout>> = {};

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
        }, 5000);   // TYPING_TIMEOUT_MS
    }
},
```

**Auto-clear timeline:**

```
t=0.0s  "typing": true   → show "alice is typing..."
t=0.5s  "typing": true   → reset 5s timer (alice still typing)
t=1.0s  "typing": true   → reset 5s timer
t=1.0s  (alice stops)
t=6.0s  auto-clear fires → hide "alice is typing..."
```

---

## 3. Client → Server Events

Events sent **from the frontend to the backend**. The TypeScript type union is defined in `ui-tauri/src/types/events.ts`:

```ts
export type WSClientEvent =
  | { event: "typing"; data: { to: string; typing: boolean } }
  | { event: "mark_read"; data: { peer: string; msg_id: string } };
```

Events are sent via `websocket.send()`:

```ts
// ui-tauri/src/services/websocket.ts
send(event: WSClientEvent) {
    if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(event));
    }
}
```

---

### 3.1 `typing`

**When sent:** User starts or stops typing in the compose/message input area.

**Payload:**

```json
{
  "event": "typing",
  "data": {
    "to": "alice",
    "typing": true
  }
}
```

| Field | Type | Description |
|---|---|---|
| `to` | `string` | The peer the user is chatting with |
| `typing` | `boolean` | `true` = user is typing, `false` = user stopped |

**Debounce behavior:**

The frontend uses a debounce strategy defined by `TYPING_DEBOUNCE_MS` (1 000 ms):

```
User presses key   → send { "typing": true }  immediately
User keeps typing   → do NOT re-send (debounced, 1s cooldown)
User stops typing   → after TYPING_DEBOUNCE_MS (1s), send { "typing": false }
```

**Backend responsibility:** When the backend receives this event, it should forward it as a server `typing` event to the target peer (`to`) if they are connected. The forwarded event replaces `to` with `username` (the sender):

```
Client A sends:     { "event": "typing", "data": { "to": "bob", "typing": true } }
Backend forwards    { "event": "typing", "data": { "username": "alice", "typing": true } }
to Client B (bob):
```

---

### 3.2 `mark_read`

**When sent:** User opens a chat conversation or scrolls through unread messages, marking them as read.

**Payload:**

```json
{
  "event": "mark_read",
  "data": {
    "peer": "alice",
    "msg_id": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

| Field | Type | Description |
|---|---|---|
| `peer` | `string` | The username of the conversation partner |
| `msg_id` | `string` (UUID) | The ID of the latest message that was read |

**Backend responsibility:**

1. Update the local SQLite database to mark messages from `peer` up to `msg_id` as read
2. Optionally: sync read status to Supabase for cross-device consistency
3. Optionally: forward a read receipt to the peer (future feature)

**Frontend side-effect:** The frontend also calls `contactStore.clearUnread(username)` locally:

```ts
clearUnread: (username) =>
    set((state) => ({
        contacts: state.contacts.map((c) =>
            c.username === username ? { ...c, unreadCount: 0 } : c
        ),
    })),
```

---

## 4. How to Add WebSocket Support to the C++ Backend

The backend currently uses **standalone ASIO** for TCP networking. WebSocket support can be added using **Boost.Beast** (which builds on ASIO) or by implementing the WebSocket handshake manually over ASIO. This section provides a complete Boost.Beast implementation.

### 4.1 CMake Changes

Add Boost.Beast via FetchContent in `backend/CMakeLists.txt`:

```cmake
# ─── Boost.Beast (WebSocket + HTTP, header-only) ────────────────────────────
# Beast requires Boost headers but we only need beast + asio (already fetched).
# Option A: Use standalone Beast (if available)
# Option B: Fetch full Boost (simpler, but heavier)

# Minimal approach: Fetch only the needed Boost libraries
FetchContent_Declare(
    boost
    URL https://github.com/boostorg/boost/releases/download/boost-1.84.0/boost-1.84.0-cmake.tar.gz
    URL_HASH SHA256=...  # pin the hash for reproducibility
)
set(BOOST_INCLUDE_LIBRARIES beast asio system)
FetchContent_MakeAvailable(boost)
```

Then update `target_link_libraries`:

```cmake
target_link_libraries(${PROJECT_NAME} PRIVATE
    nlohmann_json::nlohmann_json
    spdlog::spdlog
    Boost::beast      # <-- add
    ${SODIUM_LIBRARIES}
    CURL::libcurl
    SQLite::SQLite3
)
```

> **Alternative (lighter):** Keep standalone ASIO and implement the WebSocket upgrade handshake manually. This avoids the Boost dependency but requires ~200 lines of handshake code. Beast is recommended for correctness.

### 4.2 WebSocket Server Header

Create `backend/include/network/ws_event_server.h`:

```cpp
#pragma once

#include <boost/beast/core.hpp>
#include <boost/beast/websocket.hpp>
#include <boost/asio.hpp>
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <set>
#include <string>

namespace beast     = boost::beast;
namespace websocket = beast::websocket;
namespace net       = boost::asio;
using tcp           = net::ip::tcp;
using json          = nlohmann::json;

// Forward declaration
class WSSession;

/**
 * WebSocket event server on localhost for pushing real-time events to the UI.
 *
 * Listens on ws://127.0.0.1:<port>/events
 * Broadcasts JSON events to all connected clients.
 * Receives client events (typing, mark_read) via a callback.
 */
class WSEventServer : public std::enable_shared_from_this<WSEventServer> {
public:
    using ClientEventCallback = std::function<void(const json& event)>;

    WSEventServer(net::io_context& ioc, uint16_t port);

    /// Start accepting WebSocket connections.
    void start();

    /// Stop the server and close all sessions.
    void stop();

    /// Broadcast a JSON event to ALL connected clients.
    void broadcast(const json& event);

    /// Send a JSON event to a specific session (by session pointer).
    void send_to(std::shared_ptr<WSSession> session, const json& event);

    /// Register a callback for events received from clients.
    void set_on_client_event(ClientEventCallback cb);

    /// Called by WSSession when a new session connects.
    void join(std::shared_ptr<WSSession> session);

    /// Called by WSSession when a session disconnects.
    void leave(std::shared_ptr<WSSession> session);

    /// Called by WSSession when a client sends a message.
    void on_receive(std::shared_ptr<WSSession> session, const std::string& msg);

    /// Number of currently connected clients.
    size_t connection_count() const;

private:
    void do_accept();

    net::io_context&                     ioc_;
    tcp::acceptor                        acceptor_;
    std::set<std::shared_ptr<WSSession>> sessions_;
    mutable std::mutex                   sessions_mutex_;
    ClientEventCallback                  on_client_event_;
};
```

### 4.3 WebSocket Session Header

Create `backend/include/network/ws_session.h`:

```cpp
#pragma once

#include <boost/beast/core.hpp>
#include <boost/beast/websocket.hpp>
#include <boost/asio.hpp>

#include <memory>
#include <queue>
#include <string>

namespace beast     = boost::beast;
namespace websocket = beast::websocket;
namespace net       = boost::asio;
using tcp           = net::ip::tcp;

class WSEventServer;

/**
 * Represents a single WebSocket client connection.
 * Handles the HTTP upgrade handshake, reading, and writing.
 */
class WSSession : public std::enable_shared_from_this<WSSession> {
public:
    WSSession(tcp::socket socket, std::shared_ptr<WSEventServer> server);

    /// Start the WebSocket handshake.
    void run();

    /// Queue a text message for sending.
    void send(const std::string& msg);

    /// Close the connection gracefully.
    void close();

private:
    void on_accept(beast::error_code ec);
    void do_read();
    void on_read(beast::error_code ec, std::size_t bytes_transferred);
    void do_write();
    void on_write(beast::error_code ec, std::size_t bytes_transferred);

    websocket::stream<beast::tcp_stream>  ws_;
    beast::flat_buffer                    buffer_;
    std::shared_ptr<WSEventServer>        server_;
    std::queue<std::string>               write_queue_;
    bool                                  writing_ = false;
};
```

### 4.4 WebSocket Server Implementation

Create `backend/src/network/ws_event_server.cpp`:

```cpp
#include "network/ws_event_server.h"
#include "network/ws_session.h"

// ─── WSEventServer ──────────────────────────────────────────────────────────

WSEventServer::WSEventServer(net::io_context& ioc, uint16_t port)
    : ioc_(ioc)
    , acceptor_(ioc, tcp::endpoint(net::ip::make_address("127.0.0.1"), port))
{
    spdlog::info("[WS] Event server created on port {}", port);
}

void WSEventServer::start() {
    spdlog::info("[WS] Starting event server...");
    do_accept();
}

void WSEventServer::stop() {
    acceptor_.close();
    std::lock_guard lock(sessions_mutex_);
    for (auto& session : sessions_) {
        session->close();
    }
    sessions_.clear();
    spdlog::info("[WS] Event server stopped");
}

void WSEventServer::broadcast(const json& event) {
    auto msg = event.dump();
    std::lock_guard lock(sessions_mutex_);
    for (auto& session : sessions_) {
        session->send(msg);
    }
}

void WSEventServer::send_to(std::shared_ptr<WSSession> session, const json& event) {
    session->send(event.dump());
}

void WSEventServer::set_on_client_event(ClientEventCallback cb) {
    on_client_event_ = std::move(cb);
}

void WSEventServer::join(std::shared_ptr<WSSession> session) {
    std::lock_guard lock(sessions_mutex_);
    sessions_.insert(session);
    spdlog::info("[WS] Client connected (total: {})", sessions_.size());
}

void WSEventServer::leave(std::shared_ptr<WSSession> session) {
    std::lock_guard lock(sessions_mutex_);
    sessions_.erase(session);
    spdlog::info("[WS] Client disconnected (total: {})", sessions_.size());
}

void WSEventServer::on_receive(std::shared_ptr<WSSession> /*session*/,
                                const std::string& msg) {
    try {
        auto event = json::parse(msg);
        spdlog::debug("[WS] Received client event: {}", event["event"].get<std::string>());
        if (on_client_event_) {
            on_client_event_(event);
        }
    } catch (const json::exception& e) {
        spdlog::warn("[WS] Failed to parse client message: {}", e.what());
    }
}

size_t WSEventServer::connection_count() const {
    std::lock_guard lock(sessions_mutex_);
    return sessions_.size();
}

void WSEventServer::do_accept() {
    acceptor_.async_accept(
        [self = shared_from_this()](beast::error_code ec, tcp::socket socket) {
            if (ec) {
                if (ec != net::error::operation_aborted) {
                    spdlog::error("[WS] Accept error: {}", ec.message());
                }
                return;
            }
            auto session = std::make_shared<WSSession>(
                std::move(socket), self);
            session->run();
            self->do_accept();
        });
}
```

### 4.5 WebSocket Session Implementation

Create `backend/src/network/ws_session.cpp`:

```cpp
#include "network/ws_session.h"
#include "network/ws_event_server.h"
#include <spdlog/spdlog.h>

WSSession::WSSession(tcp::socket socket, std::shared_ptr<WSEventServer> server)
    : ws_(std::move(socket))
    , server_(std::move(server))
{
}

void WSSession::run() {
    // Set WebSocket options
    ws_.set_option(websocket::stream_base::timeout::suggested(
        beast::role_type::server));

    ws_.set_option(websocket::stream_base::decorator(
        [](websocket::response_type& res) {
            res.set(beast::http::field::server, "p2p-chat-ws/0.1");
        }));

    // Accept the WebSocket handshake
    ws_.async_accept(
        beast::bind_front_handler(&WSSession::on_accept, shared_from_this()));
}

void WSSession::on_accept(beast::error_code ec) {
    if (ec) {
        spdlog::error("[WS] Handshake failed: {}", ec.message());
        return;
    }
    server_->join(shared_from_this());
    do_read();
}

void WSSession::do_read() {
    ws_.async_read(
        buffer_,
        beast::bind_front_handler(&WSSession::on_read, shared_from_this()));
}

void WSSession::on_read(beast::error_code ec, std::size_t /*bytes_transferred*/) {
    if (ec) {
        if (ec != websocket::error::closed &&
            ec != net::error::operation_aborted) {
            spdlog::warn("[WS] Read error: {}", ec.message());
        }
        server_->leave(shared_from_this());
        return;
    }

    auto msg = beast::buffers_to_string(buffer_.data());
    buffer_.consume(buffer_.size());

    server_->on_receive(shared_from_this(), msg);
    do_read();
}

void WSSession::send(const std::string& msg) {
    net::post(ws_.get_executor(),
        [self = shared_from_this(), msg]() {
            self->write_queue_.push(msg);
            if (!self->writing_) {
                self->do_write();
            }
        });
}

void WSSession::do_write() {
    if (write_queue_.empty()) {
        writing_ = false;
        return;
    }
    writing_ = true;
    ws_.text(true);
    ws_.async_write(
        net::buffer(write_queue_.front()),
        beast::bind_front_handler(&WSSession::on_write, shared_from_this()));
}

void WSSession::on_write(beast::error_code ec, std::size_t /*bytes_transferred*/) {
    if (ec) {
        spdlog::warn("[WS] Write error: {}", ec.message());
        server_->leave(shared_from_this());
        return;
    }
    write_queue_.pop();
    do_write();
}

void WSSession::close() {
    beast::error_code ec;
    ws_.close(websocket::close_code::normal, ec);
}
```

### 4.6 Integration in `main.cpp`

Wire the WebSocket server into the existing application:

```cpp
#include "network/ws_event_server.h"
#include <nlohmann/json.hpp>

using json = nlohmann::json;

int main() {
    // ... existing setup ...

    asio::io_context ioc;

    // Create the WebSocket event server on port 8081
    auto ws_server = std::make_shared<WSEventServer>(ioc, 8081);

    // Handle events received from frontend clients
    ws_server->set_on_client_event([&](const json& event) {
        std::string event_type = event["event"];

        if (event_type == "typing") {
            std::string to   = event["data"]["to"];
            bool typing      = event["data"]["typing"];
            // TODO: Forward typing indicator to the peer via P2P
            spdlog::debug("User typing to {}: {}", to, typing);
        }
        else if (event_type == "mark_read") {
            std::string peer   = event["data"]["peer"];
            std::string msg_id = event["data"]["msg_id"];
            // TODO: Update read status in SQLite
            spdlog::debug("Marked read for peer {} up to {}", peer, msg_id);
        }
    });

    ws_server->start();

    // ─── Example: Broadcasting events from elsewhere in the app ───

    // When a new P2P message arrives:
    auto notify_new_message = [&](const json& msg_data) {
        ws_server->broadcast({
            {"event", "new_message"},
            {"data", msg_data}
        });
    };

    // When a friend comes online:
    auto notify_friend_online = [&](const std::string& username) {
        ws_server->broadcast({
            {"event", "friend_online"},
            {"data", {{"username", username}}}
        });
    };

    // When a friend goes offline:
    auto notify_friend_offline = [&](const std::string& username) {
        ws_server->broadcast({
            {"event", "friend_offline"},
            {"data", {{"username", username}}}
        });
    };

    // When a typing indicator is received from a peer:
    auto notify_typing = [&](const std::string& username, bool typing) {
        ws_server->broadcast({
            {"event", "typing"},
            {"data", {{"username", username}, {"typing", typing}}}
        });
    };

    // Run the IO context (blocks until stopped)
    ioc.run();
}
```

### 4.7 Updated CMake Sources

Add the new source files to `CMakeLists.txt`:

```cmake
set(SOURCES
    src/main.cpp
    src/node/node.cpp
    src/crypto/crypto_manager.cpp
    src/network/peer_server.cpp
    src/network/peer_client.cpp
    src/network/ws_event_server.cpp    # <-- add
    src/network/ws_session.cpp         # <-- add
    src/supabase/supabase_client.cpp
    src/api/local_api.cpp
)
```

### 4.8 Complete File Listing

After implementation, the backend should have these new/modified files:

```
backend/
├── include/network/
│   ├── peer_server.h          (existing)
│   ├── peer_client.h          (existing)
│   ├── ws_event_server.h      (NEW)
│   └── ws_session.h           (NEW)
├── src/network/
│   ├── peer_server.cpp        (existing)
│   ├── peer_client.cpp        (existing)
│   ├── ws_event_server.cpp    (NEW)
│   └── ws_session.cpp         (NEW)
└── CMakeLists.txt             (MODIFIED — add Boost.Beast + new sources)
```

---

## 5. Testing WebSocket Events

### 5.1 Install wscat

```bash
npm install -g wscat
```

### 5.2 Connect to the Server

```bash
wscat -c ws://127.0.0.1:8081/events
```

Expected output on success:

```
Connected (press CTRL+C to quit)
>
```

### 5.3 Send Client Events

**Send a typing indicator:**

```json
> {"event": "typing", "data": {"to": "alice", "typing": true}}
```

**Send a mark_read event:**

```json
> {"event": "mark_read", "data": {"peer": "alice", "msg_id": "550e8400-e29b-41d4-a716-446655440000"}}
```

### 5.4 What You Should See

When the backend pushes events, they appear in the wscat terminal as raw JSON:

**New message arrives:**

```json
< {"event":"new_message","data":{"msg_id":"a1b2c3d4-e5f6-7890-abcd-ef1234567890","from":"alice","to":"bob","text":"Hey there!","timestamp":"2024-01-15T10:30:00Z","direction":"received","delivered":true,"delivery_method":"direct"}}
```

**Friend comes online:**

```json
< {"event":"friend_online","data":{"username":"alice"}}
```

**Friend goes offline:**

```json
< {"event":"friend_offline","data":{"username":"alice"}}
```

**Typing indicator:**

```json
< {"event":"typing","data":{"username":"alice","typing":true}}
```

### 5.5 Testing with Multiple Clients

Open two terminal windows and connect both to the WebSocket server:

```bash
# Terminal 1
wscat -c ws://127.0.0.1:8081/events

# Terminal 2
wscat -c ws://127.0.0.1:8081/events
```

When the backend broadcasts an event, **both terminals** should receive it. This verifies the broadcast mechanism works correctly.

### 5.6 Quick Test Script (PowerShell)

```powershell
# Requires wscat installed globally
# Start the backend first, then run:

$testEvents = @(
    '{"event":"typing","data":{"to":"alice","typing":true}}'
    '{"event":"mark_read","data":{"peer":"alice","msg_id":"test-id-123"}}'
)

foreach ($event in $testEvents) {
    Write-Host "Sending: $event" -ForegroundColor Cyan
    echo $event | wscat -c ws://127.0.0.1:8081/events --wait 2
    Start-Sleep -Seconds 1
}
```

### 5.7 Testing from the Browser Console

If the Tauri app is running, you can test from the browser dev console:

```js
// Connect manually
const ws = new WebSocket("ws://127.0.0.1:8081/events");
ws.onmessage = (e) => console.log("Received:", JSON.parse(e.data));
ws.onopen = () => {
    console.log("Connected!");
    // Send a typing event
    ws.send(JSON.stringify({
        event: "typing",
        data: { to: "alice", typing: true }
    }));
};
```

---

## 6. Frontend WebSocket Architecture

### 6.1 Data Flow Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                        C++ Backend (port 8081)                       │
│                                                                      │
│  PeerServer ──► on_message ──► ws_event_server.broadcast(new_message)│
│  Supabase  ──► poll offline ──► ws_event_server.broadcast(new_message)│
│  Supabase  ──► last_seen   ──► ws_event_server.broadcast(friend_*)   │
│                                                                      │
│                    WSEventServer                                     │
│                    ├── session 1 (UI client)                         │
│                    └── session 2 (wscat debug)                       │
└──────────────────────┬───────────────────────────────────────────────┘
                       │
                  JSON over WebSocket
                  ws://127.0.0.1:8081/events
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│              WebSocketService  (services/websocket.ts)               │
│                                                                      │
│  • Singleton instance: `export const websocket`                      │
│  • Manages WebSocket lifecycle (connect / disconnect / reconnect)    │
│  • Parses JSON → WSEvent                                            │
│  • Fan-out: handlers.forEach(handler => handler(parsed))             │
│  • send(WSClientEvent): serializes + sends to server                │
│                                                                      │
│  Public API:                                                         │
│    .connect()                                                        │
│    .disconnect()                                                     │
│    .send(event: WSClientEvent)                                       │
│    .subscribe(handler): () => void    (returns unsubscribe fn)       │
│    .connected: boolean                (readonly getter)              │
└──────────────────────┬───────────────────────────────────────────────┘
                       │
              subscribe / unsubscribe
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│               useWebSocket hook  (hooks/useWebSocket.ts)             │
│                                                                      │
│  • Called once in the root <App /> component                         │
│  • Subscribes a handleEvent function to WebSocketService             │
│  • Routes events by event.event name via switch/case                │
│  • Polls websocket.connected → uiStore.wsConnected every 1s         │
│                                                                      │
│  Event routing:                                                      │
│    "new_message"   → chatStore.addMessage()                          │
│                      contactStore.updateLastMessage()                 │
│                      contactStore.incrementUnread() (if not active)   │
│    "friend_online" → contactStore.setOnline()                        │
│    "friend_offline"→ contactStore.setOffline()                       │
│    "typing"        → chatStore.setTyping()                           │
└──────────────────────┬───────────────────────────────────────────────┘
                       │
              dispatches to Zustand stores
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  chatStore   │ │ contactStore │ │   uiStore    │
│              │ │              │ │              │
│ • messages   │ │ • contacts   │ │ • wsConnected│
│ • activeChat │ │ • online     │ │              │
│ • typingUsers│ │ • unread     │ │              │
│ • sendingMsg │ │ • lastMsg    │ │              │
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │                │                │
       └────────────────┼────────────────┘
                        │
               Zustand selectors trigger
               React component re-renders
                        │
          ┌─────────────┼─────────────────┐
          ▼             ▼                 ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────────┐
│  ChatPanel   │ │  ContactList │ │ ConnectionStatus │
│              │ │              │ │                  │
│ • Messages   │ │ • Online dot │ │ • Green/red dot  │
│ • Typing...  │ │ • Last msg   │ │ • "Connected" /  │
│ • Input area │ │ • Unread cnt │ │   "Disconnected" │
└──────────────┘ └──────────────┘ └──────────────────┘
```

### 6.2 File Reference

| File | Role | Key exports |
|---|---|---|
| `src/lib/constants.ts` | Configuration | `WS_URL`, `WS_RECONNECT_DELAY_MS`, `WS_MAX_RECONNECT_ATTEMPTS`, `TYPING_DEBOUNCE_MS`, `TYPING_TIMEOUT_MS` |
| `src/types/events.ts` | Type definitions | `WSEvent` (server→client), `WSClientEvent` (client→server) |
| `src/types/message.ts` | Message model | `Message`, `Reaction`, `MessageGroup` |
| `src/types/contact.ts` | Contact model | `Contact`, `ContactWithPreview` |
| `src/services/websocket.ts` | WebSocket client singleton | `websocket` (instance of `WebSocketService`) |
| `src/hooks/useWebSocket.ts` | React hook | `useWebSocket()` — wires events to stores |
| `src/hooks/useNotification.ts` | Desktop notifications | `useNotification()` — `{ notify }` |
| `src/stores/chatStore.ts` | Chat state (Zustand) | `useChatStore` — messages, typing, sending |
| `src/stores/contactStore.ts` | Contacts state (Zustand) | `useContactStore` — contacts, online, unread |
| `src/stores/uiStore.ts` | UI state (Zustand, persisted) | `useUIStore` — wsConnected, theme, sidebar |

### 6.3 Adding a New Event (Step-by-Step)

To add a new WebSocket event (e.g., `message_delivered`):

**Step 1: Define the types** in `src/types/events.ts`:

```ts
export type WSEvent =
  | { event: "new_message"; data: Message }
  | { event: "friend_online"; data: { username: string } }
  | { event: "friend_offline"; data: { username: string } }
  | { event: "typing"; data: { username: string; typing: boolean } }
  | { event: "message_delivered"; data: { msg_id: string; peer: string } };  // NEW
```

**Step 2: Handle it** in `src/hooks/useWebSocket.ts`:

```ts
case "message_delivered":
    markDelivered(event.data.msg_id, event.data.peer);
    break;
```

**Step 3: Add the store action** in `src/stores/chatStore.ts`:

```ts
markDelivered: (msgId: string, peer: string) =>
    set((state) => ({
        messages: {
            ...state.messages,
            [peer]: state.messages[peer]?.map((m) =>
                m.msg_id === msgId ? { ...m, delivered: true } : m
            ) ?? [],
        },
    })),
```

**Step 4: Emit from C++ backend:**

```cpp
ws_server->broadcast({
    {"event", "message_delivered"},
    {"data", {{"msg_id", msg_id}, {"peer", peer_username}}}
});
```

### 6.4 Error Handling Summary

| Layer | Error | Behavior |
|---|---|---|
| WebSocket transport | Connection refused | `onerror` → `onclose` → `scheduleReconnect()` |
| WebSocket transport | Connection dropped | `onclose` → `scheduleReconnect()` |
| WebSocket transport | Max reconnects exceeded | Log error, stop retrying, `wsConnected = false` |
| Message parsing | Invalid JSON from server | `catch` in `onmessage`, log error, skip message |
| Event routing | Unknown event type | Falls through `switch`, silently ignored |
| Sending | Socket not open | `send()` checks `readyState`, silently drops if not `OPEN` |

---

## Appendix A: Complete JSON Event Catalog

### Server → Client

```jsonc
// 1. new_message — a new chat message arrived
{
  "event": "new_message",
  "data": {
    "msg_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "from": "alice",
    "to": "bob",
    "text": "Hey there!",
    "timestamp": "2024-01-15T10:30:00Z",
    "direction": "received",
    "delivered": true,
    "delivery_method": "direct"
  }
}

// 2. friend_online — a friend came online
{
  "event": "friend_online",
  "data": {
    "username": "alice"
  }
}

// 3. friend_offline — a friend went offline
{
  "event": "friend_offline",
  "data": {
    "username": "alice"
  }
}

// 4. typing — a friend started or stopped typing
{
  "event": "typing",
  "data": {
    "username": "alice",
    "typing": true
  }
}
```

### Client → Server

```jsonc
// 1. typing — local user is typing to a peer
{
  "event": "typing",
  "data": {
    "to": "alice",
    "typing": true
  }
}

// 2. mark_read — local user read messages from a peer
{
  "event": "mark_read",
  "data": {
    "peer": "alice",
    "msg_id": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

---

## Appendix B: Constants Reference

All WebSocket-related constants from `ui-tauri/src/lib/constants.ts`:

| Constant | Value | Usage |
|---|---|---|
| `WS_URL` | `"ws://127.0.0.1:8081/events"` | WebSocket server endpoint |
| `WS_RECONNECT_DELAY_MS` | `3000` | Base reconnect delay (ms) |
| `WS_MAX_RECONNECT_ATTEMPTS` | `10` | Give up after this many failures |
| `TYPING_DEBOUNCE_MS` | `1000` | Debounce interval for sending typing events |
| `TYPING_TIMEOUT_MS` | `5000` | Auto-clear typing indicator after this duration |
