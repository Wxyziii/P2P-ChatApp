# CMake Build System Guide

> Everything you need to know about building the C++ backend with CMake.

---

## Table of Contents

1. [What is CMake?](#1-what-is-cmake)
2. [Our CMakeLists.txt Explained Line by Line](#2-our-cmakeliststxt-explained-line-by-line)
3. [Building the Project](#3-building-the-project)
4. [FetchContent — Auto-Downloading Dependencies](#4-fetchcontent--auto-downloading-dependencies)
5. [Finding System Libraries](#5-finding-system-libraries)
6. [Adding New Source Files](#6-adding-new-source-files)
7. [Build Types (Debug vs Release)](#7-build-types-debug-vs-release)
8. [Using vcpkg on Windows](#8-using-vcpkg-on-windows)
9. [Common Build Errors and Fixes](#9-common-build-errors-and-fixes)
10. [Tips & Tricks](#10-tips--tricks)

---

## 1. What is CMake?

CMake is a **build system generator**. It doesn't compile your code directly —
it generates the actual build files for your platform:

- On **Windows**: generates Visual Studio project files (`.sln`, `.vcxproj`)
- On **Linux**: generates Makefiles
- On **macOS**: generates Xcode projects or Makefiles

```
You write:  CMakeLists.txt  (one config for all platforms)
    |
    v
CMake generates:  Makefile / .sln / build.ninja  (platform-specific)
    |
    v
Compiler builds:  your-executable  (the actual binary)
```

**Why not just use g++ directly?**
For a tiny project with one file, `g++ main.cpp -o app` works fine. But our
project has:
- 7+ source files across multiple directories
- 6+ external libraries to link
- Header include paths to configure
- Platform-specific settings (Windows needs ws2_32 for sockets)

CMake handles all of this with one configuration file.

---

## 2. Our CMakeLists.txt Explained Line by Line

Here's our complete CMakeLists.txt with detailed comments:

```cmake
# ──────────────────────────────────────────────────────────────
# Minimum CMake version required.
# 3.20 gives us FetchContent improvements and C++20 support.
# If someone has an older CMake, they'll get a clear error message.
cmake_minimum_required(VERSION 3.20)

# ──────────────────────────────────────────────────────────────
# Project name and language.
# LANGUAGES CXX means "this project uses C++ only" (no C, Fortran, etc.)
project(secure-p2p-chat-backend LANGUAGES CXX)

# ──────────────────────────────────────────────────────────────
# Enable C++20 standard.
# CMAKE_CXX_STANDARD_REQUIRED ON means: fail if the compiler doesn't
# support C++20 (don't silently fall back to an older standard).
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ──────────────────────────────────────────────────────────────
# Generate compile_commands.json — used by IDEs and language servers
# (clangd, VS Code C++ extension) for code navigation and autocomplete.
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
```

### FetchContent section:

```cmake
# ──────────────────────────────────────────────────────────────
# FetchContent lets CMake download dependencies during configuration.
# No need to manually clone repos or install libraries for these.
include(FetchContent)

# nlohmann/json — header-only JSON library
FetchContent_Declare(
    json                                              # internal name
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG        v3.11.3                            # pinned version
)
FetchContent_MakeAvailable(json)
# After this, you can use: target_link_libraries(... nlohmann_json::nlohmann_json)

# spdlog — fast logging library
FetchContent_Declare(
    spdlog
    GIT_REPOSITORY https://github.com/gabime/spdlog.git
    GIT_TAG        v1.13.0
)
FetchContent_MakeAvailable(spdlog)
# After this: target_link_libraries(... spdlog::spdlog)

# ASIO — standalone (non-Boost) async I/O library
FetchContent_Declare(
    asio
    GIT_REPOSITORY https://github.com/chriskohlhoff/asio.git
    GIT_TAG        asio-1-30-2
)
FetchContent_MakeAvailable(asio)

# ASIO is header-only but needs include paths and a define.
# We create an INTERFACE library (no compiled code, just settings).
add_library(asio INTERFACE)
target_include_directories(asio INTERFACE ${asio_SOURCE_DIR}/asio/include)
target_compile_definitions(asio INTERFACE ASIO_STANDALONE)
# ASIO_STANDALONE tells ASIO we're NOT using Boost.
```

### System libraries section:

```cmake
# ──────────────────────────────────────────────────────────────
# These libraries must be installed on your system.
# CMake will search for them; if not found, you get an error.

# pkg-config is a helper tool on Linux/macOS for finding libraries.
find_package(PkgConfig QUIET)

# libsodium — crypto library
if(PkgConfig_FOUND)
    pkg_check_modules(SODIUM REQUIRED libsodium)
else()
    # Fallback for Windows / systems without pkg-config
    find_library(SODIUM_LIBRARIES NAMES sodium)
    find_path(SODIUM_INCLUDE_DIRS sodium.h)
    if(NOT SODIUM_LIBRARIES OR NOT SODIUM_INCLUDE_DIRS)
        message(FATAL_ERROR "libsodium not found. Install it or set SODIUM_ROOT.")
    endif()
endif()

# libcurl — HTTP client
find_package(CURL REQUIRED)
# After this: CURL::libcurl is available as a target.

# SQLite3
find_package(SQLite3 REQUIRED)
# After this: SQLite::SQLite3 is available as a target.
```

### Source files and linking:

```cmake
# ──────────────────────────────────────────────────────────────
# List every .cpp file in the project.
# When you add a new .cpp file, ADD IT HERE.
set(SOURCES
    src/main.cpp
    src/node/node.cpp
    src/crypto/crypto_manager.cpp
    src/network/peer_server.cpp
    src/network/peer_client.cpp
    src/supabase/supabase_client.cpp
    src/api/local_api.cpp
)

# Create an executable target from these sources.
add_executable(${PROJECT_NAME} ${SOURCES})

# Tell the compiler where to find our header files.
target_include_directories(${PROJECT_NAME} PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include    # our headers
    ${SODIUM_INCLUDE_DIRS}                  # libsodium headers
)

# Link all libraries to our executable.
target_link_libraries(${PROJECT_NAME} PRIVATE
    nlohmann_json::nlohmann_json    # JSON parsing
    spdlog::spdlog                  # Logging
    asio                            # Networking
    ${SODIUM_LIBRARIES}             # Crypto
    CURL::libcurl                   # HTTP client
    SQLite::SQLite3                 # Database
)

# Windows needs Winsock libraries for networking.
if(WIN32)
    target_link_libraries(${PROJECT_NAME} PRIVATE ws2_32 wsock32)
endif()
```

---

## 3. Building the Project

### First-time build:

```bash
cd backend

# Step 1: Configure (generate build files)
# -B build       = put build files in ./build/ directory
# -DCMAKE_BUILD_TYPE=Debug  = include debug symbols (for debugging)
cmake -B build -DCMAKE_BUILD_TYPE=Debug

# Step 2: Compile
cmake --build build

# Step 3: Run
./build/secure-p2p-chat-backend              # Linux/macOS
.\build\Debug\secure-p2p-chat-backend.exe    # Windows
```

### Rebuilding after code changes:

```bash
# You only need step 2 again — CMake is smart enough to only
# recompile files that changed.
cmake --build build
```

### Rebuilding after CMakeLists.txt changes:

```bash
# If you changed CMakeLists.txt (added a file, changed a library),
# re-run configuration first:
cmake -B build -DCMAKE_BUILD_TYPE=Debug
cmake --build build
```

### Clean build (when things go wrong):

```bash
# Delete the build directory and start fresh
rm -rf build                  # Linux/macOS
Remove-Item -Recurse build    # PowerShell (Windows)

cmake -B build -DCMAKE_BUILD_TYPE=Debug
cmake --build build
```

---

## 4. FetchContent — Auto-Downloading Dependencies

FetchContent downloads libraries from Git during the **configure** step
(when you run `cmake -B build`). The first configure is slow (downloading);
subsequent ones are fast (cached).

### How to add a new FetchContent dependency:

```cmake
FetchContent_Declare(
    my_library_name                              # pick any name (used internally)
    GIT_REPOSITORY https://github.com/user/repo.git
    GIT_TAG        v1.0.0                        # ALWAYS pin a version!
)
FetchContent_MakeAvailable(my_library_name)

# Then link it:
target_link_libraries(${PROJECT_NAME} PRIVATE my_library_name::my_library_name)
```

### ⚠️ Watch Out

- **Always pin a version** with `GIT_TAG`. Using `main` means your build could
  break when the library updates.
- **FetchContent downloads are cached** in `build/_deps/`. Delete `build/` to
  force a re-download.
- **Large libraries** (like Boost) should NOT use FetchContent — they're too big.
  Use system package managers instead.

---

## 5. Finding System Libraries

For libraries that must be pre-installed (libsodium, libcurl, SQLite3):

### On Linux (Arch Linux — pacman):
```bash
sudo pacman -S libsodium curl sqlite
```

### On Linux (Ubuntu/Debian — apt):
```bash
sudo apt install libsodium-dev libcurl4-openssl-dev libsqlite3-dev
```

### On macOS (Homebrew):
```bash
brew install libsodium curl sqlite
```

### On Windows (vcpkg):
```bash
vcpkg install libsodium curl sqlite3
# Then tell CMake about vcpkg:
cmake -B build -DCMAKE_TOOLCHAIN_FILE=C:/path/to/vcpkg/scripts/buildsystems/vcpkg.cmake
```

---

## 6. Adding New Source Files

When you create a new `.cpp` file:

1. Create the file in the correct `src/` subdirectory.
2. Create a corresponding `.h` file in the `include/` subdirectory.
3. **Add the .cpp to the SOURCES list** in CMakeLists.txt:

```cmake
set(SOURCES
    src/main.cpp
    src/node/node.cpp
    # ... existing files ...
    src/my_new/my_new_module.cpp    # ← ADD THIS
)
```

4. Re-run `cmake --build build`.

**Forgetting step 3 is the #1 beginner mistake.** You'll get "undefined
reference" linker errors because the new file wasn't compiled.

---

## 7. Build Types (Debug vs Release)

```bash
# Debug: includes debug symbols, no optimization.
# Use during development for debugging with GDB/LLDB/Visual Studio.
cmake -B build -DCMAKE_BUILD_TYPE=Debug

# Release: full optimization, no debug symbols.
# Use for the final binary you give to users.
cmake -B build -DCMAKE_BUILD_TYPE=Release

# RelWithDebInfo: optimized but with debug symbols.
# Best of both worlds — use if Release crashes and you need to debug.
cmake -B build -DCMAKE_BUILD_TYPE=RelWithDebInfo
```

---

## 8. Using vcpkg on Windows

vcpkg is a C++ package manager that makes Windows development MUCH easier.

### Install vcpkg:
```bash
git clone https://github.com/microsoft/vcpkg.git C:\vcpkg
cd C:\vcpkg
.\bootstrap-vcpkg.bat
```

### Install our dependencies:
```bash
.\vcpkg install libsodium:x64-windows curl:x64-windows sqlite3:x64-windows
```

### Use with CMake:
```bash
cmake -B build -DCMAKE_TOOLCHAIN_FILE=C:\vcpkg\scripts\buildsystems\vcpkg.cmake
cmake --build build
```

### 💡 Tip: Set a system environment variable
```
VCPKG_ROOT=C:\vcpkg
CMAKE_TOOLCHAIN_FILE=C:\vcpkg\scripts\buildsystems\vcpkg.cmake
```
Then you don't need to pass `-DCMAKE_TOOLCHAIN_FILE` every time.

---

## 9. Common Build Errors and Fixes

### "libsodium not found"
```
CMake Error: libsodium not found. Install it or set SODIUM_ROOT.
```
**Fix:** Install libsodium (see Section 5). On Windows with vcpkg, make sure
you passed the toolchain file.

### "undefined reference to ..."
```
undefined reference to `Node::send_message(...)'
```
**Fix:** You forgot to add the `.cpp` file to the SOURCES list in CMakeLists.txt.

### "cannot find -lsodium"
```
/usr/bin/ld: cannot find -lsodium
```
**Fix:** libsodium is installed but the linker can't find it. Try:
```bash
sudo ldconfig  # refresh linker cache (Linux)
```

### "C++20 not supported"
```
error: 'std::format' is not a member of 'std'
```
**Fix:** Your compiler is too old. Update to GCC 12+, Clang 15+, or MSVC 19.30+.

### FetchContent download fails
```
fatal: unable to connect to github.com
```
**Fix:** Check your internet connection. If behind a proxy, configure Git:
```bash
git config --global http.proxy http://proxy:port
```

---

## 10. Tips & Tricks

### Parallel builds (faster compilation):
```bash
cmake --build build --parallel 8    # use 8 cores
cmake --build build -j 8            # shorthand
```

### Verbose output (see the actual compiler commands):
```bash
cmake --build build --verbose
```

### compile_commands.json for IDE support:
Our CMakeLists.txt generates `build/compile_commands.json`. Point your IDE to it:
- **VS Code**: C++ extension auto-detects it in the `build/` directory.
- **CLion**: auto-detects it.
- **Neovim/clangd**: symlink to project root: `ln -s build/compile_commands.json .`

### Building a single target:
```bash
cmake --build build --target secure-p2p-chat-backend
```

### List all available targets:
```bash
cmake --build build --target help
```
