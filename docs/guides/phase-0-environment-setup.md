# Phase 0 — Environment Setup & Project Structure

> **Goal**: Get every tool installed, understand the project layout, and verify
> you can build both the C++ backend and the Tauri frontend from a clean checkout.
> This phase produces zero features but saves you hours of debugging later.

---

## Table of Contents

1. [Overview — What We're Building](#1-overview)
2. [Required Tools](#2-required-tools)
3. [Installing C++ Toolchain (Windows)](#3-installing-c-toolchain-windows)
4. [Installing C++ Toolchain (Linux)](#4-installing-c-toolchain-linux)
5. [Installing Backend Dependencies](#5-installing-backend-dependencies)
6. [Installing Node.js & Rust](#6-installing-nodejs--rust)
7. [Installing Frontend Dependencies](#7-installing-frontend-dependencies)
8. [Project Folder Structure Explained](#8-project-folder-structure-explained)
9. [Configuration Files](#9-configuration-files)
10. [Verifying Everything Works](#10-verifying-everything-works)
11. [Editor Setup & Recommendations](#11-editor-setup--recommendations)
12. [Learning Resources for Phase 0](#12-learning-resources)
13. [Common Pitfalls](#13-common-pitfalls)

---

## 1. Overview

Our P2P chat app has three layers:

```
┌─────────────────────────────────────────────────────┐
│  Tauri Window (Desktop App)                         │
│  ┌───────────────────────────────────────────────┐  │
│  │  React Frontend (TypeScript)                  │  │
│  │  - All UI rendering, user interaction         │  │
│  │  - Talks to backend via localhost HTTP + WS   │  │
│  └──────────────────┬────────────────────────────┘  │
│                     │ HTTP :8080 / WS :8081         │
│  ┌──────────────────▼────────────────────────────┐  │
│  │  C++ Backend (Sidecar Process)                │  │
│  │  - P2P networking (ASIO, TCP :9100)           │  │
│  │  - Encryption (libsodium)                     │  │
│  │  - Supabase REST calls (libcurl)              │  │
│  │  - Local storage (SQLite)                     │  │
│  └──────────────────┬────────────────────────────┘  │
│                     │ HTTPS                         │
│  ┌──────────────────▼────────────────────────────┐  │
│  │  Supabase (Cloud)                             │  │
│  │  - User directory (username → IP + public key)│  │
│  │  - Offline message store (encrypted)          │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

**Why this architecture?**
- The backend does ALL the hard work (networking, crypto, database calls).
- The frontend is purely visual — it never touches encryption or network sockets.
- Supabase is a thin "phone book" — it just helps users find each other.

---

## 2. Required Tools

| Tool | Version | Purpose | Download |
|------|---------|---------|----------|
| **Visual Studio** (Windows) | 2022+ | C++ compiler (MSVC) | [visualstudio.microsoft.com](https://visualstudio.microsoft.com/) |
| **GCC/Clang** (Linux) | 12+ | C++ compiler | `sudo apt install build-essential` |
| **CMake** | 3.20+ | C++ build system | [cmake.org/download](https://cmake.org/download/) |
| **vcpkg** or manual install | Latest | C++ package manager | [github.com/microsoft/vcpkg](https://github.com/microsoft/vcpkg) |
| **Node.js** | 20 LTS+ | Frontend tooling (npm, vite) | [nodejs.org](https://nodejs.org/) |
| **Rust** | Latest stable | Tauri runtime | [rustup.rs](https://rustup.rs/) |
| **Git** | 2.x | Version control | [git-scm.com](https://git-scm.com/) |
| **VS Code** | Latest | Code editor (recommended) | [code.visualstudio.com](https://code.visualstudio.com/) |

---

## 3. Installing C++ Toolchain (Windows)

### Step 1: Install Visual Studio 2022

1. Download **Visual Studio 2022 Community** (free) from [visualstudio.microsoft.com](https://visualstudio.microsoft.com/)
2. In the installer, check **"Desktop development with C++"**
3. Make sure these individual components are selected:
   - MSVC v143 build tools
   - Windows 10/11 SDK
   - CMake tools for Windows
4. Click Install (this takes 5-10 GB)

**Why Visual Studio?** It includes the MSVC compiler, which is the standard C++ compiler on Windows. CMake will use it automatically.

### Step 2: Install CMake (if not included)

```powershell
# Check if cmake is available
cmake --version

# If not, download from cmake.org or use winget:
winget install Kitware.CMake
```

### Step 3: Install vcpkg (C++ Package Manager)

vcpkg makes installing C++ libraries painless:

```powershell
# Clone vcpkg to a permanent location
cd C:\dev
git clone https://github.com/microsoft/vcpkg.git
cd vcpkg

# Bootstrap it
.\bootstrap-vcpkg.bat

# Set environment variable (add to your PATH permanently)
$env:VCPKG_ROOT = "C:\dev\vcpkg"
[Environment]::SetEnvironmentVariable("VCPKG_ROOT", "C:\dev\vcpkg", "User")
```

**Why vcpkg?** Installing C++ libraries manually on Windows is painful. vcpkg downloads, compiles, and links them for you.

> 📺 **Video**: [vcpkg in 5 Minutes — Microsoft](https://www.youtube.com/watch?v=b7SdgK7Y510)

---

## 4. Installing C++ Toolchain (Linux)

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install -y build-essential cmake git pkg-config

# Verify
g++ --version    # Should show 12+
cmake --version  # Should show 3.20+
```

**Why `build-essential`?** It's a meta-package that installs `gcc`, `g++`, `make`, and other essentials.

---

## 5. Installing Backend Dependencies

These are the C++ libraries our backend uses. Some are fetched by CMake automatically (header-only), others need system install.

### Libraries Fetched Automatically by CMake (FetchContent)

These require NO manual installation — CMake downloads them during build:

| Library | What It Does |
|---------|-------------|
| **nlohmann/json** | Parse and create JSON objects in C++ |
| **spdlog** | Fast, pretty logging with colors |
| **ASIO** (standalone) | Async networking (TCP sockets) without Boost |

### Libraries You Must Install

#### libsodium (Encryption)

```powershell
# Windows (vcpkg)
vcpkg install libsodium:x64-windows

# Linux
sudo apt install libsodium-dev
```

**Why libsodium?** It's the gold standard for easy-to-use cryptography. Unlike OpenSSL, it's nearly impossible to misuse.

> 📖 **Docs**: [doc.libsodium.org](https://doc.libsodium.org/)
> 📺 **Video**: [Intro to libsodium — Coding Tech](https://www.youtube.com/watch?v=jE5vKgbJ0F0)

#### libcurl (HTTP Client)

```powershell
# Windows (vcpkg)
vcpkg install curl:x64-windows

# Linux
sudo apt install libcurl4-openssl-dev
```

**Why libcurl?** It's the most widely-used HTTP client library in the world. We use it to call Supabase REST APIs.

> 📖 **Docs**: [curl.se/libcurl](https://curl.se/libcurl/)
> 📺 **Video**: [libcurl C++ Tutorial — Jacob Sorber](https://www.youtube.com/watch?v=q_ZpxCBMag0)

#### SQLite3 (Local Database)

```powershell
# Windows (vcpkg)
vcpkg install sqlite3:x64-windows

# Linux
sudo apt install libsqlite3-dev
```

**Why SQLite?** It's a zero-setup embedded database stored in a single file. Perfect for local chat history.

> 📖 **Docs**: [sqlite.org/cintro.html](https://www.sqlite.org/cintro.html)
> 📺 **Video**: [SQLite in C++ — The Cherno](https://www.youtube.com/watch?v=GRFG_xQsma0)

### Verify Backend Build

```powershell
cd backend
mkdir build && cd build
cmake .. -DCMAKE_TOOLCHAIN_FILE="C:/dev/vcpkg/scripts/buildsystems/vcpkg.cmake"
cmake --build . --config Release
```

If this produces `secure-p2p-chat-backend.exe`, you're good!

**Linux:**
```bash
cd backend
mkdir build && cd build
cmake ..
cmake --build .
```

---

## 6. Installing Node.js & Rust

### Node.js

```powershell
# Windows — download LTS from nodejs.org, or:
winget install OpenJS.NodeJS.LTS

# Linux
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node --version   # v20.x+
npm --version    # 10.x+
```

### Rust (for Tauri)

```powershell
# All platforms — use rustup
# Windows: download from https://rustup.rs/
# Linux:
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# After install, restart terminal, then verify:
rustc --version   # 1.75+
cargo --version
```

**Why Rust?** Tauri's core is written in Rust. You don't need to write Rust code — it just needs to be installed for compilation.

> 📖 **Tauri Prerequisites**: [v2.tauri.app/start/prerequisites](https://v2.tauri.app/start/prerequisites/)

### Linux Additional Dependencies (for Tauri)

```bash
sudo apt install -y libwebkit2gtk-4.1-dev libgtk-3-dev \
  libayatana-appindicator3-dev librsvg2-dev
```

---

## 7. Installing Frontend Dependencies

```powershell
cd ui-tauri
npm install --legacy-peer-deps
```

**Why `--legacy-peer-deps`?** React 19 has a peer dependency conflict with `emoji-mart`. This flag tells npm to install anyway. It's safe — the libraries work fine together.

### Verify Frontend Build

```powershell
# TypeScript check (should show no errors)
npx tsc --noEmit

# Vite build (should produce dist/ folder)
npx vite build

# Full Tauri dev (opens the app window)
# Make sure Rust is in PATH first:
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
npm run tauri dev
```

---

## 8. Project Folder Structure Explained

```
p2pApp/
│
├── backend/                    # C++20 backend — ALL logic lives here
│   ├── src/
│   │   ├── main.cpp            # Entry point: loads config, starts services
│   │   ├── api/
│   │   │   └── local_api.cpp   # HTTP server on :8080 for frontend
│   │   ├── network/
│   │   │   ├── peer_server.cpp # Accepts TCP from other peers (:9100)
│   │   │   └── peer_client.cpp # Connects to peers, sends messages
│   │   ├── node/
│   │   │   └── node.cpp        # Core app logic: friends, messages
│   │   ├── crypto/
│   │   │   └── crypto_manager.cpp  # libsodium encrypt/decrypt/sign
│   │   └── supabase/
│   │       └── supabase_client.cpp # REST calls to Supabase via libcurl
│   │
│   ├── include/                # Header files (.h) — class declarations
│   │   ├── api/local_api.h
│   │   ├── network/peer_server.h, peer_client.h
│   │   ├── node/node.h
│   │   ├── crypto/crypto_manager.h
│   │   ├── supabase/supabase_client.h
│   │   ├── nlohmann/           # Header-only JSON library
│   │   └── spdlog/             # Header-only logging library
│   │
│   ├── CMakeLists.txt          # Build configuration
│   └── config.example.json     # Template for runtime config
│
├── ui-tauri/                   # Tauri + React frontend — UI only
│   ├── src/
│   │   ├── main.tsx            # React entry point
│   │   ├── App.tsx             # Root component
│   │   ├── components/
│   │   │   ├── layout/         # AppShell, TitleBar, Sidebar
│   │   │   ├── chat/           # ChatPanel, MessageBubble, ComposeArea
│   │   │   ├── contacts/       # ContactList, ContactItem, AddFriendDialog
│   │   │   ├── emoji/          # EmojiPicker, ReactionBar
│   │   │   └── common/         # Avatar, Badge, ThemeToggle
│   │   ├── stores/             # Zustand state (chatStore, contactStore, uiStore)
│   │   ├── services/           # api.ts (REST), websocket.ts (WS)
│   │   ├── hooks/              # React hooks (useWebSocket, useContacts, etc)
│   │   ├── types/              # TypeScript interfaces
│   │   ├── lib/                # Utilities, constants, animation variants
│   │   └── styles/             # CSS modules (theme, layout, chat, etc)
│   │
│   ├── src-tauri/              # Tauri Rust backend (minimal, just config)
│   │   ├── src/lib.rs
│   │   ├── Cargo.toml
│   │   └── tauri.conf.json     # Window settings, sidecar config
│   │
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
│
├── protocol/                   # Protocol specifications
│   ├── message_format.md       # Wire format for P2P messages
│   ├── api_contract.md         # REST API between frontend ↔ backend
│   └── threat_model.md         # Security considerations
│
├── docs/                       # Detailed documentation
│   ├── guides/                 # ← YOU ARE HERE (phase guides)
│   ├── backend/                # C++ library tutorials
│   ├── frontend/               # UI development guides
│   └── infrastructure/         # Supabase setup, environment
│
├── README.md
└── ARCHITECTURE.md
```

### Why This Structure?

| Decision | Reasoning |
|----------|-----------|
| Backend and frontend are separate folders | They use different languages and build systems |
| `include/` separate from `src/` | Standard C++ convention — headers declare, sources implement |
| `stores/` separate from `components/` | Separates data logic from rendering logic |
| `services/` for API calls | Single place to change if backend URLs change |
| `protocol/` at root level | Shared spec between backend and frontend teams |

---

## 9. Configuration Files

### Backend: `config.json`

Copy `config.example.json` and fill in your values:

```json
{
    "node": {
        "username": "alice",
        "listen_port": 9100,
        "api_port": 8080
    },
    "supabase": {
        "url": "https://abcdefgh.supabase.co",
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

| Field | What It Does |
|-------|-------------|
| `username` | Your unique identity in the chat network |
| `listen_port` | Port other peers connect to (TCP) |
| `api_port` | Port the frontend connects to (HTTP REST) |
| `supabase.url` | Your Supabase project URL |
| `supabase.anon_key` | Public API key from Supabase dashboard |
| `local_db_path` | Where SQLite stores your chat history |

### Frontend: `ui-tauri/src/lib/constants.ts`

```typescript
export const API_BASE_URL = "http://127.0.0.1:8080";   // Must match api_port
export const WS_URL = "ws://127.0.0.1:8081/events";    // WebSocket events
export const MESSAGE_PAGE_SIZE = 50;
export const TYPING_DEBOUNCE_MS = 1000;
export const TYPING_TIMEOUT_MS = 5000;
export const WS_RECONNECT_DELAY_MS = 3000;
export const WS_MAX_RECONNECT_ATTEMPTS = 10;
```

**⚠️ Important**: If you change `api_port` in the backend config, you MUST also change `API_BASE_URL` here.

---

## 10. Verifying Everything Works

Run this checklist after setup:

```powershell
# 1. C++ compiler
cmake --version            # 3.20+
cl.exe 2>&1 | Select-String "Version"  # Windows (from VS Developer Terminal)
# OR on Linux: g++ --version

# 2. Backend build
cd backend && mkdir build && cd build
cmake ..
cmake --build .
cd ../..

# 3. Node.js
node --version             # 20+
npm --version              # 10+

# 4. Rust
rustc --version            # 1.75+
cargo --version

# 5. Frontend build
cd ui-tauri
npm install --legacy-peer-deps
npx tsc --noEmit           # Zero errors
npx vite build             # Produces dist/

# 6. Tauri dev (opens a window)
npm run tauri dev
```

If step 6 opens a window with the chat UI, everything is working!

---

## 11. Editor Setup & Recommendations

### VS Code Extensions

| Extension | Why |
|-----------|-----|
| **C/C++** (Microsoft) | IntelliSense, debugging for backend |
| **CMake Tools** (Microsoft) | Build C++ projects from VS Code |
| **ES7+ React Snippets** | Faster React component creation |
| **Tailwind CSS IntelliSense** | Autocomplete for CSS classes |
| **rust-analyzer** | Rust support (needed for Tauri) |
| **Prettier** | Auto-format TypeScript/CSS |
| **Error Lens** | Shows errors inline (very helpful) |

### VS Code Settings

Add to `.vscode/settings.json`:

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "typescript.preferences.importModuleSpecifier": "non-relative",
  "cmake.configureOnOpen": true,
  "files.exclude": {
    "**/node_modules": true,
    "**/dist": true,
    "**/build": true,
    "**/target": true
  }
}
```

---

## 12. Learning Resources

### C++ Fundamentals (if you're new)

| Resource | Type | Link |
|----------|------|------|
| **The Cherno — C++ Series** | 📺 YouTube (100+ videos) | [youtube.com/playlist?list=PLlrATfBNZ98dudnM48yfGUldqGD0S4FFb](https://www.youtube.com/playlist?list=PLlrATfBNZ98dudnM48yfGUldqGD0S4FFb) |
| **learncpp.com** | 📖 Free online textbook | [learncpp.com](https://www.learncpp.com/) |
| **C++ Reference** | 📖 API reference | [cppreference.com](https://en.cppreference.com/) |
| **Compiler Explorer (Godbolt)** | 🔧 Test C++ snippets online | [godbolt.org](https://godbolt.org/) |

### CMake

| Resource | Type | Link |
|----------|------|------|
| **CMake Tutorial (official)** | 📖 Step-by-step | [cmake.org/cmake/help/latest/guide/tutorial](https://cmake.org/cmake/help/latest/guide/tutorial/index.html) |
| **An Introduction to Modern CMake** | 📖 Guide | [cliutils.gitlab.io/modern-cmake](https://cliutils.gitlab.io/modern-cmake/) |
| **The Cherno — CMake** | 📺 YouTube | [youtube.com/watch?v=HUpofVOGwgA](https://www.youtube.com/watch?v=HUpofVOGwgA) |

### TypeScript & React

| Resource | Type | Link |
|----------|------|------|
| **React Official Tutorial** | 📖 Interactive | [react.dev/learn](https://react.dev/learn) |
| **TypeScript Handbook** | 📖 Official docs | [typescriptlang.org/docs/handbook](https://www.typescriptlang.org/docs/handbook/intro.html) |
| **Jack Herrington — React 19** | 📺 YouTube | [youtube.com/@jherr](https://www.youtube.com/@jherr) |
| **Fireship — React in 100 Seconds** | 📺 YouTube | [youtube.com/watch?v=Tn6-PIqc4UM](https://www.youtube.com/watch?v=Tn6-PIqc4UM) |

### Tauri

| Resource | Type | Link |
|----------|------|------|
| **Tauri v2 Official Guide** | 📖 Docs | [v2.tauri.app](https://v2.tauri.app/) |
| **Tauri + React Tutorial** | 📺 YouTube | [youtube.com/watch?v=PZstfIq3CHk](https://www.youtube.com/watch?v=PZstfIq3CHk) |
| **Awesome Tauri** | 📖 Resource list | [github.com/tauri-apps/awesome-tauri](https://github.com/tauri-apps/awesome-tauri) |

---

## 13. Common Pitfalls

### ❌ "CMake can't find libsodium"

**Fix**: Make sure you pass the vcpkg toolchain file:
```powershell
cmake .. -DCMAKE_TOOLCHAIN_FILE="C:/dev/vcpkg/scripts/buildsystems/vcpkg.cmake"
```

### ❌ "npm install fails with peer dependency errors"

**Fix**: Always use `--legacy-peer-deps`:
```powershell
npm install --legacy-peer-deps
```

### ❌ "cargo not found" after installing Rust

**Fix**: Restart your terminal, or manually add to PATH:
```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
```

### ❌ "Tauri dev shows white screen"

**Fix**: The Vite dev server hasn't started yet. Wait 5-10 seconds. If it persists, check that `vite.config.ts` has the correct port.

### ❌ "Port 8080 already in use"

**Fix**: Another process is using the port. Change `api_port` in your backend config AND `API_BASE_URL` in `constants.ts`.

---

**Next: [Phase 1 — Plaintext P2P Chat →](./phase-1-plaintext-p2p.md)**
