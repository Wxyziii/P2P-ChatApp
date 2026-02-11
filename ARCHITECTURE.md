# Architecture — Secure P2P Chat

> Version 0.1 — Draft
>
> This document explains **how the entire system works** at a level of detail
> that lets you implement it. If you're new to systems design, networking, or
> cryptography, this document is your guide. Every concept is explained from
> scratch.

---

## Table of Contents

1. [What is "Architecture"?](#1-what-is-architecture)
2. [The Big Picture](#2-the-big-picture)
3. [Why This Design? (Design Decisions)](#3-why-this-design-design-decisions)
4. [Component Deep-Dives](#4-component-deep-dives)
   - [4.1 C++ Backend (P2P Node)](#41-c-backend-p2p-node)
   - [4.2 Python UI](#42-python-ui)
   - [4.3 Supabase (Cloud Database)](#43-supabase-cloud-database)
5. [How Data Flows Through the System](#5-how-data-flows-through-the-system)
   - [5.1 Application Startup](#51-application-startup)
   - [5.2 Adding a Friend](#52-adding-a-friend)
   - [5.3 Sending a Message (Peer Online)](#53-sending-a-message-peer-online)
   - [5.4 Sending a Message (Peer Offline)](#54-sending-a-message-peer-offline)
   - [5.5 Receiving a Message (Direct)](#55-receiving-a-message-direct)
   - [5.6 Fetching Offline Messages (Startup)](#56-fetching-offline-messages-startup)
   - [5.7 Heartbeat Loop](#57-heartbeat-loop)
6. [Security Architecture](#6-security-architecture)
   - [6.1 Key Pairs Explained](#61-key-pairs-explained)
   - [6.2 Encryption Flow (Step by Step)](#62-encryption-flow-step-by-step)
   - [6.3 Trust Model (TOFU)](#63-trust-model-tofu)
7. [Threading & Concurrency Model](#7-threading--concurrency-model)
8. [Local Storage (SQLite)](#8-local-storage-sqlite)
9. [Supabase Schema (Detailed)](#9-supabase-schema-detailed)
10. [Network Protocol](#10-network-protocol)
11. [Backend ↔ UI API](#11-backend--ui-api)
12. [Error Handling Strategy](#12-error-handling-strategy)
13. [Configuration](#13-configuration)
14. [Deployment & Running](#14-deployment--running)
15. [Glossary](#15-glossary)

---

## 1. What is "Architecture"?

Software architecture is the **high-level design** of a system. It answers
questions like:

- What are the major **components** (pieces) of the system?
- How do they **communicate** with each other?
- What are the **responsibilities** of each component?
- What happens when something **goes wrong**?

Think of it like a building's architecture: before laying bricks, you need a
blueprint that shows where the walls, plumbing, and electrical wiring go.

This document is your blueprint.

---

## 2. The Big Picture

Our system has **three main components** that work together:

```
 YOUR COMPUTER                                    FRIEND'S COMPUTER
 ============                                    ==================

 +-----------+   HTTP (localhost)  +----------+        +----------+   HTTP   +-----------+
 | Python UI | <================> | C++      |  TCP   | C++      | <======> | Python UI |
 | (PySide6) |   port 8080       | Backend  | <====> | Backend  |  port    | (PySide6) |
 +-----------+                    | (Node A) |  9100  | (Node B) |  8080   +-----------+
                                  +----+-----+        +----+-----+
                                       |                    |
                                       | HTTPS              | HTTPS
                                       v                    v
                                  +----------------------------+
                                  |         Supabase           |
                                  |    (Cloud PostgreSQL)      |
                                  |                            |
                                  |  users table:              |
                                  |    username, public_key,   |
                                  |    last_ip, last_seen      |
                                  |                            |
                                  |  messages table:           |
                                  |    to_user, from_user,     |
                                  |    ciphertext, created_at  |
                                  +----------------------------+
```

### What Each Arrow Means

| Connection | Protocol | Port | Encrypted? | Purpose |
|---|---|---|---|---|
| UI ↔ Backend | HTTP | 8080 (configurable) | No (localhost only, safe) | UI sends commands (send message, add friend). Backend returns data (messages, friend list). |
| Backend ↔ Backend | TCP | 9100 (configurable) | Yes (application-layer E2EE) | Direct peer-to-peer message exchange. |
| Backend ↔ Supabase | HTTPS | 443 | Yes (TLS) | User registration, friend lookup, offline message storage. |

### The Key Principle: Separation of Concerns

Each component does ONE thing well:

- **C++ Backend:** All the hard stuff — networking, encryption, database queries.
  This is the "brain" of the application.
- **Python UI:** All the pretty stuff — windows, buttons, displaying messages.
  This is the "face" of the application.
- **Supabase:** All the cloud stuff — storing user records and offline messages.
  This is the "phone book and mailbox."

The UI never touches the network directly. The backend never draws windows. This
separation makes the code cleaner, easier to debug, and lets two developers work
independently.

---

## 3. Why This Design? (Design Decisions)

Every design choice has a reason. Here's why we chose this architecture:

### 3.1 Why C++ for the backend?

| Alternative | Why We Didn't Choose It |
|---|---|
| Python for everything | Python is slow for crypto operations and less suited for high-performance networking. Also, we want to learn C++! |
| Go / Rust | Great languages, but we specifically want C++ experience. |
| Node.js | JavaScript's async model is nice, but we want systems-level control. |

**What we gain:** Performance, direct access to libsodium's C API, learning
C++20 features, experience with CMake and system-level programming.

### 3.2 Why Python for the UI?

| Alternative | Why We Didn't Choose It |
|---|---|
| C++ Qt | Writing UIs in C++ is painful and slow. Qt + Python (PySide6) gives us the same powerful widgets with 10x faster development. |
| Electron (HTML/JS) | Heavy (ships a whole Chromium browser). PySide6 is lighter and more native-feeling. |
| Web browser UI | Requires a web server, HTML, CSS, JavaScript — too many technologies. PySide6 is one framework. |

**What we gain:** Fast UI development, easy-to-read Python code, PySide6's huge
widget library, and it looks native on every platform.

### 3.3 Why a localhost HTTP API between UI and backend?

| Alternative | Why We Didn't Choose It |
|---|---|
| Shared memory / IPC | Complex, OS-specific, hard to debug. |
| gRPC | Powerful but adds another dependency and learning curve. |
| stdin/stdout pipe | Fragile, hard to debug, no standard format. |

**What we gain:** HTTP is universal, debuggable with curl, well-understood, and
both C++ and Python have great HTTP libraries. The Python `requests` library and
a simple C++ HTTP server make this trivial.

### 3.4 Why Supabase and not our own server?

| Alternative | Why We Didn't Choose It |
|---|---|
| Self-hosted PostgreSQL | We'd need a VPS ($5-10/month) and system admin skills. |
| Firebase | Google's platform — fine, but PostgreSQL is more educational. |
| No server at all | Users would need to exchange IPs manually — terrible UX. |

**What we gain:** Free hosting, automatic REST API (PostgREST), PostgreSQL
experience, zero server management, and a nice dashboard for debugging.

### 3.5 Why not use WebSockets for the UI?

Polling (asking "any new messages?" every few seconds) is simpler than
WebSockets (maintaining a persistent connection). For Phase 1, polling is fine.
We can upgrade to WebSockets or Server-Sent Events in a later phase if the
polling latency bothers us.

---

## 4. Component Deep-Dives

### 4.1 C++ Backend (P2P Node)

The backend is a single long-running C++ process. Think of it like a daemon or
service that runs in the background while the UI is open.

#### Module Overview

```
+-----------------------------------------------------------+
|                     C++ Backend Process                     |
|                                                             |
|  +-------+  +----------+  +----------+  +-----------+     |
|  | Node  |  | Crypto   |  | Supabase |  | LocalAPI  |     |
|  | (core)|  | Manager  |  | Client   |  | (HTTP)    |     |
|  +---+---+  +----+-----+  +----+-----+  +-----+-----+     |
|      |           |              |               |           |
|      +-----+-----+-----+-------+-------+-------+           |
|            |           |               |                    |
|      +-----+-----+  +-+--------+  +---+---+               |
|      | PeerServer|  |PeerClient|  | SQLite |               |
|      | (TCP in)  |  |(TCP out) |  | (local)|               |
|      +-----------+  +----------+  +--------+               |
|                                                             |
|      All tied together by asio::io_context event loop       |
+-----------------------------------------------------------+
```

#### Module Responsibilities

| Module | File(s) | What It Does | Depends On |
|---|---|---|---|
| **Node** | `node/node.h`, `node/node.cpp` | The central coordinator. Owns the user identity (username, node_id, key pair). Routes messages between modules. | CryptoManager, SupabaseClient, PeerServer, PeerClient, SQLite |
| **CryptoManager** | `crypto/crypto_manager.h`, `crypto/crypto_manager.cpp` | All cryptographic operations: key generation, encryption, decryption, signing, verification. Wraps libsodium. | libsodium |
| **PeerServer** | `network/peer_server.h`, `network/peer_server.cpp` | Listens for incoming TCP connections from remote peers. When a peer connects, reads their message and passes it to Node for processing. | ASIO, Node (callback) |
| **PeerClient** | `network/peer_client.h`, `network/peer_client.cpp` | Connects to a remote peer's IP:port and sends a message. Used for direct message delivery. | ASIO |
| **SupabaseClient** | `supabase/supabase_client.h`, `supabase/supabase_client.cpp` | Makes HTTP requests (GET, POST, PATCH, DELETE) to the Supabase REST API using libcurl. Handles user registration, friend lookup, heartbeat, and offline messages. | libcurl, nlohmann/json |
| **LocalAPI** | `api/local_api.h`, `api/local_api.cpp` | HTTP server that listens on `127.0.0.1:8080` for requests from the Python UI. Translates HTTP requests into Node method calls. | ASIO (or cpp-httplib), Node, nlohmann/json |

#### How Modules Interact (Message Send Example)

```
UI sends: POST /messages {"to":"bob","text":"Hello!"}
    |
    v
LocalAPI.handle_request()
    |
    v
Node.send_message("bob", "Hello!")
    |
    +--> Look up Bob's public key from SQLite
    |
    +--> CryptoManager.encrypt("Hello!", bob_pk)  --> ciphertext
    |
    +--> CryptoManager.sign(ciphertext)  --> signature
    |
    +--> Build envelope JSON
    |
    +--> PeerClient.connect(bob_ip, bob_port)
    |       |
    |       +--> SUCCESS: PeerClient.send(envelope) --> return "direct"
    |       |
    |       +--> FAILURE: SupabaseClient.push_offline_message(envelope) --> return "offline"
    |
    +--> Store message in SQLite
    |
    v
LocalAPI returns: {"delivered": true/false, "method": "direct"/"offline"}
```

### 4.2 Python UI

The Python UI is a standard desktop application built with PySide6 (Qt 6).

#### Window Layout

```
+------------------------------------------------------------------+
|  Secure P2P Chat - alice                              [_][O][X]  |
+------------------------------------------------------------------+
|  Friends              |  Chat with: bob                           |
|  =======              |  ============                             |
|                       |                                           |
|  [green] bob          |  bob (3:00 PM):                          |
|  [grey]  charlie      |    Hey Alice!                             |
|                       |                                           |
|                       |  alice (3:01 PM):                         |
|                       |    Hi Bob! Working on our app!            |
|                       |                                           |
|                       |  bob (3:02 PM):                          |
|                       |    Nice! How's it going?                  |
|                       |                                           |
|  +------------------+ |  +------------------------------+------+  |
|  | Add friend...    | |  | Type a message...            | Send |  |
|  +------------------+ |  +------------------------------+------+  |
|  [Add Friend]         |                                           |
+------------------------------------------------------------------+
```

#### Key Classes

| Class | File | Responsibility |
|---|---|---|
| **main.py** | `ui/main.py` | Entry point. Creates QApplication and shows MainWindow. |
| **MainWindow** | `ui/views/main_window.py` | The main application window. Contains the friend list, chat display, and message input. Connects UI events to BackendService calls. |
| **BackendService** | `ui/services/backend_service.py` | HTTP client that wraps all API calls to the C++ backend. Every method corresponds to one API endpoint. |

#### UI-Backend Communication Pattern

The UI follows a simple pattern for every action:

```python
# 1. User does something (clicks a button, presses Enter)
def on_send_clicked(self):
    text = self.message_input.text()
    peer = self.current_friend

    # 2. Call the backend API
    try:
        result = self.backend.send_message(peer, text)
    except ConnectionError:
        self.show_error("Backend not running!")
        return

    # 3. Update the UI based on the response
    if result["delivered"]:
        self.add_message_bubble(text, "sent", delivered=True)
    else:
        self.add_message_bubble(text, "sent", delivered=False)
```

**Important: Never block the UI thread!** HTTP requests can take time. Use
`QThread` or `asyncio` to make API calls in a background thread, and update
the UI via Qt signals. See `protocol/api_contract.md` Section 7 for examples.

### 4.3 Supabase (Cloud Database)

Supabase provides two things:

1. **A PostgreSQL database** — where we store user records and offline messages.
2. **An automatic REST API** — Supabase runs PostgREST, which creates HTTP
   endpoints for every table. No server code needed!

#### How PostgREST Works

When you create a table called `users`, Supabase automatically creates these
endpoints:

| Operation | HTTP Request | SQL Equivalent |
|---|---|---|
| List all users | `GET /rest/v1/users` | `SELECT * FROM users` |
| Get one user | `GET /rest/v1/users?username=eq.alice` | `SELECT * FROM users WHERE username = 'alice'` |
| Insert a user | `POST /rest/v1/users` with JSON body | `INSERT INTO users (...) VALUES (...)` |
| Update a user | `PATCH /rest/v1/users?username=eq.alice` with JSON body | `UPDATE users SET ... WHERE username = 'alice'` |
| Delete a user | `DELETE /rest/v1/users?username=eq.alice` | `DELETE FROM users WHERE username = 'alice'` |
| Upsert | `POST /rest/v1/users` with header `Prefer: resolution=merge-duplicates` | `INSERT ... ON CONFLICT ... DO UPDATE` |

Every request needs two headers:
```
apikey: YOUR_ANON_KEY
Authorization: Bearer YOUR_ANON_KEY
```

#### PostgREST Query Operators

| Operator | Meaning | Example |
|---|---|---|
| `eq.` | Equal | `?username=eq.alice` → WHERE username = 'alice' |
| `neq.` | Not equal | `?username=neq.alice` |
| `gt.` | Greater than | `?last_seen=gt.2026-02-10T00:00:00Z` |
| `lt.` | Less than | `?created_at=lt.2026-02-04T00:00:00Z` (for 7-day cleanup) |
| `gte.` | Greater or equal | `?age=gte.18` |
| `lte.` | Less or equal | `?age=lte.65` |
| `like.` | Pattern match | `?username=like.*alice*` |
| `is.` | IS (for NULL) | `?last_ip=is.null` |
| `order` | Sort | `?order=last_seen.desc` |
| `limit` | Max results | `?limit=10` |

These operators are appended to the URL as query parameters. You can combine them:
```
GET /rest/v1/messages?to_user=eq.bob&order=created_at.desc&limit=50
```

---

## 5. How Data Flows Through the System

These are step-by-step walkthroughs of every major operation. Follow along
with the code files to understand where each step happens.

### 5.1 Application Startup

When a user launches the application, this sequence happens:

```
USER double-clicks the app
    |
    v
1. C++ Backend starts (main.cpp)
    |
    +--> Load config.json
    |       Read username, ports, Supabase URL/key
    |
    +--> CryptoManager.init()
    |       Call sodium_init()
    |       Load key pair from disk (or generate new one if first run)
    |
    +--> Initialize SQLite database
    |       Create tables if they don't exist (identity, friends, messages)
    |
    +--> SupabaseClient.register_user()
    |       UPSERT into users table:
    |         username, node_id, public_key, current IP, NOW()
    |
    +--> SupabaseClient.fetch_offline_messages(username)
    |       GET /rest/v1/messages?to_user=eq.<username>
    |       For each message:
    |           Verify signature --> Decrypt --> Store in local SQLite
    |       DELETE /rest/v1/messages?to_user=eq.<username>
    |
    +--> PeerServer.start()
    |       Begin listening on port 9100 (or configured port)
    |       Ready to accept incoming peer connections
    |
    +--> LocalAPI.start()
    |       Begin listening on 127.0.0.1:8080
    |       Ready to accept requests from the Python UI
    |
    +--> Start heartbeat timer (every 60 seconds)
    |
    +--> asio::io_context.run()
            Event loop starts — handles all async I/O
```

```
2. Python UI starts (main.py)
    |
    +--> Create QApplication
    |
    +--> Create MainWindow
    |
    +--> BackendService.status()
    |       GET http://127.0.0.1:8080/status
    |       Verify backend is running
    |
    +--> BackendService.list_friends()
    |       GET http://127.0.0.1:8080/friends
    |       Populate the friend list panel
    |
    +--> Start message polling timer (every 3 seconds)
    |
    +--> window.show()
            UI is visible and interactive
```

### 5.2 Adding a Friend

```
User types "bob" in the "Add friend" input and clicks "Add Friend"
    |
    v
UI: BackendService.add_friend("bob")
    POST http://127.0.0.1:8080/friends {"username": "bob"}
    |
    v
Backend LocalAPI receives POST /friends
    |
    v
Node.add_friend("bob")
    |
    +--> Check local database: is "bob" already a friend?
    |       YES --> return 409 Conflict ("Already in friend list")
    |       NO  --> continue
    |
    +--> SupabaseClient.lookup_user("bob")
    |       GET /rest/v1/users?username=eq.bob
    |       |
    |       +--> NOT FOUND --> return 404 ("User not found")
    |       |
    |       +--> FOUND --> returns:
    |               {
    |                   "username": "bob",
    |                   "public_key": "base64...",
    |                   "last_ip": "192.168.1.42",
    |                   "last_seen": "2026-02-11T16:00:00Z"
    |               }
    |
    +--> Store in local SQLite `friends` table:
    |       INSERT INTO friends (username, public_key, signing_pk, last_ip, last_seen)
    |       VALUES ('bob', '...', '...', '192.168.1.42', '...')
    |
    +--> Return friend info to LocalAPI
    |
    v
LocalAPI returns 201 Created with friend JSON
    |
    v
UI receives response
    |
    +--> Add "bob" to the friend list widget
    +--> Show success notification: "bob added!"
```

### 5.3 Sending a Message (Peer Online)

This is the primary message flow — when both peers are running.

```
Alice types "Hello!" and clicks Send
    |
    v
UI: POST /messages {"to":"bob", "text":"Hello!"}
    |
    v
Backend: Node.send_message("bob", "Hello!")
    |
    +--> Generate msg_id = uuid_v4()  (e.g., "a1b2c3d4-...")
    |
    +--> Build plaintext JSON:
    |       {"text": "Hello!", "msg_id": "a1b2c3d4-..."}
    |
    +--> Look up Bob's public key from local friends table
    |       bob_pk = [32 bytes X25519]
    |       bob_sign_pk = [32 bytes Ed25519]
    |
    +--> CryptoManager.encrypt(plaintext_json, bob_pk)
    |       1. Generate 24-byte random nonce
    |       2. crypto_box_easy(plaintext, nonce, bob_pk, alice_sk)
    |       3. Return (ciphertext, nonce)
    |
    +--> CryptoManager.sign(ciphertext)
    |       crypto_sign_detached(ciphertext, alice_sign_sk)
    |       Return 64-byte signature
    |
    +--> Build envelope JSON:
    |       {
    |           "type": "message",
    |           "from": "alice",
    |           "to": "bob",
    |           "timestamp": "2026-02-11T16:00:00Z",
    |           "nonce": base64(nonce),
    |           "ciphertext": base64(ciphertext),
    |           "signature": base64(signature)
    |       }
    |
    +--> PeerClient.connect(bob_ip, 9100)
    |       TCP connect to 192.168.1.42:9100
    |       SUCCESS!
    |
    +--> PeerClient.send(envelope)
    |       1. Calculate length of envelope JSON string
    |       2. Write 4-byte big-endian length header
    |       3. Write envelope JSON bytes
    |       SUCCESS!
    |
    +--> Store in local SQLite:
    |       INSERT INTO messages (msg_id, peer, direction, plaintext, timestamp, delivered)
    |       VALUES ('a1b2c3d4-...', 'bob', 'sent', 'Hello!', '...', true)
    |
    +--> Return {"msg_id": "a1b2c3d4-...", "delivered": true, "method": "direct"}
    |
    v
UI shows: "Hello!" with a checkmark
```

### 5.4 Sending a Message (Peer Offline)

Same as above, but TCP connection fails:

```
... (same encryption steps) ...
    |
    +--> PeerClient.connect(bob_ip, 9100)
    |       TCP connect attempt...
    |       TIMEOUT after 5 seconds (Bob is offline)
    |
    +--> Fallback: SupabaseClient.push_offline_message()
    |       POST /rest/v1/messages
    |       {
    |           "to_user": "bob",
    |           "from_user": "alice",
    |           "ciphertext": base64(entire envelope JSON)
    |       }
    |       SUCCESS! (Supabase stored it)
    |
    +--> Store in local SQLite with delivered=false
    |
    +--> Return {"msg_id": "...", "delivered": false, "method": "offline"}
    |
    v
UI shows: "Hello!" with a clock icon (pending delivery)
```

### 5.5 Receiving a Message (Direct)

What happens on Bob's side when Alice sends a direct message:

```
Bob's PeerServer is listening on port 9100
    |
    v
PeerServer.do_accept()
    New TCP connection from 192.168.1.10 (Alice's IP)
    |
    v
PeerSession.read_message()
    1. Read 4 bytes --> length header (e.g., 287)
    2. Read 287 bytes --> envelope JSON string
    3. Parse JSON --> envelope object
    |
    v
Node.on_message_received(envelope)
    |
    +--> Check: envelope["to"] == "bob"?
    |       YES --> continue
    |       NO  --> reject (not for us)
    |
    +--> Look up Alice's public keys from local friends table
    |       alice_sign_pk = [32 bytes Ed25519]
    |       alice_pk = [32 bytes X25519]
    |
    +--> CryptoManager.verify(ciphertext, signature, alice_sign_pk)
    |       crypto_sign_verify_detached(signature, ciphertext, alice_sign_pk)
    |       RESULT == 0 --> Valid signature! Continue.
    |       RESULT != 0 --> REJECT! Log warning. Close connection.
    |
    +--> CryptoManager.decrypt(ciphertext, nonce, alice_pk)
    |       crypto_box_open_easy(ciphertext, nonce, alice_pk, bob_sk)
    |       Result: '{"text": "Hello!", "msg_id": "a1b2c3d4-..."}'
    |
    +--> Parse plaintext JSON --> text="Hello!", msg_id="a1b2c3d4-..."
    |
    +--> Deduplication check: has msg_id been seen before?
    |       YES --> ignore (replay protection)
    |       NO  --> continue
    |
    +--> Store in local SQLite:
    |       INSERT INTO messages (msg_id, peer, direction, plaintext, timestamp, delivered)
    |       VALUES ('a1b2c3d4-...', 'alice', 'received', 'Hello!', '...', true)
    |
    v
Message stored. Next UI poll will pick it up.
```

### 5.6 Fetching Offline Messages (Startup)

What happens when Bob starts his backend and has offline messages waiting:

```
Bob's backend starts up
    |
    +--> SupabaseClient.fetch_offline_messages("bob")
    |       GET /rest/v1/messages?to_user=eq.bob
    |       |
    |       v
    |       Response: [
    |           {
    |               "id": "uuid-1",
    |               "to_user": "bob",
    |               "from_user": "alice",
    |               "ciphertext": "base64-of-envelope-json",
    |               "created_at": "2026-02-11T14:00:00Z"
    |           },
    |           {
    |               "id": "uuid-2",
    |               "to_user": "bob",
    |               "from_user": "alice",
    |               "ciphertext": "base64-of-another-envelope",
    |               "created_at": "2026-02-11T14:05:00Z"
    |           }
    |       ]
    |
    +--> For EACH message in the array:
    |       |
    |       +--> base64_decode(ciphertext) --> envelope JSON string
    |       |
    |       +--> Parse envelope JSON
    |       |
    |       +--> Look up sender (from_user) public keys
    |       |       If sender is not a friend --> skip or log warning
    |       |
    |       +--> CryptoManager.verify(ciphertext, signature, sender_sign_pk)
    |       |       INVALID --> skip, log warning
    |       |       VALID   --> continue
    |       |
    |       +--> CryptoManager.decrypt(ciphertext, nonce, sender_pk)
    |       |       --> plaintext JSON
    |       |
    |       +--> Parse plaintext --> text, msg_id
    |       |
    |       +--> Store in local SQLite (direction='received', delivered=true)
    |
    +--> Delete all fetched messages from Supabase:
            DELETE /rest/v1/messages?to_user=eq.bob
            (Clean up -- don't leave messages sitting in the cloud)
```

### 5.7 Heartbeat Loop

The heartbeat keeps the user's record fresh in Supabase and prevents the free
tier from auto-pausing.

```
Every 60 seconds:
    |
    +--> SupabaseClient.heartbeat(username, current_ip)
    |       PATCH /rest/v1/users?username=eq.alice
    |       Body: {"last_ip": "192.168.1.10", "last_seen": "2026-02-11T16:01:00Z"}
    |
    +--> If request fails (network error, Supabase down):
            Log warning but don't crash. Try again in 60 seconds.
```

---

## 6. Security Architecture

### 6.1 Key Pairs Explained

Each node generates **two separate key pairs** on first run:

```
KEY PAIR 1: Encryption (X25519)
    Public key:  32 bytes  -- shared with the world (uploaded to Supabase)
    Secret key:  32 bytes  -- NEVER leaves your machine

    Used for: crypto_box_easy / crypto_box_open_easy
    Purpose:  Encrypting and decrypting messages

KEY PAIR 2: Signing (Ed25519)
    Public key:  32 bytes  -- shared with the world (stored with friends)
    Secret key:  64 bytes  -- NEVER leaves your machine

    Used for: crypto_sign_detached / crypto_sign_verify_detached
    Purpose:  Proving who sent a message (authentication)
```

**Why two key pairs?** Using the same key for encryption AND signing can create
subtle cryptographic weaknesses. Best practice is to use separate keys for
separate purposes.

**Where are keys stored?**
- On disk: `keys.json` in the backend directory (or path from config).
- In Supabase: only the PUBLIC keys (in the `users` table).
- In local SQLite: your own keys in the `identity` table; friends' public keys
  in the `friends` table.

### 6.2 Encryption Flow (Step by Step)

Here's exactly what happens cryptographically when Alice sends Bob a message:

```
ALICE'S MACHINE                              BOB'S MACHINE
==============                              ==============

Alice has:                                  Bob has:
  - Her X25519 secret key (alice_sk)          - His X25519 secret key (bob_sk)
  - Her Ed25519 secret key (alice_sign_sk)    - His Ed25519 secret key (bob_sign_sk)
  - Bob's X25519 public key (bob_pk)          - Alice's X25519 public key (alice_pk)
  - Bob's Ed25519 public key (bob_sign_pk)    - Alice's Ed25519 public key (alice_sign_pk)

Step 1: ENCRYPT
  nonce = randombytes_buf(24)  // 24 random bytes
  ciphertext = crypto_box_easy(
      "Hello!",     // plaintext
      nonce,        // ensures uniqueness
      bob_pk,       // Bob's public key
      alice_sk      // Alice's secret key
  )
  // Output: ciphertext (len = plaintext_len + 16)

Step 2: SIGN
  signature = crypto_sign_detached(
      ciphertext,       // we sign the ENCRYPTED data
      alice_sign_sk     // Alice's signing secret key
  )
  // Output: signature (64 bytes)

Step 3: SEND
  Send to Bob: {nonce, ciphertext, signature, from:"alice"}

                    --- network --->

Step 4: VERIFY                              Bob receives the envelope.
                                            signature_ok = crypto_sign_verify_detached(
                                                signature,
                                                ciphertext,
                                                alice_sign_pk  // Alice's signing PUBLIC key
                                            )
                                            if NOT ok --> REJECT!

Step 5: DECRYPT
                                            plaintext = crypto_box_open_easy(
                                                ciphertext,
                                                nonce,
                                                alice_pk,    // Alice's PUBLIC key
                                                bob_sk       // Bob's SECRET key
                                            )
                                            if fails --> REJECT! (tampered or wrong keys)
                                            // Output: "Hello!"
```

### 6.3 Trust Model (TOFU)

TOFU = Trust On First Use. Here's how it works:

```
1. Alice adds Bob as a friend.
   --> Backend looks up Bob in Supabase.
   --> Gets Bob's public key: "ABC123..."
   --> Stores it locally: friends table has bob -> "ABC123..."
   --> This is now Bob's PINNED key.

2. Every time Alice sends to Bob, she uses the LOCALLY stored key.
   She does NOT re-fetch from Supabase every time.

3. Periodically (or on manual refresh), Alice's backend checks Supabase.
   --> Bob's key is still "ABC123..."? Great, nothing changed.
   --> Bob's key changed to "XYZ789..."? 

4. KEY CHANGE DETECTED:
   --> Backend flags this as a warning.
   --> UI shows: "Bob's encryption key has changed! This could mean
       Bob set up a new device, OR someone is impersonating Bob."
   --> User must manually accept the new key before messaging resumes.
```

**Why TOFU?** It's simple and works for our use case. The alternative (a
Certificate Authority or Web of Trust) is much more complex. Signal uses
TOFU too (they call it "Safety Numbers").

---

## 7. Threading & Concurrency Model

### 7.1 C++ Backend: Single-Threaded Event Loop

The backend uses ASIO's `io_context` — a single-threaded event loop that
handles all I/O operations asynchronously.

```
Main Thread runs io_context.run():
    |
    +-- PeerServer: async_accept() waiting for peer connections
    |     When a peer connects: async_read() the message
    |
    +-- LocalAPI: async_accept() waiting for UI HTTP requests
    |     When UI sends request: async_read() + process + async_write()
    |
    +-- Timers:
    |     heartbeat_timer: fires every 60s -> SupabaseClient.heartbeat()
    |     cleanup_timer: fires every hour -> delete old messages
    |
    +-- PeerClient: async_connect() + async_write() for outgoing messages
```

**"Asynchronous" means:** Instead of blocking (waiting) for I/O to complete,
we register a callback and return immediately. ASIO calls our callback when
the I/O is done. This lets a single thread handle many connections efficiently.

**Example:**
```cpp
// This does NOT block. It returns immediately.
// When a connection arrives, on_accept is called.
acceptor.async_accept([this](asio::error_code ec, asio::ip::tcp::socket socket) {
    if (!ec) {
        // Handle the new connection
        handle_connection(std::move(socket));
    }
    // Accept the next connection
    do_accept();
});
```

**Why single-threaded?** Multi-threading is hard and error-prone (race
conditions, deadlocks). A single-threaded event loop is simpler, safer, and
fast enough for a chat application. If performance becomes an issue (unlikely),
we can add a thread pool later.

### 7.2 Python UI: Main Thread + Worker Threads

Qt requires all UI updates to happen on the main thread. HTTP requests must
happen on background threads to avoid freezing the UI.

```
Main Thread (Qt event loop):
    |
    +-- Handles UI events (button clicks, typing, window resizing)
    +-- Updates widgets (add text to chat, update friend list)
    +-- Receives signals from worker threads
    
Worker Thread (QThread):
    |
    +-- Makes HTTP requests to the backend
    +-- Emits signals when data is available
    +-- Never touches UI widgets directly!
```

---

## 8. Local Storage (SQLite)

Each node maintains a local SQLite database. SQLite is a file-based database —
the entire database is a single `.db` file on your hard drive.

### 8.1 Schema

```sql
-- =============================================
-- TABLE: identity
-- Stores YOUR key pair and identity info.
-- There's only ever ONE row in this table.
-- =============================================
CREATE TABLE IF NOT EXISTS identity (
    username    TEXT PRIMARY KEY,
    node_id     TEXT NOT NULL,
    -- Raw binary keys stored as BLOBs (Binary Large Objects)
    public_key  BLOB NOT NULL,      -- 32 bytes, X25519 public
    secret_key  BLOB NOT NULL,      -- 32 bytes, X25519 secret (SENSITIVE!)
    signing_pk  BLOB NOT NULL,      -- 32 bytes, Ed25519 public
    signing_sk  BLOB NOT NULL       -- 64 bytes, Ed25519 secret (SENSITIVE!)
);

-- =============================================
-- TABLE: friends
-- Stores information about your friends.
-- Public keys are used for encryption/verification.
-- =============================================
CREATE TABLE IF NOT EXISTS friends (
    username    TEXT PRIMARY KEY,
    public_key  BLOB NOT NULL,      -- Friend's X25519 public key
    signing_pk  BLOB NOT NULL,      -- Friend's Ed25519 public key
    last_ip     TEXT,               -- Last known IP address
    last_seen   TIMESTAMP,          -- When they were last online
    added_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- TABLE: messages
-- Chat history. Messages are stored DECRYPTED
-- (plaintext) because this is YOUR local database.
-- =============================================
CREATE TABLE IF NOT EXISTS messages (
    msg_id      TEXT PRIMARY KEY,       -- UUID from the message
    peer        TEXT NOT NULL,          -- The other person's username
    direction   TEXT NOT NULL,          -- 'sent' or 'received'
    plaintext   TEXT NOT NULL,          -- The actual message text
    timestamp   TIMESTAMP NOT NULL,     -- When the message was created
    delivered   BOOLEAN DEFAULT FALSE,  -- Has it been confirmed delivered?
    FOREIGN KEY (peer) REFERENCES friends(username)
);

-- =============================================
-- TABLE: seen_message_ids
-- For replay attack protection.
-- Stores IDs of messages we've already processed.
-- =============================================
CREATE TABLE IF NOT EXISTS seen_message_ids (
    msg_id      TEXT PRIMARY KEY,
    received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 8.2 Why Store Messages as Plaintext Locally?

"Wait — aren't we supposed to be encrypted? Why store plaintext?"

The encryption protects messages **in transit** (over the network) and **at rest
in Supabase** (on someone else's server). Your local database is on YOUR
machine — you can already read your own messages. Encrypting them locally would
mean you'd need to decrypt them every time you view your chat history, which
adds complexity for no real security benefit.

That said, if you're worried about someone stealing your laptop and reading your
database file, you can use **SQLCipher** (an encrypted SQLite variant) in a
future phase.

### 8.3 SQLite in C++ (Quick Guide)

```cpp
#include <sqlite3.h>

// Open (or create) a database
sqlite3* db;
int rc = sqlite3_open("local_chat.db", &db);
if (rc != SQLITE_OK) {
    // Handle error: sqlite3_errmsg(db)
}

// Create a table
const char* sql = "CREATE TABLE IF NOT EXISTS messages ("
                  "msg_id TEXT PRIMARY KEY, "
                  "peer TEXT NOT NULL, "
                  "plaintext TEXT NOT NULL)";
char* err_msg;
rc = sqlite3_exec(db, sql, nullptr, nullptr, &err_msg);

// Insert with parameterized query (SAFE from SQL injection!)
sqlite3_stmt* stmt;
sqlite3_prepare_v2(db,
    "INSERT INTO messages (msg_id, peer, plaintext) VALUES (?, ?, ?)",
    -1, &stmt, nullptr);
sqlite3_bind_text(stmt, 1, msg_id.c_str(), -1, SQLITE_TRANSIENT);
sqlite3_bind_text(stmt, 2, peer.c_str(), -1, SQLITE_TRANSIENT);
sqlite3_bind_text(stmt, 3, text.c_str(), -1, SQLITE_TRANSIENT);
sqlite3_step(stmt);
sqlite3_finalize(stmt);

// Query
sqlite3_prepare_v2(db,
    "SELECT msg_id, peer, plaintext FROM messages WHERE peer = ?",
    -1, &stmt, nullptr);
sqlite3_bind_text(stmt, 1, "bob", -1, SQLITE_TRANSIENT);
while (sqlite3_step(stmt) == SQLITE_ROW) {
    const char* id   = (const char*)sqlite3_column_text(stmt, 0);
    const char* peer = (const char*)sqlite3_column_text(stmt, 1);
    const char* text = (const char*)sqlite3_column_text(stmt, 2);
    // Process each row...
}
sqlite3_finalize(stmt);

// Always close when done
sqlite3_close(db);
```

**IMPORTANT:** Always use **parameterized queries** (`?` placeholders), never
string concatenation. This prevents SQL injection attacks.

### 8.4 SQLite in Python (Quick Guide)

```python
import sqlite3

# Open (or create) a database
conn = sqlite3.connect("local_chat.db")
cursor = conn.cursor()

# Create a table
cursor.execute("""
    CREATE TABLE IF NOT EXISTS messages (
        msg_id TEXT PRIMARY KEY,
        peer TEXT NOT NULL,
        plaintext TEXT NOT NULL
    )
""")

# Insert with parameterized query (SAFE!)
cursor.execute(
    "INSERT INTO messages (msg_id, peer, plaintext) VALUES (?, ?, ?)",
    ("uuid-here", "bob", "Hello!")
)
conn.commit()

# Query
cursor.execute(
    "SELECT msg_id, peer, plaintext FROM messages WHERE peer = ?",
    ("bob",)
)
for row in cursor.fetchall():
    msg_id, peer, text = row
    print(f"{peer}: {text}")

conn.close()
```

---

## 9. Supabase Schema (Detailed)

### 9.1 `users` Table

```sql
CREATE TABLE users (
    username    TEXT PRIMARY KEY,
    node_id     TEXT UNIQUE NOT NULL,
    public_key  TEXT NOT NULL,
    last_ip     TEXT,
    last_seen   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**Detailed field explanations:**

| Field | Type | Constraints | What Goes Here | Example |
|---|---|---|---|---|
| `username` | TEXT | PRIMARY KEY (unique, not null) | User-chosen name. Like a Discord username. | `"alice"` |
| `node_id` | TEXT | UNIQUE, NOT NULL | Random hex string identifying this node instance. Generated on first run. | `"a1b2c3d4e5f6..."` |
| `public_key` | TEXT | NOT NULL | Base64-encoded X25519 public key (32 bytes → ~44 chars base64). | `"Ym9iX3B1YmxpY19rZXk="` |
| `last_ip` | TEXT | (nullable) | The node's public or LAN IP address. Updated on heartbeat. | `"192.168.1.42"` |
| `last_seen` | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | Auto-set on insert. Updated by heartbeat every 60s. | `"2026-02-11T16:00:00+00:00"` |

### 9.2 `messages` Table

```sql
CREATE TABLE messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    to_user     TEXT NOT NULL,
    from_user   TEXT NOT NULL,
    ciphertext  TEXT NOT NULL,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

| Field | Type | Constraints | What Goes Here | Example |
|---|---|---|---|---|
| `id` | UUID | PRIMARY KEY, auto-generated | Random UUID for this row. | `"550e8400-e29b-..."` |
| `to_user` | TEXT | NOT NULL | Recipient username. | `"bob"` |
| `from_user` | TEXT | NOT NULL | Sender username. | `"alice"` |
| `ciphertext` | TEXT | NOT NULL | Base64 of the entire encrypted envelope JSON. | `"eyJ0eXBlIjoi..."` |
| `created_at` | TIMESTAMP | DEFAULT NOW() | When stored. Used for 7-day cleanup. | `"2026-02-11T16:00:00+00:00"` |

---

## 10. Network Protocol

Messages between peers use **length-prefixed JSON over TCP**.

Full specification: [protocol/message_format.md](protocol/message_format.md)

Summary:
- **Frame format:** 4-byte big-endian length + JSON payload.
- **Message types:** `message`, `ack`, `ping`, `key_exchange`.
- **Encryption:** XSalsa20-Poly1305 via `crypto_box_easy`.
- **Signing:** Ed25519 via `crypto_sign_detached`.

---

## 11. Backend ↔ UI API

The Python UI communicates with the C++ backend over localhost HTTP.

Full specification: [protocol/api_contract.md](protocol/api_contract.md)

Summary:

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/status` | Health check |
| GET | `/friends` | List friends |
| POST | `/friends` | Add friend by username |
| DELETE | `/friends/:username` | Remove friend |
| GET | `/messages?peer=<user>` | Chat history |
| POST | `/messages` | Send a message |
| DELETE | `/messages/:msg_id` | Delete from history |

---

## 12. Error Handling Strategy

### Backend (C++)

| Error Type | How to Handle | Example |
|---|---|---|
| Config file missing | Log error and exit. | "Cannot open config.json" |
| Supabase unreachable | Log warning, continue without discovery. | Heartbeat fails — retry in 60s. |
| Peer unreachable | Fall back to offline messaging. | TCP connect timeout → push to Supabase. |
| Decryption failure | Reject message, log warning. | Tampered or wrong keys. |
| Signature invalid | Reject message, log warning. | Possible impersonation attempt. |
| SQLite error | Log error. Try to continue. | Disk full, permission denied. |
| Malformed JSON from peer | Reject, close connection. | Parser throws exception. |
| Malformed JSON from UI | Return 400 Bad Request. | Missing "to" field. |

### UI (Python)

| Error Type | How to Handle | Show to User |
|---|---|---|
| Backend not running | Show "Cannot connect to backend" banner. | Red status bar. |
| Backend returns 400 | Show the error message. | "Missing required field." |
| Backend returns 404 | Show not-found message. | "User not found." |
| Backend returns 500 | Show generic error. | "Something went wrong." |
| Network timeout | Retry once, then show error. | "Backend not responding." |

---

## 13. Configuration

The backend reads `config.json` on startup. Here's every field:

```json
{
    "node": {
        "username": "alice",
        "listen_port": 9100,
        "api_port": 8080
    },
    "supabase": {
        "url": "https://abcdefg.supabase.co",
        "anon_key": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    },
    "database": {
        "local_db_path": "local_chat.db"
    },
    "logging": {
        "level": "info",
        "file": "node.log"
    }
}
```

| Path | Type | Default | Description |
|---|---|---|---|
| `node.username` | string | (required) | Your chosen username. Must be unique in Supabase. |
| `node.listen_port` | number | 9100 | TCP port for incoming peer connections. |
| `node.api_port` | number | 8080 | HTTP port for the Python UI on localhost. |
| `supabase.url` | string | (required) | Your Supabase project URL. |
| `supabase.anon_key` | string | (required) | Your Supabase anon/public API key. |
| `database.local_db_path` | string | "local_chat.db" | Path to the local SQLite database file. |
| `logging.level` | string | "info" | Logging verbosity: trace, debug, info, warn, error, critical. |
| `logging.file` | string | "node.log" | Log file path. |

---

## 14. Deployment & Running

This is a **desktop application** — there is no cloud deployment. Each user:

1. Builds the C++ backend from source (or uses a pre-built binary).
2. Installs Python + PySide6.
3. Creates a free Supabase project and configures the connection.
4. Runs the backend and UI on their machine.

### Running on the Same Network (LAN)

If both users are on the same Wi-Fi or LAN:
- Use your local IP (e.g., `192.168.1.42`). Find it with `ipconfig` (Windows)
  or `ifconfig` / `ip addr` (Linux/macOS).
- No port forwarding needed.

### Running on Different Networks

If users are on different Wi-Fi networks (e.g., different houses):
- Each user must **port forward** their `listen_port` on their router.
- Or use a VPN like **Tailscale** (free, creates a virtual LAN).
- NAT traversal (STUN/TURN) is out of scope for this project.

---

## 15. Glossary

| Term | Definition |
|---|---|
| **Async I/O** | A programming model where I/O operations don't block the thread. Instead, you register a callback that runs when the operation completes. ASIO uses this model. |
| **Callback** | A function you pass to another function, to be called later when something happens. |
| **Ciphertext** | The encrypted version of a message. Looks like random bytes. |
| **E2EE** | End-to-End Encryption. Only sender and recipient can read messages. |
| **Ed25519** | A digital signature algorithm. Used to prove who sent a message. |
| **Event loop** | A loop that waits for events (connections, data, timers) and dispatches handlers. ASIO's `io_context.run()` is an event loop. |
| **FetchContent** | A CMake feature that downloads dependencies during the build process. We use it for nlohmann/json, spdlog, and ASIO. |
| **Heartbeat** | A periodic signal sent to show a system is alive. Our backend sends one to Supabase every 60 seconds. |
| **io_context** | ASIO's central class that drives all async operations. All handlers run inside `io_context.run()`. |
| **JSON** | JavaScript Object Notation. A text format for structured data. |
| **Length-prefixed framing** | A technique where each message starts with its byte length, so the receiver knows when one message ends and the next begins. |
| **Localhost (127.0.0.1)** | A special IP address meaning "this computer." Traffic to 127.0.0.1 never reaches the network — it stays on your machine. |
| **Nonce** | Number Used Once. A random value ensuring each encryption is unique. |
| **P2P** | Peer-to-Peer. A network where each node is both a client and server. |
| **Plaintext** | The original, unencrypted message content. |
| **PostgREST** | A tool that generates a REST API from PostgreSQL tables. Supabase uses it. |
| **REST API** | A style of web API using HTTP methods (GET, POST, PUT, DELETE) on resources. |
| **TOFU** | Trust On First Use. Trust a key the first time you see it; warn on changes. |
| **UPSERT** | INSERT if new, UPDATE if exists. A database operation combining both. |
| **UUID** | Universally Unique Identifier. A 128-bit random ID. Practically zero collision chance. |
| **X25519** | An elliptic-curve Diffie-Hellman algorithm for key agreement. Used to derive a shared secret from two key pairs. |
| **XSalsa20-Poly1305** | The encryption algorithm used by libsodium's `crypto_box`. XSalsa20 is the cipher; Poly1305 is the authentication tag. |
