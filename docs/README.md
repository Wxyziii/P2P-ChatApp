# 📚 Documentation Index

> All guides contain **detailed code examples** you can reference while building the app.
> Read them in order within each section, or jump to what you need.

---

## 🔧 Backend (C++)

| # | Guide | What You'll Learn |
|---|-------|-------------------|
| 01 | [CMake Build System](backend/01-cmake-build-system.md) | How to build the project, FetchContent, vcpkg, common build errors |
| 02 | [ASIO Networking](backend/02-asio-networking.md) | TCP server/client, length-prefixed protocol, async patterns |
| 03 | [HTTP Server API](backend/03-http-server-api.md) | Local REST API with cpp-httplib, routing, JSON responses |
| 04 | [libcurl & Supabase](backend/04-libcurl-supabase.md) | HTTP client, GET/POST/PATCH/DELETE, PostgREST queries |
| 05 | [libsodium Crypto](backend/05-libsodium-crypto.md) | Key generation, encrypt/decrypt, sign/verify, Base64 |
| 06 | [SQLite Database](backend/06-sqlite-database.md) | Local storage, CRUD operations, parameterized queries |
| 07 | [nlohmann/json](backend/07-nlohmann-json.md) | Creating, parsing, and manipulating JSON in C++ |
| 08 | [spdlog Logging](backend/08-spdlog-logging.md) | Log levels, file logging, our logging strategy |

## 🎨 Frontend (Python)

| # | Guide | What You'll Learn |
|---|-------|-------------------|
| 01 | [PySide6 Basics](frontend/01-pyside6-basics.md) | Widgets, layouts, signals/slots, styling, chat window |
| 02 | [Backend Service](frontend/02-backend-service.md) | HTTP client, requests library, mock backend |
| 03 | [Threading & Async](frontend/03-threading-async.md) | QThread, workers, polling, keeping UI responsive |
| 04 | [UI Polish](frontend/04-ui-polish.md) | System tray, dark theme, chat bubbles, settings dialog |

## 🏗️ Infrastructure

| # | Guide | What You'll Learn |
|---|-------|-------------------|
| 01 | [Supabase Setup](infrastructure/01-supabase-setup.md) | Account creation, table schema, RLS, curl testing |
| 02 | [Environment Setup](infrastructure/02-environment-setup.md) | Windows/Linux/macOS setup, IDE config, Git workflow |

## 🧭 General Guides

| # | Guide | What You'll Learn |
|---|-------|-------------------|
| 01 | [Debugging Tips](guides/01-debugging-tips.md) | GDB, VS debugger, curl, Wireshark, common errors |
| 02 | [Testing Guide](guides/02-testing-guide.md) | Test strategies for each phase, integration tests |
| 03 | [Common Pitfalls](guides/03-common-pitfalls.md) | Mistakes beginners make and how to avoid them |

## 📋 Protocol & Architecture

| Document | What It Covers |
|----------|----------------|
| [README.md](../README.md) | Project overview, setup, roadmap, learning resources |
| [ARCHITECTURE.md](../ARCHITECTURE.md) | System design, data flows, component interactions |
| [Message Format](../protocol/message_format.md) | Wire protocol, JSON format, encryption details |
| [API Contract](../protocol/api_contract.md) | Backend HTTP endpoints, request/response formats |
| [Threat Model](../protocol/threat_model.md) | Security analysis, attack vectors, mitigations |

---

## 📖 Suggested Reading Order

### If you're working on the **C++ backend**:
1. `infrastructure/02-environment-setup.md` — Set up your dev environment
2. `backend/01-cmake-build-system.md` — Understand the build
3. `backend/08-spdlog-logging.md` — Add logging first
4. `backend/07-nlohmann-json.md` — JSON handling
5. `backend/02-asio-networking.md` — TCP networking
6. `backend/03-http-server-api.md` — REST API for UI
7. `backend/06-sqlite-database.md` — Local storage
8. `backend/04-libcurl-supabase.md` — Supabase integration
9. `backend/05-libsodium-crypto.md` — Encryption (Phase 3)

### If you're working on the **Python UI**:
1. `infrastructure/02-environment-setup.md` — Set up your dev environment
2. `frontend/01-pyside6-basics.md` — Learn Qt widgets
3. `frontend/02-backend-service.md` — HTTP client + mock backend
4. `frontend/03-threading-async.md` — Keep UI responsive
5. `frontend/04-ui-polish.md` — Make it look good

### For both developers:
1. `infrastructure/01-supabase-setup.md` — Set up the database together
2. `guides/03-common-pitfalls.md` — Read before you start coding!
3. `guides/01-debugging-tips.md` — When things go wrong
4. `guides/02-testing-guide.md` — How to verify each phase
