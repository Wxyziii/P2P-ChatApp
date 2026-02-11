# ASIO Networking Guide

> Complete guide to building TCP servers and clients with standalone ASIO.
> Includes every code example you need for the PeerServer and PeerClient.

---

## Table of Contents

1. [What is ASIO?](#1-what-is-asio)
2. [Core Concepts](#2-core-concepts)
3. [TCP Server — Complete Example](#3-tcp-server--complete-example)
4. [TCP Client — Complete Example](#4-tcp-client--complete-example)
5. [Length-Prefixed Protocol Implementation](#5-length-prefixed-protocol-implementation)
6. [Async vs Sync I/O](#6-async-vs-sync-io)
7. [Error Handling](#7-error-handling)
8. [Timers](#8-timers)
9. [Applying to Our Project](#9-applying-to-our-project)
10. [Common Mistakes](#10-common-mistakes)

---

## 1. What is ASIO?

ASIO (Asynchronous I/O) is a C++ library for network programming. It provides:
- TCP/UDP sockets
- Timers
- An event loop (io_context)
- Async operations with callbacks

We use **standalone ASIO** (not Boost.Asio) — same API, no Boost dependency.

### Minimal includes:

```cpp
// These are the headers you'll use most often:
#include <asio.hpp>                    // Main header
#include <asio/ip/tcp.hpp>             // TCP-specific
#include <asio/steady_timer.hpp>       // Timers

// Shortcuts you'll see everywhere:
using asio::ip::tcp;
```

---

## 2. Core Concepts

### 2.1 io_context — The Event Loop

Everything in ASIO revolves around `io_context`. It's the engine that drives
all async operations.

```cpp
asio::io_context io;

// Register async operations (sockets, timers, etc.)
// ...

// Start the event loop. This BLOCKS until all work is done.
io.run();
```

**Think of it like this:** `io.run()` is like a dispatcher at a call center.
It sits in a loop, waiting for events (new connection, data arrived, timer
fired) and dispatching them to the handlers you registered.

### 2.2 Sockets

```cpp
// A TCP socket — represents one end of a TCP connection.
tcp::socket socket(io);

// An acceptor — listens for incoming connections.
tcp::acceptor acceptor(io, tcp::endpoint(tcp::v4(), 9100));

// An endpoint — an IP address + port number.
tcp::endpoint ep(asio::ip::make_address("192.168.1.42"), 9100);
```

### 2.3 Buffers

ASIO uses buffer abstractions to pass data around:

```cpp
// From a string:
std::string data = "Hello";
asio::buffer(data);                // read-only buffer

// From a vector:
std::vector<char> buf(1024);
asio::buffer(buf);                 // mutable buffer

// Fixed size:
char raw[256];
asio::buffer(raw, 256);
```

### 2.4 Callbacks (Handlers)

Async operations take a callback that's invoked when the operation completes:

```cpp
socket.async_read_some(
    asio::buffer(buf),
    [](asio::error_code ec, std::size_t bytes_read) {
        if (!ec) {
            std::cout << "Read " << bytes_read << " bytes\n";
        } else {
            std::cerr << "Error: " << ec.message() << "\n";
        }
    }
);
```

---

## 3. TCP Server — Complete Example

This is a complete, working TCP server that accepts connections, reads messages,
and echoes them back. **This is the foundation for PeerServer.**

```cpp
#include <asio.hpp>
#include <iostream>
#include <memory>
#include <string>

using asio::ip::tcp;

// ================================================================
// Session — handles a single connected client.
// Uses shared_ptr so the session stays alive while async ops run.
// ================================================================
class Session : public std::enable_shared_from_this<Session> {
public:
    explicit Session(tcp::socket socket)
        : socket_(std::move(socket)) {}

    void start() {
        do_read();
    }

private:
    void do_read() {
        // shared_from_this() captures a shared_ptr to keep us alive
        auto self = shared_from_this();

        socket_.async_read_some(
            asio::buffer(data_, max_length),
            [this, self](asio::error_code ec, std::size_t length) {
                if (!ec) {
                    std::string msg(data_, length);
                    std::cout << "Received: " << msg << "\n";

                    // Echo it back
                    do_write(msg);
                } else {
                    std::cout << "Client disconnected: "
                              << ec.message() << "\n";
                }
            }
        );
    }

    void do_write(const std::string& msg) {
        auto self = shared_from_this();

        asio::async_write(
            socket_,
            asio::buffer(msg),
            [this, self](asio::error_code ec, std::size_t /*length*/) {
                if (!ec) {
                    do_read();  // read next message
                }
            }
        );
    }

    tcp::socket socket_;
    static constexpr std::size_t max_length = 65536;
    char data_[max_length];
};

// ================================================================
// Server — accepts connections and creates sessions.
// ================================================================
class Server {
public:
    Server(asio::io_context& io, uint16_t port)
        : acceptor_(io, tcp::endpoint(tcp::v4(), port))
    {
        std::cout << "Server listening on port " << port << "\n";
        do_accept();
    }

private:
    void do_accept() {
        acceptor_.async_accept(
            [this](asio::error_code ec, tcp::socket socket) {
                if (!ec) {
                    std::cout << "New connection from "
                              << socket.remote_endpoint() << "\n";

                    // Create a Session and start it
                    std::make_shared<Session>(std::move(socket))->start();
                }

                // Accept the next connection
                do_accept();
            }
        );
    }

    tcp::acceptor acceptor_;
};

// ================================================================
// main
// ================================================================
int main() {
    try {
        asio::io_context io;
        Server server(io, 9100);
        io.run();  // blocks forever, handling events
    } catch (std::exception& e) {
        std::cerr << "Exception: " << e.what() << "\n";
    }
    return 0;
}
```

### Key patterns to understand:

1. **`enable_shared_from_this`** — lets Session create a `shared_ptr` to itself.
   This is critical because async callbacks need the Session to stay alive.

2. **`do_accept()` calls itself** — this creates an infinite accept loop.
   After accepting one connection, it immediately starts waiting for the next.

3. **`async_read_some` vs `async_read`** — `async_read_some` reads whatever
   data is available (might be partial). `async_read` reads EXACTLY the
   number of bytes you specify. For our protocol, we'll use `async_read`.

---

## 4. TCP Client — Complete Example

This is the foundation for **PeerClient**:

```cpp
#include <asio.hpp>
#include <iostream>
#include <string>

using asio::ip::tcp;

class Client {
public:
    Client(asio::io_context& io, const std::string& host, uint16_t port)
        : socket_(io), resolver_(io)
    {
        // Resolve hostname to IP address(es)
        auto endpoints = resolver_.resolve(host, std::to_string(port));

        // Connect (synchronous for simplicity — use async in production)
        asio::connect(socket_, endpoints);
        std::cout << "Connected to " << host << ":" << port << "\n";
    }

    // Send a message (synchronous)
    void send(const std::string& message) {
        asio::write(socket_, asio::buffer(message));
        std::cout << "Sent: " << message << "\n";
    }

    // Receive a response (synchronous)
    std::string receive() {
        char buf[65536];
        std::size_t len = socket_.read_some(asio::buffer(buf));
        return std::string(buf, len);
    }

    void close() {
        socket_.close();
    }

private:
    tcp::socket socket_;
    tcp::resolver resolver_;
};

int main() {
    try {
        asio::io_context io;
        Client client(io, "127.0.0.1", 9100);

        client.send("Hello, server!");
        std::string reply = client.receive();
        std::cout << "Server replied: " << reply << "\n";

        client.close();
    } catch (std::exception& e) {
        std::cerr << "Error: " << e.what() << "\n";
    }
    return 0;
}
```

### Async version (for production):

```cpp
void async_connect(const std::string& ip, uint16_t port,
                   std::function<void(bool)> callback)
{
    auto endpoint = tcp::endpoint(asio::ip::make_address(ip), port);

    socket_.async_connect(endpoint,
        [this, callback](asio::error_code ec) {
            if (!ec) {
                callback(true);   // connected
            } else {
                callback(false);  // failed
            }
        }
    );
}

void async_send(const std::string& data,
                std::function<void(bool)> callback)
{
    asio::async_write(socket_, asio::buffer(data),
        [callback](asio::error_code ec, std::size_t /*bytes*/) {
            callback(!ec);
        }
    );
}
```

---

## 5. Length-Prefixed Protocol Implementation

Our wire protocol uses a 4-byte big-endian length header before each JSON
message. Here's a complete implementation:

```cpp
#include <cstdint>
#include <string>
#include <vector>
#include <asio.hpp>

// ================================================================
// Writing a length-prefixed message
// ================================================================
void write_message(tcp::socket& socket, const std::string& json_payload) {
    // 1. Calculate payload length
    uint32_t length = static_cast<uint32_t>(json_payload.size());

    // 2. Convert to big-endian (network byte order)
    uint32_t header = htonl(length);

    // 3. Create a buffer with header + payload
    std::vector<asio::const_buffer> buffers;
    buffers.push_back(asio::buffer(&header, sizeof(header)));
    buffers.push_back(asio::buffer(json_payload));

    // 4. Write everything in one call
    //    asio::write guarantees ALL bytes are sent.
    asio::write(socket, buffers);
}

// Async version:
void async_write_message(tcp::socket& socket, const std::string& json_payload,
                         std::function<void(bool)> callback)
{
    // We need the header to outlive the async operation,
    // so we allocate it on the heap via shared_ptr.
    auto header = std::make_shared<uint32_t>(htonl(json_payload.size()));
    auto payload = std::make_shared<std::string>(json_payload);

    std::vector<asio::const_buffer> buffers;
    buffers.push_back(asio::buffer(header.get(), sizeof(uint32_t)));
    buffers.push_back(asio::buffer(*payload));

    asio::async_write(socket, buffers,
        [header, payload, callback](asio::error_code ec, std::size_t) {
            // header and payload are captured to keep them alive
            callback(!ec);
        }
    );
}

// ================================================================
// Reading a length-prefixed message
// ================================================================
std::string read_message(tcp::socket& socket) {
    // 1. Read exactly 4 bytes (the length header)
    uint32_t header;
    asio::read(socket, asio::buffer(&header, sizeof(header)));

    // 2. Convert from big-endian to host byte order
    uint32_t length = ntohl(header);

    // 3. Sanity check (prevent huge allocations from malicious input)
    if (length > 1024 * 1024) {  // 1 MB max
        throw std::runtime_error("Message too large: " + std::to_string(length));
    }

    // 4. Read exactly `length` bytes (the JSON payload)
    std::vector<char> buffer(length);
    asio::read(socket, asio::buffer(buffer));

    // 5. Convert to string
    return std::string(buffer.begin(), buffer.end());
}

// Async version:
class MessageReader : public std::enable_shared_from_this<MessageReader> {
public:
    using Callback = std::function<void(const std::string& message)>;

    MessageReader(tcp::socket& socket, Callback cb)
        : socket_(socket), callback_(std::move(cb)) {}

    void start() {
        auto self = shared_from_this();
        // Step 1: read 4-byte header
        asio::async_read(socket_,
            asio::buffer(&header_, sizeof(header_)),
            [this, self](asio::error_code ec, std::size_t) {
                if (ec) return;  // connection closed or error

                uint32_t length = ntohl(header_);
                if (length > 1024 * 1024) return;  // too large

                // Step 2: read `length` bytes of payload
                payload_.resize(length);
                asio::async_read(socket_,
                    asio::buffer(payload_),
                    [this, self](asio::error_code ec2, std::size_t) {
                        if (ec2) return;
                        std::string msg(payload_.begin(), payload_.end());
                        callback_(msg);
                    }
                );
            }
        );
    }

private:
    tcp::socket& socket_;
    Callback callback_;
    uint32_t header_;
    std::vector<char> payload_;
};
```

### ⚠️ Watch Out: `htonl` / `ntohl` headers

```cpp
// On Linux/macOS:
#include <arpa/inet.h>

// On Windows:
#include <winsock2.h>
// Or use ASIO's built-in:
#include <asio/detail/socket_ops.hpp>
// asio::detail::socket_ops::host_to_network_long(value)

// Portable alternative (no system headers needed):
inline uint32_t to_big_endian(uint32_t value) {
    uint8_t bytes[4];
    bytes[0] = (value >> 24) & 0xFF;
    bytes[1] = (value >> 16) & 0xFF;
    bytes[2] = (value >> 8)  & 0xFF;
    bytes[3] = value & 0xFF;
    uint32_t result;
    std::memcpy(&result, bytes, 4);
    return result;
}

inline uint32_t from_big_endian(uint32_t value) {
    uint8_t bytes[4];
    std::memcpy(bytes, &value, 4);
    return (uint32_t(bytes[0]) << 24) |
           (uint32_t(bytes[1]) << 16) |
           (uint32_t(bytes[2]) << 8)  |
           uint32_t(bytes[3]);
}
```

---

## 6. Async vs Sync I/O

| Style | Pros | Cons | When to Use |
|---|---|---|---|
| **Synchronous** | Simple, easy to read. | Blocks the thread. Can't handle multiple connections. | Quick tests, simple clients. |
| **Asynchronous** | Handles many connections with one thread. Non-blocking. | Callback chains can get complex. | Servers, production code. |

```cpp
// Synchronous — blocks until data arrives
std::string data(1024, '\0');
std::size_t n = socket.read_some(asio::buffer(data));
// Thread is stuck here until data arrives

// Asynchronous — returns immediately
socket.async_read_some(asio::buffer(data),
    [](asio::error_code ec, std::size_t n) {
        // This runs later when data arrives
    }
);
// Thread continues immediately — other work can happen
```

**For our project:** Use **async for the server** (PeerServer handles multiple
connections) and **sync for simple client sends** (PeerClient sends one message
then disconnects).

---

## 7. Error Handling

ASIO uses `asio::error_code` for error handling:

```cpp
// In async callbacks:
socket.async_read_some(asio::buffer(buf),
    [](asio::error_code ec, std::size_t bytes) {
        if (ec == asio::error::eof) {
            // Client disconnected gracefully
            std::cout << "Peer disconnected\n";
        } else if (ec == asio::error::connection_refused) {
            // Peer is not listening
            std::cout << "Peer offline\n";
        } else if (ec == asio::error::timed_out) {
            // Connection timed out
            std::cout << "Connection timed out\n";
        } else if (ec) {
            // Some other error
            std::cerr << "Error: " << ec.message() << "\n";
        } else {
            // Success!
            // process data...
        }
    }
);

// Synchronous with error code (no exceptions):
asio::error_code ec;
asio::write(socket, asio::buffer(data), ec);
if (ec) {
    std::cerr << "Write failed: " << ec.message() << "\n";
}

// Synchronous with exceptions (throws on error):
try {
    asio::write(socket, asio::buffer(data));
} catch (asio::system_error& e) {
    std::cerr << "Write failed: " << e.what() << "\n";
}
```

---

## 8. Timers

Timers are essential for heartbeats and periodic tasks:

```cpp
#include <asio/steady_timer.hpp>
#include <chrono>

class HeartbeatTimer {
public:
    HeartbeatTimer(asio::io_context& io, int interval_seconds)
        : timer_(io), interval_(interval_seconds) {}

    void start() {
        timer_.expires_after(std::chrono::seconds(interval_));
        timer_.async_wait([this](asio::error_code ec) {
            if (!ec) {
                on_tick();
                start();  // reschedule
            }
        });
    }

private:
    void on_tick() {
        // Send heartbeat to Supabase, check for offline messages, etc.
        spdlog::info("Heartbeat tick");
    }

    asio::steady_timer timer_;
    int interval_;
};

// Usage:
asio::io_context io;
HeartbeatTimer heartbeat(io, 60);  // every 60 seconds
heartbeat.start();
io.run();
```

---

## 9. Applying to Our Project

### PeerServer should:
1. `async_accept` in a loop (like the Server example in Section 3).
2. For each connection, create a Session that uses `MessageReader` (Section 5)
   to read length-prefixed JSON.
3. Parse the JSON, invoke `Node::on_message_received()`.

### PeerClient should:
1. Open a TCP connection to the peer's IP:port.
2. Use `write_message()` (Section 5) to send the envelope JSON.
3. Close the connection (we use short-lived connections for simplicity).

### io_context setup in main.cpp:
```cpp
asio::io_context io;

// Start all components on the same io_context
PeerServer peer_server(io, config["node"]["listen_port"]);
peer_server.start();

LocalAPI api(io, config["node"]["api_port"]);
api.start();

HeartbeatTimer heartbeat(io, 60);
heartbeat.start();

// Run the event loop (blocks forever)
io.run();
```

---

## 10. Common Mistakes

### ❌ Forgetting `io.run()`
Without `io.run()`, nothing happens. Async operations are registered but never
executed.

### ❌ Object lifetime issues
```cpp
void bad_example(asio::io_context& io) {
    tcp::socket socket(io);
    socket.async_connect(endpoint, [&socket](auto ec) {
        socket.async_write_some(...);  // socket might be destroyed!
    });
}  // socket is destroyed here, but the callback hasn't fired yet!
```
**Fix:** Use `shared_ptr` + `enable_shared_from_this`.

### ❌ Blocking inside async handlers
```cpp
socket.async_read_some(buf, [](auto ec, auto n) {
    std::this_thread::sleep_for(5s);  // BLOCKS the entire event loop!
});
```
**Fix:** Never block in handlers. Use async operations or post work to a thread pool.

### ❌ Writing to a socket from multiple threads
ASIO sockets are NOT thread-safe. Only access them from the io_context thread
(which is the main thread in our single-threaded design).

### ❌ Not handling partial reads
`socket.read_some()` might return fewer bytes than you need. Always use
`asio::read()` or `asio::async_read()` when you need an exact number of bytes.
