# API Contract — Backend ↔ UI (localhost)

> Version 0.1 — Draft
>
> This document describes every HTTP endpoint that the C++ backend exposes for
> the Python UI. If you're new to HTTP / REST APIs, read the background section
> first — it explains the concepts from scratch.

---

## Table of Contents

1. [Background: What is a REST API?](#1-background-what-is-a-rest-api)
2. [How the UI Talks to the Backend](#2-how-the-ui-talks-to-the-backend)
3. [Common Conventions](#3-common-conventions)
4. [Endpoint Reference](#4-endpoint-reference)
   - [GET /status](#41-get-status)
   - [GET /friends](#42-get-friends)
   - [POST /friends](#43-post-friends)
   - [DELETE /friends/:username](#44-delete-friendsusername)
   - [GET /messages](#45-get-messagespeerusername)
   - [POST /messages](#46-post-messages)
   - [DELETE /messages/:msg_id](#47-delete-messagesmsg_id)
5. [Error Handling](#5-error-handling)
6. [Real-Time Updates (Polling vs WebSocket)](#6-real-time-updates)
7. [Python Code Examples](#7-python-code-examples)
8. [C++ Implementation Notes](#8-c-implementation-notes)
9. [Testing the API with curl](#9-testing-the-api-with-curl)

---

## 1. Background: What is a REST API?

If you've never built or consumed an API before, here's a quick primer.

### 1.1 HTTP in 60 Seconds

HTTP (HyperText Transfer Protocol) is the protocol your browser uses to load
web pages. But it's also perfect for **any** client-server communication.

An HTTP exchange has two parts:

**Request** (client → server):
```
POST /messages HTTP/1.1          ← method + path + version
Host: 127.0.0.1:8080            ← headers
Content-Type: application/json
Content-Length: 42

{"to": "bob", "text": "Hello!"}  ← body (optional)
```

**Response** (server → client):
```
HTTP/1.1 200 OK                  ← status code
Content-Type: application/json

{"msg_id": "abc", "delivered": true}  ← body
```

### 1.2 HTTP Methods (Verbs)

| Method | Meaning | Analogy |
|---|---|---|
| **GET** | "Give me data" | Reading a page in a book |
| **POST** | "Create something new" | Writing a new entry in a guestbook |
| **PUT** | "Replace this entirely" | Rewriting a page |
| **PATCH** | "Update part of this" | Editing a sentence on a page |
| **DELETE** | "Remove this" | Tearing out a page |

We use GET, POST, and DELETE in this project.

### 1.3 Status Codes

The server responds with a 3-digit code:

| Code | Meaning | When We Use It |
|---|---|---|
| **200 OK** | Success | Most successful responses |
| **201 Created** | Something was created | After adding a friend |
| **202 Accepted** | Request accepted but not yet complete | Message queued for offline delivery |
| **204 No Content** | Success, no body to return | After deleting something |
| **400 Bad Request** | Client sent invalid data | Missing required field |
| **404 Not Found** | Resource doesn't exist | Friend username not found |
| **500 Internal Server Error** | Something went wrong on the server | Backend crashed / unexpected error |

### 1.4 JSON — The Data Format

All request and response bodies use JSON. Both Python (`json` module) and C++
(`nlohmann/json`) handle this natively.

### 1.5 What is "REST"?

REST (Representational State Transfer) is a style for designing APIs. The key
ideas:

- **Resources** are identified by URLs: `/friends`, `/messages`.
- **HTTP methods** express the action: GET = read, POST = create, DELETE = remove.
- **Stateless**: Each request contains all information needed. The server
  doesn't remember previous requests.
- **JSON**: Data is exchanged as JSON (in our case).

It's not a rigid standard — it's a set of conventions that make APIs predictable
and easy to use.

---

## 2. How the UI Talks to the Backend

```
┌──────────────────┐                  ┌──────────────────┐
│   Python UI      │   HTTP requests  │   C++ Backend    │
│   (PySide6)      │ ───────────────► │   (LocalAPI)     │
│                  │ ◄─────────────── │                  │
│   Port: N/A      │   JSON responses │   Port: 8080     │
│   (client only)  │                  │   127.0.0.1 only │
└──────────────────┘                  └──────────────────┘
```

**Key points:**

1. The C++ backend starts an HTTP server on `127.0.0.1:8080` (configurable in
   `config.json` as `node.api_port`).

2. **`127.0.0.1` (localhost) only** — the API is NOT accessible from other
   machines on the network. This is critical for security: we don't want random
   people on your Wi-Fi sending messages as you.

3. The Python UI uses the `requests` library to make HTTP calls to this local
   server. The `BackendService` class in `ui/services/backend_service.py`
   wraps all these calls.

4. **No authentication** between UI and backend. Since both run on the same
   machine and the API is localhost-only, we trust all requests. (If you want
   extra security, you could add a shared secret token — see Section 8.)

---

## 3. Common Conventions

### 3.1 Request Headers

Every request should include:

```
Content-Type: application/json     ← for POST/PUT/PATCH requests
Accept: application/json           ← tells the server we want JSON back
```

The Python `requests` library adds these automatically when you use `json=`.

### 3.2 Response Format

**Success responses** return the relevant data directly:

```json
{
  "username": "bob",
  "public_key": "base64...",
  "online": true
}
```

**Error responses** always have this shape:

```json
{
  "error": "Human-readable error message"
}
```

### 3.3 Pagination (Future)

For endpoints that could return many items (like messages), we support optional
query parameters:

| Parameter | Default | Description |
|---|---|---|
| `limit` | 50 | Maximum number of items to return |
| `offset` | 0 | Skip this many items (for pagination) |

Example: `GET /messages?peer=bob&limit=20&offset=40` — returns messages 41-60.

---

## 4. Endpoint Reference

### 4.1 `GET /status`

**Purpose:** Health check. The UI calls this on startup to verify the backend is
running and get basic node information.

**When to call:** On UI startup, and periodically (every 30s) to detect if the
backend crashed.

**Request:**
```
GET /status HTTP/1.1
Host: 127.0.0.1:8080
```

No request body needed.

**Response `200 OK`:**
```json
{
  "status": "ok",
  "username": "alice",
  "node_id": "a1b2c3d4e5f6…",
  "uptime_seconds": 3600,
  "friends_count": 5,
  "peer_port": 9100,
  "supabase_connected": true,
  "version": "0.1.0"
}
```

| Field | Type | Description |
|---|---|---|
| `status` | string | Always `"ok"` if the backend is healthy. |
| `username` | string | The local user's username (from config). |
| `node_id` | string | Unique identifier for this node (hex-encoded hash of public key). |
| `uptime_seconds` | number | How many seconds the backend has been running. |
| `friends_count` | number | Number of friends in the local database. |
| `peer_port` | number | The TCP port the backend listens on for peer connections. |
| `supabase_connected` | boolean | Whether the last Supabase heartbeat succeeded. |
| `version` | string | Backend version string. |

**What the UI does with this:**
- Shows the username in the title bar.
- Shows a green/red indicator for backend connectivity.
- Shows online/offline for Supabase connectivity.

---

### 4.2 `GET /friends`

**Purpose:** Retrieve the full friend list from the local database.

**When to call:** On UI startup, and after adding a new friend.

**Request:**
```
GET /friends HTTP/1.1
Host: 127.0.0.1:8080
```

**Response `200 OK`:**
```json
[
  {
    "username": "bob",
    "public_key": "Ym9iX3B1YmxpY19rZXlfYmFzZTY0…",
    "signing_key": "Ym9iX3NpZ25pbmdfcHVibGljX2tleQ…",
    "online": true,
    "last_seen": "2026-02-11T16:25:00Z",
    "last_ip": "192.168.1.42",
    "added_at": "2026-02-01T10:00:00Z"
  },
  {
    "username": "charlie",
    "public_key": "Y2hhcmxpZV9wdWJsaWNfa2V5…",
    "signing_key": "Y2hhcmxpZV9zaWduaW5nX2tleQ…",
    "online": false,
    "last_seen": "2026-02-10T08:00:00Z",
    "last_ip": "10.0.0.5",
    "added_at": "2026-02-05T14:30:00Z"
  }
]
```

| Field | Type | Description |
|---|---|---|
| `username` | string | Friend's username. |
| `public_key` | string | Friend's X25519 public key (base64). Used for encryption. |
| `signing_key` | string | Friend's Ed25519 public key (base64). Used for signature verification. |
| `online` | boolean | `true` if the friend's `last_seen` is within the last 5 minutes. This is a best-effort estimate — the backend pings Supabase periodically. |
| `last_seen` | string | ISO 8601 timestamp of when this friend was last active (from Supabase). |
| `last_ip` | string | The friend's last known IP address (from Supabase). The backend uses this for direct TCP connections. |
| `added_at` | string | When you added this friend. |

**What the UI does with this:**
- Populates the friend list panel on the left side of the window.
- Shows a green dot next to online friends, grey dot for offline.
- Sorts: online friends first, then by last_seen descending.

---

### 4.3 `POST /friends`

**Purpose:** Add a new friend by username. The backend looks up the user in
Supabase, fetches their public key and last known IP, and stores them locally.

**When to call:** When the user types a username and clicks "Add Friend."

**Request:**
```
POST /friends HTTP/1.1
Host: 127.0.0.1:8080
Content-Type: application/json

{
  "username": "bob"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `username` | string | ✅ | The username to look up in Supabase. |

**Response `201 Created`** (friend found and added):
```json
{
  "username": "bob",
  "public_key": "Ym9iX3B1YmxpY19rZXk…",
  "signing_key": "Ym9iX3NpZ25pbmdfcHVibGljX2tleQ…",
  "online": true,
  "last_seen": "2026-02-11T16:25:00Z"
}
```

**Response `404 Not Found`** (username doesn't exist in Supabase):
```json
{
  "error": "User 'bob' not found. They must run their backend and register first."
}
```

**Response `409 Conflict`** (already in your friend list):
```json
{
  "error": "User 'bob' is already in your friend list."
}
```

**What happens behind the scenes:**
1. Backend calls Supabase: `GET /rest/v1/users?username=eq.bob`
2. If found: store in local SQLite `friends` table.
3. If not found: return 404 to the UI.

**What the UI does:**
- On success: refresh the friend list, show a success toast notification.
- On 404: show "User not found" message.
- On 409: show "Already added" message.

---

### 4.4 `DELETE /friends/:username`

**Purpose:** Remove a friend from your local list. This does NOT affect Supabase
or the other person — it only removes them from YOUR local database.

**Request:**
```
DELETE /friends/bob HTTP/1.1
Host: 127.0.0.1:8080
```

The username is in the URL path (`:username` is a URL parameter).

**Response `204 No Content`:**
(Empty body — success.)

**Response `404 Not Found`:**
```json
{
  "error": "User 'bob' is not in your friend list."
}
```

**What the UI does:**
- Remove the friend from the friend list.
- Optionally ask for confirmation before sending the DELETE request.

---

### 4.5 `GET /messages?peer=<username>`

**Purpose:** Retrieve chat history with a specific friend from the local SQLite
database. Messages are returned in chronological order (oldest first).

**When to call:** When the user clicks on a friend in the friend list, and
periodically (every 2-3 seconds) to check for new messages.

**Request:**
```
GET /messages?peer=bob&limit=50&offset=0 HTTP/1.1
Host: 127.0.0.1:8080
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `peer` | string | (required) | The friend's username to get chat history with. |
| `limit` | number | 50 | Maximum messages to return. |
| `offset` | number | 0 | Number of messages to skip (for loading older messages). |

**Response `200 OK`:**
```json
{
  "messages": [
    {
      "msg_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "from": "alice",
      "to": "bob",
      "text": "Hey Bob!",
      "timestamp": "2026-02-11T16:00:00Z",
      "direction": "sent",
      "delivered": true,
      "delivery_method": "direct"
    },
    {
      "msg_id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      "from": "bob",
      "to": "alice",
      "text": "Hi Alice! What's up?",
      "timestamp": "2026-02-11T16:00:05Z",
      "direction": "received",
      "delivered": true,
      "delivery_method": "direct"
    },
    {
      "msg_id": "c3d4e5f6-a7b8-9012-cdef-123456789012",
      "from": "alice",
      "to": "bob",
      "text": "Not much, working on our chat app!",
      "timestamp": "2026-02-11T16:00:10Z",
      "direction": "sent",
      "delivered": false,
      "delivery_method": "offline"
    }
  ],
  "total": 3,
  "has_more": false
}
```

| Field | Type | Description |
|---|---|---|
| `messages` | array | Array of message objects (see below). |
| `total` | number | Total number of messages with this peer (for pagination). |
| `has_more` | boolean | `true` if there are more messages beyond the current limit+offset. |

**Message object fields:**

| Field | Type | Description |
|---|---|---|
| `msg_id` | string | UUID identifying this message. |
| `from` | string | Sender username. |
| `to` | string | Recipient username. |
| `text` | string | The **decrypted** plaintext message. The backend decrypts before storing locally, so the UI always gets plaintext. |
| `timestamp` | string | When the message was created (ISO 8601 UTC). |
| `direction` | string | `"sent"` (you sent it) or `"received"` (you received it). Helps the UI decide left/right bubble alignment. |
| `delivered` | boolean | `true` if confirmed delivered. `false` if queued for offline delivery. |
| `delivery_method` | string | `"direct"` (TCP) or `"offline"` (via Supabase). |

**What the UI does:**
- Display messages as chat bubbles. Sent messages on the right, received on the left.
- Show a ✓ icon for delivered messages, a ⏳ clock for pending.
- "Load older messages" button at the top uses `offset` for pagination.

---

### 4.6 `POST /messages`

**Purpose:** Send a chat message to a friend. The backend handles ALL the
complexity: encryption, signing, delivery attempt (TCP), offline fallback
(Supabase), and local storage.

**When to call:** When the user types a message and clicks "Send" (or presses
Enter).

**Request:**
```
POST /messages HTTP/1.1
Host: 127.0.0.1:8080
Content-Type: application/json

{
  "to": "bob",
  "text": "Hey Bob, what's up?"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `to` | string | ✅ | Recipient's username. Must be in your friend list. |
| `text` | string | ✅ | The plaintext message. Maximum 10,000 characters. |

**Response `200 OK`** (message delivered directly via TCP):
```json
{
  "msg_id": "d4e5f6a7-b8c9-0123-def0-234567890123",
  "delivered": true,
  "method": "direct",
  "timestamp": "2026-02-11T16:05:00Z"
}
```

**Response `202 Accepted`** (peer offline, message queued in Supabase):
```json
{
  "msg_id": "d4e5f6a7-b8c9-0123-def0-234567890123",
  "delivered": false,
  "method": "offline",
  "timestamp": "2026-02-11T16:05:00Z",
  "note": "Recipient is offline. Encrypted message stored in Supabase for later delivery."
}
```

**Response `400 Bad Request`** (missing field):
```json
{
  "error": "Missing required field: 'text'"
}
```

**Response `404 Not Found`** (recipient not in friend list):
```json
{
  "error": "'charlie' is not in your friend list. Add them first with POST /friends."
}
```

**What happens behind the scenes:**
1. Backend looks up Bob's public key from local `friends` table.
2. Generates nonce, encrypts plaintext, signs ciphertext.
3. Tries TCP connection to Bob's last known IP:port.
4. **If success:** sends the envelope, returns 200.
5. **If fail:** uploads encrypted envelope to Supabase, returns 202.
6. Stores the message in local SQLite either way.

**What the UI does:**
- On 200: show ✓ next to the message.
- On 202: show ⏳ and a note that it'll be delivered when the peer comes online.
- On error: show the error message inline.

---

### 4.7 `DELETE /messages/:msg_id`

**Purpose:** Delete a single message from LOCAL chat history. This does NOT
delete it from the peer's history or from Supabase.

**Request:**
```
DELETE /messages/d4e5f6a7-b8c9-0123-def0-234567890123 HTTP/1.1
Host: 127.0.0.1:8080
```

**Response `204 No Content`:**
(Empty body — success.)

**Response `404 Not Found`:**
```json
{
  "error": "Message not found."
}
```

---

## 5. Error Handling

### 5.1 Error Response Format

Every error response follows this consistent format:

```json
{
  "error": "Human-readable description of what went wrong"
}
```

The HTTP status code tells you the **category** of error; the `error` field
gives you the **details**.

### 5.2 Status Code Guide for UI Developers

```python
response = requests.post(f"{BASE_URL}/messages", json=payload)

if response.status_code == 200:
    # Success! Message delivered.
    data = response.json()
elif response.status_code == 202:
    # Accepted but not yet delivered (offline).
    data = response.json()
elif response.status_code == 400:
    # Our fault — we sent bad data. Check the payload.
    error_msg = response.json()["error"]
elif response.status_code == 404:
    # Resource not found (e.g., friend doesn't exist).
    error_msg = response.json()["error"]
elif response.status_code == 500:
    # Backend error — something crashed. Check backend logs.
    error_msg = response.json().get("error", "Unknown server error")
```

### 5.3 Connection Errors

If the backend is not running, `requests` will raise a `ConnectionError`:

```python
try:
    response = requests.get(f"{BASE_URL}/status", timeout=5)
except requests.ConnectionError:
    # Backend is not running!
    show_error("Cannot connect to backend. Is it running?")
except requests.Timeout:
    # Backend is running but not responding.
    show_error("Backend is not responding. It might be overloaded.")
```

**Always set a timeout** on HTTP requests. Default `requests` has no timeout,
which means your UI could hang forever if the backend is stuck.

---

## 6. Real-Time Updates

### 6.1 The Problem

When Bob sends Alice a message, how does Alice's UI know about it? The backend
receives the message (via TCP from Bob), stores it in SQLite… but the UI doesn't
know there's a new message until it asks.

### 6.2 Phase 1 Solution: Polling

The simplest approach: the UI periodically calls `GET /messages?peer=<current_friend>`
every few seconds.

```python
import threading
import time

class MessagePoller:
    """Polls the backend for new messages every N seconds."""

    def __init__(self, backend_service, interval=3):
        self.backend = backend_service
        self.interval = interval
        self.current_peer = None
        self._running = False

    def start(self, peer: str):
        self.current_peer = peer
        self._running = True
        thread = threading.Thread(target=self._poll_loop, daemon=True)
        thread.start()

    def stop(self):
        self._running = False

    def _poll_loop(self):
        last_count = 0
        while self._running:
            try:
                data = self.backend.get_messages(self.current_peer)
                if len(data["messages"]) > last_count:
                    last_count = len(data["messages"])
                    # Signal the UI to refresh (emit a Qt signal)
                    self.on_new_messages(data["messages"])
            except Exception:
                pass  # Backend might be temporarily unavailable
            time.sleep(self.interval)
```

**Pros:** Dead simple to implement.
**Cons:** Up to 3 seconds of latency; wastes CPU/bandwidth on empty polls.

### 6.3 Phase 5+ Solution: Server-Sent Events or WebSocket

In later phases, we can upgrade the backend to push notifications to the UI:

- **Server-Sent Events (SSE):** The UI opens `GET /events` and the backend
  keeps the connection open, sending events as they happen. Simpler than WebSocket.
- **WebSocket:** Full-duplex communication. More complex but more powerful.

For now, polling is fine. Don't over-engineer.

---

## 7. Python Code Examples

### 7.1 Using BackendService in the UI

The `BackendService` class in `ui/services/backend_service.py` wraps all API
calls. Here's how the UI uses it:

```python
from services.backend_service import BackendService

backend = BackendService("http://127.0.0.1:8080")

# Check if backend is running
try:
    status = backend.status()
    print(f"Connected as {status['username']}")
except Exception as e:
    print(f"Backend not running: {e}")

# List friends
friends = backend.list_friends()
for friend in friends:
    status_icon = "🟢" if friend["online"] else "⚫"
    print(f"  {status_icon} {friend['username']}")

# Add a friend
try:
    result = backend.add_friend("bob")
    print(f"Added {result['username']}!")
except requests.HTTPError as e:
    if e.response.status_code == 404:
        print("User not found!")
    elif e.response.status_code == 409:
        print("Already in friend list!")

# Send a message
result = backend.send_message("bob", "Hello!")
if result["delivered"]:
    print("✓ Delivered directly!")
else:
    print("⏳ Queued for offline delivery")

# Get chat history
data = backend.get_messages("bob", limit=20)
for msg in data["messages"]:
    arrow = "→" if msg["direction"] == "sent" else "←"
    print(f"  {arrow} {msg['text']}  ({msg['timestamp']})")
```

### 7.2 Integrating with PySide6 (Qt Signals)

Qt uses a signal/slot system for UI updates. Here's how to connect backend
calls to UI elements without freezing the interface:

```python
from PySide6.QtCore import QThread, Signal

class BackendWorker(QThread):
    """Runs backend API calls in a separate thread to avoid freezing the UI."""

    friends_loaded = Signal(list)         # emitted with friend list
    messages_loaded = Signal(dict)        # emitted with messages data
    message_sent = Signal(dict)           # emitted with send result
    error_occurred = Signal(str)          # emitted with error message

    def __init__(self, backend_service):
        super().__init__()
        self.backend = backend_service
        self._task = None
        self._args = ()

    def load_friends(self):
        self._task = "load_friends"
        self.start()

    def load_messages(self, peer):
        self._task = "load_messages"
        self._args = (peer,)
        self.start()

    def send_message(self, to, text):
        self._task = "send_message"
        self._args = (to, text)
        self.start()

    def run(self):
        try:
            if self._task == "load_friends":
                result = self.backend.list_friends()
                self.friends_loaded.emit(result)
            elif self._task == "load_messages":
                result = self.backend.get_messages(*self._args)
                self.messages_loaded.emit(result)
            elif self._task == "send_message":
                result = self.backend.send_message(*self._args)
                self.message_sent.emit(result)
        except Exception as e:
            self.error_occurred.emit(str(e))
```

**Why a separate thread?** HTTP requests can take hundreds of milliseconds. If
you make them on the main (UI) thread, the window freezes until the response
arrives. Qt's `QThread` lets you do the work in the background and update the UI
via signals.

---

## 8. C++ Implementation Notes

### 8.1 Building a Minimal HTTP Server

The backend needs to parse HTTP requests and send HTTP responses. You have
several options:

**Option A: Build from scratch with ASIO (recommended for learning)**

HTTP/1.1 is a text protocol. A minimal parser needs to:
1. Read the request line: `GET /friends HTTP/1.1\r\n`
2. Read headers until `\r\n\r\n`
3. If Content-Length header present, read that many bytes as the body.
4. Route the request to the right handler.
5. Write a response: `HTTP/1.1 200 OK\r\n...`

This is a great exercise! Here's a skeleton:

```cpp
void handle_connection(asio::ip::tcp::socket socket) {
    // 1. Read the full HTTP request
    asio::streambuf buf;
    asio::read_until(socket, buf, "\r\n\r\n");
    std::string raw(asio::buffer_cast<const char*>(buf.data()), buf.size());

    // 2. Parse method + path
    // e.g., "GET /friends HTTP/1.1"
    std::string method = ...;  // "GET"
    std::string path   = ...;  // "/friends"

    // 3. Route to handler
    std::string response_body;
    int status_code;

    if (method == "GET" && path == "/status") {
        status_code = 200;
        response_body = R"({"status":"ok"})";
    } else if (method == "GET" && path == "/friends") {
        // Query SQLite, build JSON...
    } else if (method == "POST" && path == "/messages") {
        // Read body from Content-Length, parse JSON...
    }

    // 4. Send response
    std::string response =
        "HTTP/1.1 " + std::to_string(status_code) + " OK\r\n"
        "Content-Type: application/json\r\n"
        "Content-Length: " + std::to_string(response_body.size()) + "\r\n"
        "\r\n" +
        response_body;
    asio::write(socket, asio::buffer(response));
}
```

**Option B: Use a micro HTTP library**

If you want to skip the HTTP parsing, consider:
- [cpp-httplib](https://github.com/yhirose/cpp-httplib) — single header, very easy to use.
- [Crow](https://github.com/CrowCpp/Crow) — Express.js-like syntax for C++.

```cpp
// Example with cpp-httplib (single header file)
#include "httplib.h"

httplib::Server svr;

svr.Get("/status", [](const httplib::Request&, httplib::Response& res) {
    res.set_content(R"({"status":"ok"})", "application/json");
});

svr.Post("/messages", [](const httplib::Request& req, httplib::Response& res) {
    auto body = nlohmann::json::parse(req.body);
    std::string to = body["to"];
    std::string text = body["text"];
    // ... encrypt, send, etc.
    res.set_content(R"({"delivered":true})", "application/json");
});

svr.listen("127.0.0.1", 8080);
```

We recommend starting with **Option B** (cpp-httplib) to get things working
quickly, then optionally rewriting with raw ASIO if you want to learn HTTP
parsing.

### 8.2 Parsing Query Parameters

For endpoints like `GET /messages?peer=bob&limit=20`, you need to parse query
parameters from the URL.

```cpp
// Simple query parameter parser
#include <string>
#include <map>

std::map<std::string, std::string> parse_query(const std::string& url) {
    std::map<std::string, std::string> params;
    auto pos = url.find('?');
    if (pos == std::string::npos) return params;

    std::string query = url.substr(pos + 1);
    std::istringstream stream(query);
    std::string pair;
    while (std::getline(stream, pair, '&')) {
        auto eq = pair.find('=');
        if (eq != std::string::npos) {
            params[pair.substr(0, eq)] = pair.substr(eq + 1);
        }
    }
    return params;
}

// Usage:
auto params = parse_query("/messages?peer=bob&limit=20");
std::string peer  = params["peer"];   // "bob"
std::string limit = params["limit"];  // "20"
```

(cpp-httplib handles this for you automatically.)

---

## 9. Testing the API with curl

Before wiring up the Python UI, you can test each endpoint from the command line
using `curl`. This is extremely useful for debugging.

### 9.1 Install curl

- **Windows:** `winget install curl` or download from https://curl.se/download.html
- **Linux/macOS:** Already installed.

### 9.2 Test Commands

```bash
# Health check
curl http://127.0.0.1:8080/status

# List friends
curl http://127.0.0.1:8080/friends

# Add a friend
curl -X POST http://127.0.0.1:8080/friends \
     -H "Content-Type: application/json" \
     -d '{"username": "bob"}'

# Send a message
curl -X POST http://127.0.0.1:8080/messages \
     -H "Content-Type: application/json" \
     -d '{"to": "bob", "text": "Hello from curl!"}'

# Get chat history
curl "http://127.0.0.1:8080/messages?peer=bob&limit=10"

# Delete a message
curl -X DELETE http://127.0.0.1:8080/messages/some-uuid-here

# Delete a friend
curl -X DELETE http://127.0.0.1:8080/friends/bob
```

### 9.3 Pretty-printing JSON

curl output is a single line by default. To make it readable:

```bash
# Using Python (available on all platforms)
curl http://127.0.0.1:8080/friends | python -m json.tool

# Using jq (install: winget install jqlang.jq)
curl http://127.0.0.1:8080/friends | jq .
```

### 9.4 PowerShell Alternative (Windows)

If you prefer PowerShell over curl:

```powershell
# GET request
Invoke-RestMethod -Uri "http://127.0.0.1:8080/status" | ConvertTo-Json

# POST request
$body = @{ to = "bob"; text = "Hello!" } | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:8080/messages" -Method POST -Body $body -ContentType "application/json"
```
