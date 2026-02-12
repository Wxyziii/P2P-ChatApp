# Phase 7 — Polish & Packaging

> **Goal**: Turn your working dev build into a professional, polished, distributable desktop app.
> This covers desktop notifications, Tauri sidecar (auto-launch backend), system tray,
> app icons, final UI polish, and cross-platform packaging.

---

## Table of Contents

1. [Overview: What Makes an App Feel "Finished"](#1-overview)
2. [Step 1: Tauri Sidecar (Bundle C++ Backend)](#2-step-1-sidecar)
3. [Step 2: Desktop Notifications](#3-step-2-notifications)
4. [Step 3: System Tray](#4-step-3-system-tray)
5. [Step 4: App Icons & Metadata](#5-step-4-icons)
6. [Step 5: Final UI Polish](#6-step-5-ui-polish)
7. [Step 6: Platform-Specific Builds](#7-step-6-platform-builds)
8. [Step 7: Packaging & Distribution](#8-step-7-packaging)
9. [Build Commands Reference](#9-build-commands)
10. [Learning Resources](#10-learning-resources)
11. [Common Pitfalls](#11-common-pitfalls)
12. [Project Completion Checklist](#12-checklist)

---

## 1. Overview

Before packaging, your app needs these finishing touches:

| Feature | Why | Effort |
|---------|-----|--------|
| **Sidecar** | Auto-start C++ backend with the app | Medium |
| **Notifications** | Alert user of new messages when app is minimized | Easy |
| **System tray** | Keep app running in background | Medium |
| **App icon** | Professional appearance in taskbar/dock | Easy |
| **Error handling** | Graceful failures, loading states, offline indicators | Medium |
| **Keyboard shortcuts** | Power user experience | Easy |
| **Packaging** | `.msi` for Windows, `.AppImage` for Linux (or `.deb` / PKGBUILD for Arch) | Easy (Tauri handles it) |

---

## 2. Step 1: Tauri Sidecar (Bundle C++ Backend)

A **sidecar** is an external binary that Tauri bundles inside your app and launches automatically. This is how the C++ backend runs alongside the frontend.

### How It Works

```
User double-clicks SecureChat.exe
  └─ Tauri starts
     ├─ Launches C++ backend as child process (sidecar)
     ├─ Waits for backend to be ready (polls /status)
     └─ Opens React webview
        └─ Frontend connects to backend on localhost:8080 + :8081
```

### Step 1a: Name the Backend Binary

Tauri sidecar binaries must follow a specific naming convention:

```
<name>-<target-triple>

Examples:
  p2p-backend-x86_64-pc-windows-msvc.exe    (Windows)
  p2p-backend-x86_64-unknown-linux-gnu      (Linux)
```

After building your C++ backend, rename the executable:

```powershell
# Windows
copy backend\build\Release\backend.exe `
     ui-tauri\src-tauri\binaries\p2p-backend-x86_64-pc-windows-msvc.exe
```

```bash
# Linux
cp backend/build/backend \
   ui-tauri/src-tauri/binaries/p2p-backend-x86_64-unknown-linux-gnu
```

### Step 1b: Create the Binaries Folder

```powershell
mkdir ui-tauri\src-tauri\binaries
```

### Step 1c: Configure tauri.conf.json

```json
{
  "bundle": {
    "externalBin": [
      "binaries/p2p-backend"
    ]
  }
}
```

> ⚠️ **Important**: Don't include the target triple or `.exe` extension in `externalBin`. Tauri appends the correct suffix automatically based on the build target.

### Step 1d: Launch Sidecar from Rust

```rust
// src-tauri/src/lib.rs

use tauri::Manager;
use tauri_plugin_shell::ShellExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Launch the C++ backend as a sidecar
            let sidecar = app.shell()
                .sidecar("p2p-backend")
                .expect("Failed to create sidecar command");

            let (mut rx, child) = sidecar
                .spawn()
                .expect("Failed to spawn sidecar");

            // Log sidecar output
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_shell::process::CommandEvent;
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            println!("[Backend] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Stderr(line) => {
                            eprintln!("[Backend Error] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Terminated(status) => {
                            eprintln!("[Backend] Exited: {:?}", status);
                            break;
                        }
                        _ => {}
                    }
                }
            });

            // Store child handle so we can kill it on app exit
            app.manage(SidecarState { child: std::sync::Mutex::new(Some(child)) });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Kill sidecar when window closes
                let state = window.state::<SidecarState>();
                if let Some(child) = state.child.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

struct SidecarState {
    child: std::sync::Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
}
```

### Step 1e: Add Shell Plugin to Cargo.toml

```toml
# src-tauri/Cargo.toml
[dependencies]
tauri-plugin-shell = "2"
```

### Step 1f: Add Capability

```json
// src-tauri/capabilities/default.json
{
  "identifier": "default",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "shell:allow-open",
    "shell:allow-execute",
    "shell:default"
  ]
}
```

### Step 1g: Frontend — Wait for Backend

```typescript
// services/sidecar.ts

import { api } from "./api";

export async function waitForBackend(
  maxAttempts = 30,
  intervalMs = 1000
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await api.getStatus();
      console.log(`Backend ready after ${i + 1} attempts`);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  console.error("Backend failed to start after", maxAttempts, "attempts");
  return false;
}
```

```tsx
// App.tsx
function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    waitForBackend().then((ok) => {
      if (ok) {
        setReady(true);
      } else {
        // Show error screen
      }
    });
  }, []);

  if (!ready) {
    return <SplashScreen message="Starting backend..." />;
  }

  return <AppShell />;
}
```

> 📖 **Tauri Sidecar Docs**: [v2.tauri.app/develop/sidecar](https://v2.tauri.app/develop/sidecar/)
> 📺 **Tauri Sidecar Tutorial**: [youtube.com/watch?v=8bD-VKQVqas](https://www.youtube.com/watch?v=8bD-VKQVqas)

---

## 3. Step 2: Desktop Notifications

### Install the Notification Plugin

```powershell
cd ui-tauri
npm install @tauri-apps/plugin-notification

# Add to Rust dependencies
cd src-tauri
cargo add tauri-plugin-notification
```

### Register the Plugin

```rust
// src-tauri/src/lib.rs
tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_notification::init())  // ← Add this
    .setup(|app| { /* ... */ })
```

### Add Capability

```json
// src-tauri/capabilities/default.json
{
  "permissions": [
    "core:default",
    "shell:default",
    "notification:default",
    "notification:allow-notify",
    "notification:allow-is-permission-granted",
    "notification:allow-request-permission"
  ]
}
```

### Use in Frontend

```typescript
// hooks/useNotification.ts

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

export async function initNotifications() {
  let granted = await isPermissionGranted();
  if (!granted) {
    const permission = await requestPermission();
    granted = permission === "granted";
  }
  return granted;
}

export async function notifyNewMessage(from: string, text: string) {
  const granted = await isPermissionGranted();
  if (!granted) return;

  sendNotification({
    title: `Message from ${from}`,
    body: text.length > 100 ? text.substring(0, 100) + "..." : text,
  });
}
```

### Trigger on New Message (When App Not Focused)

```typescript
// In useWebSocket.ts
const handleMessage = (data: Message) => {
  useChatStore.getState().addMessage(data);

  // Only notify if window is not focused
  if (!document.hasFocus()) {
    notifyNewMessage(data.from, data.text);
  }
};
```

---

## 4. Step 3: System Tray

The system tray lets users close the window but keep the app running in the background.

### Register Tray in Rust

```rust
// src-tauri/src/lib.rs

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager,
};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // ── System Tray ──
            let show = MenuItem::with_id(app, "show", "Show SecureChat", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("SecureChat")
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left, ..
                    } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // ── Sidecar launch ──
            // ... (same as Step 1)

            Ok(())
        })
        // Hide instead of close
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### Add Tray Capability

```json
// src-tauri/capabilities/default.json
{
  "permissions": [
    "core:default",
    "shell:default",
    "notification:default",
    "notification:allow-notify",
    "notification:allow-is-permission-granted",
    "notification:allow-request-permission",
    "core:tray:default"
  ]
}
```

---

## 5. Step 4: App Icons

### Generate Icons

Tauri needs multiple icon sizes. Start with a single 1024x1024 PNG:

```powershell
# From ui-tauri/
npx @tauri-apps/cli icon path\to\your\icon-1024x1024.png
```

This generates all required sizes in `src-tauri/icons/`:
- `icon.ico` (Windows)
- `icon.png` (Linux)
- `32x32.png`, `128x128.png`, `128x128@2x.png`
- `icon.icns` (macOS)

### Configure in tauri.conf.json

```json
{
  "bundle": {
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

### Where to Get Icons

| Resource | Link |
|----------|------|
| **Figma** (design your own) | [figma.com](https://www.figma.com/) |
| **Iconify** (SVG icons) | [iconify.design](https://iconify.design/) |
| **Real Favicon Generator** | [realfavicongenerator.net](https://realfavicongenerator.net/) |
| **App Icon Generator** | [appicon.co](https://appicon.co/) |

### Icon Design Tips

- Use a simple shape (circle, rounded square) for the base
- Make it recognizable at 16×16 pixels
- Use your accent color (indigo `#6366f1`)
- Avoid text — it's unreadable at small sizes
- A chat bubble or lock icon suits a secure chat app

---

## 6. Step 5: Final UI Polish

### Loading States

Every async operation should show feedback:

```tsx
function ContactList() {
  const loading = useContactStore((s) => s.loading);
  const contacts = useContactStore((s) => s.contacts);

  if (loading) {
    return (
      <div className="contact-list__loading">
        <div className="skeleton skeleton--avatar" />
        <div className="skeleton skeleton--text" />
        <div className="skeleton skeleton--avatar" />
        <div className="skeleton skeleton--text" />
      </div>
    );
  }

  if (contacts.length === 0) {
    return (
      <div className="contact-list__empty">
        <Users size={48} className="contact-list__empty-icon" />
        <p>No contacts yet</p>
        <p className="text-muted">Add a friend to start chatting</p>
      </div>
    );
  }

  return contacts.map((c) => <ContactItem key={c.username} contact={c} />);
}
```

### Skeleton Loading CSS

```css
/* components.css */
.skeleton {
  background: linear-gradient(90deg,
    var(--color-bg-sunken) 25%,
    var(--color-bg-raised) 50%,
    var(--color-bg-sunken) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
  border-radius: var(--radius-md);
}

.skeleton--avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
}

.skeleton--text {
  height: 14px;
  width: 60%;
  margin: 6px 0;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

### Keyboard Shortcuts

```typescript
// hooks/useKeyboardShortcuts.ts

import { useEffect } from "react";
import { useChatStore } from "@/stores/chatStore";
import { useUIStore } from "@/stores/uiStore";

export function useKeyboardShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+K — Focus search
      if (e.ctrlKey && e.key === "k") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>(".search-input")?.focus();
      }

      // Escape — Close dialog/deselect chat
      if (e.key === "Escape") {
        const dialog = useUIStore.getState().addFriendDialogOpen;
        if (dialog) {
          useUIStore.getState().setAddFriendDialogOpen(false);
        } else {
          useChatStore.getState().setActiveChat(null);
        }
      }

      // Ctrl+D — Toggle dark mode
      if (e.ctrlKey && e.key === "d") {
        e.preventDefault();
        const current = useUIStore.getState().theme;
        const next = current === "dark" ? "light" : "dark";
        useUIStore.getState().setTheme(next);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
```

### Smooth Scroll to New Message

```typescript
// In MessageList.tsx
const virtuosoRef = useRef<VirtuosoHandle>(null);

useEffect(() => {
  if (messages.length > 0) {
    // Scroll to bottom when new message arrives
    virtuosoRef.current?.scrollToIndex({
      index: messages.length - 1,
      behavior: "smooth",
    });
  }
}, [messages.length]);
```

### Error Boundary

```tsx
// components/common/ErrorBoundary.tsx

import { Component, ErrorInfo, ReactNode } from "react";

interface Props { children: ReactNode; fallback?: ReactNode; }
interface State { hasError: boolean; error?: Error; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("React error boundary:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="error-boundary">
          <h2>Something went wrong</h2>
          <p>{this.state.error?.message}</p>
          <button onClick={() => this.setState({ hasError: false })}>
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

---

## 7. Step 6: Platform-Specific Builds

### tauri.conf.json — Full Configuration

```json
{
  "$schema": "https://raw.githubusercontent.com/nicegram/nicegram-web/main/schemas/tauri-conf.json",
  "productName": "SecureChat",
  "version": "1.0.0",
  "identifier": "com.securechat.p2p",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "beforeDevCommand": "npm run dev"
  },
  "app": {
    "windows": [
      {
        "title": "SecureChat",
        "width": 1100,
        "height": 720,
        "minWidth": 800,
        "minHeight": 550,
        "decorations": false,
        "transparent": false,
        "center": true
      }
    ],
    "security": {
      "csp": "default-src 'self'; connect-src 'self' http://127.0.0.1:8080 ws://127.0.0.1:8081; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:"
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "externalBin": ["binaries/p2p-backend"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "windows": {
      "certificateThumbprint": null,
      "digestAlgorithm": "sha256",
      "timestampUrl": "",
      "wix": {
        "language": "en-US"
      },
      "nsis": {
        "installMode": "currentUser",
        "displayLanguageSelector": false
      }
    },
    "linux": {
      "deb": {
        "depends": ["libssl3", "libsqlite3-0"]
      },
      "appimage": {
        "bundleMediaFramework": false
      }
    }
  }
}
```

> **Arch Linux**: The `deb.depends` section is only relevant for Debian-based distros. On Arch, install the equivalent packages with pacman: `sudo pacman -S openssl sqlite`. If you're only building AppImage or using a PKGBUILD, you can ignore the `deb` block entirely.

### CSP (Content Security Policy) — Important!

The `csp` field controls what the webview can connect to. You **must** whitelist your backend:

```
connect-src 'self' http://127.0.0.1:8080 ws://127.0.0.1:8081;
```

Without this, all API calls and WebSocket connections will be blocked in production.

---

## 8. Step 7: Packaging & Distribution

### Building for Windows

```powershell
cd ui-tauri

# Make sure C++ backend is compiled and in binaries/
copy ..\backend\build\Release\backend.exe `
     src-tauri\binaries\p2p-backend-x86_64-pc-windows-msvc.exe

# Build the Tauri app
npm run tauri build
```

Output will be in:
```
src-tauri/target/release/bundle/
├── msi/
│   └── SecureChat_1.0.0_x64_en-US.msi
└── nsis/
    └── SecureChat_1.0.0_x64-setup.exe
```

### Building for Linux

```bash
cd ui-tauri

# Copy compiled backend
cp ../backend/build/backend \
   src-tauri/binaries/p2p-backend-x86_64-unknown-linux-gnu

# Build
npm run tauri build
```

Output (Ubuntu / Debian):
```
src-tauri/target/release/bundle/
├── deb/
│   └── secure-chat_1.0.0_amd64.deb
└── appimage/
    └── secure-chat_1.0.0_amd64.AppImage
```

Output (Arch Linux):
```
src-tauri/target/release/bundle/
└── appimage/
    └── secure-chat_1.0.0_amd64.AppImage
```

> ⚠️ **Arch Linux Note**: Tauri does not generate `.deb` packages on Arch since `dpkg` is not installed. Use the **AppImage** output — it works on all Linux distros. Alternatively, create a custom `PKGBUILD` (see below).

#### Optional: Arch Linux PKGBUILD

If you want to install the app via `makepkg` on Arch, create a `PKGBUILD`:

```bash
# PKGBUILD
pkgname=securechat
pkgver=1.0.0
pkgrel=1
pkgdesc="Secure P2P Chat Application"
arch=('x86_64')
license=('MIT')
depends=('webkit2gtk-4.1' 'gtk3' 'libayatana-appindicator' 'librsvg' 'libsodium' 'curl' 'sqlite')

package() {
    install -Dm755 "${srcdir}/SecureChat" "${pkgdir}/usr/bin/securechat"
    install -Dm644 "${srcdir}/icon.png" "${pkgdir}/usr/share/icons/hicolor/128x128/apps/securechat.png"
    install -Dm644 "${srcdir}/securechat.desktop" "${pkgdir}/usr/share/applications/securechat.desktop"
}
```

```bash
# Build and install on Arch
makepkg -si
```

### Build Checklist

Before building, verify:

```powershell
# 1. Frontend builds cleanly
npm run build

# 2. TypeScript has no errors
npx tsc --noEmit

# 3. Backend binary exists in correct location
Test-Path "src-tauri\binaries\p2p-backend-x86_64-pc-windows-msvc.exe"

# 4. Icons are generated
Test-Path "src-tauri\icons\icon.ico"

# 5. Rust compiles
cd src-tauri && cargo check && cd ..
```

### File Size Expectations

| Component | Approximate Size |
|-----------|-----------------|
| Tauri WebView runtime | ~3 MB |
| React frontend (JS + CSS) | ~1 MB |
| C++ backend sidecar | ~5–10 MB |
| **Total installer** | **~10–15 MB** |

Compare with Electron: 150+ MB. Tauri is 10x smaller.

---

## 9. Build Commands Reference

| Command | What It Does |
|---------|-------------|
| `npm run dev` | Start Vite dev server (frontend only) |
| `npm run build` | Build frontend for production |
| `npm run tauri dev` | Start full Tauri app in dev mode |
| `npm run tauri build` | Build distributable package |
| `npm run tauri icon <png>` | Generate all icon sizes |
| `npx tsc --noEmit` | TypeScript type check |
| `cargo check` | Rust compilation check |
| `cargo build --release` | Build Rust (Tauri core) |

### Development Workflow

```
1. Start C++ backend manually (or via sidecar)
2. Run `npm run tauri dev`
3. Edit React code → Vite hot-reloads instantly
4. Edit Rust code → Tauri rebuilds + restarts
5. Check console (F12) for errors
6. Test with two users on different machines/configs
7. Run `npm run tauri build` for final package
```

---

## 10. Learning Resources

### Tauri Packaging

| Resource | Type | Link |
|----------|------|------|
| **Tauri v2 Build Guide** | 📖 Official | [v2.tauri.app/distribute](https://v2.tauri.app/distribute/) |
| **Tauri Sidecar Docs** | 📖 Official | [v2.tauri.app/develop/sidecar](https://v2.tauri.app/develop/sidecar/) |
| **Tauri Notification Plugin** | 📖 Official | [v2.tauri.app/plugin/notification](https://v2.tauri.app/plugin/notification/) |
| **Tauri System Tray** | 📖 Official | [v2.tauri.app/learn/system-tray](https://v2.tauri.app/learn/system-tray/) |
| **Tauri v2 Full Tutorial** | 📺 YouTube | [youtube.com/watch?v=PZstfIq3CHk](https://www.youtube.com/watch?v=PZstfIq3CHk) |

### Desktop App Polish

| Resource | Type | Link |
|----------|------|------|
| **UX Design for Desktop Apps** | 📖 Article | [nngroup.com/articles/desktop-apps](https://www.nngroup.com/articles/progressive-disclosure/) |
| **Skeleton Loading Screens** | 📖 Article | [uxdesign.cc/skeleton-screens](https://uxdesign.cc/what-you-should-know-about-skeleton-screens-a820c45a571a) |
| **Keyboard Shortcuts Best Practices** | 📖 Article | [web.dev/keyboard-access](https://web.dev/articles/keyboard-access) |

### Cross-Platform C++ Building

| Resource | Type | Link |
|----------|------|------|
| **CMake Tutorial** | 📺 YouTube | [youtube.com/watch?v=nlKcXPUJGwA](https://www.youtube.com/watch?v=nlKcXPUJGwA) |
| **Cross-Compiling C++ with CMake** | 📖 Docs | [cmake.org/cmake/help/latest/manual/cmake-toolchains.7.html](https://cmake.org/cmake/help/latest/manual/cmake-toolchains.7.html) |
| **GitHub Actions for C++** | 📖 Example | [github.com/actions/starter-workflows](https://github.com/actions/starter-workflows/tree/main/ci) |

---

## 11. Common Pitfalls

### ❌ Sidecar binary not found

**Error**: `Failed to create sidecar command: program not found`
**Cause**: Binary name doesn't match the target triple.
**Fix**: Check the exact name:

```powershell
# What's your target triple?
rustc -vV | Select-String "host:"
# Output: host: x86_64-pc-windows-msvc

# Binary must be named:
# p2p-backend-x86_64-pc-windows-msvc.exe
```

### ❌ CSP blocks API calls in production

**Error**: `Refused to connect to 'http://127.0.0.1:8080'`
**Cause**: Content Security Policy in `tauri.conf.json` doesn't include the backend.
**Fix**: Add to `security.csp`:
```
connect-src 'self' http://127.0.0.1:8080 ws://127.0.0.1:8081;
```

### ❌ App crashes on startup (sidecar fails)

**Cause**: Backend binary doesn't have execute permissions (Linux).
**Fix**:
```bash
chmod +x src-tauri/binaries/p2p-backend-x86_64-unknown-linux-gnu
```

### ❌ Icons look blurry

**Cause**: Source image is too small.
**Fix**: Always start with a 1024×1024 or larger PNG. Tauri downscales automatically.

### ❌ Build fails: "cargo metadata" not found

**Cause**: Rust is not in PATH.
**Fix** (Windows):
```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
```

### ❌ WebSocket won't connect in production

**Cause**: The port might be blocked or the URL is wrong.
**Fix**: Make sure constants use `127.0.0.1`, not `localhost` (IPv4 vs IPv6 issues):
```typescript
// constants.ts
export const API_BASE_URL = "http://127.0.0.1:8080";  // ✅
export const WS_URL = "ws://127.0.0.1:8081/events";   // ✅
// NOT "http://localhost:8080"                          // ❌
```

### ❌ NSIS installer needs admin rights

**Fix**: Use `installMode: "currentUser"` in tauri.conf.json:
```json
"nsis": { "installMode": "currentUser" }
```

### 💡 Tip: Test the Production Build

Always test the actual built package, not just `tauri dev`:

```powershell
# Build
npm run tauri build

# Run the output
.\src-tauri\target\release\SecureChat.exe
```

The dev build and production build can behave differently (CSP, paths, sidecar).

### 💡 Tip: Add a Splash Screen

Show a loading screen while the sidecar starts:

```tsx
function SplashScreen({ message }: { message: string }) {
  return (
    <div className="splash">
      <div className="splash__icon">💬</div>
      <h1 className="splash__title">SecureChat</h1>
      <p className="splash__message">{message}</p>
      <div className="splash__spinner" />
    </div>
  );
}
```

```css
.splash {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  background: var(--color-bg-app);
}

.splash__spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--color-bg-sunken);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
```

---

## 12. Project Completion Checklist

Use this checklist to verify your app is ready for release:

### Backend ✅

- [ ] P2P TCP connections work between two nodes
- [ ] Messages encrypt/decrypt correctly (libsodium)
- [ ] Supabase user registration and discovery works
- [ ] Offline message push/fetch/delete works
- [ ] REST API serves all endpoints on :8080
- [ ] WebSocket broadcasts events on :8081
- [ ] Heartbeat loop updates presence in Supabase
- [ ] Config loads from `config.json`
- [ ] Logging (spdlog) is active and useful
- [ ] Backend compiles on both Windows and Linux

### Frontend ✅

- [ ] All components render without errors
- [ ] Contact list shows friends with online/offline status
- [ ] Chat messages display correctly with grouping
- [ ] Message sending works (REST → backend → peer)
- [ ] WebSocket receives real-time events
- [ ] Typing indicators show and hide correctly
- [ ] Emoji picker opens and inserts emojis
- [ ] Light/dark theme toggle works
- [ ] Keyboard shortcuts work (Enter to send, Ctrl+K search, Escape)
- [ ] Loading states show during async operations
- [ ] Error states display when backend is offline
- [ ] TypeScript compiles with zero errors

### Integration ✅

- [ ] Frontend successfully calls all REST endpoints
- [ ] WebSocket connection auto-reconnects
- [ ] Messages flow end-to-end: UI → backend → peer → peer backend → peer UI
- [ ] Offline messages deliver when recipient comes online
- [ ] Presence updates propagate through the system

### Packaging ✅

- [ ] Sidecar launches backend automatically
- [ ] Desktop notifications work for new messages
- [ ] System tray keeps app running in background
- [ ] App icon displays correctly in taskbar
- [ ] CSP allows API and WebSocket connections
- [ ] Windows installer (`.msi` or `.exe`) builds successfully
- [ ] Linux package (`.AppImage`, `.deb`, or Arch PKGBUILD) builds successfully
- [ ] Production build runs without errors

---

## 🎉 Congratulations!

If you've made it through all 7 phases, you have:

1. ✅ A C++ backend that handles P2P networking, encryption, and Supabase integration
2. ✅ A modern React + Tauri frontend with polished animations and dark mode
3. ✅ Real-time communication via WebSocket
4. ✅ End-to-end encrypted messaging
5. ✅ Offline message delivery via Supabase
6. ✅ A packaged desktop application ready for distribution

### What's Next?

If you want to go further, consider:

- **File sharing**: Send encrypted files over P2P
- **Group chats**: Multi-party encrypted conversations
- **Voice messages**: Record and send audio
- **NAT traversal**: Use STUN/TURN for connections behind routers
- **Mobile**: Port the frontend to Tauri Mobile (iOS/Android)
- **CI/CD**: Set up GitHub Actions to auto-build releases

---

**← [Phase 6 — Integration](./phase-6-integration.md) | [Back to README](../../README.md)**
