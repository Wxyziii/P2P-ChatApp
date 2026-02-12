# 02 — Development Environment Setup

> **Audience**: Beginners setting up their first C++ and Python development environment.
> Follow the section for your operating system.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Windows Setup](#2-windows-setup)
3. [Linux Setup (Arch / Ubuntu / Debian)](#3-linux-setup)
4. [macOS Setup](#4-macos-setup)
5. [IDE Setup](#5-ide-setup)
6. [Git Setup](#6-git-setup)
7. [Running the Project](#7-running-the-project)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Overview

You need:
- **C++ compiler** with C++20 support
- **CMake** 3.20+
- **Libraries**: libsodium, libcurl, SQLite3
- **Python** 3.11+
- **Python packages**: PySide6, requests

---

## 2. Windows Setup

### Step 1: Install Visual Studio 2022

1. Download [Visual Studio 2022 Community](https://visualstudio.microsoft.com/vs/community/) (free)
2. Run the installer
3. Select these workloads:
   - ✅ **Desktop development with C++**
4. Click **Install** (takes 5–10 GB)
5. This gives you: MSVC compiler, CMake, and debugger

### Step 2: Install vcpkg (Package Manager)

```powershell
# Open PowerShell as Administrator
cd C:\
git clone https://github.com/microsoft/vcpkg.git
cd vcpkg
.\bootstrap-vcpkg.bat

# Integrate with Visual Studio
.\vcpkg integrate install
```

### Step 3: Install C++ Libraries

```powershell
cd C:\vcpkg
.\vcpkg install libsodium:x64-windows
.\vcpkg install curl:x64-windows
.\vcpkg install sqlite3:x64-windows
```

This takes 5–15 minutes. Coffee time ☕

### Step 4: Build the Backend

```powershell
cd C:\path\to\secure-p2p-chat\backend

# Configure with vcpkg toolchain
cmake -B build -S . -DCMAKE_TOOLCHAIN_FILE=C:/vcpkg/scripts/buildsystems/vcpkg.cmake

# Build
cmake --build build --config Release
```

Or open the `backend` folder in Visual Studio — it auto-detects CMakeLists.txt.

### Step 5: Install Python

1. Download [Python 3.12](https://www.python.org/downloads/) (or 3.11+)
2. **Check "Add Python to PATH"** during installation!
3. Verify: `python --version`

### Step 6: Install Python Packages

```powershell
cd C:\path\to\secure-p2p-chat
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install PySide6 requests
```

---

## 3. Linux Setup

### Arch Linux

#### Step 1: Install Build Tools

```bash
sudo pacman -S base-devel cmake git pkgconf
```

#### Step 2: Install C++ Libraries

```bash
sudo pacman -S libsodium curl sqlite
```

#### Step 3: Build the Backend

```bash
cd secure-p2p-chat/backend
mkdir build && cd build
cmake ..
make -j$(nproc)
```

#### Step 4: Install Python

```bash
sudo pacman -S python python-pip python-virtualenv
```

#### Step 5: Python Virtual Environment

```bash
cd secure-p2p-chat
python -m venv venv
source venv/bin/activate
pip install PySide6 requests
```

### Ubuntu / Debian

#### Step 1: Install Build Tools

```bash
sudo apt update
sudo apt install -y build-essential cmake git
```

#### Step 2: Install C++ Libraries

```bash
sudo apt install -y \
    libsodium-dev \
    libcurl4-openssl-dev \
    libsqlite3-dev
```

#### Step 3: Build the Backend

```bash
cd secure-p2p-chat/backend
mkdir build && cd build
cmake ..
make -j$(nproc)
```

#### Step 4: Install Python

```bash
sudo apt install -y python3 python3-pip python3-venv
```

#### Step 5: Python Virtual Environment

```bash
cd secure-p2p-chat
python3 -m venv venv
source venv/bin/activate
pip install PySide6 requests
```

---

## 4. macOS Setup

### Step 1: Install Homebrew

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### Step 2: Install Tools and Libraries

```bash
brew install cmake libsodium curl sqlite3
```

### Step 3: Build the Backend

```bash
cd secure-p2p-chat/backend
mkdir build && cd build
cmake ..
make -j$(sysctl -n hw.ncpu)
```

### Step 4: Python Setup

```bash
brew install python@3.12
cd secure-p2p-chat
python3 -m venv venv
source venv/bin/activate
pip install PySide6 requests
```

---

## 5. IDE Setup

### VS Code (Recommended for Both Languages)

1. Install [VS Code](https://code.visualstudio.com/)
2. Install extensions:
   - **C/C++** (by Microsoft) — IntelliSense, debugging
   - **CMake Tools** (by Microsoft) — Build/configure CMake
   - **Python** (by Microsoft) — Python IntelliSense, debugging
   - **GitLens** — Git blame, history
3. Open the project: `code secure-p2p-chat`
4. CMake Tools should auto-detect the backend

### VS Code Settings

Create `.vscode/settings.json`:

```json
{
    "cmake.sourceDirectory": "${workspaceFolder}/backend",
    "cmake.buildDirectory": "${workspaceFolder}/backend/build",
    "python.defaultInterpreterPath": "${workspaceFolder}/venv/Scripts/python",
    "python.terminal.activateEnvironment": true
}
```

### Visual Studio 2022 (Windows, C++ Only)

1. Open Visual Studio
2. **File → Open → CMake** → select `backend/CMakeLists.txt`
3. Visual Studio auto-configures everything
4. Build with Ctrl+Shift+B
5. Debug with F5

### PyCharm Community (Python Only)

1. Install [PyCharm Community](https://www.jetbrains.com/pycharm/download/) (free)
2. Open the `ui/` folder
3. Configure interpreter: point to your `venv`
4. Run `main.py`

---

## 6. Git Setup

### Initialize Repository

```bash
cd secure-p2p-chat
git init
```

### .gitignore

Create this `.gitignore` file:

```gitignore
# C++ build artifacts
build/
cmake-build-*/
*.o
*.obj
*.exe
*.dll
*.so
*.dylib

# IDE files
.vscode/
.idea/
*.user
*.suo
CMakeUserPresets.json

# Python
__pycache__/
*.pyc
venv/
.venv/

# Config with secrets
config.json
*.key
keys.json

# Database files
*.db
*.sqlite

# Logs
logs/
*.log

# OS files
.DS_Store
Thumbs.db
```

### Branching Strategy (for Two People)

```bash
# Main branch — always working code
# Feature branches — one per feature

# Person A: working on crypto
git checkout -b feature/encryption
# ... make changes ...
git add -A && git commit -m "Add key generation"
git push origin feature/encryption
# Create Pull Request on GitHub → merge to main

# Person B: working on UI
git checkout -b feature/chat-ui
# ... make changes ...
git add -A && git commit -m "Add chat window"
git push origin feature/chat-ui
```

### Daily Workflow

```bash
# Start of day: get latest changes
git checkout main
git pull origin main

# Start working on your feature
git checkout -b feature/my-task

# End of day: push your work
git add -A
git commit -m "Descriptive message about what you did"
git push origin feature/my-task
```

---

## 7. Running the Project

### Step 1: Configure

```bash
# Copy the example config and fill in your Supabase credentials
cp backend/config.example.json backend/config.json
# Edit config.json with your Supabase URL and API key
```

### Step 2: Build & Run Backend

```bash
# Windows (PowerShell)
cd backend/build/Release
.\p2p_chat_backend.exe

# Linux/macOS
cd backend/build
./p2p_chat_backend
```

You should see:
```
[10:30:00] [info] === P2P Chat Backend Starting ===
[10:30:00] [info] Listening on port 8080
```

### Step 3: Run Python UI

In a new terminal:

```bash
# Activate virtual environment first!
# Windows: .\venv\Scripts\Activate.ps1
# Linux/macOS: source venv/bin/activate

cd secure-p2p-chat
python ui/main.py
```

### Step 4: Verify Connection

The UI status bar should show "Connected to backend".

---

## 8. Troubleshooting

### CMake Can't Find libsodium

```
-- Could NOT find PkgConfig (missing: libsodium)
```

**Fix (Windows)**: Make sure you're using the vcpkg toolchain:
```powershell
cmake -B build -S . -DCMAKE_TOOLCHAIN_FILE=C:/vcpkg/scripts/buildsystems/vcpkg.cmake
```

**Fix (Linux)**: Install the dev package:
```bash
# Arch Linux
sudo pacman -S libsodium

# Ubuntu / Debian
sudo apt install libsodium-dev
```

### Python Can't Connect to Backend

```
ConnectionError: Connection refused
```

**Fixes**:
1. Is the backend running? Check the terminal.
2. Is it on the right port? Default is 8080.
3. Windows Firewall: Allow the backend through.
4. Check `config.json` port matches.

### Build Errors: C++20 Features Not Supported

```
error: 'std::format' is not a member of 'std'
```

**Fix**: Make sure your compiler supports C++20:
- **MSVC**: Visual Studio 2022 (version 17.0+)
- **GCC**: version 12+
- **Clang**: version 15+

Check CMakeLists.txt has `set(CMAKE_CXX_STANDARD 20)`.

### PySide6 Import Error

```
ModuleNotFoundError: No module named 'PySide6'
```

**Fix**: Make sure the virtual environment is activated:
```bash
# Windows
.\venv\Scripts\Activate.ps1

# Linux/macOS
source venv/bin/activate

# Then check
pip list | grep PySide6
```

### vcpkg Packages Not Found

```
Could not find a package configuration file provided by "unofficial-sodium"
```

**Fix**: Ensure vcpkg integration is set up:
```powershell
C:\vcpkg\vcpkg integrate install
```

And you're passing the toolchain file to CMake.

### Port Already in Use

```
error: Cannot bind to port 8080: Address already in use
```

**Fix**: Either:
1. Kill the other process using port 8080
2. Change the port in `config.json`

```bash
# Find what's using port 8080
# Windows:
netstat -ano | findstr :8080

# Linux:
lsof -i :8080
```
