# 07 — nlohmann/json Guide

> **Audience**: Beginners learning C++ and JSON.
> This guide teaches you everything about using the nlohmann/json library for JSON handling in C++.

---

## Table of Contents

1. [What is JSON?](#1-what-is-json)
2. [What is nlohmann/json?](#2-what-is-nlohmannjson)
3. [Creating JSON Objects](#3-creating-json-objects)
4. [Accessing Values](#4-accessing-values)
5. [Type Checking](#5-type-checking)
6. [Iterating Over JSON](#6-iterating-over-json)
7. [Parsing JSON Strings](#7-parsing-json-strings)
8. [Serializing to Strings](#8-serializing-to-strings)
9. [Reading/Writing JSON Files](#9-readingwriting-json-files)
10. [Arrays](#10-arrays)
11. [Nested Objects](#11-nested-objects)
12. [Struct Conversion](#12-struct-conversion)
13. [Our Project's JSON Formats](#13-our-projects-json-formats)
14. [Common Mistakes](#14-common-mistakes)
15. [Tips & Tricks](#15-tips--tricks)

---

## 1. What is JSON?

JSON (JavaScript Object Notation) is a text format for structured data. It looks like this:

```json
{
  "name": "Alice",
  "age": 25,
  "online": true,
  "friends": ["Bob", "Charlie"],
  "address": {
    "city": "Warsaw",
    "country": "Poland"
  }
}
```

**JSON has 6 data types**:
| Type | Example | C++ Equivalent |
|------|---------|----------------|
| String | `"hello"` | `std::string` |
| Number | `42`, `3.14` | `int`, `double` |
| Boolean | `true`, `false` | `bool` |
| Null | `null` | `nullptr` |
| Object | `{"key": "value"}` | `std::map` |
| Array | `[1, 2, 3]` | `std::vector` |

**We use JSON everywhere in our project**:
- Configuration files (`config.json`)
- Messages between backend and UI (REST API)
- Messages between peers (TCP protocol)
- Supabase API requests and responses

---

## 2. What is nlohmann/json?

nlohmann/json is the most popular C++ JSON library. It makes JSON feel like a native C++ type.

### Including It

```cpp
#include <nlohmann/json.hpp>

// Create a shorthand (everyone does this)
using json = nlohmann::json;
```

### CMake Integration

If using FetchContent (already in our CMakeLists.txt):

```cmake
FetchContent_Declare(
    json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG v3.11.3
)
FetchContent_MakeAvailable(json)
target_link_libraries(your_target nlohmann_json::nlohmann_json)
```

---

## 3. Creating JSON Objects

### Method 1: Initializer List (Recommended)

```cpp
#include <nlohmann/json.hpp>
using json = nlohmann::json;

// Create a JSON object with key-value pairs
json user = {
    {"username", "alice"},
    {"age", 25},
    {"online", true}
};

std::cout << user.dump(2) << std::endl;
// Output:
// {
//   "age": 25,
//   "online": true,
//   "username": "alice"
// }
```

### Method 2: Assignment (Build Step by Step)

```cpp
json msg;
msg["type"] = "chat";
msg["from"] = "alice";
msg["to"] = "bob";
msg["content"] = "Hello!";
msg["timestamp"] = 1700000000;

// You can mix types freely!
msg["read"] = false;
msg["tags"] = {"urgent", "personal"};  // Array
```

### Method 3: From Existing Data

```cpp
std::string name = "alice";
int port = 8080;
bool encrypted = true;

json config = {
    {"username", name},          // std::string → JSON string
    {"port", port},              // int → JSON number
    {"encrypted", encrypted},    // bool → JSON boolean
    {"server", nullptr}          // nullptr → JSON null
};
```

---

## 4. Accessing Values

### Using operator[] (Simple but Risky)

```cpp
json user = {{"username", "alice"}, {"age", 25}};

// Access values — implicit conversion
std::string name = user["username"];  // "alice"
int age = user["age"];                // 25

// ⚠️ WARNING: If the key doesn't exist, this CREATES it!
auto x = user["nonexistent"];  // Now user has a "nonexistent" key!
```

### Using .at() (Safe — Throws on Missing Key)

```cpp
json user = {{"username", "alice"}};

try {
    std::string name = user.at("username");  // "alice"
    std::string email = user.at("email");    // THROWS json::out_of_range!
} catch (const json::out_of_range& e) {
    std::cerr << "Key not found: " << e.what() << std::endl;
}
```

### Using .value() (Safe — Returns Default)

```cpp
json user = {{"username", "alice"}};

// If key exists, return its value. Otherwise, return default.
std::string name = user.value("username", "unknown");  // "alice"
std::string email = user.value("email", "no-email");   // "no-email"
int age = user.value("age", 0);                         // 0
```

**🎯 For our project, use `.value()` for optional fields and `.at()` for required fields.**

### Using .get<T>() (Explicit Type Conversion)

```cpp
json data = {{"port", 8080}, {"name", "node1"}};

int port = data["port"].get<int>();
std::string name = data["name"].get<std::string>();

// Also works with .at()
auto port2 = data.at("port").get<int>();
```

---

## 5. Type Checking

### Checking Types Before Access

```cpp
json data = {
    {"name", "alice"},
    {"age", 25},
    {"online", true},
    {"ip", nullptr},
    {"friends", json::array({"bob", "charlie"})}
};

data["name"].is_string();   // true
data["age"].is_number();    // true
data["online"].is_boolean(); // true
data["ip"].is_null();       // true
data["friends"].is_array(); // true
data.is_object();           // true (the whole thing)
```

### Checking if a Key Exists

```cpp
json user = {{"username", "alice"}};

if (user.contains("username")) {
    std::cout << "Username: " << user["username"] << std::endl;
}

if (!user.contains("email")) {
    std::cout << "No email set" << std::endl;
}
```

### Safe Access Pattern

```cpp
// Our recommended pattern for reading messages:
void process_message(const json& msg) {
    // Check required fields
    if (!msg.contains("type") || !msg.contains("from")) {
        spdlog::error("Invalid message: missing required fields");
        return;
    }

    std::string type = msg.at("type");
    std::string from = msg.at("from");

    // Use .value() for optional fields
    std::string content = msg.value("content", "");
    int64_t timestamp = msg.value("timestamp", 0);
}
```

---

## 6. Iterating Over JSON

### Iterating Over Object Keys

```cpp
json user = {
    {"username", "alice"},
    {"age", 25},
    {"online", true}
};

// Method 1: items() — gives you key-value pairs
for (auto& [key, value] : user.items()) {
    std::cout << key << ": " << value << std::endl;
}
// Output:
// age: 25
// online: true
// username: "alice"

// Method 2: Traditional iterator
for (auto it = user.begin(); it != user.end(); ++it) {
    std::cout << it.key() << ": " << it.value() << std::endl;
}
```

### Iterating Over Arrays

```cpp
json friends = {"bob", "charlie", "diana"};

// Range-based for loop
for (const auto& name : friends) {
    std::cout << name << std::endl;
}

// With index
for (size_t i = 0; i < friends.size(); i++) {
    std::cout << i << ": " << friends[i] << std::endl;
}
```

---

## 7. Parsing JSON Strings

### Basic Parsing

```cpp
// Parse a JSON string into a json object
std::string raw = R"({"username": "alice", "age": 25})";
json data = json::parse(raw);

std::string name = data["username"];  // "alice"
```

### Error Handling During Parsing

```cpp
std::string raw = "this is not valid json!!!";

try {
    json data = json::parse(raw);
} catch (const json::parse_error& e) {
    std::cerr << "JSON parse error: " << e.what() << std::endl;
    // Output: JSON parse error: [json.exception.parse_error.101]
    //         parse error at line 1, column 1: ...
}
```

### Safe Parsing (No Exceptions)

```cpp
std::string raw = "maybe valid, maybe not";

json data = json::parse(raw, nullptr, false);
// The 'false' parameter means: don't throw, return discarded

if (data.is_discarded()) {
    std::cerr << "Invalid JSON received!" << std::endl;
} else {
    std::cout << "Parsed: " << data.dump() << std::endl;
}
```

### Parsing from a Network Buffer

```cpp
// When receiving data over TCP:
void handle_received_data(const char* buffer, size_t length) {
    std::string raw(buffer, length);

    json msg = json::parse(raw, nullptr, false);
    if (msg.is_discarded()) {
        spdlog::error("Received invalid JSON from peer");
        return;
    }

    // Process the message
    std::string type = msg.value("type", "unknown");
    spdlog::info("Received message type: {}", type);
}
```

---

## 8. Serializing to Strings

### Compact (For Network Transmission)

```cpp
json msg = {
    {"type", "chat"},
    {"from", "alice"},
    {"content", "Hello!"}
};

std::string compact = msg.dump();
// {"content":"Hello!","from":"alice","type":"chat"}
// No spaces — smallest possible size
```

### Pretty-Printed (For Logging/Config Files)

```cpp
std::string pretty = msg.dump(2);  // 2 = indent spaces
// {
//   "content": "Hello!",
//   "from": "alice",
//   "type": "chat"
// }

std::string pretty4 = msg.dump(4);  // 4-space indent
```

### Size of Serialized JSON

```cpp
std::string s = msg.dump();
std::cout << "JSON size: " << s.size() << " bytes" << std::endl;
// Useful for the length-prefix in our TCP protocol
```

---

## 9. Reading/Writing JSON Files

### Writing a Config File

```cpp
#include <fstream>

void save_config(const json& config, const std::string& path) {
    std::ofstream file(path);
    if (!file.is_open()) {
        throw std::runtime_error("Cannot open file: " + path);
    }

    file << config.dump(2);  // Pretty-printed
    file.close();

    std::cout << "Config saved to " << path << std::endl;
}

// Usage:
json config = {
    {"username", "alice"},
    {"port", 8080},
    {"supabase", {
        {"url", "https://abc.supabase.co"},
        {"api_key", "your-anon-key-here"}
    }}
};

save_config(config, "config.json");
```

### Reading a Config File

```cpp
json load_config(const std::string& path) {
    std::ifstream file(path);
    if (!file.is_open()) {
        throw std::runtime_error("Cannot open config: " + path);
    }

    json config;
    try {
        config = json::parse(file);
    } catch (const json::parse_error& e) {
        throw std::runtime_error(
            "Invalid JSON in config: " + std::string(e.what()));
    }

    return config;
}

// Usage:
json config = load_config("config.json");
std::string username = config.at("username");
int port = config.value("port", 8080);
std::string supabase_url = config.at("supabase").at("url");
```

---

## 10. Arrays

### Creating Arrays

```cpp
// Method 1: From initializer list
json friends = {"alice", "bob", "charlie"};

// Method 2: Explicit array
json numbers = json::array({1, 2, 3, 4, 5});

// Method 3: Empty array, then push_back
json items = json::array();
items.push_back("first");
items.push_back("second");
items.push_back(42);  // Arrays can have mixed types
```

### Accessing Array Elements

```cpp
json arr = {"alice", "bob", "charlie"};

std::string first = arr[0];     // "alice"
std::string last = arr.back();  // "charlie"
size_t count = arr.size();      // 3
bool empty = arr.empty();       // false
```

### Checking if an Array Contains a Value

```cpp
json tags = {"urgent", "personal", "encrypted"};

// Use std::find
auto it = std::find(tags.begin(), tags.end(), "urgent");
if (it != tags.end()) {
    std::cout << "Found 'urgent' tag!" << std::endl;
}
```

---

## 11. Nested Objects

### Creating Nested Structures

```cpp
json msg = {
    {"type", "chat"},
    {"from", "alice"},
    {"to", "bob"},
    {"payload", {
        {"ciphertext", "base64-encrypted-data..."},
        {"nonce", "base64-nonce..."},
        {"signature", "base64-signature..."}
    }},
    {"metadata", {
        {"timestamp", 1700000000},
        {"message_id", "uuid-here"},
        {"encrypted", true}
    }}
};
```

### Accessing Nested Values

```cpp
// Chain brackets for nested access
std::string ciphertext = msg["payload"]["ciphertext"];
int64_t timestamp = msg["metadata"]["timestamp"];

// Safe access with .at()
try {
    auto ct = msg.at("payload").at("ciphertext").get<std::string>();
} catch (const json::exception& e) {
    spdlog::error("Missing field: {}", e.what());
}

// Even safer with .value()
std::string ct = msg.value("/payload/ciphertext"_json_pointer, "");
```

### JSON Pointer (for Deep Access)

```cpp
// JSON Pointer uses / separated paths
json config = load_config("config.json");

// Instead of: config["supabase"]["url"]
// You can use:
std::string url = config.value(
    "/supabase/url"_json_pointer, "");
```

---

## 12. Struct Conversion

### Manual Conversion (Recommended for Beginners)

```cpp
struct UserInfo {
    std::string username;
    std::string public_key;
    std::string last_ip;
    int64_t last_seen;
};

// Convert struct to JSON
json user_to_json(const UserInfo& user) {
    return {
        {"username", user.username},
        {"public_key", user.public_key},
        {"last_ip", user.last_ip},
        {"last_seen", user.last_seen}
    };
}

// Convert JSON to struct
UserInfo json_to_user(const json& j) {
    UserInfo user;
    user.username = j.at("username");
    user.public_key = j.at("public_key");
    user.last_ip = j.value("last_ip", "");
    user.last_seen = j.value("last_seen", 0);
    return user;
}
```

### Automatic Conversion (Advanced)

nlohmann/json can auto-convert if you define `to_json` and `from_json`:

```cpp
struct ChatMessage {
    std::string type;
    std::string from;
    std::string to;
    std::string content;
    int64_t timestamp;
};

// Define these functions (must be in the same namespace as the struct
// or in the nlohmann namespace)
void to_json(json& j, const ChatMessage& m) {
    j = {
        {"type", m.type},
        {"from", m.from},
        {"to", m.to},
        {"content", m.content},
        {"timestamp", m.timestamp}
    };
}

void from_json(const json& j, ChatMessage& m) {
    j.at("type").get_to(m.type);
    j.at("from").get_to(m.from);
    j.at("to").get_to(m.to);
    j.at("content").get_to(m.content);
    j.at("timestamp").get_to(m.timestamp);
}

// Now you can do:
ChatMessage msg = {"chat", "alice", "bob", "Hi!", 1700000000};
json j = msg;               // Automatic conversion to JSON!
ChatMessage msg2 = j;        // Automatic conversion from JSON!
```

---

## 13. Our Project's JSON Formats

### TCP Message Envelope

```cpp
// Building a chat message to send over TCP
json build_chat_envelope(const std::string& from,
                         const std::string& to,
                         const std::string& ciphertext_b64,
                         const std::string& nonce_b64,
                         const std::string& signature_b64,
                         const std::string& msg_id) {
    return {
        {"type", "chat"},
        {"from", from},
        {"to", to},
        {"message_id", msg_id},
        {"ciphertext", ciphertext_b64},
        {"nonce", nonce_b64},
        {"signature", signature_b64},
        {"timestamp", std::time(nullptr)}
    };
}
```

### REST API Responses

```cpp
// Building an API response for the Python UI
json build_friends_response(
    const std::vector<FriendInfo>& friends)
{
    json arr = json::array();
    for (const auto& f : friends) {
        arr.push_back({
            {"username", f.username},
            {"online", !f.last_ip.empty()},
            {"last_seen", f.last_seen}
        });
    }
    return {{"friends", arr}};
}

// Building a messages response
json build_messages_response(
    const std::vector<ChatMessage>& messages)
{
    json arr = json::array();
    for (const auto& m : messages) {
        arr.push_back({
            {"id", m.id},
            {"from", m.from},
            {"to", m.to},
            {"content", m.content},
            {"timestamp", m.timestamp},
            {"direction", m.direction}
        });
    }
    return {{"messages", arr}};
}
```

### Config File

```cpp
// Parsing our config.json
struct AppConfig {
    std::string username;
    int port;
    std::string supabase_url;
    std::string supabase_key;
    std::string data_dir;
};

AppConfig load_app_config(const std::string& path) {
    json j = load_config(path);

    AppConfig cfg;
    cfg.username = j.at("username");
    cfg.port = j.value("port", 8080);
    cfg.supabase_url = j.at("supabase").at("url");
    cfg.supabase_key = j.at("supabase").at("api_key");
    cfg.data_dir = j.value("data_dir", "./data");

    return cfg;
}
```

---

## 14. Common Mistakes

### ❌ Accessing Non-Existent Keys with []

```cpp
json data = {{"name", "alice"}};

// BAD — creates an empty "email" key!
auto email = data["email"];  // data now has {"email": null, "name": "alice"}

// GOOD — check first or use .value()
if (data.contains("email")) {
    auto email = data["email"];
}
std::string email = data.value("email", "none");
```

### ❌ Wrong Type Conversion

```cpp
json data = {{"port", "8080"}};  // Note: "8080" is a STRING

// BAD — throws! String is not an int
int port = data["port"];  // json::type_error exception!

// GOOD — check type first
if (data["port"].is_number()) {
    int port = data["port"];
} else if (data["port"].is_string()) {
    int port = std::stoi(data["port"].get<std::string>());
}
```

### ❌ Forgetting to Parse Before Using

```cpp
std::string raw = R"({"name": "alice"})";

// BAD — raw is a string, not a json object!
// raw["name"];  // COMPILE ERROR

// GOOD — parse first
json data = json::parse(raw);
std::string name = data["name"];  // Works!
```

### ❌ Not Handling Parse Errors

```cpp
// BAD — crashes on invalid JSON
json data = json::parse(received_data);

// GOOD — handle the error
json data = json::parse(received_data, nullptr, false);
if (data.is_discarded()) {
    spdlog::error("Invalid JSON");
    return;
}
```

---

## 15. Tips & Tricks

### Tip 1: Use R"()" for Raw Strings in Tests

```cpp
// C++ raw string literal — no escaping needed
std::string test_json = R"({
    "type": "chat",
    "from": "alice",
    "to": "bob",
    "content": "Hello \"World\"!"
})";
// The quotes inside are preserved correctly
```

### Tip 2: Check JSON Size Before Sending

```cpp
json msg = build_chat_message(...);
std::string serialized = msg.dump();

if (serialized.size() > 1024 * 1024) {  // 1 MB
    spdlog::error("Message too large: {} bytes", serialized.size());
    return;
}
```

### Tip 3: Merge Two JSON Objects

```cpp
json defaults = {
    {"port", 8080},
    {"log_level", "info"},
    {"data_dir", "./data"}
};

json user_config = {
    {"port", 9090},
    {"username", "alice"}
};

// Merge user_config into defaults (user values override defaults)
defaults.merge_patch(user_config);
// Result: {"port":9090, "log_level":"info", "data_dir":"./data", "username":"alice"}
```

### Tip 4: Pretty Print for Debugging

```cpp
json msg = get_some_json();
spdlog::debug("Received: {}", msg.dump(2));
// Great for debugging — you can see the full structure
```

### Tip 5: JSON Diff (Comparing)

```cpp
json a = {{"name", "alice"}, {"age", 25}};
json b = {{"name", "alice"}, {"age", 26}};

json diff = json::diff(a, b);
std::cout << diff.dump(2) << std::endl;
// Shows exactly what changed
```

---

## Quick Reference

```cpp
// Creation
json j = {{"key", "value"}};           // Object
json j = json::array({1, 2, 3});       // Array
json j; j["key"] = "value";            // Step by step

// Access
j["key"]                                // Direct (risky)
j.at("key")                             // Throws if missing
j.value("key", default)                 // Returns default if missing
j.contains("key")                       // Check existence

// Types
j.is_object() / is_array() / is_string() / is_number() / is_boolean() / is_null()

// Parse & Serialize
json j = json::parse(str);              // String → JSON
json j = json::parse(str, nullptr, false); // No-throw parse
std::string s = j.dump();               // JSON → compact string
std::string s = j.dump(2);              // JSON → pretty string

// Files
json j = json::parse(std::ifstream("file.json"));
std::ofstream("file.json") << j.dump(2);

// Iterate
for (auto& [key, val] : j.items()) {}  // Object
for (auto& item : j) {}                 // Array
```

---

## Learning Resources

- [nlohmann/json GitHub](https://github.com/nlohmann/json) — Official repository
- [nlohmann/json Documentation](https://json.nlohmann.me/) — Full API docs
- [JSON.org](https://www.json.org/) — JSON specification
