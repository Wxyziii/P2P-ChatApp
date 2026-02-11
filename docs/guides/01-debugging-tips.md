# 01 — Debugging Tips & Tricks

> **Audience**: Beginners learning to debug C++ and Python code.
> This guide covers practical debugging techniques for every part of the project.

---

## Table of Contents

1. [C++ Debugging](#1-c-debugging)
2. [Python Debugging](#2-python-debugging)
3. [Network Debugging](#3-network-debugging)
4. [Supabase Debugging](#4-supabase-debugging)
5. [Common Error Patterns](#5-common-error-patterns)

---

## 1. C++ Debugging

### Print Debugging with spdlog

The fastest debugging method. Add temporary log statements:

```cpp
void process_message(const json& msg) {
    spdlog::debug(">>> process_message entered");
    spdlog::debug("Message type: {}", msg.value("type", "NONE"));
    spdlog::debug("Message from: {}", msg.value("from", "NONE"));

    // Set log level to debug to see these:
    // spdlog::set_level(spdlog::level::debug);
}
```

### Visual Studio Debugger (Windows)

1. Set build type to Debug: `cmake -DCMAKE_BUILD_TYPE=Debug ..`
2. Set breakpoints: click left margin of a line
3. Press **F5** to start debugging
4. Use:
   - **F10**: Step over (next line)
   - **F11**: Step into (enter function)
   - **Shift+F11**: Step out (leave function)
   - **Watch window**: type variable names to inspect
   - **Call Stack**: see what called this function

### GDB (Linux/macOS)

```bash
# Build with debug info
cmake -DCMAKE_BUILD_TYPE=Debug ..
make

# Run with GDB
gdb ./p2p_chat_backend

# GDB commands:
(gdb) break main.cpp:42        # Set breakpoint at line 42
(gdb) break CryptoManager::encrypt  # Break at function
(gdb) run                      # Start program
(gdb) next                     # Step over
(gdb) step                     # Step into
(gdb) print variable_name      # Show variable value
(gdb) print msg.dump()         # Call methods
(gdb) backtrace                # Show call stack
(gdb) continue                 # Resume execution
(gdb) quit                     # Exit
```

### Address Sanitizer (Find Memory Bugs)

Add to CMakeLists.txt for debug builds:

```cmake
if(CMAKE_BUILD_TYPE STREQUAL "Debug")
    add_compile_options(-fsanitize=address -fno-omit-frame-pointer)
    add_link_options(-fsanitize=address)
endif()
```

Catches: buffer overflows, use-after-free, memory leaks. When it finds a bug, it prints a detailed report with the exact line number.

### Valgrind (Linux — Find Memory Leaks)

```bash
valgrind --leak-check=full ./p2p_chat_backend
```

---

## 2. Python Debugging

### Print Debugging

```python
def on_friend_selected(self, current, previous):
    print(f"DEBUG: current={current}, previous={previous}")
    if current:
        print(f"DEBUG: selected text={current.text()}")
```

### Python Debugger (pdb)

```python
def problematic_function(data):
    import pdb; pdb.set_trace()  # Program stops here!
    # Now you can inspect variables:
    # (Pdb) print(data)
    # (Pdb) type(data)
    # (Pdb) n     ← next line
    # (Pdb) c     ← continue
    # (Pdb) q     ← quit
```

### VS Code Python Debugger

1. Open a `.py` file
2. Click the left margin to set a breakpoint (red dot)
3. Press **F5** → Select "Python File"
4. Use the debug toolbar: step over, step into, continue

### Debugging Qt Issues

```python
# See all signals being emitted
import PySide6.QtCore
PySide6.QtCore.qInstallMessageHandler(
    lambda type, ctx, msg: print(f"Qt {type}: {msg}"))
```

---

## 3. Network Debugging

### curl — Test REST APIs

```bash
# Test backend status
curl -s http://localhost:8080/api/status | python -m json.tool

# Test with verbose headers
curl -v http://localhost:8080/api/friends

# Test POST
curl -X POST http://localhost:8080/api/messages \
  -H "Content-Type: application/json" \
  -d '{"to":"bob","content":"test"}'
```

### Check If a Port Is Listening

```bash
# Windows
netstat -ano | findstr :8080

# Linux
ss -tlnp | grep 8080

# macOS
lsof -i :8080
```

### Test TCP Connection

```bash
# Try connecting to the peer server
# Windows:
Test-NetConnection -ComputerName localhost -Port 9000

# Linux/macOS:
nc -zv localhost 9000
```

### Wireshark (Advanced)

1. Install [Wireshark](https://www.wireshark.org/)
2. Start capture on the loopback interface
3. Filter: `tcp.port == 8080 or tcp.port == 9000`
4. You can see every packet between components

---

## 4. Supabase Debugging

### Check API Responses

```bash
# Verbose curl shows all headers
curl -v "https://YOUR_PROJECT.supabase.co/rest/v1/users" \
  -H "apikey: YOUR_KEY"
```

### Supabase Dashboard Logs

1. Go to your Supabase project dashboard
2. Click **Logs** in the sidebar
3. Check **API logs** for recent requests and errors

### Common Supabase Errors

| HTTP Code | Meaning | Fix |
|-----------|---------|-----|
| 401 | Unauthorized | Check apikey header |
| 404 | Not found | Check URL and table name |
| 409 | Conflict | Duplicate primary key |
| 400 | Bad request | Check JSON format |

---

## 5. Common Error Patterns

### Segmentation Fault (C++)

**Causes**: Null pointer, out-of-bounds array, use-after-free

```cpp
// Check for null
if (ptr == nullptr) {
    spdlog::error("Null pointer!");
    return;
}

// Check bounds
if (index >= vec.size()) {
    spdlog::error("Index {} out of bounds (size {})", index, vec.size());
    return;
}
```

### Connection Refused

**Means**: No process is listening on that port.

**Checklist**:
1. Is the backend running?
2. Is it listening on the right port?
3. Is firewall blocking it?
4. Are you connecting to `localhost` / `127.0.0.1`?

### JSON Parse Error

```
[json.exception.parse_error.101] parse error at line 1, column 1
```

**Means**: The data isn't valid JSON.

**Debug**:
```cpp
spdlog::error("Raw data that failed to parse: '{}'",
              std::string(buffer, length));
```

### Crypto Verification Failed

**Means**: Wrong keys, tampered data, or wrong nonce.

**Checklist**:
1. Are you using the sender's PUBLIC key to verify?
2. Are you using YOUR PRIVATE key to decrypt?
3. Is the nonce exactly what the sender sent?
4. Was the data modified in transit?

### "Address Already in Use"

```bash
# Find the process using the port
# Windows:
netstat -ano | findstr :8080
# Kill it:
taskkill /PID <PID> /F

# Linux:
lsof -i :8080
kill <PID>
```

---

## Quick Debug Checklist

When something doesn't work:

1. **Read the error message carefully** — it usually tells you what's wrong
2. **Check logs** — did the backend print any errors?
3. **Test with curl** — is the API working independently?
4. **Add spdlog/print** — trace the execution path
5. **Check network** — is the port open? Is the process running?
6. **Check config** — are URLs, ports, and keys correct?
7. **Google the error** — someone else probably hit the same issue

---

## Learning Resources

- [GDB Tutorial](https://www.cs.cmu.edu/~gilpin/tutorial/) — GDB basics
- [VS Code Debugging](https://code.visualstudio.com/docs/editor/debugging) — Official guide
- [Wireshark User Guide](https://www.wireshark.org/docs/wsug_html/) — Network analysis
