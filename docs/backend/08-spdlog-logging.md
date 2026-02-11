# 08 — spdlog Logging Guide

> **Audience**: Beginners learning C++ logging.
> This guide teaches you how to add professional logging to your C++ backend.

---

## Table of Contents

1. [What is spdlog?](#1-what-is-spdlog)
2. [Basic Usage](#2-basic-usage)
3. [Log Levels](#3-log-levels)
4. [Format Strings](#4-format-strings)
5. [Setting the Log Level](#5-setting-the-log-level)
6. [File Logging](#6-file-logging)
7. [Multiple Loggers](#7-multiple-loggers)
8. [Our Project's Logging Strategy](#8-our-projects-logging-strategy)
9. [Pattern Customization](#9-pattern-customization)
10. [Async Logging](#10-async-logging)
11. [Complete Logger Setup](#11-complete-logger-setup)
12. [Common Mistakes](#12-common-mistakes)
13. [Tips & Tricks](#13-tips--tricks)

---

## 1. What is spdlog?

spdlog is a fast, header-only C++ logging library. It's like `std::cout` but much better:

| Feature | `std::cout` | spdlog |
|---------|-------------|--------|
| Log levels | ❌ No | ✅ trace/debug/info/warn/error/critical |
| Timestamps | ❌ Manual | ✅ Automatic |
| File output | ❌ Manual | ✅ Built-in |
| Colors | ❌ No | ✅ Colored terminal output |
| Thread safe | ❌ No | ✅ Yes |
| Performance | ⚠️ Slow | ✅ Very fast |

**Why not `std::cout`?** In production code, you need:
- To know WHEN something happened (timestamps)
- To filter by severity (show only errors in production)
- To write to files (for debugging after the fact)
- Thread safety (our ASIO backend is multi-threaded)

### CMake Integration

Already in our CMakeLists.txt via FetchContent:

```cmake
FetchContent_Declare(
    spdlog
    GIT_REPOSITORY https://github.com/gabime/spdlog.git
    GIT_TAG v1.12.0
)
FetchContent_MakeAvailable(spdlog)
target_link_libraries(your_target spdlog::spdlog)
```

---

## 2. Basic Usage

```cpp
#include <spdlog/spdlog.h>

int main() {
    // Just use it! No setup needed for basic console logging
    spdlog::info("Application started");
    spdlog::warn("This is a warning");
    spdlog::error("Something went wrong!");

    // With variables
    std::string user = "alice";
    int port = 8080;
    spdlog::info("User {} connected on port {}", user, port);

    return 0;
}
```

Output:
```
[2024-01-15 10:30:00.123] [info] Application started
[2024-01-15 10:30:00.124] [warning] This is a warning
[2024-01-15 10:30:00.124] [error] Something went wrong!
[2024-01-15 10:30:00.124] [info] User alice connected on port 8080
```

---

## 3. Log Levels

### The 6 Levels (From Most to Least Verbose)

| Level | Function | When to Use |
|-------|----------|-------------|
| `trace` | `spdlog::trace(...)` | Raw data dumps, byte-level details |
| `debug` | `spdlog::debug(...)` | Function entry/exit, internal state |
| `info` | `spdlog::info(...)` | Startup, connections, message sent |
| `warn` | `spdlog::warn(...)` | Non-critical issues, fallbacks |
| `error` | `spdlog::error(...)` | Failures that affect functionality |
| `critical` | `spdlog::critical(...)` | Cannot continue, shutting down |

### Examples for Our Project

```cpp
// TRACE: raw data (only enable during deep debugging)
spdlog::trace("TCP received {} bytes: {:02x}", len,
              spdlog::to_hex(data, data + len));
spdlog::trace("JSON payload: {}", json_msg.dump());

// DEBUG: detailed flow information
spdlog::debug("encrypt_and_sign() called for recipient: {}", to_user);
spdlog::debug("Nonce generated: {} bytes", nonce.size());
spdlog::debug("Supabase GET /users?username=eq.{}", username);

// INFO: normal operations worth noting
spdlog::info("Backend started on port {}", port);
spdlog::info("Peer {} connected from {}", username, ip);
spdlog::info("Message sent to {} ({} bytes)", to_user, msg.size());
spdlog::info("Registered with Supabase as '{}'", username);

// WARN: something unexpected but recoverable
spdlog::warn("Peer {} unreachable, storing message in Supabase", peer);
spdlog::warn("Supabase heartbeat failed, retrying in 30s");
spdlog::warn("Unknown message type: '{}'", msg_type);

// ERROR: something went wrong
spdlog::error("Failed to decrypt message from {}: {}", from, e.what());
spdlog::error("Supabase request failed: HTTP {}", status_code);
spdlog::error("Cannot bind to port {}: {}", port, error_msg);

// CRITICAL: cannot continue
spdlog::critical("libsodium init failed! Cannot start.");
spdlog::critical("Config file missing: {}", config_path);
spdlog::critical("Database corruption detected!");
```

---

## 4. Format Strings

spdlog uses the `{fmt}` library (like Python's f-strings):

### Basic Placeholders

```cpp
std::string name = "alice";
int port = 8080;
double latency = 3.14;

spdlog::info("Hello, {}!", name);              // Hello, alice!
spdlog::info("Port: {}", port);                // Port: 8080
spdlog::info("Latency: {:.2f}ms", latency);   // Latency: 3.14ms
```

### Number Formatting

```cpp
spdlog::info("Hex: {:#x}", 255);      // Hex: 0xff
spdlog::info("Binary: {:#b}", 42);    // Binary: 0b101010
spdlog::info("Padded: {:05d}", 42);   // Padded: 00042
spdlog::info("Bytes: {}", 1024);      // Bytes: 1024
```

### Multiple Arguments

```cpp
spdlog::info("{} sent {} to {} at {}",
             "alice", "Hello!", "bob", "10:30");
// alice sent Hello! to bob at 10:30

// Positional (reuse arguments)
spdlog::info("{0} → {1}: {2} (from {0})",
             "alice", "bob", "Hi!");
// alice → bob: Hi! (from alice)
```

---

## 5. Setting the Log Level

### Global Level

```cpp
// Only show messages at this level or higher
spdlog::set_level(spdlog::level::debug);  // Show debug and above
spdlog::set_level(spdlog::level::info);   // Show info and above (default)
spdlog::set_level(spdlog::level::warn);   // Show warn and above
spdlog::set_level(spdlog::level::off);    // Disable all logging

// During development:
spdlog::set_level(spdlog::level::debug);

// In production:
spdlog::set_level(spdlog::level::info);
```

### Set Level from Config File

```cpp
void set_log_level_from_config(const std::string& level_str) {
    if (level_str == "trace")    spdlog::set_level(spdlog::level::trace);
    else if (level_str == "debug") spdlog::set_level(spdlog::level::debug);
    else if (level_str == "info")  spdlog::set_level(spdlog::level::info);
    else if (level_str == "warn")  spdlog::set_level(spdlog::level::warn);
    else if (level_str == "error") spdlog::set_level(spdlog::level::err);
    else spdlog::set_level(spdlog::level::info);
}

// In config.json: {"log_level": "debug"}
json config = load_config("config.json");
set_log_level_from_config(config.value("log_level", "info"));
```

---

## 6. File Logging

### Basic File Logger

```cpp
#include <spdlog/sinks/basic_file_sink.h>

// Create a file logger
auto file_logger = spdlog::basic_logger_mt(
    "file_logger",          // Logger name
    "logs/p2p_chat.log"     // File path
);

file_logger->info("This goes to the file");
file_logger->error("Errors too!");
```

### Rotating File Logger (Recommended)

```cpp
#include <spdlog/sinks/rotating_file_sink.h>

// Create a rotating logger (max 5MB per file, keep 3 files)
auto rotating = spdlog::rotating_logger_mt(
    "main",                  // Logger name
    "logs/p2p_chat.log",     // Base file path
    5 * 1024 * 1024,         // 5 MB max size
    3                        // Keep 3 rotated files
);

// Files created: p2p_chat.log, p2p_chat.1.log, p2p_chat.2.log
// Oldest is deleted when new one is needed
```

### Daily File Logger

```cpp
#include <spdlog/sinks/daily_file_sink.h>

// Creates a new log file every day at 2:30 AM
auto daily = spdlog::daily_logger_mt(
    "daily",                  // Logger name
    "logs/p2p_chat.log",      // Base file path
    2, 30                     // Rotate at 2:30 AM
);

// Files: p2p_chat_2024-01-15.log, p2p_chat_2024-01-16.log, etc.
```

---

## 7. Multiple Loggers

### Console + File Simultaneously

```cpp
#include <spdlog/sinks/stdout_color_sinks.h>
#include <spdlog/sinks/rotating_file_sink.h>

void setup_logging() {
    // Create sinks (output destinations)
    auto console_sink = std::make_shared<
        spdlog::sinks::stdout_color_sink_mt>();
    console_sink->set_level(spdlog::level::info);

    auto file_sink = std::make_shared<
        spdlog::sinks::rotating_file_sink_mt>(
            "logs/p2p_chat.log", 5 * 1024 * 1024, 3);
    file_sink->set_level(spdlog::level::debug);

    // Create a logger with both sinks
    auto logger = std::make_shared<spdlog::logger>(
        "main",
        spdlog::sinks_init_list{console_sink, file_sink});

    logger->set_level(spdlog::level::debug);

    // Set as the default logger
    spdlog::set_default_logger(logger);

    // Now all spdlog::info(), etc. go to BOTH console and file
    spdlog::info("Logging initialized (console + file)");
}
```

This is the recommended setup: console shows info and above (less noise), file captures everything from debug up (for detailed troubleshooting).

---

## 8. Our Project's Logging Strategy

### What to Log at Each Level

```
┌─────────┬─────────────────────────────────────────────┐
│ trace   │ Raw TCP bytes, full JSON dumps, hex data    │
│         │ Only enable for deep packet-level debugging │
├─────────┼─────────────────────────────────────────────┤
│ debug   │ Function calls with params                  │
│         │ Crypto operations: key sizes, nonce gen     │
│         │ Database queries and results                │
│         │ Supabase request/response details           │
├─────────┼─────────────────────────────────────────────┤
│ info    │ ⭐ Startup: "Backend started on port 8080"  │
│         │ ⭐ Connection: "Peer alice connected"       │
│         │ ⭐ Message flow: "Sent msg to bob"          │
│         │ ⭐ Registration: "Registered as alice"      │
│         │ ⭐ Shutdown: "Backend shutting down"        │
├─────────┼─────────────────────────────────────────────┤
│ warn    │ ⚠️ Peer offline, using Supabase fallback    │
│         │ ⚠️ Heartbeat failed, will retry             │
│         │ ⚠️ Unknown message type received            │
│         │ ⚠️ Message older than expected              │
├─────────┼─────────────────────────────────────────────┤
│ error   │ ❌ Decryption failed                        │
│         │ ❌ Signature verification failed             │
│         │ ❌ Supabase API error                        │
│         │ ❌ Database write failed                     │
│         │ ❌ Config parse error                        │
├─────────┼─────────────────────────────────────────────┤
│ critical│ 🔥 Cannot start server                      │
│         │ 🔥 Key generation failed                    │
│         │ 🔥 Database cannot be opened                │
│         │ 🔥 libsodium init failed                    │
└─────────┴─────────────────────────────────────────────┘
```

### ⚠️ NEVER Log These

```cpp
// ❌ NEVER log private/secret keys
spdlog::info("Secret key: {}", secret_key_b64);  // SECURITY HOLE!

// ❌ NEVER log full message content in production
spdlog::info("Message content: {}", plaintext);  // PRIVACY VIOLATION!

// ✅ Instead, log metadata
spdlog::info("Sent message to {} ({} chars)", to_user, plaintext.size());
spdlog::debug("Using encryption key fingerprint: {}...",
              public_key_b64.substr(0, 8));
```

---

## 9. Pattern Customization

### Default Pattern

```
[2024-01-15 10:30:00.123] [info] Hello World
```

### Custom Patterns

```cpp
// Add thread ID
spdlog::set_pattern("[%Y-%m-%d %H:%M:%S.%e] [%^%l%$] [thread %t] %v");
// [2024-01-15 10:30:00.123] [info] [thread 1234] Hello World

// Short time format
spdlog::set_pattern("[%H:%M:%S] [%^%l%$] %v");
// [10:30:00] [info] Hello World

// With source location (file + line)
spdlog::set_pattern("[%H:%M:%S] [%^%l%$] [%s:%#] %v");
// [10:30:00] [info] [main.cpp:42] Hello World
```

### Pattern Flags Reference

| Flag | Output | Example |
|------|--------|---------|
| `%Y-%m-%d` | Date | 2024-01-15 |
| `%H:%M:%S` | Time | 10:30:00 |
| `%e` | Milliseconds | 123 |
| `%l` | Level name | info, warn, error |
| `%^...%$` | Color range | Colors the level name |
| `%t` | Thread ID | 1234 |
| `%v` | The actual message | Hello World |
| `%s` | Source file | main.cpp |
| `%#` | Source line | 42 |
| `%n` | Logger name | main |

---

## 10. Async Logging

For high-performance scenarios, use async logging to avoid blocking:

```cpp
#include <spdlog/async.h>
#include <spdlog/sinks/rotating_file_sink.h>

void setup_async_logging() {
    // Create async logger with 8K queue size and 1 background thread
    spdlog::init_thread_pool(8192, 1);

    auto file_sink = std::make_shared<
        spdlog::sinks::rotating_file_sink_mt>(
            "logs/p2p_chat.log", 5 * 1024 * 1024, 3);

    auto async_logger = std::make_shared<spdlog::async_logger>(
        "async_main",
        file_sink,
        spdlog::thread_pool(),
        spdlog::async_overflow_policy::block);

    spdlog::set_default_logger(async_logger);
}
```

**When to use async**: Only if logging becomes a performance bottleneck. For our project, synchronous logging is fine.

---

## 11. Complete Logger Setup

Here's the recommended setup function for our project:

```cpp
// logger_setup.h
#pragma once
#include <string>

void setup_logging(const std::string& log_level = "info",
                   const std::string& log_dir = "logs");

// logger_setup.cpp
#include "logger_setup.h"
#include <spdlog/spdlog.h>
#include <spdlog/sinks/stdout_color_sinks.h>
#include <spdlog/sinks/rotating_file_sink.h>
#include <filesystem>

void setup_logging(const std::string& log_level,
                   const std::string& log_dir) {
    // Create log directory if it doesn't exist
    std::filesystem::create_directories(log_dir);

    // Console sink: colored, shows info and above
    auto console = std::make_shared<
        spdlog::sinks::stdout_color_sink_mt>();
    console->set_level(spdlog::level::info);
    console->set_pattern("[%H:%M:%S] [%^%l%$] %v");

    // File sink: everything from configured level
    auto file = std::make_shared<
        spdlog::sinks::rotating_file_sink_mt>(
            log_dir + "/p2p_chat.log",
            5 * 1024 * 1024,   // 5 MB per file
            3);                 // Keep 3 files
    file->set_level(spdlog::level::trace);
    file->set_pattern("[%Y-%m-%d %H:%M:%S.%e] [%l] [%t] %v");

    // Create multi-sink logger
    auto logger = std::make_shared<spdlog::logger>(
        "p2p_chat",
        spdlog::sinks_init_list{console, file});

    // Set global level from config
    if (log_level == "trace")       logger->set_level(spdlog::level::trace);
    else if (log_level == "debug")  logger->set_level(spdlog::level::debug);
    else if (log_level == "info")   logger->set_level(spdlog::level::info);
    else if (log_level == "warn")   logger->set_level(spdlog::level::warn);
    else if (log_level == "error")  logger->set_level(spdlog::level::err);
    else                            logger->set_level(spdlog::level::info);

    // Flush on warn and above (ensures important messages are written)
    logger->flush_on(spdlog::level::warn);

    // Set as default logger
    spdlog::set_default_logger(logger);

    spdlog::info("=== P2P Chat Backend Starting ===");
    spdlog::info("Log level: {}", log_level);
    spdlog::info("Log file: {}/p2p_chat.log", log_dir);
}
```

### Using in main.cpp

```cpp
#include "logger_setup.h"
#include <nlohmann/json.hpp>

int main() {
    // Load config
    auto config = json::parse(std::ifstream("config.json"));

    // Setup logging first (before anything else)
    setup_logging(
        config.value("log_level", "info"),
        config.value("log_dir", "logs")
    );

    // Now start the application
    spdlog::info("Loaded config for user: {}",
                 config.at("username").get<std::string>());

    // ... rest of startup ...

    spdlog::info("=== Backend Shutting Down ===");
    spdlog::shutdown();  // Flush all buffers
    return 0;
}
```

---

## 12. Common Mistakes

### ❌ Logging Sensitive Data

```cpp
// BAD — private key in logs!
spdlog::info("Generated key: {}", private_key_b64);

// BAD — message content (privacy)
spdlog::info("Message: {}", decrypted_plaintext);

// GOOD — log metadata only
spdlog::info("Generated new key pair (pk: {}...)",
             public_key_b64.substr(0, 8));
spdlog::info("Decrypted message ({} chars) from {}",
             plaintext.size(), from_user);
```

### ❌ Logging in Hot Loops

```cpp
// BAD — logs thousands of times per second
for (auto& byte : buffer) {
    spdlog::trace("Processing byte: {:#x}", byte);
}

// GOOD — log summary
spdlog::trace("Processing {} bytes from buffer", buffer.size());
```

### ❌ Forgetting to Call spdlog::shutdown()

```cpp
// BAD — buffered logs may be lost on exit
return 0;

// GOOD — flush everything before exit
spdlog::shutdown();
return 0;
```

### ❌ Not Setting Flush Policy

```cpp
// If your app crashes, recent logs might be lost!
// Fix: flush on warning and above
spdlog::flush_on(spdlog::level::warn);

// Or flush every 3 seconds
spdlog::flush_every(std::chrono::seconds(3));
```

---

## 13. Tips & Tricks

### Tip 1: Use Conditional Logging for Expensive Operations

```cpp
// Don't build the string if debug level is disabled
if (spdlog::should_log(spdlog::level::debug)) {
    std::string details = expensive_to_string(data);
    spdlog::debug("Details: {}", details);
}
```

### Tip 2: Log Function Entry/Exit in Debug

```cpp
void connect_to_peer(const std::string& username) {
    spdlog::debug(">>> connect_to_peer({})", username);

    // ... do stuff ...

    spdlog::debug("<<< connect_to_peer({}) succeeded", username);
}
```

### Tip 3: Structured Error Logging

```cpp
try {
    // ... risky operation ...
} catch (const std::exception& e) {
    spdlog::error("Operation '{}' failed: {} (retries left: {})",
                  operation_name, e.what(), retries);
}
```

### Tip 4: Startup Banner

```cpp
void log_startup_info(const AppConfig& config) {
    spdlog::info("╔═══════════════════════════════════╗");
    spdlog::info("║    Secure P2P Chat Backend        ║");
    spdlog::info("╠═══════════════════════════════════╣");
    spdlog::info("║ User:   {:25s} ║", config.username);
    spdlog::info("║ Port:   {:25d} ║", config.port);
    spdlog::info("║ Level:  {:25s} ║", config.log_level);
    spdlog::info("╚═══════════════════════════════════╝");
}
```

### Tip 5: Hex Dump for Network Debugging

```cpp
#include <spdlog/fmt/bin_to_hex.h>

void on_tcp_receive(const uint8_t* data, size_t len) {
    spdlog::trace("Received {} bytes: {:02x}",
                  len, spdlog::to_hex(data, data + std::min(len, 64UL)));
}
```

---

## Learning Resources

- [spdlog GitHub](https://github.com/gabime/spdlog) — Official repository with examples
- [spdlog Wiki](https://github.com/gabime/spdlog/wiki) — Configuration guides
- [{fmt} Library](https://fmt.dev/latest/index.html) — Format string reference
