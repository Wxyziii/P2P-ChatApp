# 06 — SQLite Database Guide (C++)

> **Audience**: Beginners learning C++ and databases.
> This guide teaches you how to use SQLite for local data storage in the C++ backend.

---

## Table of Contents

1. [What is SQLite?](#1-what-is-sqlite)
2. [Opening a Database](#2-opening-a-database)
3. [Creating Tables](#3-creating-tables)
4. [INSERT — Adding Data](#4-insert--adding-data)
5. [SELECT — Reading Data](#5-select--reading-data)
6. [UPDATE — Modifying Data](#6-update--modifying-data)
7. [DELETE — Removing Data](#7-delete--removing-data)
8. [Parameterized Queries (CRITICAL)](#8-parameterized-queries-critical)
9. [Complete DatabaseManager Class](#9-complete-databasemanager-class)
10. [Transactions](#10-transactions)
11. [Error Handling](#11-error-handling)
12. [Performance Tips](#12-performance-tips)
13. [Our Complete Schema](#13-our-complete-schema)
14. [Common Mistakes](#14-common-mistakes)
15. [Tips & Tricks](#15-tips--tricks)

---

## 1. What is SQLite?

SQLite is a lightweight database that stores everything in a single file. No server needed!

**Why SQLite for our project?**
- **Zero setup** — no database server to install or configure
- **Single file** — your entire database is one `.db` file
- **Fast** — for local storage, SQLite is extremely fast
- **Built into everything** — every OS has SQLite support
- **Perfect for desktop apps** — exactly our use case

**What we store locally:**
- Our identity (username, keys, node_id)
- Friends list (usernames, public keys, connection info)
- Chat history (messages sent and received)
- Seen message IDs (to avoid duplicate delivery)

### Installing SQLite

**Windows (vcpkg)**:
```bash
vcpkg install sqlite3:x64-windows
```

**Linux (Arch Linux)**:
```bash
sudo pacman -S sqlite
```

**Linux (Ubuntu/Debian)**:
```bash
sudo apt install libsqlite3-dev
```

**macOS**:
```bash
# SQLite is included with macOS, but for headers:
brew install sqlite3
```

### Including in Your Code

```cpp
#include <sqlite3.h>  // That's the only header you need
```

### CMake Integration

```cmake
find_package(SQLite3 REQUIRED)
target_link_libraries(your_target SQLite::SQLite3)
```

---

## 2. Opening a Database

### Basic Open/Close

```cpp
#include <sqlite3.h>
#include <iostream>

int main() {
    sqlite3* db = nullptr;

    // Open (or create) a database file
    int rc = sqlite3_open("chat.db", &db);

    if (rc != SQLITE_OK) {
        std::cerr << "Cannot open database: "
                  << sqlite3_errmsg(db) << std::endl;
        return 1;
    }

    std::cout << "Database opened successfully!" << std::endl;

    // ALWAYS close the database when done
    sqlite3_close(db);
    return 0;
}
```

### Understanding the Pattern

Every SQLite operation follows this pattern:

```
1. Open database → sqlite3_open("file.db", &db)
2. Do operations → sqlite3_exec() or prepare/step/finalize
3. Close database → sqlite3_close(db)
```

### In-Memory Database (for Testing)

```cpp
// Use ":memory:" instead of a filename
sqlite3_open(":memory:", &db);
// Database exists only in RAM, disappears when closed
// Great for unit tests!
```

---

## 3. Creating Tables

### Using sqlite3_exec (Simple Queries)

For queries that don't return data (CREATE, INSERT without results), use `sqlite3_exec`:

```cpp
void create_tables(sqlite3* db) {
    const char* sql = R"(
        CREATE TABLE IF NOT EXISTS identity (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS friends (
            username           TEXT PRIMARY KEY,
            encryption_pub_key TEXT NOT NULL,
            signing_pub_key    TEXT NOT NULL,
            last_ip            TEXT,
            last_seen          TEXT,
            added_at           TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS messages (
            id        TEXT PRIMARY KEY,
            peer      TEXT NOT NULL,
            direction TEXT NOT NULL CHECK(direction IN ('sent','received')),
            content   TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            FOREIGN KEY (peer) REFERENCES friends(username)
        );

        CREATE TABLE IF NOT EXISTS seen_message_ids (
            message_id TEXT PRIMARY KEY,
            seen_at    TEXT DEFAULT (datetime('now'))
        );
    )";

    char* err_msg = nullptr;
    int rc = sqlite3_exec(db, sql, nullptr, nullptr, &err_msg);

    if (rc != SQLITE_OK) {
        std::cerr << "SQL error: " << err_msg << std::endl;
        sqlite3_free(err_msg);  // MUST free error messages!
    } else {
        std::cout << "Tables created successfully!" << std::endl;
    }
}
```

### What is `IF NOT EXISTS`?

This prevents an error if the table already exists. Without it, running CREATE TABLE twice would fail. Always use it!

---

## 4. INSERT — Adding Data

### The Prepare/Bind/Step/Finalize Pattern

For queries with user data, ALWAYS use prepared statements (see Section 8 for why).

```cpp
bool insert_friend(sqlite3* db,
                   const std::string& username,
                   const std::string& enc_pk,
                   const std::string& sign_pk) {
    const char* sql = R"(
        INSERT INTO friends (username, encryption_pub_key, signing_pub_key)
        VALUES (?, ?, ?)
    )";
    //         ^  ^  ^
    //    These ? are placeholders for actual values

    sqlite3_stmt* stmt = nullptr;

    // Step 1: PREPARE — compile the SQL
    int rc = sqlite3_prepare_v2(db, sql, -1, &stmt, nullptr);
    if (rc != SQLITE_OK) {
        std::cerr << "Prepare failed: " << sqlite3_errmsg(db) << std::endl;
        return false;
    }

    // Step 2: BIND — fill in the ? placeholders
    // Index starts at 1, NOT 0!
    sqlite3_bind_text(stmt, 1, username.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, enc_pk.c_str(),   -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 3, sign_pk.c_str(),  -1, SQLITE_TRANSIENT);

    // Step 3: STEP — execute the statement
    rc = sqlite3_step(stmt);

    // Step 4: FINALIZE — clean up (ALWAYS do this!)
    sqlite3_finalize(stmt);

    if (rc != SQLITE_DONE) {
        std::cerr << "Insert failed: " << sqlite3_errmsg(db) << std::endl;
        return false;
    }

    return true;
}
```

### Understanding SQLITE_TRANSIENT

```cpp
sqlite3_bind_text(stmt, 1, text.c_str(), -1, SQLITE_TRANSIENT);
//                                        ^^  ^^^^^^^^^^^^^^^^^
//                                        |   "Make a copy of the data"
//                                        |
//                                        -1 means "calculate strlen for me"
```

`SQLITE_TRANSIENT` tells SQLite to make its own copy of the string. This is always safe. The alternative (`SQLITE_STATIC`) is faster but requires the string to stay alive until after `sqlite3_step` — risky for beginners.

---

## 5. SELECT — Reading Data

### Reading a Single Row

```cpp
#include <optional>

struct FriendInfo {
    std::string username;
    std::string encryption_pub_key;
    std::string signing_pub_key;
    std::string last_ip;
    std::string last_seen;
};

std::optional<FriendInfo> get_friend(sqlite3* db,
                                     const std::string& username) {
    const char* sql = "SELECT * FROM friends WHERE username = ?";

    sqlite3_stmt* stmt = nullptr;
    int rc = sqlite3_prepare_v2(db, sql, -1, &stmt, nullptr);
    if (rc != SQLITE_OK) return std::nullopt;

    sqlite3_bind_text(stmt, 1, username.c_str(), -1, SQLITE_TRANSIENT);

    rc = sqlite3_step(stmt);

    if (rc == SQLITE_ROW) {
        // We got a result row!
        FriendInfo info;
        // Column indices start at 0
        info.username = reinterpret_cast<const char*>(
            sqlite3_column_text(stmt, 0));
        info.encryption_pub_key = reinterpret_cast<const char*>(
            sqlite3_column_text(stmt, 1));
        info.signing_pub_key = reinterpret_cast<const char*>(
            sqlite3_column_text(stmt, 2));

        // Handle potentially NULL columns
        const char* ip = reinterpret_cast<const char*>(
            sqlite3_column_text(stmt, 3));
        info.last_ip = ip ? ip : "";

        const char* seen = reinterpret_cast<const char*>(
            sqlite3_column_text(stmt, 4));
        info.last_seen = seen ? seen : "";

        sqlite3_finalize(stmt);
        return info;
    }

    sqlite3_finalize(stmt);
    return std::nullopt;  // User not found
}
```

### Reading Multiple Rows

```cpp
std::vector<FriendInfo> list_friends(sqlite3* db) {
    std::vector<FriendInfo> friends;
    const char* sql = "SELECT * FROM friends ORDER BY username";

    sqlite3_stmt* stmt = nullptr;
    int rc = sqlite3_prepare_v2(db, sql, -1, &stmt, nullptr);
    if (rc != SQLITE_OK) return friends;

    // Loop: step through each row
    while (sqlite3_step(stmt) == SQLITE_ROW) {
        FriendInfo info;
        info.username = reinterpret_cast<const char*>(
            sqlite3_column_text(stmt, 0));
        info.encryption_pub_key = reinterpret_cast<const char*>(
            sqlite3_column_text(stmt, 1));
        info.signing_pub_key = reinterpret_cast<const char*>(
            sqlite3_column_text(stmt, 2));

        const char* ip = reinterpret_cast<const char*>(
            sqlite3_column_text(stmt, 3));
        info.last_ip = ip ? ip : "";

        const char* seen = reinterpret_cast<const char*>(
            sqlite3_column_text(stmt, 4));
        info.last_seen = seen ? seen : "";

        friends.push_back(std::move(info));
    }

    sqlite3_finalize(stmt);
    return friends;
}
```

### Reading Messages with Limit

```cpp
struct Message {
    std::string id;
    std::string peer;
    std::string direction;  // "sent" or "received"
    std::string content;
    std::string timestamp;
};

std::vector<Message> get_messages(sqlite3* db,
                                  const std::string& peer,
                                  int limit = 50) {
    std::vector<Message> messages;
    const char* sql = R"(
        SELECT id, peer, direction, content, timestamp
        FROM messages
        WHERE peer = ?
        ORDER BY timestamp DESC
        LIMIT ?
    )";

    sqlite3_stmt* stmt = nullptr;
    int rc = sqlite3_prepare_v2(db, sql, -1, &stmt, nullptr);
    if (rc != SQLITE_OK) return messages;

    sqlite3_bind_text(stmt, 1, peer.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(stmt, 2, limit);

    while (sqlite3_step(stmt) == SQLITE_ROW) {
        Message msg;
        msg.id = reinterpret_cast<const char*>(
            sqlite3_column_text(stmt, 0));
        msg.peer = reinterpret_cast<const char*>(
            sqlite3_column_text(stmt, 1));
        msg.direction = reinterpret_cast<const char*>(
            sqlite3_column_text(stmt, 2));
        msg.content = reinterpret_cast<const char*>(
            sqlite3_column_text(stmt, 3));
        msg.timestamp = reinterpret_cast<const char*>(
            sqlite3_column_text(stmt, 4));
        messages.push_back(std::move(msg));
    }

    sqlite3_finalize(stmt);

    // Reverse so oldest is first (we queried DESC for LIMIT)
    std::reverse(messages.begin(), messages.end());
    return messages;
}
```

---

## 6. UPDATE — Modifying Data

```cpp
bool update_friend_ip(sqlite3* db,
                      const std::string& username,
                      const std::string& new_ip) {
    const char* sql = R"(
        UPDATE friends
        SET last_ip = ?, last_seen = datetime('now')
        WHERE username = ?
    )";

    sqlite3_stmt* stmt = nullptr;
    int rc = sqlite3_prepare_v2(db, sql, -1, &stmt, nullptr);
    if (rc != SQLITE_OK) return false;

    sqlite3_bind_text(stmt, 1, new_ip.c_str(),   -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, username.c_str(), -1, SQLITE_TRANSIENT);

    rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    return (rc == SQLITE_DONE);
}
```

---

## 7. DELETE — Removing Data

```cpp
bool remove_friend(sqlite3* db, const std::string& username) {
    // First delete their messages, then delete the friend
    const char* sql1 = "DELETE FROM messages WHERE peer = ?";
    const char* sql2 = "DELETE FROM friends WHERE username = ?";

    sqlite3_stmt* stmt = nullptr;

    // Delete messages
    sqlite3_prepare_v2(db, sql1, -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, username.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    // Delete friend
    sqlite3_prepare_v2(db, sql2, -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, username.c_str(), -1, SQLITE_TRANSIENT);
    int rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    return (rc == SQLITE_DONE);
}
```

---

## 8. Parameterized Queries (CRITICAL)

### ⚠️ NEVER Do This — SQL Injection

```cpp
// ❌ CATASTROPHICALLY BAD — SQL injection vulnerability!
std::string username = get_user_input();
std::string sql = "SELECT * FROM friends WHERE username = '"
                  + username + "'";
sqlite3_exec(db, sql.c_str(), ...);

// If someone enters: ' OR '1'='1
// The query becomes:
// SELECT * FROM friends WHERE username = '' OR '1'='1'
// This returns ALL friends! (or worse, deletes data)
```

### ✅ Always Use ? Placeholders

```cpp
// ✅ SAFE — parameterized query
const char* sql = "SELECT * FROM friends WHERE username = ?";
sqlite3_stmt* stmt;
sqlite3_prepare_v2(db, sql, -1, &stmt, nullptr);
sqlite3_bind_text(stmt, 1, username.c_str(), -1, SQLITE_TRANSIENT);
// SQLite treats the username as DATA, not as SQL code
// Even if someone enters malicious input, it's harmless
```

### The Bind Functions

| Function | For Type | Example |
|----------|----------|---------|
| `sqlite3_bind_text` | Strings | `sqlite3_bind_text(stmt, 1, str.c_str(), -1, SQLITE_TRANSIENT)` |
| `sqlite3_bind_int` | Integers | `sqlite3_bind_int(stmt, 1, 42)` |
| `sqlite3_bind_int64` | Large ints | `sqlite3_bind_int64(stmt, 1, 9999999999LL)` |
| `sqlite3_bind_double` | Floats | `sqlite3_bind_double(stmt, 1, 3.14)` |
| `sqlite3_bind_null` | NULL | `sqlite3_bind_null(stmt, 1)` |
| `sqlite3_bind_blob` | Binary | `sqlite3_bind_blob(stmt, 1, data, len, SQLITE_TRANSIENT)` |

---

## 9. Complete DatabaseManager Class

### Header

```cpp
// database_manager.h
#pragma once
#include <sqlite3.h>
#include <string>
#include <vector>
#include <optional>

struct FriendInfo {
    std::string username;
    std::string encryption_pub_key;
    std::string signing_pub_key;
    std::string last_ip;
    std::string last_seen;
};

struct ChatMessage {
    std::string id;
    std::string peer;
    std::string direction;  // "sent" or "received"
    std::string content;
    std::string timestamp;
};

class DatabaseManager {
public:
    explicit DatabaseManager(const std::string& db_path);
    ~DatabaseManager();

    // Prevent copying (only one connection to the db)
    DatabaseManager(const DatabaseManager&) = delete;
    DatabaseManager& operator=(const DatabaseManager&) = delete;

    // Identity
    void save_identity(const std::string& key,
                       const std::string& value);
    std::string load_identity(const std::string& key,
                              const std::string& default_val = "");

    // Friends
    bool add_friend(const std::string& username,
                    const std::string& enc_pk,
                    const std::string& sign_pk);
    std::optional<FriendInfo> get_friend(const std::string& username);
    std::vector<FriendInfo> list_friends();
    bool update_friend(const std::string& username,
                       const std::string& ip);
    bool remove_friend(const std::string& username);

    // Messages
    bool save_message(const std::string& id,
                      const std::string& peer,
                      const std::string& direction,
                      const std::string& content,
                      const std::string& timestamp);
    std::vector<ChatMessage> get_messages(const std::string& peer,
                                          int limit = 50);

    // Deduplication
    bool has_seen_message(const std::string& message_id);
    void mark_message_seen(const std::string& message_id);

private:
    sqlite3* db_ = nullptr;
    void create_tables();
    void exec(const std::string& sql);
};
```

### Implementation

```cpp
// database_manager.cpp
#include "database_manager.h"
#include <spdlog/spdlog.h>
#include <stdexcept>
#include <algorithm>

DatabaseManager::DatabaseManager(const std::string& db_path) {
    int rc = sqlite3_open(db_path.c_str(), &db_);
    if (rc != SQLITE_OK) {
        std::string err = sqlite3_errmsg(db_);
        sqlite3_close(db_);
        throw std::runtime_error("Cannot open database: " + err);
    }

    // Enable WAL mode for better performance
    exec("PRAGMA journal_mode=WAL");

    // Enable foreign keys
    exec("PRAGMA foreign_keys=ON");

    create_tables();
    spdlog::info("Database opened: {}", db_path);
}

DatabaseManager::~DatabaseManager() {
    if (db_) {
        sqlite3_close(db_);
        spdlog::debug("Database closed");
    }
}

void DatabaseManager::exec(const std::string& sql) {
    char* err = nullptr;
    int rc = sqlite3_exec(db_, sql.c_str(), nullptr, nullptr, &err);
    if (rc != SQLITE_OK) {
        std::string msg = err ? err : "Unknown error";
        sqlite3_free(err);
        spdlog::error("SQL exec failed: {}", msg);
        throw std::runtime_error("SQL error: " + msg);
    }
}

void DatabaseManager::create_tables() {
    const char* sql = R"(
        CREATE TABLE IF NOT EXISTS identity (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS friends (
            username           TEXT PRIMARY KEY,
            encryption_pub_key TEXT NOT NULL,
            signing_pub_key    TEXT NOT NULL,
            last_ip            TEXT DEFAULT '',
            last_seen          TEXT DEFAULT '',
            added_at           TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS messages (
            id        TEXT PRIMARY KEY,
            peer      TEXT NOT NULL,
            direction TEXT NOT NULL CHECK(direction IN ('sent','received')),
            content   TEXT NOT NULL,
            timestamp TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_messages_peer
            ON messages(peer, timestamp);

        CREATE TABLE IF NOT EXISTS seen_message_ids (
            message_id TEXT PRIMARY KEY,
            seen_at    TEXT DEFAULT (datetime('now'))
        );
    )";

    exec(sql);
    spdlog::debug("Database tables initialized");
}

// ---- Identity ----

void DatabaseManager::save_identity(const std::string& key,
                                    const std::string& value) {
    const char* sql = R"(
        INSERT INTO identity (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
    )";

    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, key.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, value.c_str(), -1, SQLITE_TRANSIENT);

    int rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    if (rc != SQLITE_DONE) {
        spdlog::error("save_identity failed: {}", sqlite3_errmsg(db_));
    }
}

std::string DatabaseManager::load_identity(
    const std::string& key,
    const std::string& default_val)
{
    const char* sql = "SELECT value FROM identity WHERE key = ?";

    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, key.c_str(), -1, SQLITE_TRANSIENT);

    std::string result = default_val;
    if (sqlite3_step(stmt) == SQLITE_ROW) {
        const char* val = reinterpret_cast<const char*>(
            sqlite3_column_text(stmt, 0));
        if (val) result = val;
    }

    sqlite3_finalize(stmt);
    return result;
}

// ---- Friends ----

bool DatabaseManager::add_friend(const std::string& username,
                                 const std::string& enc_pk,
                                 const std::string& sign_pk) {
    const char* sql = R"(
        INSERT INTO friends (username, encryption_pub_key, signing_pub_key)
        VALUES (?, ?, ?)
    )";

    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, username.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, enc_pk.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 3, sign_pk.c_str(), -1, SQLITE_TRANSIENT);

    int rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    if (rc != SQLITE_DONE) {
        spdlog::error("add_friend failed: {}", sqlite3_errmsg(db_));
        return false;
    }
    return true;
}

std::optional<FriendInfo> DatabaseManager::get_friend(
    const std::string& username)
{
    const char* sql = R"(
        SELECT username, encryption_pub_key, signing_pub_key,
               last_ip, last_seen
        FROM friends WHERE username = ?
    )";

    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, username.c_str(), -1, SQLITE_TRANSIENT);

    if (sqlite3_step(stmt) == SQLITE_ROW) {
        FriendInfo info;
        auto col = [&](int i) -> std::string {
            const char* v = reinterpret_cast<const char*>(
                sqlite3_column_text(stmt, i));
            return v ? v : "";
        };
        info.username = col(0);
        info.encryption_pub_key = col(1);
        info.signing_pub_key = col(2);
        info.last_ip = col(3);
        info.last_seen = col(4);

        sqlite3_finalize(stmt);
        return info;
    }

    sqlite3_finalize(stmt);
    return std::nullopt;
}

std::vector<FriendInfo> DatabaseManager::list_friends() {
    std::vector<FriendInfo> list;
    const char* sql = R"(
        SELECT username, encryption_pub_key, signing_pub_key,
               last_ip, last_seen
        FROM friends ORDER BY username
    )";

    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr);

    while (sqlite3_step(stmt) == SQLITE_ROW) {
        FriendInfo info;
        auto col = [&](int i) -> std::string {
            const char* v = reinterpret_cast<const char*>(
                sqlite3_column_text(stmt, i));
            return v ? v : "";
        };
        info.username = col(0);
        info.encryption_pub_key = col(1);
        info.signing_pub_key = col(2);
        info.last_ip = col(3);
        info.last_seen = col(4);
        list.push_back(std::move(info));
    }

    sqlite3_finalize(stmt);
    return list;
}

bool DatabaseManager::update_friend(const std::string& username,
                                    const std::string& ip) {
    const char* sql = R"(
        UPDATE friends
        SET last_ip = ?, last_seen = datetime('now')
        WHERE username = ?
    )";

    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, ip.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, username.c_str(), -1, SQLITE_TRANSIENT);

    int rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    return (rc == SQLITE_DONE);
}

bool DatabaseManager::remove_friend(const std::string& username) {
    exec("BEGIN TRANSACTION");

    const char* sql1 = "DELETE FROM messages WHERE peer = ?";
    const char* sql2 = "DELETE FROM friends WHERE username = ?";

    sqlite3_stmt* stmt = nullptr;

    sqlite3_prepare_v2(db_, sql1, -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, username.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    sqlite3_prepare_v2(db_, sql2, -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, username.c_str(), -1, SQLITE_TRANSIENT);
    int rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    exec("COMMIT");
    return (rc == SQLITE_DONE);
}

// ---- Messages ----

bool DatabaseManager::save_message(const std::string& id,
                                   const std::string& peer,
                                   const std::string& direction,
                                   const std::string& content,
                                   const std::string& timestamp) {
    const char* sql = R"(
        INSERT OR IGNORE INTO messages (id, peer, direction, content, timestamp)
        VALUES (?, ?, ?, ?, ?)
    )";

    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, id.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, peer.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 3, direction.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 4, content.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 5, timestamp.c_str(), -1, SQLITE_TRANSIENT);

    int rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    return (rc == SQLITE_DONE);
}

std::vector<ChatMessage> DatabaseManager::get_messages(
    const std::string& peer, int limit)
{
    std::vector<ChatMessage> msgs;
    const char* sql = R"(
        SELECT id, peer, direction, content, timestamp
        FROM messages WHERE peer = ?
        ORDER BY timestamp DESC LIMIT ?
    )";

    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, peer.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(stmt, 2, limit);

    while (sqlite3_step(stmt) == SQLITE_ROW) {
        ChatMessage m;
        auto col = [&](int i) -> std::string {
            const char* v = reinterpret_cast<const char*>(
                sqlite3_column_text(stmt, i));
            return v ? v : "";
        };
        m.id = col(0);
        m.peer = col(1);
        m.direction = col(2);
        m.content = col(3);
        m.timestamp = col(4);
        msgs.push_back(std::move(m));
    }

    sqlite3_finalize(stmt);
    std::reverse(msgs.begin(), msgs.end());
    return msgs;
}

// ---- Deduplication ----

bool DatabaseManager::has_seen_message(const std::string& message_id) {
    const char* sql = "SELECT 1 FROM seen_message_ids WHERE message_id = ?";

    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, message_id.c_str(), -1, SQLITE_TRANSIENT);

    bool seen = (sqlite3_step(stmt) == SQLITE_ROW);
    sqlite3_finalize(stmt);
    return seen;
}

void DatabaseManager::mark_message_seen(const std::string& message_id) {
    const char* sql = "INSERT OR IGNORE INTO seen_message_ids (message_id) VALUES (?)";

    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, message_id.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);
}
```

---

## 10. Transactions

### Why Transactions?

When you need to do multiple operations that must succeed or fail together:

```cpp
// Without transaction: if step 2 fails, step 1 already happened!
// delete_messages(peer);  // Step 1: succeeds
// delete_friend(peer);    // Step 2: fails!
// Now messages are gone but friend still exists — inconsistent!

// With transaction: both succeed or both are rolled back
void remove_friend_safely(sqlite3* db, const std::string& peer) {
    sqlite3_exec(db, "BEGIN TRANSACTION", nullptr, nullptr, nullptr);

    try {
        // Step 1
        // ... delete messages ...
        // Step 2
        // ... delete friend ...

        sqlite3_exec(db, "COMMIT", nullptr, nullptr, nullptr);
    } catch (...) {
        sqlite3_exec(db, "ROLLBACK", nullptr, nullptr, nullptr);
        throw;
    }
}
```

### RAII Transaction Helper

```cpp
class Transaction {
public:
    explicit Transaction(sqlite3* db) : db_(db), committed_(false) {
        sqlite3_exec(db_, "BEGIN TRANSACTION", nullptr, nullptr, nullptr);
    }

    void commit() {
        sqlite3_exec(db_, "COMMIT", nullptr, nullptr, nullptr);
        committed_ = true;
    }

    ~Transaction() {
        if (!committed_) {
            sqlite3_exec(db_, "ROLLBACK", nullptr, nullptr, nullptr);
        }
    }

private:
    sqlite3* db_;
    bool committed_;
};

// Usage:
void do_stuff(sqlite3* db) {
    Transaction txn(db);
    // ... do multiple operations ...
    // If any throw, destructor calls ROLLBACK automatically
    txn.commit();  // If we get here, everything succeeded
}
```

---

## 11. Error Handling

### SQLite Return Codes

| Code | Name | Meaning |
|------|------|---------|
| 0 | `SQLITE_OK` | Everything is fine |
| 1 | `SQLITE_ERROR` | Generic error |
| 5 | `SQLITE_BUSY` | Database is locked |
| 19 | `SQLITE_CONSTRAINT` | Constraint violation (duplicate key, etc.) |
| 100 | `SQLITE_ROW` | `sqlite3_step()` has a row ready |
| 101 | `SQLITE_DONE` | `sqlite3_step()` finished executing |

### Getting Error Messages

```cpp
// After any SQLite call returns an error:
const char* error = sqlite3_errmsg(db);
std::cerr << "SQLite error: " << error << std::endl;

// More detailed error code:
int extended = sqlite3_extended_errcode(db);
```

---

## 12. Performance Tips

### 1. Enable WAL Mode

```cpp
// Call once after opening the database
sqlite3_exec(db, "PRAGMA journal_mode=WAL", nullptr, nullptr, nullptr);
```

WAL (Write-Ahead Logging) dramatically improves performance for concurrent reads/writes.

### 2. Use Prepared Statement Caching

Instead of preparing the same query every time, cache it:

```cpp
// In your class, store frequently-used prepared statements
class DatabaseManager {
private:
    sqlite3_stmt* insert_msg_stmt_ = nullptr;

    void prepare_statements() {
        sqlite3_prepare_v2(db_,
            "INSERT INTO messages VALUES (?,?,?,?,?)",
            -1, &insert_msg_stmt_, nullptr);
    }

    void cleanup_statements() {
        if (insert_msg_stmt_) sqlite3_finalize(insert_msg_stmt_);
    }
};

// Reuse: just reset and rebind
sqlite3_reset(insert_msg_stmt_);
sqlite3_bind_text(insert_msg_stmt_, 1, ...);
sqlite3_step(insert_msg_stmt_);
```

### 3. Batch Inserts in Transactions

```cpp
// SLOW: 1000 individual inserts
for (int i = 0; i < 1000; i++) {
    save_message(...);  // Each has its own transaction
}

// FAST: 1000 inserts in one transaction
exec("BEGIN TRANSACTION");
for (int i = 0; i < 1000; i++) {
    save_message(...);
}
exec("COMMIT");
// Can be 100x faster!
```

### 4. Create Indexes for Frequently Queried Columns

```sql
-- We query messages by peer often, so index it
CREATE INDEX IF NOT EXISTS idx_messages_peer
    ON messages(peer, timestamp);
```

---

## 13. Our Complete Schema

```sql
-- Identity: stores our username, node_id, etc.
CREATE TABLE IF NOT EXISTS identity (
    key   TEXT PRIMARY KEY,    -- e.g., "username", "node_id"
    value TEXT NOT NULL         -- the actual value
);

-- Friends list with their public keys
CREATE TABLE IF NOT EXISTS friends (
    username           TEXT PRIMARY KEY,
    encryption_pub_key TEXT NOT NULL,     -- Base64 X25519 public key
    signing_pub_key    TEXT NOT NULL,     -- Base64 Ed25519 public key
    last_ip            TEXT DEFAULT '',   -- Last known IP
    last_seen          TEXT DEFAULT '',   -- Last seen timestamp
    added_at           TEXT DEFAULT (datetime('now'))
);

-- Chat messages (both sent and received)
CREATE TABLE IF NOT EXISTS messages (
    id        TEXT PRIMARY KEY,          -- UUID
    peer      TEXT NOT NULL,             -- Who the message is to/from
    direction TEXT NOT NULL              -- 'sent' or 'received'
              CHECK(direction IN ('sent','received')),
    content   TEXT NOT NULL,             -- Decrypted message text
    timestamp TEXT NOT NULL              -- ISO 8601 timestamp
);

-- Index for fast message lookup by peer
CREATE INDEX IF NOT EXISTS idx_messages_peer
    ON messages(peer, timestamp);

-- Track which message IDs we've already processed
-- Prevents duplicate delivery of offline messages
CREATE TABLE IF NOT EXISTS seen_message_ids (
    message_id TEXT PRIMARY KEY,
    seen_at    TEXT DEFAULT (datetime('now'))
);
```

---

## 14. Common Mistakes

### ❌ Forgetting `sqlite3_finalize()`

```cpp
// BAD — memory leak! Statement handle is never freed
sqlite3_stmt* stmt;
sqlite3_prepare_v2(db, sql, -1, &stmt, nullptr);
sqlite3_step(stmt);
// Missing: sqlite3_finalize(stmt);

// GOOD — always finalize
sqlite3_step(stmt);
sqlite3_finalize(stmt);
```

### ❌ String Concatenation for Queries (SQL Injection)

```cpp
// BAD — SQL injection!
std::string sql = "DELETE FROM friends WHERE username = '"
                  + user_input + "'";

// GOOD — parameterized
const char* sql = "DELETE FROM friends WHERE username = ?";
sqlite3_bind_text(stmt, 1, user_input.c_str(), -1, SQLITE_TRANSIENT);
```

### ❌ Not Checking Return Codes

```cpp
// BAD — ignoring errors
sqlite3_step(stmt);

// GOOD — check the return code
int rc = sqlite3_step(stmt);
if (rc != SQLITE_DONE && rc != SQLITE_ROW) {
    spdlog::error("Step failed: {}", sqlite3_errmsg(db));
}
```

### ❌ Using Column Index 0 Without Verifying Order

```cpp
// If you change the SELECT query, indices change too!
// Better: explicitly name columns in SELECT
"SELECT username, encryption_pub_key FROM friends"
//       ^0        ^1
```

### ❌ Forgetting `sqlite3_free()` for Error Messages

```cpp
char* err = nullptr;
sqlite3_exec(db, sql, nullptr, nullptr, &err);
if (err) {
    std::cerr << err << std::endl;
    sqlite3_free(err);  // MUST free this!
}
```

---

## 15. Tips & Tricks

### Use `sqlite3` CLI for Quick Testing

```bash
# Open your database in the terminal
sqlite3 chat.db

# Show tables
.tables

# Show table schema
.schema friends

# Run a query
SELECT * FROM friends;

# Pretty output
.mode column
.headers on
SELECT * FROM messages WHERE peer = 'alice';

# Exit
.quit
```

### Use `INSERT OR IGNORE` to Skip Duplicates

```sql
-- If the message ID already exists, silently skip
INSERT OR IGNORE INTO messages (id, peer, direction, content, timestamp)
VALUES ('uuid-1', 'alice', 'received', 'Hello!', '2024-01-01T12:00:00');
```

### Use `INSERT ... ON CONFLICT` for Upsert

```sql
-- Insert or update if key exists
INSERT INTO identity (key, value) VALUES ('username', 'alice')
ON CONFLICT(key) DO UPDATE SET value = excluded.value;
```

### Generate UUIDs

SQLite doesn't have built-in UUID generation. Generate them in C++:

```cpp
#include <sodium.h>
#include <sstream>
#include <iomanip>

std::string generate_uuid() {
    unsigned char bytes[16];
    randombytes_buf(bytes, sizeof(bytes));

    // Set UUID version 4 bits
    bytes[6] = (bytes[6] & 0x0F) | 0x40;
    bytes[8] = (bytes[8] & 0x3F) | 0x80;

    std::ostringstream ss;
    ss << std::hex << std::setfill('0');
    for (int i = 0; i < 16; i++) {
        if (i == 4 || i == 6 || i == 8 || i == 10) ss << '-';
        ss << std::setw(2) << static_cast<int>(bytes[i]);
    }
    return ss.str();
}
```

---

## Learning Resources

- [SQLite Official Docs](https://www.sqlite.org/docs.html) — Comprehensive reference
- [SQLite C/C++ Interface](https://www.sqlite.org/cintro.html) — C API introduction
- [SQLite Tutorial](https://www.sqlitetutorial.net/) — SQL basics with SQLite
- [SQLite Browser](https://sqlitebrowser.org/) — GUI tool to view your database
