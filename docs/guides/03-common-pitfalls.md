# 03 — Common Pitfalls & How to Avoid Them

> **Audience**: Beginners in C++ and Python.
> This is a collection of mistakes we've seen people make — and how to fix them.

---

## Table of Contents

1. [C++ Pitfalls](#1-c-pitfalls)
2. [Python Pitfalls](#2-python-pitfalls)
3. [Networking Pitfalls](#3-networking-pitfalls)
4. [Crypto Pitfalls](#4-crypto-pitfalls)
5. [Supabase Pitfalls](#5-supabase-pitfalls)
6. [Qt/PySide6 Pitfalls](#6-qtpyside6-pitfalls)
7. [Build System Pitfalls](#7-build-system-pitfalls)

---

## 1. C++ Pitfalls

### 🔥 Memory Leaks — Use Smart Pointers

```cpp
// ❌ BAD — raw pointer, easy to forget delete
int* data = new int[100];
// ... code that might throw or return early ...
// Oops, forgot delete[] data!

// ✅ GOOD — smart pointer, auto-deletes
auto data = std::make_unique<int[]>(100);
// Automatically freed when data goes out of scope
```

### 🔥 Dangling References

```cpp
// ❌ BAD — returning reference to local variable
std::string& get_name() {
    std::string name = "alice";
    return name;  // name is destroyed after return!
}

// ✅ GOOD — return by value
std::string get_name() {
    std::string name = "alice";
    return name;  // Compiler optimizes this (copy elision)
}
```

### 🔥 String c_str() Lifetime

```cpp
// ❌ BAD — string is temporary, c_str() points to freed memory
const char* get_data() {
    std::string s = "hello";
    return s.c_str();  // s is destroyed, pointer is dangling!
}

// ✅ GOOD — keep the string alive
std::string data = "hello";
const char* ptr = data.c_str();  // OK as long as data exists
curl_easy_setopt(curl, CURLOPT_URL, ptr);
```

### 🔥 Not Checking Return Values

```cpp
// ❌ BAD — ignoring errors
sqlite3_open("db.sqlite", &db);  // What if it fails?

// ✅ GOOD — check every return value
int rc = sqlite3_open("db.sqlite", &db);
if (rc != SQLITE_OK) {
    spdlog::error("DB open failed: {}", sqlite3_errmsg(db));
    return false;
}
```

### 🔥 ASIO Lambda Lifetime

```cpp
// ❌ BAD — `this` might be destroyed before callback fires
auto self = this;
socket.async_read_some(buffer, [self](auto ec, auto len) {
    self->handle_read(ec, len);  // self might be dangling!
});

// ✅ GOOD — use shared_from_this()
class Session : public std::enable_shared_from_this<Session> {
    void start() {
        auto self = shared_from_this();
        socket_.async_read_some(buffer_,
            [self](auto ec, auto len) {
                self->handle_read(ec, len);  // self stays alive!
            });
    }
};
```

### 🔥 Forgetting io_context.run()

```cpp
// ❌ BAD — ASIO does nothing without run()!
asio::io_context io;
asio::ip::tcp::acceptor acceptor(io, endpoint);
acceptor.async_accept([](auto ec, auto socket) {
    // This callback NEVER fires!
});
// Missing: io.run();

// ✅ GOOD
io.run();  // Blocks and processes all async operations
```

### 🔥 Integer Overflow

```cpp
// ❌ BAD — overflow when calculating buffer size
uint16_t size = 60000;
uint16_t total = size + 10000;  // Overflows! total = 4464

// ✅ GOOD — use appropriate type
size_t total = static_cast<size_t>(size) + 10000;  // 70000
```

---

## 2. Python Pitfalls

### 🔥 Mutable Default Arguments

```python
# ❌ BAD — the list is shared between ALL calls!
def add_message(msg, messages=[]):
    messages.append(msg)
    return messages

add_message("hi")   # ["hi"]
add_message("bye")  # ["hi", "bye"]  ← UNEXPECTED!

# ✅ GOOD — use None as default
def add_message(msg, messages=None):
    if messages is None:
        messages = []
    messages.append(msg)
    return messages
```

### 🔥 Forgetting self

```python
# ❌ BAD — TypeError: method takes 0 positional arguments
class ChatWindow:
    def send_message():  # Missing self!
        pass

# ✅ GOOD
class ChatWindow:
    def send_message(self):  # Always include self
        pass
```

### 🔥 Modifying a List While Iterating

```python
# ❌ BAD — skips items!
friends = ["alice", "bob", "charlie"]
for f in friends:
    if f == "bob":
        friends.remove(f)

# ✅ GOOD — iterate over a copy
for f in friends[:]:  # [:] creates a copy
    if f == "bob":
        friends.remove(f)

# ✅ ALSO GOOD — list comprehension
friends = [f for f in friends if f != "bob"]
```

### 🔥 Not Handling Exceptions from requests

```python
# ❌ BAD — crashes if server is down!
data = requests.get(url).json()

# ✅ GOOD
try:
    resp = requests.get(url, timeout=5)
    resp.raise_for_status()
    data = resp.json()
except requests.RequestException as e:
    print(f"Request failed: {e}")
    data = None
```

### 🔥 Mixing Tabs and Spaces

```python
# ❌ BAD — IndentationError!
def func():
    if True:
        print("tabs")     # tab character
        print("spaces")   # 4 spaces
                           # Python hates this!

# ✅ GOOD — always use 4 spaces
# Configure your editor: Tab key inserts 4 spaces
```

---

## 3. Networking Pitfalls

### 🔥 TCP Does NOT Preserve Message Boundaries

This is the #1 networking mistake:

```
// You send: "Hello" (5 bytes) then "World" (5 bytes)
// You might receive:
//   "HelloWorld"     ← merged into one read
//   "Hel" + "loWor" + "ld"  ← split across reads
//   "Hello" + "World" ← only sometimes this!

// SOLUTION: Length-prefix every message
// Send: [5]["Hello"][5]["World"]
// Read: read 4 bytes → know length → read exactly that many bytes
```

See `02-asio-networking.md` for the complete implementation.

### 🔥 Not Handling Partial Reads

```cpp
// ❌ BAD — assumes you get all data at once
char buffer[1024];
auto len = socket.read_some(asio::buffer(buffer));
// len might be less than what was sent!

// ✅ GOOD — read exactly N bytes
asio::read(socket, asio::buffer(buffer, expected_len));
// This blocks until ALL expected_len bytes are received
```

### 🔥 Hardcoding IP Addresses

```python
# ❌ BAD
url = "http://192.168.1.100:8080/api/status"

# ✅ GOOD — use configuration
url = f"http://{config['host']}:{config['port']}/api/status"
```

### 🔥 Not Setting Timeouts

```cpp
// ❌ BAD — hangs forever if peer is unresponsive
curl_easy_perform(curl);

// ✅ GOOD
curl_easy_setopt(curl, CURLOPT_TIMEOUT, 10L);
curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 5L);
```

### 🔥 Port Already in Use

```
Error: bind: Address already in use
```

This happens when a previous instance didn't shut down cleanly.

**Fix**: Set `SO_REUSEADDR`:
```cpp
acceptor.set_option(asio::ip::tcp::acceptor::reuse_address(true));
```

---

## 4. Crypto Pitfalls

### 🔥🔥🔥 Nonce Reuse (CATASTROPHIC)

```cpp
// ❌ CATASTROPHICALLY BAD — same nonce for different messages
unsigned char nonce[24] = {0};  // Always zero!
crypto_box_easy(ct1, msg1, len1, nonce, pk, sk);
crypto_box_easy(ct2, msg2, len2, nonce, pk, sk);
// Attacker can XOR ct1 ⊕ ct2 = msg1 ⊕ msg2 → recover both!

// ✅ GOOD — fresh random nonce every time
randombytes_buf(nonce, sizeof(nonce));
```

### 🔥 Not Verifying Before Trusting

```cpp
// ❌ BAD — decrypt and use without verification
auto text = decrypt(ciphertext);
display(text);  // Could be from anyone!

// ✅ GOOD — verify signature first
auto text = decrypt(ciphertext);
if (!verify(text, signature, sender_pk)) {
    spdlog::error("REJECTED: invalid signature from {}", sender);
    return;
}
display(text);
```

### 🔥 Confusing Key Types

```
Encryption keys (X25519):
  crypto_box_PUBLICKEYBYTES = 32
  crypto_box_SECRETKEYBYTES = 32
  Used with: crypto_box_easy / crypto_box_open_easy

Signing keys (Ed25519):
  crypto_sign_PUBLICKEYBYTES = 32
  crypto_sign_SECRETKEYBYTES = 64   ← NOTE: different size!
  Used with: crypto_sign_detached / crypto_sign_verify_detached

DO NOT mix them! Using a signing key for encryption = CRASH or wrong results.
```

### 🔥 Storing Private Keys Insecurely

```
// ❌ BAD locations for private keys:
// - Committed to Git
// - In a config file that's shared
// - In a file with world-readable permissions

// ✅ GOOD:
// - keys.json in user's data directory
// - chmod 600 keys.json (Linux: owner-only access)
// - .gitignore includes *.key, keys.json
```

### 🔥 Rolling Your Own Crypto

```
// ❌ NEVER do this:
std::string encrypt(const std::string& msg, const std::string& key) {
    std::string result;
    for (size_t i = 0; i < msg.size(); i++) {
        result += msg[i] ^ key[i % key.size()];  // XOR "encryption"
    }
    return result;  // BROKEN in 100 different ways
}

// ✅ ALWAYS use libsodium's high-level functions
// They handle all the hard parts correctly
```

---

## 5. Supabase Pitfalls

### 🔥 Exposing the service_role Key

```json
// ❌ BAD — this key bypasses ALL security!
{"api_key": "eyJ...service_role..."}

// ✅ GOOD — use the anon key
{"api_key": "eyJ...anon..."}
```

### 🔥 Forgetting to URL-Encode Special Characters

```
// ❌ BAD — breaks if username has spaces or special chars
/users?username=eq.John Doe

// ✅ GOOD — URL-encode
/users?username=eq.John%20Doe
```

### 🔥 Not Cleaning Up Old Messages

Without cleanup, messages accumulate forever. Implement the 7-day cleanup in your backend (see Supabase guide).

---

## 6. Qt/PySide6 Pitfalls

### 🔥 Accessing Widgets from Background Threads

```python
# ❌ BAD — undefined behavior, random crashes
def worker_function():
    self.label.setText("Done!")  # WRONG THREAD!

# ✅ GOOD — use signals
class Worker(QObject):
    done = Signal(str)
    def work(self):
        self.done.emit("Done!")  # Signal is thread-safe
```

### 🔥 Not Keeping Widget References

```python
# ❌ BAD — widget gets garbage collected
def setup_ui(self):
    btn = QPushButton("Click")
    self.layout.addWidget(btn)
    # btn is a local variable → might be garbage collected!

# ✅ GOOD — store as self attribute
def setup_ui(self):
    self.btn = QPushButton("Click")
    self.layout.addWidget(self.btn)
```

### 🔥 Forgetting app.exec()

```python
# ❌ BAD — window appears for 0.001 seconds then disappears
app = QApplication(sys.argv)
window = MainWindow()
window.show()
# Script ends, everything is destroyed!

# ✅ GOOD — event loop keeps the app alive
sys.exit(app.exec())
```

### 🔥 Lambda Capture Bug in Loops

```python
# ❌ BAD — all buttons do the same thing (last value)
for name in ["alice", "bob", "charlie"]:
    btn = QPushButton(name)
    btn.clicked.connect(lambda: self.select(name))
    # All buttons select "charlie"!

# ✅ GOOD — capture with default argument
for name in ["alice", "bob", "charlie"]:
    btn = QPushButton(name)
    btn.clicked.connect(lambda _, n=name: self.select(n))
```

---

## 7. Build System Pitfalls

### 🔥 Forgetting to Add Source Files to CMake

```cmake
# ❌ BAD — added new_file.cpp but forgot to add it to CMake
add_executable(backend src/main.cpp)
# Linker error: undefined reference to NewClass::method()

# ✅ GOOD — add ALL source files
add_executable(backend
    src/main.cpp
    src/node/node.cpp
    src/crypto/crypto_manager.cpp
    src/new_file.cpp  # Don't forget this!
)
```

### 🔥 Not Rebuilding After CMakeLists.txt Changes

```bash
# After changing CMakeLists.txt:
cd build
cmake ..           # Re-configure!
cmake --build .    # Then rebuild
```

### 🔥 Mixing Debug and Release Builds

```bash
# ❌ BAD — linking Debug library with Release build
# Results in mysterious crashes

# ✅ GOOD — use same build type for everything
cmake -DCMAKE_BUILD_TYPE=Debug ..    # For development
cmake -DCMAKE_BUILD_TYPE=Release ..  # For testing performance
```

---

## Golden Rules Summary

| # | Rule | Why |
|---|------|-----|
| 1 | Always use `?` placeholders in SQL | Prevents SQL injection |
| 2 | Always use random nonces | Prevents crypto attacks |
| 3 | Never touch widgets from background threads | Prevents crashes |
| 4 | Always set timeouts on network requests | Prevents hangs |
| 5 | Always check return values | Prevents silent failures |
| 6 | Always free/finalize resources | Prevents memory leaks |
| 7 | Never log private keys | Prevents security breaches |
| 8 | Always use length-prefixed TCP | Prevents message corruption |
| 9 | Always keep widget references in self | Prevents garbage collection |
| 10 | Always use virtual environments in Python | Prevents package conflicts |
