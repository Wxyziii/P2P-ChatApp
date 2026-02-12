# Secure P2P Chat

A **peer-to-peer encrypted chat application** where every user hosts their own
backend node. Messages are end-to-end encrypted with
[libsodium](https://doc.libsodium.org/) -- the server (Supabase) never sees
plaintext.

> **Status:** Project skeleton -- see the [Development Roadmap](#development-roadmap) to get started.

---

## Table of Contents

1. [What Does This App Do?](#what-does-this-app-do)
2. [How It Works (Simple Explanation)](#how-it-works-simple-explanation)
3. [Key Features](#key-features)
4. [Architecture at a Glance](#architecture-at-a-glance)
5. [Project Structure](#project-structure)
6. [Tech Stack (and Why We Chose Each)](#tech-stack-and-why-we-chose-each)
7. [Prerequisites](#prerequisites)
8. [Step-by-Step Setup Guide](#step-by-step-setup-guide)
9. [Security Model (Summary)](#security-model-summary)
10. [Development Roadmap](#development-roadmap)
11. [Learning Resources](#learning-resources)
12. [Supabase Free Tier Guide](#supabase-free-tier-guide)
13. [Team Workflow](#team-workflow)
14. [FAQ / Troubleshooting](#faq--troubleshooting)
15. [License](#license)

---

## What Does This App Do?

Imagine WhatsApp or Signal, but instead of your messages going through
Facebook's or Signal's servers, **you run your own server on your computer**.
When you send a message to a friend, it goes directly from your computer to
theirs -- no middleman.

**The problem with direct connections:** You need to know your friend's IP
address, which is annoying and changes often. So we use a free cloud database
(Supabase) as a "phone book" -- it stores usernames and their current IPs so
you can find each other by name.

**What about when your friend is offline?** We store the message (encrypted!) in
Supabase until they come back online. They download and decrypt it on their
machine. Supabase never sees the actual message content.

---

## How It Works (Simple Explanation)

Let's trace what happens when Alice sends "Hello!" to Bob:

### Scenario 1: Bob Is Online

```
1. Alice types "Hello!" in the Python UI and clicks Send.

2. The UI sends an HTTP request to Alice's LOCAL C++ backend:
   POST http://127.0.0.1:8080/messages {"to": "bob", "text": "Hello!"}

3. Alice's backend:
   a. Looks up Bob's public encryption key (from local database).
   b. Generates a random nonce (24 random bytes -- ensures uniqueness).
   c. Encrypts "Hello!" using Bob's public key + Alice's secret key.
      Result: a blob of unreadable bytes (ciphertext).
   d. Signs the ciphertext with Alice's private signing key.
      Result: a 64-byte digital signature proving Alice sent this.
   e. Packages everything into a JSON envelope:
      {"type":"message", "from":"alice", "to":"bob",
       "nonce":"...", "ciphertext":"...", "signature":"..."}

4. Alice's backend opens a TCP connection to Bob's IP:port
   (looked up from local database, originally from Supabase).

5. Alice's backend sends the JSON envelope over TCP.

6. Bob's backend receives it:
   a. Verifies the signature using Alice's public signing key. Valid!
   b. Decrypts the ciphertext using Alice's public key + Bob's secret key.
      Result: "Hello!"
   c. Stores the decrypted message in Bob's local database.

7. Bob's UI polls his backend and displays: "Alice: Hello!"
```

### Scenario 2: Bob Is Offline

```
Steps 1-3 are the same.

4. Alice's backend tries to connect to Bob's IP:port.
   --> Connection FAILS (Bob's computer is off).

5. Alice's backend uploads the encrypted envelope to Supabase:
   POST https://supabase.co/rest/v1/messages
   {"to_user":"bob", "from_user":"alice", "ciphertext":"<encrypted envelope>"}

6. Later, Bob comes online. His backend starts up and checks Supabase:
   GET https://supabase.co/rest/v1/messages?to_user=eq.bob

7. Bob's backend downloads, decrypts, and deletes the messages from Supabase.

8. Bob sees: "Alice: Hello!" (with a note that it was an offline message).
```

### The Key Insight

**Supabase only ever sees encrypted data.** Even if someone hacks Supabase,
they get a bunch of random-looking bytes. The actual message "Hello!" was
encrypted on Alice's machine and only decrypted on Bob's machine.

---

## Key Features

| Feature | What It Means | Why It Matters |
|---|---|---|
| **Self-hosted nodes** | Each user runs a lightweight C++ backend on their machine. | Your messages, your rules. No company controls your data. |
| **Friend codes** | Add friends by username, not IP address. | IPs change and are hard to remember. Usernames are easy. |
| **End-to-end encryption** | Messages are encrypted before leaving your machine and decrypted only on the recipient's machine. | Even if the network or Supabase is compromised, your messages are safe. |
| **Offline messages** | If a friend is offline, encrypted messages wait in Supabase. | You can send messages anytime; they'll be delivered when the friend comes online. |
| **Desktop UI** | Clean Python/Qt interface. | Easy to use, easy to develop with PySide6. |
| **Open protocol** | Documented message format and API. | You understand exactly how everything works. Great for learning! |

---

## Architecture at a Glance

```
+------------+  localhost HTTP   +-----------------+  TCP (direct)   +-----------------+
| Python UI  | <--------------> |  C++ Backend    | <-------------> |  Remote Peer    |
| (PySide6)  |                  |  (P2P Node)     |                 |  (C++ Backend)  |
+------------+                  +--------+--------+                 +-----------------+
                                         | HTTPS (REST)
                                         v
                                +-----------------+
                                |    Supabase     |
                                |  (PostgreSQL)   |
                                |  - users table  |
                                |  - messages tbl |
                                +-----------------+
```

**Three separate programs:**
1. **C++ Backend** -- Does all the heavy lifting: networking, encryption,
   talking to Supabase. This is the "brain."
2. **Python UI** -- The pretty face. Shows messages, friend list, input box.
   Talks ONLY to the local backend via HTTP.
3. **Supabase** -- Cloud "phone book" and offline mailbox. Stores only
   encrypted data and public keys.

> Full architecture details: [ARCHITECTURE.md](ARCHITECTURE.md)

---

## Project Structure

Here's every file in the project and what it's for:

```
secure-p2p-chat/
|
|-- backend/                       # C++20 P2P node (the "brain")
|   |-- src/                       # Source files (.cpp)
|   |   |-- main.cpp               # Program entry point. Loads config,
|   |   |                          # starts all modules.
|   |   |-- node/
|   |   |   +-- node.cpp           # Node identity: manages username,
|   |   |                          # keys, friends, message routing.
|   |   |-- crypto/
|   |   |   +-- crypto_manager.cpp # Encryption, decryption, signing,
|   |   |                          # key generation (libsodium wrapper).
|   |   |-- network/
|   |   |   |-- peer_server.cpp    # Listens for incoming TCP connections
|   |   |   |                      # from other peers (ASIO).
|   |   |   +-- peer_client.cpp    # Connects to remote peers and sends
|   |   |                          # messages (ASIO).
|   |   |-- supabase/
|   |   |   +-- supabase_client.cpp # REST API client for Supabase
|   |   |                           # (libcurl). Registration, lookup,
|   |   |                           # offline messages.
|   |   +-- api/
|   |       +-- local_api.cpp      # HTTP server on localhost for the
|   |                              # Python UI to talk to.
|   |-- include/                   # Header files (.h) -- same structure
|   |   |                          # as src/. Contains class declarations.
|   |   |-- node/node.h
|   |   |-- crypto/crypto_manager.h
|   |   |-- network/peer_server.h
|   |   |-- network/peer_client.h
|   |   |-- supabase/supabase_client.h
|   |   +-- api/local_api.h
|   |-- CMakeLists.txt             # Build configuration. Tells CMake
|   |                              # where the source files are and what
|   |                              # libraries to link.
|   +-- config.example.json        # Template config -- copy to
|                                  # config.json and fill in your details.
|
|-- ui/                            # Python desktop UI (the "face")
|   |-- main.py                    # UI entry point. Creates the Qt
|   |                              # application window.
|   |-- views/
|   |   |-- __init__.py
|   |   +-- main_window.py        # The main window layout: friend list
|   |                              # on the left, chat on the right.
|   |-- services/
|   |   |-- __init__.py
|   |   +-- backend_service.py    # HTTP client that talks to the C++
|   |                              # backend on localhost.
|   +-- assets/
|       +-- .gitkeep               # Placeholder for icons, fonts,
|                                  # stylesheets.
|
|-- protocol/                      # Technical specifications
|   |-- message_format.md          # How messages are structured,
|   |                              # encrypted, and sent over TCP.
|   |-- api_contract.md            # Every HTTP endpoint between UI
|   |                              # and backend, with examples.
|   +-- threat_model.md            # Security analysis: what could go
|                                  # wrong and how we defend against it.
|
|-- README.md                      # <-- You are here!
+-- ARCHITECTURE.md                # Detailed architecture document
                                   # with data flows and diagrams.
```

### Why Separate `src/` and `include/`?

In C++, code is split into:
- **Header files (.h)** -- Declare what functions/classes exist (the "interface").
  Other files `#include` these to know what's available.
- **Source files (.cpp)** -- Contain the actual implementation (the "body").

This separation lets the compiler work efficiently and keeps interfaces clean.
It's a C++ convention you'll see in most projects.

---

## Tech Stack (and Why We Chose Each)

### Backend (C++)

| Component | Library | What It Does | Why This Library |
|---|---|---|---|
| Language | **C++20** | The backend language | We want to learn C++! It's fast and gives us full control over networking and crypto. C++20 adds nice features like concepts and std::format. |
| Build system | **CMake >= 3.20** | Compiles the project | The industry standard for C++ projects. Works on Windows, Linux, and macOS. Our CMakeLists.txt auto-downloads some dependencies via FetchContent. |
| Networking | **ASIO (standalone)** | TCP server/client for peer connections | The most popular C++ async I/O library. "Standalone" means we use it without Boost (simpler). It handles async reads/writes elegantly with callbacks or coroutines. |
| HTTP client | **libcurl** | Makes HTTP requests to Supabase REST API | The world's most popular HTTP client library. Available everywhere. Well-documented with tons of examples. |
| JSON | **nlohmann/json** | Parse & create JSON data | The most popular C++ JSON library. Beautiful API: you can do `json j = {{"name", "alice"}}` and it just works. Header-only (no compilation needed). |
| Crypto | **libsodium** | Encryption, signing, key management | A modern, easy-to-use crypto library. Much simpler than OpenSSL. Designed to be hard to misuse. Used by many real-world apps. |
| Logging | **spdlog** | Log messages for debugging | Fast, header-only, supports multiple log levels (info, warn, error, debug). Way better than `std::cout` for debugging. |
| Local DB | **SQLite** | Store chat history, friends, keys locally | A file-based database -- no server needed. Just a .db file on disk. Perfect for desktop apps. Used by Firefox, Chrome, Android, etc. |

### Frontend (Python)

| Component | Library | What It Does | Why This Library |
|---|---|---|---|
| Language | **Python 3.11+** | The UI language | We want to learn Python! It's great for UIs, has excellent libraries, and is much faster to develop with than C++. |
| UI framework | **PySide6 (Qt 6)** | Desktop window, buttons, layouts | The official Python binding for Qt, the most powerful cross-platform UI toolkit. Works on Windows, macOS, and Linux. Free and open-source (LGPL). |
| HTTP client | **requests** | Talks to the C++ backend on localhost | The most popular Python HTTP library. Dead simple: `requests.get(url)` returns the response. |
| Async | **asyncio** | Non-blocking operations | Python's built-in async framework. We'll use it to poll for messages without freezing the UI. |
| Local DB | **sqlite3** | Optional local caching | Built into Python's standard library -- no install needed. |

### Cloud (Supabase)

| Component | What It Does | Why Supabase |
|---|---|---|
| **PostgreSQL** | Stores users table and messages table | A real SQL database (not a toy). Supabase hosts it for free. |
| **PostgREST API** | Auto-generated REST API for the database | No need to write server-side code! Supabase automatically creates GET/POST/PATCH/DELETE endpoints for every table. |
| **Free tier** | 500 MB DB, 5 GB bandwidth, unlimited API calls | Generous enough for our project. No credit card required. |

---

## Prerequisites

Before setting up the project, you need these installed:

### For the C++ Backend

| Tool | Minimum Version | How to Install | How to Check |
|---|---|---|---|
| C++ Compiler | GCC 12+, Clang 15+, or MSVC 19.30+ (Visual Studio 2022) | **Windows:** Install [Visual Studio 2022](https://visualstudio.microsoft.com/) Community (free) with "Desktop development with C++" workload. **Arch Linux:** `sudo pacman -S base-devel` **Ubuntu/Debian:** `sudo apt install build-essential` | `g++ --version` or `cl` in VS Developer Command Prompt |
| CMake | 3.20+ | **Windows:** `winget install Kitware.CMake` **Arch Linux:** `sudo pacman -S cmake` **Ubuntu/Debian:** `sudo apt install cmake` | `cmake --version` |
| libsodium | Latest | **Windows:** `vcpkg install libsodium` or download from [download.libsodium.org](https://download.libsodium.org/libsodium/releases/) **Arch Linux:** `sudo pacman -S libsodium` **Ubuntu/Debian:** `sudo apt install libsodium-dev` | `pkg-config --modversion libsodium` (Linux) |
| libcurl | Latest | **Windows:** Usually bundled with Visual Studio; or `vcpkg install curl` **Arch Linux:** `sudo pacman -S curl` **Ubuntu/Debian:** `sudo apt install libcurl4-openssl-dev` | `curl --version` |
| SQLite3 | Latest | **Windows:** `vcpkg install sqlite3` **Arch Linux:** `sudo pacman -S sqlite` **Ubuntu/Debian:** `sudo apt install libsqlite3-dev` | `sqlite3 --version` |

> **What is vcpkg?** It's a C++ package manager by Microsoft. Install it from
> [github.com/microsoft/vcpkg](https://github.com/microsoft/vcpkg). It makes
> installing C++ libraries on Windows MUCH easier.

### For the Python UI

| Tool | Minimum Version | How to Install | How to Check |
|---|---|---|---|
| Python | 3.11+ | **Windows:** `winget install Python.Python.3.11` or from [python.org](https://www.python.org/downloads/) **Arch Linux:** `sudo pacman -S python` **Ubuntu/Debian:** `sudo apt install python3` | `python --version` |
| pip | Latest | Comes with Python | `pip --version` |

Python libraries (PySide6, requests) are installed via pip in the setup steps below.

### Supabase Account

1. Go to [supabase.com](https://supabase.com) and sign up (free).
2. Create a new project (any name, any region).
3. Note your **Project URL** and **anon key** from Settings > API.

---

## Step-by-Step Setup Guide

### Step 1: Get the Code

```bash
git clone <repo-url> secure-p2p-chat
cd secure-p2p-chat
```

Or if you're starting from this skeleton, you already have it!

### Step 2: Set Up Supabase Tables

Go to your Supabase project dashboard > SQL Editor and run:

```sql
-- ============================================
-- TABLE 1: User discovery (the "phone book")
-- ============================================
CREATE TABLE users (
    username    TEXT PRIMARY KEY,
    -- The unique name users choose. Like a Discord username.
    -- PRIMARY KEY means no two users can have the same name.

    node_id     TEXT UNIQUE NOT NULL,
    -- A random identifier for this node instance.
    -- UNIQUE means no two rows can have the same node_id.
    -- NOT NULL means this field is required.

    public_key  TEXT NOT NULL,
    -- The user's X25519 public encryption key, base64-encoded.
    -- This is how other users encrypt messages TO this user.
    -- It's safe to store publicly (that's the point of public keys).

    last_ip     TEXT,
    -- The user's last known IP address.
    -- Other users need this to make direct TCP connections.
    -- NULL if the user has never connected.

    last_seen   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    -- When this user was last online.
    -- DEFAULT NOW() means it's auto-set to the current time on insert.
    -- The backend updates this periodically (heartbeat).
);

-- ============================================
-- TABLE 2: Offline encrypted messages (the "mailbox")
-- ============================================
CREATE TABLE messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- A random UUID for each message. Auto-generated.
    -- UUID = Universally Unique Identifier (a 128-bit random ID).

    to_user     TEXT NOT NULL,
    -- Who should receive this message.

    from_user   TEXT NOT NULL,
    -- Who sent this message (so the recipient knows who it's from).

    ciphertext  TEXT NOT NULL,
    -- The full encrypted message envelope (base64-encoded JSON).
    -- This contains the nonce, encrypted content, and signature.
    -- Even if you read this field, you see only random characters.

    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    -- When this offline message was stored.
    -- Used for the 7-day auto-delete cleanup.
);

-- ============================================
-- OPTIONAL: Auto-delete old messages
-- ============================================
-- pg_cron might not be available on the free tier.
-- If not, the backend can handle cleanup (see ARCHITECTURE.md).
-- Uncomment if pg_cron is available:
--
-- SELECT cron.schedule(
--     'delete-old-messages',
--     '0 * * * *',
--     $$DELETE FROM messages WHERE created_at < NOW() - INTERVAL '7 days'$$
-- );
```

**Verify it worked:** Go to Table Editor in Supabase. You should see `users`
and `messages` tables.

### Step 3: Configure the Backend

```bash
cd backend
copy config.example.json config.json
# On Linux/macOS: cp config.example.json config.json
```

Edit `config.json`:

```json
{
    "node": {
        "username": "your_username_here",
        "listen_port": 9100,
        "api_port": 8080
    },
    "supabase": {
        "url": "https://YOUR_PROJECT_ID.supabase.co",
        "anon_key": "YOUR_ANON_KEY_HERE"
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

**Where to find your Supabase credentials:**
1. Go to your Supabase project dashboard.
2. Click "Settings" (gear icon) in the left sidebar.
3. Click "API" under "Configuration."
4. Copy the "Project URL" (looks like `https://abcdefg.supabase.co`).
5. Copy the "anon public" key (a long string starting with `eyJ...`).

### Step 4: Build the Backend

```bash
cd backend

# Create a build directory
cmake -B build -DCMAKE_BUILD_TYPE=Debug

# Build the project
cmake --build build

# Run it
./build/secure-p2p-chat-backend              # Linux/macOS
# or
.\build\Debug\secure-p2p-chat-backend.exe    # Windows
```

**If the build fails** -- this is expected in the skeleton stage! The source
files have stub implementations. As you complete each phase, the build will
start working.

**Common build issues:**
- "libsodium not found" -- Install libsodium (see Prerequisites).
- "CURL not found" -- Install libcurl-dev (see Prerequisites).
- "SQLite3 not found" -- Install libsqlite3-dev (see Prerequisites).
- On Windows with vcpkg: add `-DCMAKE_TOOLCHAIN_FILE=path/to/vcpkg/scripts/buildsystems/vcpkg.cmake`

### Step 5: Set Up the Python UI

```bash
cd ui

# Create a virtual environment (recommended)
python -m venv venv

# Activate it
# Windows:
venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate

# Install dependencies
pip install PySide6 requests

# Run the UI
python main.py
```

You should see a window titled "Secure P2P Chat" with a placeholder label.
As you build out the views, this will become a full chat interface.

### Step 6: Test the Connection (Phase 1+)

Once the backend is running:

```bash
# In a new terminal, test the health endpoint:
curl http://127.0.0.1:8080/status

# Expected response:
# {"status":"ok","username":"your_username"}
```

---

## Security Model (Summary)

| What We Protect | How We Protect It |
|---|---|
| **Message confidentiality** | X25519 key exchange + XSalsa20-Poly1305 encryption (libsodium crypto_box_easy). Only the sender and recipient can read messages. |
| **Message integrity** | Poly1305 MAC (built into crypto_box_easy) detects any tampering. If a single byte is changed, decryption fails. |
| **Sender authentication** | Ed25519 digital signatures. Each message is signed with the sender's private key. The recipient verifies it was really from them. |
| **Key storage** | Private keys NEVER leave your machine. They're stored in a local file. Only public keys are uploaded to Supabase. |
| **Offline messages** | Encrypted before uploading to Supabase. Supabase stores only ciphertext. Deleted after delivery. |
| **Local API security** | Backend binds to 127.0.0.1 only. Not accessible from the network. |

**What we DON'T protect against (accepted trade-offs):**
- **IP visibility** -- Peers can see each other's IPs. Use a VPN if this concerns you.
- **Metadata** -- Supabase knows who talks to whom (from_user, to_user), even though it can't read the content.
- **Local malware** -- If someone has malware on your machine, they can read your keys. Use OS-level security.
- **Forward secrecy** -- If your key is ever compromised, past messages (if captured) could be decrypted. Future improvement: Double Ratchet protocol.

> Full security analysis: [protocol/threat_model.md](protocol/threat_model.md)

---

## Development Roadmap

This roadmap is designed for **two people learning C++ and Python**. Each phase
builds on the previous one and includes recommended tutorials.

---

### Phase 1: Plaintext P2P Chat

> **Goal:** Two backends can exchange plaintext messages over TCP. The UI
> displays them. No encryption yet -- just get the plumbing working.
>
> **Estimated difficulty:** Medium (this is the hardest phase because you're
> setting up the foundation).

**Backend tasks (C++ developer):**
- [ ] Implement `PeerServer` -- listen for TCP connections with ASIO.
- [ ] Implement `PeerClient` -- connect to a peer and send data.
- [ ] Implement `LocalAPI` -- HTTP server on localhost.
  - Start with just `GET /status` and `POST /messages`.
- [ ] Implement local SQLite storage for messages.
- [ ] Test: Two instances on your LAN can send plaintext JSON to each other.

**UI tasks (Python developer):**
- [ ] Implement `BackendService` -- HTTP client for the backend API.
- [ ] Implement `MainWindow` -- friend list + chat area.
- [ ] Wire up Send button to call `POST /messages`.
- [ ] Poll `GET /messages` every 3 seconds to show new messages.
- [ ] Test: UI can send and receive messages via the backend.

**Integration:**
- [ ] Run two backends (different ports) + two UIs on the same machine.
- [ ] Verify messages flow: UI A -> Backend A -> Backend B -> UI B.

**Tutorials for this phase:**

*C++ Networking (ASIO):*
- Start here: [ASIO Tutorial](https://think-async.com/Asio/asio-1.30.2/doc/asio/tutorial.html)
  -- Official tutorial. Work through the timer and TCP examples.
- [Beej's Guide to Network Programming](https://beej.us/guide/bgnet/)
  -- Classic guide to socket programming. Read chapters 1-6 for background,
  even though we use ASIO instead of raw sockets.
- Video: [The Cherno - C++ Networking](https://www.youtube.com/watch?v=2hNdkYInj4g)
  -- Practical C++ networking explanation.
- Reference: [ASIO async_read/async_write](https://think-async.com/Asio/asio-1.30.2/doc/asio/reference/async_read.html)

*C++ HTTP Server:*
- [cpp-httplib](https://github.com/yhirose/cpp-httplib) -- Single-header HTTP
  server. Much easier than building one from scratch with ASIO. We recommend
  starting with this, then optionally rewriting with raw ASIO.
- [libcurl examples](https://curl.se/libcurl/c/example.html) -- For the
  Supabase client.

*C++ SQLite:*
- [SQLite C/C++ Interface Intro](https://www.sqlite.org/cintro.html)
  -- Official guide. Read "Opening A New Database Connection" through "Binding Values."
- [SQLite C API in 5 minutes](https://www.sqlite.org/quickstart.html)

*Python UI (PySide6):*
- Start here: [Qt for Python Getting Started](https://doc.qt.io/qtforpython-6/gettingstarted.html)
- Best tutorial series: [Python GUIs - PySide6](https://www.pythonguis.com/pyside6/)
  -- Free tutorials from basics to advanced. Start with "Creating your first app."
- [Qt Widgets Tutorial](https://doc.qt.io/qtforpython-6/tutorials/basictutorial/widgets.html)
- Video: [Tech With Tim - PyQt6 Tutorial](https://www.youtube.com/watch?v=Cc5TAaetrig)
  -- (PyQt6 and PySide6 are nearly identical.)

*Python HTTP (requests):*
- [Requests Quickstart](https://requests.readthedocs.io/en/latest/user/quickstart/)
- [Real Python - HTTP Requests](https://realpython.com/python-requests/)

---

### Phase 2: Supabase Username Discovery

> **Goal:** Users register in Supabase on startup. Friends are found by
> username instead of IP address. The backend regularly updates its
> last_seen timestamp.

**Backend tasks (C++ developer):**
- [ ] Implement `SupabaseClient` using libcurl.
  - `register_user()` -- UPSERT into `users` table on startup.
  - `heartbeat()` -- UPDATE `last_seen` every 60 seconds.
  - `lookup_user()` -- GET user by username.
- [ ] On startup: register self, fetch friend IPs from Supabase.
- [ ] Implement `POST /friends` in LocalAPI -- resolve username via Supabase.

**UI tasks (Python developer):**
- [ ] Add "Add Friend" input and button to the UI.
- [ ] Show online/offline status based on `last_seen`.
- [ ] Handle errors (user not found, already added, etc.).

**Integration:**
- [ ] Register both users in Supabase.
- [ ] Add each other by username (not IP).
- [ ] Verify the friend's IP is resolved from Supabase and TCP connections work.

**Tutorials for this phase:**

*Supabase:*
- [Supabase Quick Start](https://supabase.com/docs/guides/getting-started)
  -- Set up a project, understand the dashboard.
- [Supabase REST API](https://supabase.com/docs/guides/api)
  -- How PostgREST works. This is the API your backend will call.
- [PostgREST API Reference](https://postgrest.org/en/stable/references/api.html)
  -- Detailed query syntax (eq., gt., lt., order, limit, etc.).
- [Supabase Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
  -- For future hardening.

*libcurl:*
- [libcurl - The Easy Interface](https://curl.se/libcurl/c/libcurl-easy.html)
  -- Start here. The "easy" API is for simple HTTP requests.
- [libcurl GET example](https://curl.se/libcurl/c/http-post.html)
- [libcurl POST with JSON body](https://curl.se/libcurl/c/http-post.html)
- [Everything curl](https://everything.curl.dev/) -- Free online book covering
  everything about curl and libcurl.
- Video: [libcurl Tutorial for Beginners](https://www.youtube.com/watch?v=PV-5y7kcYWw)

---

### Phase 3: Encryption & Signing

> **Goal:** All messages are end-to-end encrypted and signed. No more
> plaintext on the wire.

**Backend tasks (C++ developer):**
- [ ] Implement `CryptoManager`:
  - `init()` -- call `sodium_init()`.
  - `generate_keypair()` -- X25519 + Ed25519.
  - `save_keypair()` / `load_keypair()` -- persist to disk.
  - `encrypt()` / `decrypt()` -- `crypto_box_easy` / `crypto_box_open_easy`.
  - `sign()` / `verify()` -- `crypto_sign_detached` / `crypto_sign_verify_detached`.
- [ ] On startup: generate or load key pair. Upload public key to Supabase.
- [ ] When sending: encrypt then sign.
- [ ] When receiving: verify then decrypt.
- [ ] Store friend public keys locally (TOFU key pinning).
- [ ] Upload public key (not private!) to Supabase during registration.

**UI tasks (Python developer):**
- [ ] Show key fingerprint in friend details panel.
- [ ] Show warning dialog if a friend's key changes.
- [ ] Add "Verify Key" feature (display fingerprint for out-of-band comparison).

**Integration:**
- [ ] Verify encrypted messages flow correctly.
- [ ] Verify that a tampered message is rejected.
- [ ] Verify that a message from an unknown sender is rejected.

**Tutorials for this phase:**

*libsodium:*
- Start here: [libsodium Documentation](https://doc.libsodium.org/)
  -- Excellent, beginner-friendly docs with code examples.
- [Public-key Authenticated Encryption (crypto_box)](https://doc.libsodium.org/public-key_cryptography/authenticated_encryption)
  -- This is the main encryption function we use.
- [Public-key Signatures (crypto_sign)](https://doc.libsodium.org/public-key_cryptography/public-key_signatures)
  -- This is the signing function we use.
- [Generating Random Data](https://doc.libsodium.org/generating_random_data)
  -- How to generate nonces and random bytes.
- [Key Pair Generation](https://doc.libsodium.org/public-key_cryptography/authenticated_encryption#key-pair-generation)

*Cryptography concepts:*
- Video: [Computerphile - Diffie-Hellman Key Exchange](https://www.youtube.com/watch?v=NmM9HA2MQGI)
  -- Beautifully explains how two people can agree on a shared secret without
  anyone else knowing. X25519 is a modern version of this.
- Video: [Computerphile - End-to-End Encryption](https://www.youtube.com/watch?v=jkV1KEJGKRA)
  -- How E2EE works in real apps.
- Video: [Computerphile - Public Key Cryptography](https://www.youtube.com/watch?v=GSIDS_lvRv4)
  -- Explains public/private key pairs.
- [A Graduate Course in Applied Cryptography](https://toc.cryptobook.us/)
  -- Free textbook. Read Chapter 1 for concepts (skip the math if it's too heavy).

---

### Phase 4: Offline Messages via Supabase

> **Goal:** When a peer is offline, encrypted messages are stored in Supabase
> and delivered when they come back online.

**Backend tasks (C++ developer):**
- [ ] Detect peer offline (TCP connect timeout/refused).
- [ ] On send failure: push encrypted envelope to Supabase `messages` table.
- [ ] On startup: fetch all offline messages from Supabase for this user.
- [ ] Decrypt and verify each offline message.
- [ ] Store in local DB, delete from Supabase.
- [ ] Implement 7-day cleanup (DELETE old messages via REST API).

**UI tasks (Python developer):**
- [ ] Show delivery status: "Sent" (direct), "Pending" (offline), "Delivered."
- [ ] Show a clock icon for pending messages.
- [ ] Refresh messages on app startup (to show offline messages that arrived).

**Integration:**
- [ ] Send a message while the recipient is offline.
- [ ] Start the recipient's backend. Verify the message appears.
- [ ] Verify it was deleted from Supabase after delivery.

**Tutorials for this phase:**

*Supabase CRUD:*
- [Supabase - Insert Data](https://supabase.com/docs/guides/database/tables#insert-data)
- [Supabase - Read Data](https://supabase.com/docs/guides/database/tables#read-data)
- [Supabase - Delete Data](https://supabase.com/docs/guides/database/tables#delete-data)
- [PostgREST Filters](https://postgrest.org/en/stable/references/api/tables_views.html#horizontal-filtering)
  -- Learn eq., lt., gt., and other query operators.

---

### Phase 5: UI Polish

> **Goal:** Make the app look professional and feel good to use.

**UI tasks (Python developer):**
- [ ] Online/offline indicators (green/grey dots next to friends).
- [ ] Message timestamps displayed nicely ("2 minutes ago", "Yesterday").
- [ ] System tray icon (app minimizes to tray instead of closing).
- [ ] Desktop notifications (new message toast).
- [ ] Dark/light theme toggle (Qt stylesheets).
- [ ] Settings dialog (change username, ports, Supabase config).
- [ ] "Copy Key Fingerprint" button for out-of-band verification.
- [ ] Emoji support in messages.

**Backend tasks (C++ developer):**
- [ ] Rate limiting on peer connections and local API.
- [ ] Maximum message size enforcement.
- [ ] Graceful shutdown (close connections, flush DB).
- [ ] Better error responses from the API.
- [ ] Optional: shared secret for local API authentication.

**Tutorials for this phase:**

*Qt Styling:*
- [Qt Stylesheets Reference](https://doc.qt.io/qt-6/stylesheet-reference.html)
- [Qt Stylesheets Examples](https://doc.qt.io/qt-6/stylesheet-examples.html)
- [System Tray Icon in PySide6](https://doc.qt.io/qtforpython-6/PySide6/QtWidgets/QSystemTrayIcon.html)
- Video: [PySide6 Dark Theme Tutorial](https://www.youtube.com/results?search_query=pyside6+dark+theme)

---

## Learning Resources

Comprehensive resource list organized by topic. Start with the ones marked with
a star.

### C++ Fundamentals (if you're new to C++)

| Resource | Type | Link |
|---|---|---|
| **learncpp.com** | Tutorial site | https://www.learncpp.com/ |
| C++ Core Guidelines | Reference | https://isocpp.github.io/CppCoreGuidelines/ |
| The Cherno C++ Series | YouTube | https://www.youtube.com/playlist?list=PLlrATfBNZ98dudnM48yfGUldqGD0S4FFb |
| cppreference.com | Reference | https://en.cppreference.com/ |

### C++ Networking & ASIO

| Resource | Type | Link |
|---|---|---|
| **ASIO Official Tutorial** | Tutorial | https://think-async.com/Asio/asio-1.30.2/doc/asio/tutorial.html |
| **Beej's Guide to Network Programming** | Free book | https://beej.us/guide/bgnet/ |
| Boost.Asio C++ Network Programming (Book) | Book | https://www.packtpub.com/product/boost-asio-c-network-programming |
| The Cherno - C++ Networking | Video | https://www.youtube.com/watch?v=2hNdkYInj4g |

### libcurl & REST APIs

| Resource | Type | Link |
|---|---|---|
| **libcurl Easy Interface** | Docs | https://curl.se/libcurl/c/libcurl-easy.html |
| **libcurl Examples** | Code | https://curl.se/libcurl/c/example.html |
| Everything curl | Free book | https://everything.curl.dev/ |

### libsodium (Encryption & Signing)

| Resource | Type | Link |
|---|---|---|
| **libsodium Official Docs** | Docs | https://doc.libsodium.org/ |
| **Public-key Encryption (crypto_box)** | Docs | https://doc.libsodium.org/public-key_cryptography/authenticated_encryption |
| **Public-key Signatures (crypto_sign)** | Docs | https://doc.libsodium.org/public-key_cryptography/public-key_signatures |
| Computerphile - Diffie-Hellman | Video | https://www.youtube.com/watch?v=NmM9HA2MQGI |
| Computerphile - Public Key Crypto | Video | https://www.youtube.com/watch?v=GSIDS_lvRv4 |

### Python Fundamentals (if you're new to Python)

| Resource | Type | Link |
|---|---|---|
| **Python Official Tutorial** | Tutorial | https://docs.python.org/3/tutorial/ |
| Automate the Boring Stuff | Free book | https://automatetheboringstuff.com/ |
| Real Python | Tutorial site | https://realpython.com/ |

### Python UI (PySide6 / Qt)

| Resource | Type | Link |
|---|---|---|
| **Qt for Python Official** | Docs | https://doc.qt.io/qtforpython-6/ |
| **PySide6 Tutorials (Python GUIs)** | Tutorial | https://www.pythonguis.com/pyside6/ |
| Qt Widgets Tutorial | Tutorial | https://doc.qt.io/qtforpython-6/tutorials/basictutorial/widgets.html |
| Tech With Tim - PyQt6 | Video | https://www.youtube.com/watch?v=Cc5TAaetrig |

### SQLite (C++ and Python)

| Resource | Type | Link |
|---|---|---|
| **SQLite C/C++ Interface** | Docs | https://www.sqlite.org/cintro.html |
| **Python sqlite3 module** | Docs | https://docs.python.org/3/library/sqlite3.html |
| SQLite Tutorial | Tutorial | https://www.sqlitetutorial.net/ |
| SQLite QuickStart | Docs | https://www.sqlite.org/quickstart.html |

### Supabase

| Resource | Type | Link |
|---|---|---|
| **Supabase Getting Started** | Docs | https://supabase.com/docs/guides/getting-started |
| Supabase REST API | Docs | https://supabase.com/docs/guides/api |
| PostgREST API Reference | Docs | https://postgrest.org/en/stable/ |
| Supabase Row Level Security | Docs | https://supabase.com/docs/guides/auth/row-level-security |
| Supabase Free Tier Limits | Pricing | https://supabase.com/pricing |

### End-to-End Encryption & Security

| Resource | Type | Link |
|---|---|---|
| **Signal Protocol Overview** | Docs | https://signal.org/docs/ |
| Double Ratchet Algorithm | Spec | https://signal.org/docs/specifications/doubleratchet/ |
| Matrix E2EE Spec | Spec | https://spec.matrix.org/latest/client-server-api/#end-to-end-encryption |
| Computerphile - E2E Encryption | Video | https://www.youtube.com/watch?v=jkV1KEJGKRA |
| A Graduate Course in Applied Cryptography | Free book | https://toc.cryptobook.us/ |

### Build Tools

| Resource | Type | Link |
|---|---|---|
| **CMake Tutorial** | Docs | https://cmake.org/cmake/help/latest/guide/tutorial/ |
| Professional CMake (Book) | Book | https://crascit.com/professional-cmake/ |
| vcpkg Getting Started | Docs | https://learn.microsoft.com/en-us/vcpkg/get_started/ |

---

## Supabase Free Tier Guide

Supabase's free tier is generous for a project like this. Here's what you
need to know:

### Limits

| Resource | Free Tier Limit | Our Usage |
|---|---|---|
| Database size | 500 MB | We'll use < 1 MB (text data is tiny) |
| Bandwidth | 5 GB / month | Minimal (small JSON payloads) |
| API requests | Unlimited (fair use) | Heartbeats + offline messages |
| Edge Functions | 500K invocations / month | We don't use these |
| Realtime | 200 concurrent | We don't use realtime |
| Projects | 2 active | We need only 1 |
| Pausing | After 1 week of inactivity | See "Avoiding Auto-Pause" below |

### Avoiding Auto-Pause

Supabase **pauses** free-tier projects that have no activity for 7 days. When
paused, API calls fail until you manually unpause in the dashboard.

**Solution:** Your backend's heartbeat (updating `last_seen` every 60 seconds)
counts as activity. As long as at least one node is running, the project won't
pause.

**If it does pause:** Go to Supabase dashboard > your project > click "Restore."
It takes about 30 seconds.

### Best Practices

1. **Keep the messages table small:** Delete delivered messages promptly. Our
   7-day auto-cleanup ensures the table doesn't grow forever.

2. **Use UPSERT for registration:** When the backend starts, it should
   INSERT or UPDATE (UPSERT) the user record. This avoids duplicate key errors
   if the user already exists.
   ```sql
   -- PostgREST UPSERT:
   POST /rest/v1/users
   Headers: Prefer: resolution=merge-duplicates
   ```

3. **Minimize API calls:** Don't poll Supabase for offline messages in a loop.
   Fetch once on startup, and only when notified by a failed direct send.

4. **Don't store large data:** Our messages are small JSON strings. If you ever
   add file sharing, store files elsewhere (e.g., Supabase Storage) and only
   put the reference in the messages table.

---

## Team Workflow

This project is designed for a team of two. Here's how to split the work:

### Roles

| Role | Focus Areas | Primary Files |
|---|---|---|
| **Developer A** (C++ Backend) | Networking (ASIO), encryption (libsodium), Supabase client (libcurl), local API | `backend/src/`, `backend/include/` |
| **Developer B** (Python UI) | User interface (PySide6), backend service client, UX polish | `ui/` |
| **Both** | Protocol design, integration testing, documentation | `protocol/`, `README.md`, `ARCHITECTURE.md` |

### How to Collaborate

1. **Define the API contract first:** Before coding, agree on the exact JSON
   format for each endpoint. This is documented in `protocol/api_contract.md`.
   The C++ dev implements the server side; the Python dev implements the client.

2. **Mock the other side:** While the backend isn't ready, the Python dev can
   create a mock server (a simple Python HTTP server that returns fake responses).
   While the UI isn't ready, the C++ dev can test with `curl`.

3. **Integration milestones:** At the end of each phase, both developers test
   together to make sure everything connects properly.

### Git Workflow (Recommended)

```
main branch ---- always working code
  |
  +-- feature/peer-server ---- Developer A works here
  |
  +-- feature/main-window ---- Developer B works here
  |
  Merge to main when a feature works.
```

---

## FAQ / Troubleshooting

### Q: The backend won't compile!

**A:** Check the error message carefully.
- "libsodium not found" -> Install it (see Prerequisites).
- "ASIO not found" -> CMake should auto-download it. Check your internet.
- "C++20 features not supported" -> Update your compiler.
- On Windows: make sure you're using the Visual Studio Developer Command Prompt.

### Q: The UI shows "Cannot connect to backend"

**A:** The backend must be running before the UI. Start the backend first,
then the UI. Check that the port in `config.json` (api_port) matches what
`BackendService` is connecting to (default: 8080).

### Q: How do I test with two users on one machine?

**A:** Run two backend instances with different configs:
- Backend 1: `listen_port: 9100`, `api_port: 8080`, username: "alice"
- Backend 2: `listen_port: 9200`, `api_port: 8081`, username: "bob"

Run two UI instances connecting to different API ports:
- UI 1: `BackendService("http://127.0.0.1:8080")`
- UI 2: `BackendService("http://127.0.0.1:8081")`

### Q: Where is my Supabase anon key?

**A:** Supabase Dashboard > Settings > API > "anon public" key.

### Q: Is the anon key secret?

**A:** No, the "anon" key is designed to be public (like in a web browser).
It's safe in your config file. The "service_role" key IS secret -- never use
that in client code.

### Q: Can two people on different Wi-Fi networks connect?

**A:** You need **port forwarding** on your router. Forward your `listen_port`
(e.g., 9100) to your computer's local IP. This is a router-specific setting.
Alternatively, both connect to the same VPN (like Tailscale, which is free).

### Q: What if Supabase goes down?

**A:** Direct P2P connections still work (they don't need Supabase). You just
can't add new friends, resolve usernames, or send offline messages until
Supabase is back.

---

## License

This project is for educational purposes. Choose a license that fits your needs
(MIT, Apache 2.0, etc.).
