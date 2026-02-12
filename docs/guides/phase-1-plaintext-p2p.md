# Phase 1 — Plaintext P2P Chat (C++ Backend)

> **Goal**: Two backend nodes can send and receive plaintext messages over TCP,
> and the local REST API is working so the frontend can interact with the backend.
> No encryption yet — just get data flowing.

---

## Table of Contents

1. [What We're Building in This Phase](#1-what-were-building)
2. [Understanding ASIO (Networking Library)](#2-understanding-asio)
3. [Step 1: The ASIO Event Loop](#3-step-1-the-asio-event-loop)
4. [Step 2: TCP Peer Server (Accept Connections)](#4-step-2-tcp-peer-server)
5. [Step 3: TCP Peer Client (Connect & Send)](#5-step-3-tcp-peer-client)
6. [Step 4: Wire Protocol (Length-Prefixed JSON)](#6-step-4-wire-protocol)
7. [Step 5: Local HTTP API Server](#7-step-5-local-http-api-server)
8. [Step 6: SQLite Local Storage](#8-step-6-sqlite-local-storage)
9. [Step 7: Wiring It All Together in main.cpp](#9-step-7-wiring-it-all-together)
10. [Step 8: Testing Two Nodes](#10-step-8-testing-two-nodes)
11. [Learning Resources](#11-learning-resources)
12. [Common Pitfalls](#12-common-pitfalls)

---

## 1. What We're Building

```
  Node A (Alice)                         Node B (Bob)
  ┌──────────────┐                      ┌──────────────┐
  │ Frontend     │                      │ Frontend     │
  │ (localhost)  │                      │ (localhost)  │
  └──────┬───────┘                      └──────┬───────┘
         │ HTTP :8080                          │ HTTP :8081
  ┌──────▼───────┐      TCP :9101      ┌──────▼───────┐
  │ C++ Backend  │◄────────────────────►│ C++ Backend  │
  │ :8080 API    │      TCP :9100      │ :8081 API    │
  │ :9100 P2P    │                      │ :9101 P2P    │
  └──────────────┘                      └──────────────┘
```

By the end of this phase:
- ✅ Backend listens on a TCP port for peer connections
- ✅ Backend can connect to another peer and send a JSON message
- ✅ Backend exposes a REST API on localhost for the frontend
- ✅ Messages are stored in local SQLite
- ✅ Two nodes on the same machine can chat (in plaintext)

---

## 2. Understanding ASIO

ASIO (Asynchronous I/O) is a C++ library for network programming. We use the **standalone** version (no Boost dependency).

### Key Concepts

```
┌─────────────────────────────────────────────────────┐
│                 io_context                           │
│  (The "event loop" — runs everything)               │
│                                                     │
│  ┌─────────┐  ┌─────────┐  ┌──────────────────┐   │
│  │ Timer 1 │  │ Timer 2 │  │ TCP Acceptor     │   │
│  └─────────┘  └─────────┘  │ (listens :9100)  │   │
│                             └────────┬─────────┘   │
│                                      │              │
│                             ┌────────▼─────────┐   │
│                             │ TCP Socket       │   │
│                             │ (one per peer)   │   │
│                             └──────────────────┘   │
└─────────────────────────────────────────────────────┘
```

| Concept | What It Is | Analogy |
|---------|-----------|---------|
| `io_context` | The event loop that runs everything | A manager assigning tasks to workers |
| `tcp::acceptor` | Listens on a port for incoming connections | A receptionist answering phone calls |
| `tcp::socket` | A single connection between two computers | A phone line between two people |
| `async_accept` | "Call me back when someone connects" | "Ring me when someone calls" |
| `async_read` | "Call me back when data arrives" | "Tell me when they say something" |
| `async_write` | "Call me back when data is sent" | "Let me know when my message is delivered" |

### Synchronous vs Asynchronous

```cpp
// SYNCHRONOUS (blocking) — Don't use this!
// The whole program freezes while waiting
socket.read_some(buffer);  // ← Blocks here until data arrives

// ASYNCHRONOUS (non-blocking) — Use this!
// Program continues running, calls your function when data arrives
asio::async_read(socket, buffer, [](error_code ec, size_t bytes) {
    // This runs LATER, when data actually arrives
    std::cout << "Got " << bytes << " bytes!\n";
});
```

**Why async?** Because our backend does many things at once: listens for peers, handles HTTP API requests, sends heartbeats. Synchronous code can only do one thing at a time.

> 📺 **Must Watch**: [ASIO C++ Network Programming — Jacob Sorber](https://www.youtube.com/watch?v=2hNdkYInj4g)
> 📺 **Deep Dive**: [Networking in C++ with Asio — javidx9 (4-part series)](https://www.youtube.com/watch?v=2hNdkYInj4g)
> 📖 **Official**: [think-async.com/Asio/](https://think-async.com/Asio/)

---

## 3. Step 1: The ASIO Event Loop

Every ASIO program starts with an `io_context`. This is the engine that drives everything.

### Code: `main.cpp` — Starting the Event Loop

```cpp
#include <asio.hpp>
#include <spdlog/spdlog.h>
#include <nlohmann/json.hpp>
#include <fstream>

#include "node/node.h"
#include "network/peer_server.h"
#include "api/local_api.h"

using json = nlohmann::json;

int main(int argc, char* argv[]) {
    spdlog::set_level(spdlog::level::info);

    // ── Load config ──
    std::string config_path = (argc > 1) ? argv[1] : "config.json";
    std::ifstream file(config_path);
    if (!file.is_open()) {
        spdlog::error("Cannot open config: {}", config_path);
        return 1;
    }
    json config = json::parse(file);

    std::string username = config["node"]["username"];
    uint16_t listen_port = config["node"]["listen_port"];
    uint16_t api_port    = config["node"]["api_port"];

    spdlog::info("Starting node '{}' — P2P:{} API:{}", username, listen_port, api_port);

    // ── Create the event loop ──
    // Everything runs inside this single io_context
    asio::io_context io;

    // ── Start services ──
    PeerServer peer_server(io, listen_port);
    peer_server.start();
    spdlog::info("Peer server listening on :{}", listen_port);

    LocalAPI api(io, api_port);
    api.start();
    spdlog::info("REST API listening on :{}", api_port);

    // ── Run the event loop (blocks forever) ──
    // This is where all the async magic happens.
    // io.run() processes events until you call io.stop() or Ctrl+C.
    spdlog::info("Node ready. Press Ctrl+C to exit.");
    io.run();

    return 0;
}
```

**Why `io.run()`?** It's the "main loop" of your program. All async operations (accepting connections, reading data, timers) are processed here. Without it, nothing happens.

---

## 4. Step 2: TCP Peer Server

The peer server listens for incoming TCP connections from other peers.

### Code: `include/network/peer_server.h`

```cpp
#pragma once
#include <asio.hpp>
#include <functional>
#include <memory>
#include <string>
#include <set>

// Forward declaration
class PeerSession;

class PeerServer {
public:
    using MessageCallback = std::function<void(const std::string& from,
                                                const std::string& payload)>;

    PeerServer(asio::io_context& io, uint16_t port);

    void start();
    void stop();
    void set_on_message(MessageCallback cb);
    void broadcast(const std::string& json_payload);

    // Track connected peers
    bool is_connected(const std::string& username) const;

private:
    void do_accept();

    asio::ip::tcp::acceptor acceptor_;
    MessageCallback on_message_;
    std::set<std::shared_ptr<PeerSession>> sessions_;
};
```

### Code: `src/network/peer_server.cpp`

```cpp
#include "network/peer_server.h"
#include <spdlog/spdlog.h>
#include <nlohmann/json.hpp>

using asio::ip::tcp;
using json = nlohmann::json;

// ═══════════════════════════════════════════════════════
// PeerSession — handles one connected peer
// ═══════════════════════════════════════════════════════

class PeerSession : public std::enable_shared_from_this<PeerSession> {
public:
    PeerSession(tcp::socket socket, PeerServer::MessageCallback& on_message)
        : socket_(std::move(socket)), on_message_(on_message) {}

    void start() {
        read_header();
    }

    tcp::socket& socket() { return socket_; }

private:
    // ── Wire Protocol ──
    // Each message is: [4 bytes length (big-endian)] [JSON payload]
    //
    // Why length-prefix? TCP is a STREAM protocol — data arrives in
    // arbitrary chunks. We need to know where one message ends and
    // the next begins. The 4-byte header tells us exactly how many
    // bytes to read.

    void read_header() {
        auto self = shared_from_this();
        auto header_buf = std::make_shared<std::array<uint8_t, 4>>();

        asio::async_read(socket_, asio::buffer(*header_buf),
            [this, self, header_buf](asio::error_code ec, size_t) {
                if (ec) {
                    spdlog::warn("Peer disconnected: {}", ec.message());
                    return;
                }
                // Decode big-endian 4-byte length
                uint32_t length =
                    (uint32_t((*header_buf)[0]) << 24) |
                    (uint32_t((*header_buf)[1]) << 16) |
                    (uint32_t((*header_buf)[2]) << 8)  |
                    (uint32_t((*header_buf)[3]));

                if (length > 1024 * 1024) {  // Max 1MB per message
                    spdlog::error("Message too large: {} bytes", length);
                    return;
                }
                read_body(length);
            });
    }

    void read_body(uint32_t length) {
        auto self = shared_from_this();
        auto body_buf = std::make_shared<std::vector<char>>(length);

        asio::async_read(socket_, asio::buffer(*body_buf),
            [this, self, body_buf](asio::error_code ec, size_t) {
                if (ec) {
                    spdlog::warn("Read body failed: {}", ec.message());
                    return;
                }
                std::string payload(body_buf->begin(), body_buf->end());

                try {
                    json msg = json::parse(payload);
                    std::string from = msg.value("from", "unknown");
                    spdlog::info("Message from '{}': {}", from,
                                 msg.value("text", ""));

                    if (on_message_) {
                        on_message_(from, payload);
                    }
                } catch (const json::parse_error& e) {
                    spdlog::error("Invalid JSON from peer: {}", e.what());
                }

                // Read next message (loop)
                read_header();
            });
    }

    tcp::socket socket_;
    PeerServer::MessageCallback& on_message_;
};

// ═══════════════════════════════════════════════════════
// PeerServer
// ═══════════════════════════════════════════════════════

PeerServer::PeerServer(asio::io_context& io, uint16_t port)
    : acceptor_(io, tcp::endpoint(tcp::v4(), port)) {}

void PeerServer::start() {
    do_accept();
}

void PeerServer::stop() {
    acceptor_.close();
}

void PeerServer::set_on_message(MessageCallback cb) {
    on_message_ = std::move(cb);
}

void PeerServer::do_accept() {
    acceptor_.async_accept(
        [this](asio::error_code ec, tcp::socket socket) {
            if (!ec) {
                auto endpoint = socket.remote_endpoint();
                spdlog::info("Peer connected from {}:{}",
                             endpoint.address().to_string(),
                             endpoint.port());

                auto session = std::make_shared<PeerSession>(
                    std::move(socket), on_message_);
                sessions_.insert(session);
                session->start();
            }
            do_accept();  // Accept next connection
        });
}

bool PeerServer::is_connected(const std::string& /*username*/) const {
    // TODO: Track sessions by username after handshake
    return false;
}
```

### Key Concepts Explained

**`shared_from_this()`** — The session stores a shared pointer to itself. This keeps it alive as long as async operations are pending. Without it, the session would be destroyed before the read completes.

**`async_read` vs `async_read_some`** — `async_read` reads EXACTLY the number of bytes you request. `async_read_some` reads whatever is available (might be partial). We want exact reads because our protocol says "read 4 bytes of header, then N bytes of body".

**Why the accept loop calls `do_accept()` again at the end?** — ASIO accept is one-shot. After accepting one connection, you must ask it to accept the next one.

---

## 5. Step 3: TCP Peer Client

The peer client connects to another node and sends messages.

### Code: `src/network/peer_client.cpp`

```cpp
#include "network/peer_client.h"
#include <spdlog/spdlog.h>
#include <array>

using asio::ip::tcp;

PeerClient::PeerClient(asio::io_context& io)
    : socket_(io) {}

bool PeerClient::connect(const std::string& ip, uint16_t port) {
    try {
        tcp::endpoint endpoint(
            asio::ip::make_address(ip), port);

        socket_.connect(endpoint);
        spdlog::info("Connected to peer at {}:{}", ip, port);
        return true;

    } catch (const asio::system_error& e) {
        spdlog::error("Failed to connect to {}:{} — {}",
                      ip, port, e.what());
        return false;
    }
}

bool PeerClient::send(const std::string& json_payload) {
    try {
        // Create length-prefixed message
        uint32_t length = static_cast<uint32_t>(json_payload.size());
        std::array<uint8_t, 4> header = {
            static_cast<uint8_t>((length >> 24) & 0xFF),
            static_cast<uint8_t>((length >> 16) & 0xFF),
            static_cast<uint8_t>((length >> 8)  & 0xFF),
            static_cast<uint8_t>((length)       & 0xFF)
        };

        // Send header + body
        asio::write(socket_, asio::buffer(header));
        asio::write(socket_, asio::buffer(json_payload));

        spdlog::debug("Sent {} bytes to peer", length);
        return true;

    } catch (const asio::system_error& e) {
        spdlog::error("Send failed: {}", e.what());
        return false;
    }
}

void PeerClient::disconnect() {
    if (socket_.is_open()) {
        asio::error_code ec;
        socket_.shutdown(tcp::socket::shutdown_both, ec);
        socket_.close(ec);
    }
}
```

### Building a Message Payload

```cpp
// To send a chat message to a peer:
nlohmann::json msg;
msg["type"] = "chat";
msg["from"] = "alice";
msg["to"] = "bob";
msg["text"] = "Hey, how are you?";
msg["timestamp"] = "2025-06-15T10:30:00Z";
msg["msg_id"] = generate_uuid();

PeerClient client(io);
if (client.connect("192.168.1.50", 9100)) {
    client.send(msg.dump());
    client.disconnect();
}
```

---

## 6. Step 4: Wire Protocol

Our protocol is simple: **4-byte length header + JSON body**.

```
┌──────────────────────────────────────────┐
│ Byte 0 │ Byte 1 │ Byte 2 │ Byte 3 │ ... │
├─────────────────────────────────────┤─────┤
│      Message Length (Big-Endian)    │JSON │
│      e.g., 00 00 00 2A = 42 bytes  │Body │
└──────────────────────────────────────────┘
```

**Why big-endian?** Network byte order is traditionally big-endian. It doesn't matter as long as sender and receiver agree — and big-endian is the convention.

**Why not just use newlines to separate messages?** Because JSON can contain newlines in strings. Length-prefixing is unambiguous.

### Message JSON Format

```json
{
    "type": "chat",
    "msg_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "from": "alice",
    "to": "bob",
    "text": "Hello, world!",
    "timestamp": "2025-06-15T10:30:00Z"
}
```

---

## 7. Step 5: Local HTTP API Server

The frontend talks to the backend via HTTP. We need to build a minimal HTTP/1.1 server.

### Code: `src/api/local_api.cpp`

```cpp
#include "api/local_api.h"
#include <spdlog/spdlog.h>
#include <nlohmann/json.hpp>
#include <sstream>
#include <string>

using asio::ip::tcp;
using json = nlohmann::json;

LocalAPI::LocalAPI(asio::io_context& io, uint16_t port)
    : acceptor_(io, tcp::endpoint(asio::ip::make_address("127.0.0.1"), port))
{
    // Only bind to localhost — never expose to the network!
}

void LocalAPI::start() {
    do_accept();
}

void LocalAPI::stop() {
    acceptor_.close();
}

void LocalAPI::set_on_send(SendCallback cb) { on_send_ = std::move(cb); }
void LocalAPI::set_on_add_friend(FriendCallback cb) { on_add_friend_ = std::move(cb); }

void LocalAPI::do_accept() {
    acceptor_.async_accept(
        [this](asio::error_code ec, tcp::socket socket) {
            if (!ec) {
                handle_request(std::move(socket));
            }
            do_accept();
        });
}

// ── HTTP Helpers ──────────────────────────────────────────────

static std::string make_response(int status, const std::string& body) {
    std::string status_text;
    switch (status) {
        case 200: status_text = "OK"; break;
        case 201: status_text = "Created"; break;
        case 202: status_text = "Accepted"; break;
        case 204: status_text = "No Content"; break;
        case 400: status_text = "Bad Request"; break;
        case 404: status_text = "Not Found"; break;
        case 409: status_text = "Conflict"; break;
        case 500: status_text = "Internal Server Error"; break;
        default:  status_text = "Unknown"; break;
    }

    std::ostringstream oss;
    oss << "HTTP/1.1 " << status << " " << status_text << "\r\n"
        << "Content-Type: application/json\r\n"
        << "Content-Length: " << body.size() << "\r\n"
        << "Access-Control-Allow-Origin: *\r\n"
        << "Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS\r\n"
        << "Access-Control-Allow-Headers: Content-Type\r\n"
        << "Connection: close\r\n"
        << "\r\n"
        << body;
    return oss.str();
}

struct HttpRequest {
    std::string method;     // GET, POST, DELETE, OPTIONS
    std::string path;       // /status, /friends, /messages?peer=bob
    std::string body;       // JSON body for POST
    std::string query;      // peer=bob&limit=50
};

static HttpRequest parse_request(const std::string& raw) {
    HttpRequest req;
    std::istringstream stream(raw);
    std::string line;

    // First line: "GET /path HTTP/1.1"
    if (std::getline(stream, line)) {
        std::istringstream first_line(line);
        std::string http_version;
        first_line >> req.method >> req.path >> http_version;
    }

    // Extract query string: /messages?peer=bob → path=/messages, query=peer=bob
    auto qpos = req.path.find('?');
    if (qpos != std::string::npos) {
        req.query = req.path.substr(qpos + 1);
        req.path = req.path.substr(0, qpos);
    }

    // Find body (after blank line)
    auto body_pos = raw.find("\r\n\r\n");
    if (body_pos != std::string::npos) {
        req.body = raw.substr(body_pos + 4);
    }

    return req;
}

static std::string get_query_param(const std::string& query,
                                    const std::string& key) {
    // Simple query string parser: "peer=bob&limit=50"
    std::istringstream stream(query);
    std::string pair;
    while (std::getline(stream, pair, '&')) {
        auto eq = pair.find('=');
        if (eq != std::string::npos && pair.substr(0, eq) == key) {
            return pair.substr(eq + 1);
        }
    }
    return "";
}

// ── Request Handler ──────────────────────────────────────────

void LocalAPI::handle_request(tcp::socket socket) {
    auto buf = std::make_shared<asio::streambuf>();

    asio::async_read_until(socket, *buf, "\r\n\r\n",
        [this, sock = std::make_shared<tcp::socket>(std::move(socket)), buf]
        (asio::error_code ec, size_t) mutable {
            if (ec) return;

            std::string raw{
                asio::buffers_begin(buf->data()),
                asio::buffers_end(buf->data())
            };
            auto req = parse_request(raw);

            std::string response;

            // ── CORS preflight ──
            if (req.method == "OPTIONS") {
                response = make_response(204, "");
            }
            // ── GET /status ──
            else if (req.method == "GET" && req.path == "/status") {
                json body;
                body["status"] = "online";
                body["username"] = "alice";  // TODO: from Node
                body["node_id"] = "abc123";  // TODO: from Node
                body["uptime_seconds"] = 0;
                body["friends_count"] = 0;
                body["peer_port"] = 9100;
                body["supabase_connected"] = false;
                body["version"] = "0.1.0";
                response = make_response(200, body.dump());
            }
            // ── GET /friends ──
            else if (req.method == "GET" && req.path == "/friends") {
                // TODO: Query SQLite for friends list
                json friends = json::array();
                response = make_response(200, friends.dump());
            }
            // ── POST /friends ──
            else if (req.method == "POST" && req.path == "/friends") {
                try {
                    json body = json::parse(req.body);
                    std::string username = body["username"];
                    // TODO: Supabase lookup + store in SQLite
                    spdlog::info("Add friend request: {}", username);

                    json result;
                    result["username"] = username;
                    result["online"] = false;
                    result["last_seen"] = "";
                    response = make_response(201, result.dump());
                } catch (...) {
                    response = make_response(400,
                        R"({"error":"Invalid JSON body"})");
                }
            }
            // ── POST /messages ──
            else if (req.method == "POST" && req.path == "/messages") {
                try {
                    json body = json::parse(req.body);
                    std::string to = body["to"];
                    std::string text = body["text"];

                    spdlog::info("Send message to '{}': {}", to, text);

                    // TODO: encrypt, send via peer_client or Supabase
                    bool delivered = false;
                    if (on_send_) {
                        delivered = on_send_(to, text);
                    }

                    json result;
                    result["msg_id"] = "temp-uuid";  // TODO: real UUID
                    result["delivered"] = delivered;
                    result["delivery_method"] = delivered ? "direct" : "offline";
                    response = make_response(delivered ? 200 : 202,
                                             result.dump());
                } catch (...) {
                    response = make_response(400,
                        R"({"error":"Missing 'to' or 'text'"})");
                }
            }
            // ── GET /messages?peer=bob ──
            else if (req.method == "GET" && req.path == "/messages") {
                std::string peer = get_query_param(req.query, "peer");
                int limit = 50, offset = 0;
                auto limit_str = get_query_param(req.query, "limit");
                auto offset_str = get_query_param(req.query, "offset");
                if (!limit_str.empty()) limit = std::stoi(limit_str);
                if (!offset_str.empty()) offset = std::stoi(offset_str);

                // TODO: Query SQLite
                json result;
                result["messages"] = json::array();
                result["total"] = 0;
                result["has_more"] = false;
                response = make_response(200, result.dump());
            }
            // ── 404 ──
            else {
                response = make_response(404,
                    R"({"error":"Not found"})");
            }

            // Send response
            auto resp_buf = std::make_shared<std::string>(std::move(response));
            asio::async_write(*sock, asio::buffer(*resp_buf),
                [sock, resp_buf](asio::error_code, size_t) {
                    sock->shutdown(tcp::socket::shutdown_both,
                                   *const_cast<asio::error_code*>(
                                       &asio::error_code()));
                });
        });
}
```

### Why CORS Headers?

Even though the frontend and backend are both on `localhost`, they run on **different ports** (Tauri dev server on :1420, backend on :8080). Browsers treat different ports as different "origins" and block cross-origin requests unless the server explicitly allows them.

The `Access-Control-Allow-Origin: *` header says "any origin can call this API". This is safe because we only bind to `127.0.0.1` — nobody on the network can reach it.

---

## 8. Step 6: SQLite Local Storage

SQLite stores friends and message history locally.

### Setting Up the Database

```cpp
// database.h
#pragma once
#include <sqlite3.h>
#include <string>
#include <vector>
#include <nlohmann/json.hpp>

class Database {
public:
    explicit Database(const std::string& db_path);
    ~Database();

    void initialize();  // Create tables if not exist

    // Friends
    void add_friend(const std::string& username, const std::string& public_key,
                    const std::string& signing_key, const std::string& last_ip);
    void remove_friend(const std::string& username);
    std::vector<nlohmann::json> get_friends();

    // Messages
    void store_message(const std::string& msg_id, const std::string& from,
                       const std::string& to, const std::string& text,
                       const std::string& timestamp, bool delivered,
                       const std::string& delivery_method);
    std::vector<nlohmann::json> get_messages(const std::string& peer,
                                              int limit, int offset);
    int count_messages(const std::string& peer);

private:
    sqlite3* db_ = nullptr;
    void exec(const std::string& sql);
};
```

### Implementation

```cpp
// database.cpp
#include "database.h"
#include <spdlog/spdlog.h>
#include <stdexcept>

Database::Database(const std::string& db_path) {
    int rc = sqlite3_open(db_path.c_str(), &db_);
    if (rc != SQLITE_OK) {
        throw std::runtime_error("Failed to open database: " +
                                 std::string(sqlite3_errmsg(db_)));
    }
    spdlog::info("Database opened: {}", db_path);
    initialize();
}

Database::~Database() {
    if (db_) sqlite3_close(db_);
}

void Database::exec(const std::string& sql) {
    char* err_msg = nullptr;
    int rc = sqlite3_exec(db_, sql.c_str(), nullptr, nullptr, &err_msg);
    if (rc != SQLITE_OK) {
        std::string error = err_msg ? err_msg : "Unknown error";
        sqlite3_free(err_msg);
        spdlog::error("SQL error: {}", error);
    }
}

void Database::initialize() {
    exec(R"(
        CREATE TABLE IF NOT EXISTS friends (
            username    TEXT PRIMARY KEY,
            public_key  TEXT NOT NULL,
            signing_key TEXT NOT NULL,
            last_ip     TEXT,
            last_seen   TEXT,
            added_at    TEXT DEFAULT (datetime('now'))
        );
    )");

    exec(R"(
        CREATE TABLE IF NOT EXISTS messages (
            msg_id          TEXT PRIMARY KEY,
            from_user       TEXT NOT NULL,
            to_user         TEXT NOT NULL,
            text            TEXT NOT NULL,
            timestamp       TEXT NOT NULL,
            delivered       INTEGER DEFAULT 0,
            delivery_method TEXT DEFAULT 'pending',
            created_at      TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_messages_peer
            ON messages(from_user, to_user);
    )");

    spdlog::info("Database tables initialized");
}

void Database::store_message(const std::string& msg_id,
                              const std::string& from,
                              const std::string& to,
                              const std::string& text,
                              const std::string& timestamp,
                              bool delivered,
                              const std::string& delivery_method) {
    const char* sql = R"(
        INSERT OR REPLACE INTO messages
            (msg_id, from_user, to_user, text, timestamp, delivered, delivery_method)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    )";

    sqlite3_stmt* stmt;
    sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, msg_id.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, from.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 3, to.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 4, text.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 5, timestamp.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(stmt, 6, delivered ? 1 : 0);
    sqlite3_bind_text(stmt, 7, delivery_method.c_str(), -1, SQLITE_TRANSIENT);

    sqlite3_step(stmt);
    sqlite3_finalize(stmt);
}

std::vector<nlohmann::json> Database::get_messages(
    const std::string& peer, int limit, int offset)
{
    // Get messages where either from_user or to_user is the peer
    // (and the other is "me" — our local user)
    const char* sql = R"(
        SELECT msg_id, from_user, to_user, text, timestamp,
               delivered, delivery_method
        FROM messages
        WHERE from_user = ? OR to_user = ?
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
    )";

    sqlite3_stmt* stmt;
    sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, peer.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, peer.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(stmt, 3, limit);
    sqlite3_bind_int(stmt, 4, offset);

    std::vector<nlohmann::json> messages;
    while (sqlite3_step(stmt) == SQLITE_ROW) {
        nlohmann::json msg;
        msg["msg_id"] = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 0));
        msg["from"] = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 1));
        msg["to"] = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 2));
        msg["text"] = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 3));
        msg["timestamp"] = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 4));
        msg["delivered"] = sqlite3_column_int(stmt, 5) == 1;
        msg["delivery_method"] = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 6));
        messages.push_back(msg);
    }
    sqlite3_finalize(stmt);
    return messages;
}
```

**💡 Tip**: Always use **prepared statements** (`sqlite3_prepare_v2`) instead of string concatenation. String concatenation is vulnerable to SQL injection.

> 📺 **Video**: [SQLite in C/C++ — Jacob Sorber](https://www.youtube.com/watch?v=GRFG_xQsma0)
> 📖 **Docs**: [sqlite.org/cintro.html](https://www.sqlite.org/cintro.html)

---

## 9. Step 7: Wiring It All Together

Update `main.cpp` to connect the peer server, API, and database:

```cpp
// In main(), after creating io_context:

// Create database
Database db(config["database"]["local_db_path"]);

// Create peer server
PeerServer peer_server(io, listen_port);
peer_server.set_on_message([&](const std::string& from, const std::string& payload) {
    auto msg = json::parse(payload);
    db.store_message(
        msg["msg_id"], msg["from"], msg["to"],
        msg["text"], msg["timestamp"], true, "direct"
    );
    // TODO: Push to WebSocket for frontend notification
});
peer_server.start();

// Create API
LocalAPI api(io, api_port);
api.set_on_send([&](const std::string& to, const std::string& text) -> bool {
    // TODO: Look up peer's IP, create PeerClient, send message
    spdlog::info("Sending message to {}: {}", to, text);
    return false;  // Not delivered yet (Phase 1)
});
api.start();

io.run();
```

---

## 10. Step 8: Testing Two Nodes

### Test 1: REST API with curl

```bash
# Start the backend
./secure-p2p-chat-backend config.json

# In another terminal:
curl http://127.0.0.1:8080/status
# Expected: {"status":"online","username":"alice",...}

curl http://127.0.0.1:8080/friends
# Expected: []

curl -X POST http://127.0.0.1:8080/messages \
  -H "Content-Type: application/json" \
  -d '{"to":"bob","text":"Hello!"}'
# Expected: {"msg_id":"...","delivered":false,"delivery_method":"offline"}
```

### Test 2: Two Nodes on Same Machine

```bash
# Terminal 1: Alice
./secure-p2p-chat-backend config-alice.json
# config-alice.json: username=alice, listen_port=9100, api_port=8080

# Terminal 2: Bob
./secure-p2p-chat-backend config-bob.json
# config-bob.json: username=bob, listen_port=9101, api_port=8081

# Terminal 3: Alice sends to Bob
curl -X POST http://127.0.0.1:8080/messages \
  -H "Content-Type: application/json" \
  -d '{"to":"bob","text":"Hey Bob!"}'

# Check Bob received it:
curl http://127.0.0.1:8081/messages?peer=alice
```

---

## 11. Learning Resources

### ASIO Networking

| Resource | Type | Link |
|----------|------|------|
| **javidx9 — Networking in C++** | 📺 YouTube (4 parts) | [youtube.com/watch?v=2hNdkYInj4g](https://www.youtube.com/watch?v=2hNdkYInj4g) |
| **Jacob Sorber — Socket Programming** | 📺 YouTube | [youtube.com/watch?v=Y6pFtgRdUts](https://www.youtube.com/watch?v=Y6pFtgRdUts) |
| **ASIO Official Tutorial** | 📖 Docs | [think-async.com/Asio/asio-1.28.0/doc/](https://think-async.com/Asio/asio-1.28.0/doc/) |
| **Boost.Asio Examples** | 📖 Code | [github.com/chriskohlhoff/asio/tree/master/asio/src/examples](https://github.com/chriskohlhoff/asio/tree/master/asio/src/examples) |
| **Beej's Guide to Network Programming** | 📖 Classic guide | [beej.us/guide/bgnet/](https://beej.us/guide/bgnet/) |

### HTTP Servers in C++

| Resource | Type | Link |
|----------|------|------|
| **Simple HTTP Server with ASIO** | 📺 YouTube | [youtube.com/watch?v=Blr8qs4wjng](https://www.youtube.com/watch?v=Blr8qs4wjng) |
| **cpp-httplib (alternative micro-framework)** | 📖 GitHub | [github.com/yhirose/cpp-httplib](https://github.com/yhirose/cpp-httplib) |

### SQLite in C++

| Resource | Type | Link |
|----------|------|------|
| **SQLite C/C++ Interface** | 📖 Official docs | [sqlite.org/cintro.html](https://www.sqlite.org/cintro.html) |
| **The Cherno — SQLite** | 📺 YouTube | [youtube.com/watch?v=GRFG_xQsma0](https://www.youtube.com/watch?v=GRFG_xQsma0) |

---

## 12. Common Pitfalls

### ❌ "Connection refused" when testing

**Cause**: The backend isn't running, or it's on a different port.
**Fix**: Check that `listen_port` in your config matches what you're connecting to.

### ❌ Message arrives but is cut off / garbled

**Cause**: TCP is a stream — you received only part of the message.
**Fix**: Make sure you're using length-prefixed protocol (read header first, then exact body size).

### ❌ "Address already in use"

**Cause**: Previous instance is still running.
**Fix**: Kill the old process, or set `SO_REUSEADDR`:
```cpp
acceptor_.set_option(asio::ip::tcp::acceptor::reuse_address(true));
```

### ❌ CORS error in browser console

**Cause**: Missing CORS headers in HTTP responses.
**Fix**: Add `Access-Control-Allow-Origin: *` to every response, and handle `OPTIONS` preflight.

### ❌ SQLite "database is locked"

**Cause**: Multiple threads writing simultaneously.
**Fix**: Use a single database connection with a mutex, or enable WAL mode:
```cpp
sqlite3_exec(db_, "PRAGMA journal_mode=WAL;", nullptr, nullptr, nullptr);
```

---

**← [Phase 0 — Environment Setup](./phase-0-environment-setup.md) | [Phase 2 — Supabase Discovery →](./phase-2-supabase-discovery.md)**
