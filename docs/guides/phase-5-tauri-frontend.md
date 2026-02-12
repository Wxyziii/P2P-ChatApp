# Phase 5 — Tauri Frontend (React + TypeScript)

> **Goal**: Build the complete chat UI using Tauri + React + TypeScript.
> This phase covers the component architecture, state management, styling system,
> and all the visual pieces. No backend logic — just a polished, modern interface.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Tech Stack & Why](#2-tech-stack--why)
3. [Step 1: Project Setup](#3-step-1-project-setup)
4. [Step 2: Folder Structure](#4-step-2-folder-structure)
5. [Step 3: Design System (CSS Architecture)](#5-step-3-design-system)
6. [Step 4: State Management with Zustand](#6-step-4-state-management)
7. [Step 5: Layout Components](#7-step-5-layout-components)
8. [Step 6: Contact Components](#8-step-6-contact-components)
9. [Step 7: Chat Components](#9-step-7-chat-components)
10. [Step 8: Animations with Framer Motion](#10-step-8-animations)
11. [Step 9: Theme System (Light/Dark)](#11-step-9-theme-system)
12. [Step 10: Emoji Support](#12-step-10-emoji-support)
13. [Learning Resources](#13-learning-resources)
14. [Common Pitfalls](#14-common-pitfalls)

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│  Tauri Window                                        │
│  ┌────────────────────────────────────────────────┐  │
│  │  TitleBar (custom, draggable)                  │  │
│  ├──────────┬─────────────────────────────────────┤  │
│  │ Sidebar  │  Chat Panel                         │  │
│  │          │  ┌──────────────────────────────┐   │  │
│  │ Search   │  │ Chat Header (name, status)   │   │  │
│  │          │  ├──────────────────────────────┤   │  │
│  │ Contacts │  │ Message List (virtualized)   │   │  │
│  │ · Alice  │  │ ┌────────────────────────┐   │   │  │
│  │ · Bob ●  │  │ │ MessageBubble          │   │   │  │
│  │ · Carol  │  │ │ MessageBubble          │   │   │  │
│  │          │  │ │ TypingIndicator        │   │   │  │
│  │          │  │ └────────────────────────┘   │   │  │
│  │          │  ├──────────────────────────────┤   │  │
│  │ [+] Add  │  │ ComposeArea (input + send)   │   │  │
│  │          │  └──────────────────────────────┘   │  │
│  └──────────┴─────────────────────────────────────┘  │
│                                                      │
│  Zustand Stores ←→ API Service ←→ Backend :8080      │
└──────────────────────────────────────────────────────┘
```

---

## 2. Tech Stack & Why

| Library | Version | Why We Chose It |
|---------|---------|-----------------|
| **React 19** | Latest | Component model, huge ecosystem, familiar to most devs |
| **TypeScript** | 5.x | Catches bugs at compile time, great autocompletion |
| **Tailwind CSS v4** | 4.x | Utility-first CSS, rapid prototyping, tiny output |
| **Zustand** | 5.x | Simplest state management — no boilerplate, no providers |
| **Framer Motion** | 12.x | Production-grade animations with simple API |
| **react-virtuoso** | 4.x | Virtualized list for 10,000+ messages without lag |
| **Lucide React** | Latest | Beautiful, consistent icon set |
| **emoji-mart** | 5.x | Full emoji picker, same one Slack uses |
| **date-fns** | 4.x | Lightweight date formatting (no Moment.js bloat) |
| **Tauri v2** | 2.x | Tiny binary (~3MB vs Electron's 150MB), native performance |

> 📺 **Zustand in 100 Seconds**: [youtube.com/watch?v=KCr-UNsM3vA](https://www.youtube.com/watch?v=KCr-UNsM3vA)
> 📺 **Tailwind CSS Crash Course**: [youtube.com/watch?v=UBOj6rqRUME](https://www.youtube.com/watch?v=UBOj6rqRUME)
> 📺 **Framer Motion Tutorial**: [youtube.com/watch?v=znbCa4Rr054](https://www.youtube.com/watch?v=znbCa4Rr054)

---

## 3. Step 1: Project Setup

### Creating the Tauri Project

```powershell
# If starting from scratch (we already have this):
npm create tauri-app@latest ui-tauri -- --template react-ts
cd ui-tauri
npm install --legacy-peer-deps
```

### Installing Dependencies

```powershell
cd ui-tauri

# Core UI
npm install zustand framer-motion react-virtuoso lucide-react date-fns
npm install --legacy-peer-deps

# Emoji
npm install @emoji-mart/react @emoji-mart/data

# Dev dependencies
npm install -D @types/node
```

### Tailwind v4 Setup

Tailwind v4 uses a Vite plugin (no PostCSS config needed):

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
});
```

```typescript
// tsconfig.json — add path alias
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  }
}
```

---

## 4. Step 2: Folder Structure

```
ui-tauri/src/
├── main.tsx                    # React entry point
├── App.tsx                     # Root: theme + WebSocket + layout
│
├── components/
│   ├── layout/
│   │   ├── AppShell.tsx        # Main layout: sidebar + chat
│   │   ├── TitleBar.tsx        # Custom window title bar
│   │   └── Sidebar.tsx         # Contact panel wrapper
│   │
│   ├── chat/
│   │   ├── ChatPanel.tsx       # Right panel: header + messages + input
│   │   ├── ChatHeader.tsx      # Contact name + status + actions
│   │   ├── MessageList.tsx     # Virtualized message list
│   │   ├── MessageGroup.tsx    # Group messages by sender
│   │   ├── MessageBubble.tsx   # Single message bubble
│   │   ├── ComposeArea.tsx     # Text input + emoji + send button
│   │   ├── TypingIndicator.tsx # "Bob is typing..." animation
│   │   └── EmptyChat.tsx       # "Select a conversation" placeholder
│   │
│   ├── contacts/
│   │   ├── ContactList.tsx     # List of contacts with search
│   │   ├── ContactItem.tsx     # Single contact row
│   │   ├── AddFriendDialog.tsx # Modal to add friend by username
│   │   └── PresenceIndicator.tsx  # Online/offline dot
│   │
│   ├── emoji/
│   │   ├── EmojiPicker.tsx     # Emoji picker popup
│   │   └── ReactionBar.tsx     # Quick reaction bar on hover
│   │
│   └── common/
│       ├── Avatar.tsx          # Circle avatar with status dot
│       ├── Badge.tsx           # Unread count badge
│       ├── StatusDot.tsx       # Green/gray status indicator
│       └── ThemeToggle.tsx     # Light/dark/system toggle
│
├── stores/
│   ├── chatStore.ts            # Messages, active chat, typing
│   ├── contactStore.ts         # Friends list, online status
│   └── uiStore.ts              # Theme, sidebar width, dialogs
│
├── services/
│   ├── api.ts                  # REST API client (fetch wrapper)
│   └── websocket.ts            # WebSocket client (real-time events)
│
├── hooks/
│   ├── useWebSocket.ts         # Connect WS + dispatch to stores
│   ├── useContacts.ts          # Fetch contacts on mount
│   ├── useMessages.ts          # Fetch messages when chat changes
│   └── useBackendStatus.ts     # Poll /status every 5s
│
├── types/
│   ├── message.ts              # Message, Reaction, MessageGroup
│   ├── contact.ts              # Contact, ContactWithPreview
│   ├── api.ts                  # StatusResponse, MessagesResponse
│   └── events.ts               # WSEvent, WSClientEvent
│
├── lib/
│   ├── utils.ts                # cn() class merge helper
│   ├── constants.ts            # API_BASE_URL, WS_URL, etc.
│   └── animations.ts           # Framer Motion variants
│
└── styles/
    ├── globals.css              # Imports all modules + base reset
    ├── theme.css                # Design tokens (colors, spacing, shadows)
    ├── layout.css               # App shell, panels, resize handle
    ├── components.css           # Buttons, inputs, avatars, badges
    ├── chat.css                 # Bubbles, compose, typing, reactions
    ├── animations.css           # Keyframes (pulse, bounce, shimmer)
    └── scrollbar.css            # Custom thin scrollbar
```

---

## 5. Step 3: Design System

Our CSS architecture uses **modular CSS files with CSS custom properties**.

### theme.css — Design Tokens

```css
@theme {
  /* Brand */
  --color-accent: #6366f1;          /* Indigo */
  --color-accent-hover: #4f46e5;
  --color-accent-soft: rgba(99, 102, 241, 0.12);

  /* Surfaces */
  --color-bg-app: #eef0f4;          /* Behind everything */
  --color-bg-base: #ffffff;         /* Panel backgrounds */
  --color-bg-raised: #f6f7f9;       /* Slightly elevated */
  --color-bg-sunken: #eceef2;       /* Inputs, recessed areas */

  /* Text */
  --color-text-primary: #111827;
  --color-text-secondary: #4b5563;
  --color-text-muted: #9ca3af;

  /* Radii — our "rounded" look */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 20px;

  /* Shadows — floating panel effect */
  --shadow-float: 0 8px 30px rgba(0,0,0,0.07), 0 2px 8px rgba(0,0,0,0.04);
}
```

**Why CSS custom properties instead of Tailwind config?** They cascade naturally to dark mode (just override in `.dark {}`) and can be used in both Tailwind classes AND custom CSS.

### The Floating Panel Design

Every major panel (titlebar, sidebar, chat) is a **separate floating card** with rounded corners and shadows, separated by 8px gaps:

```css
/* layout.css */
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 8px;  /* Space between floating panels */
}

#root {
  padding: 20px;  /* Space between panels and window edges */
}
```

This creates the "floating cards on a canvas" effect that modern apps use.

---

## 6. Step 4: State Management

We use **Zustand** — the simplest React state management library.

### Why Zustand?

| Library | Boilerplate | Learning Curve | Bundle Size |
|---------|------------|----------------|-------------|
| Redux | High (actions, reducers, middleware) | Steep | 7KB |
| MobX | Medium (decorators, observables) | Medium | 15KB |
| **Zustand** | **Minimal (just functions)** | **Easy** | **1KB** |
| Context API | Low but re-render issues | Easy | 0KB |

### chatStore.ts — Core Pattern

```typescript
import { create } from "zustand";

interface ChatState {
  activeChat: string | null;
  messages: Record<string, Message[]>;
  // ... more state

  // Actions are just functions on the same object
  setActiveChat: (username: string | null) => void;
  sendMessage: (to: string, text: string) => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  activeChat: null,
  messages: {},

  setActiveChat: (username) => set({ activeChat: username }),

  sendMessage: async (to, text) => {
    set({ sendingMessage: true });
    try {
      const result = await api.sendMessage(to, text);
      // Add to local messages
      get().addMessage({ /* ... */ });
    } finally {
      set({ sendingMessage: false });
    }
  },
}));
```

### Using in Components

```tsx
function ChatPanel() {
  // Subscribe to specific slices of state
  const activeChat = useChatStore((s) => s.activeChat);
  const messages = useChatStore((s) =>
    s.messages[s.activeChat ?? ""] ?? []
  );

  // Component only re-renders when THESE values change
  return <MessageList messages={messages} />;
}
```

> 📺 **Zustand Tutorial**: [youtube.com/watch?v=KCr-UNsM3vA](https://www.youtube.com/watch?v=KCr-UNsM3vA)
> 📖 **Zustand Docs**: [docs.pmnd.rs/zustand](https://docs.pmnd.rs/zustand/getting-started/introduction)

---

## 7. Step 5: Layout Components

### AppShell.tsx — The Root Layout

```tsx
import { Sidebar } from "./Sidebar";
import { ChatPanel } from "../chat/ChatPanel";
import { EmptyChat } from "../chat/EmptyChat";
import { TitleBar } from "./TitleBar";
import { useChatStore } from "@/stores/chatStore";
import { useUIStore } from "@/stores/uiStore";
import { useCallback, useRef } from "react";

export function AppShell() {
  const activeChat = useChatStore((s) => s.activeChat);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);

  // Resize handle logic
  const resizing = useRef(false);

  const onMouseDown = useCallback(() => {
    resizing.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (e: MouseEvent) => {
      if (!resizing.current) return;
      const newWidth = Math.max(220, Math.min(420, e.clientX - 20));
      setSidebarWidth(newWidth);
    };

    const onMouseUp = () => {
      resizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [setSidebarWidth]);

  return (
    <div className="app-shell">
      <TitleBar />
      <div className="main-area">
        <div className="sidebar" style={{ width: sidebarWidth }}>
          <Sidebar />
        </div>
        <div className="resize-handle" onMouseDown={onMouseDown} />
        {activeChat ? <ChatPanel /> : <EmptyChat />}
      </div>
    </div>
  );
}
```

**Key concepts:**
- The resize handle uses mouse events (not a library) for zero dependencies
- `sidebar` width is persisted in `uiStore` (survives page refresh)
- `activeChat` determines whether to show ChatPanel or EmptyChat

---

## 8. Step 6: Contact Components

### ContactItem.tsx

```tsx
import { Avatar } from "../common/Avatar";
import { Badge } from "../common/Badge";
import { formatDistanceToNow } from "date-fns";
import type { ContactWithPreview } from "@/types/contact";

interface Props {
  contact: ContactWithPreview;
  active: boolean;
  onClick: () => void;
}

export function ContactItem({ contact, active, onClick }: Props) {
  return (
    <button
      className={`contact-item ${active ? "contact-item--active" : ""}`}
      onClick={onClick}
    >
      <Avatar
        name={contact.username}
        online={contact.online}
        size="md"
      />
      <div className="contact-item__info">
        <div className="contact-item__row">
          <span className="contact-item__name">
            {contact.username}
          </span>
          {contact.lastMessageTime && (
            <span className="contact-item__time">
              {formatDistanceToNow(new Date(contact.lastMessageTime),
                                    { addSuffix: false })}
            </span>
          )}
        </div>
        {contact.lastMessage && (
          <p className="contact-item__preview">
            {contact.lastMessage}
          </p>
        )}
      </div>
      {contact.unreadCount > 0 && (
        <Badge count={contact.unreadCount} />
      )}
    </button>
  );
}
```

---

## 9. Step 7: Chat Components

### MessageBubble.tsx — The Core Component

```tsx
import { motion } from "framer-motion";
import { Check, CheckCheck } from "lucide-react";
import { messagePopIn } from "@/lib/animations";
import type { Message } from "@/types/message";

interface Props {
  message: Message;
  position: "solo" | "first" | "middle" | "last";
}

export function MessageBubble({ message, position }: Props) {
  const isSent = message.direction === "sent";

  // Build CSS class string
  const bubbleClass = [
    "bubble",
    isSent ? "bubble--sent" : "bubble--received",
    `bubble--${position}`,
  ].join(" ");

  return (
    <motion.div
      variants={messagePopIn}
      initial="hidden"
      animate="visible"
      className={bubbleClass}
    >
      <p className="bubble__text">{message.text}</p>

      <div className="bubble__meta">
        <span className="bubble__time">
          {new Date(message.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>

        {isSent && (
          <div className="bubble__delivery">
            {message.delivered ? (
              <CheckCheck size={14}
                className="bubble__delivery-icon--delivered" />
            ) : (
              <Check size={14}
                className="bubble__delivery-icon" />
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
```

### How Bubble Rounding Works

Messages in a group share rounded corners to look like a continuous flow:

```
Solo message:     ╭──────────╮
                  │ Hello!   │
                  ╰──────────╯

First in group:   ╭──────────╮
                  │ Hey      │
                  ╰────────┐ │   ← Small corner (connects to next)
Middle:           ┌────────┐ │
                  │ How are │ │
                  └────────┐ │
Last in group:    ┌──────────╮
                  │ you?     │
                  ╰──────────╯   ← Full round again
```

This is achieved via CSS classes `bubble--first`, `bubble--middle`, `bubble--last`:

```css
/* chat.css */
.bubble--first.bubble--sent {
  border-radius: 24px 24px 12px 24px;  /* small bottom-right */
}
.bubble--middle.bubble--sent {
  border-radius: 24px 12px 12px 24px;  /* small right side */
}
.bubble--last.bubble--sent {
  border-radius: 24px 12px 24px 24px;  /* small top-right */
}
```

---

## 10. Step 8: Animations

### Framer Motion Variants

```typescript
// lib/animations.ts
export const messagePopIn = {
  hidden: { opacity: 0, y: 10, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", stiffness: 400, damping: 25 },
  },
};

export const fadeIn = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
};

export const listItem = {
  hidden: { opacity: 0, x: -12 },
  visible: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: { delay: i * 0.03, duration: 0.2 },
  }),
};
```

### CSS Animations (for simpler things)

```css
/* animations.css */
@keyframes typing-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30%           { transform: translateY(-4px); opacity: 1; }
}

@keyframes status-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.45); }
  50%      { box-shadow: 0 0 0 5px rgba(34, 197, 94, 0); }
}
```

**Rule of thumb**: Use Framer Motion for enter/exit animations (mount/unmount). Use CSS keyframes for infinite loops (pulsing, bouncing).

---

## 11. Step 9: Theme System

### How Dark Mode Works

1. `uiStore` tracks the theme preference (`"light"`, `"dark"`, `"system"`)
2. A `useEffect` in `App.tsx` adds/removes the `dark` class on `<html>`
3. CSS custom properties change via `.dark { }` selector
4. Tailwind's dark variant uses `@custom-variant dark (&:is(.dark *))`

```typescript
// In App.tsx
useEffect(() => {
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
  } else if (theme === "light") {
    root.classList.remove("dark");
  } else {
    // System preference
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.classList.toggle("dark", prefersDark);
  }
}, [theme]);
```

### ThemeToggle Component

```tsx
import { Sun, Moon, Monitor } from "lucide-react";
import { useUIStore } from "@/stores/uiStore";

export function ThemeToggle() {
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);

  const next = () => {
    const cycle = { light: "dark", dark: "system", system: "light" } as const;
    setTheme(cycle[theme]);
  };

  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;

  return (
    <button className="icon-btn" onClick={next} title={`Theme: ${theme}`}>
      <Icon size={16} />
    </button>
  );
}
```

---

## 12. Step 10: Emoji Support

### EmojiPicker.tsx

```tsx
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import { AnimatePresence, motion } from "framer-motion";

interface Props {
  isOpen: boolean;
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export function EmojiPicker({ isOpen, onSelect, onClose }: Props) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={onClose} />

          {/* Picker */}
          <motion.div
            className="absolute bottom-full right-0 z-50 mb-2"
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 10 }}
          >
            <Picker
              data={data}
              onEmojiSelect={(emoji: { native: string }) =>
                onSelect(emoji.native)
              }
              theme="auto"
              previewPosition="none"
              skinTonePosition="search"
            />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
```

---

## 13. Learning Resources

### React & TypeScript

| Resource | Type | Link |
|----------|------|------|
| **React Official Docs** | 📖 Interactive | [react.dev/learn](https://react.dev/learn) |
| **TypeScript Handbook** | 📖 Official | [typescriptlang.org/docs](https://www.typescriptlang.org/docs/handbook/intro.html) |
| **Jack Herrington — React 19** | 📺 YouTube | [youtube.com/@jherr](https://www.youtube.com/@jherr) |
| **Fireship — React in 100 Seconds** | 📺 YouTube | [youtube.com/watch?v=Tn6-PIqc4UM](https://www.youtube.com/watch?v=Tn6-PIqc4UM) |
| **Full Stack Open (React)** | 📖 Free course | [fullstackopen.com](https://fullstackopen.com/) |

### Tauri

| Resource | Type | Link |
|----------|------|------|
| **Tauri v2 Docs** | 📖 Official | [v2.tauri.app](https://v2.tauri.app/) |
| **Tauri + React Tutorial** | 📺 YouTube | [youtube.com/watch?v=PZstfIq3CHk](https://www.youtube.com/watch?v=PZstfIq3CHk) |
| **Awesome Tauri** | 📖 List | [github.com/tauri-apps/awesome-tauri](https://github.com/tauri-apps/awesome-tauri) |

### Styling & Animation

| Resource | Type | Link |
|----------|------|------|
| **Tailwind CSS v4 Docs** | 📖 Official | [tailwindcss.com/docs](https://tailwindcss.com/docs) |
| **Framer Motion Docs** | 📖 Official | [motion.dev](https://motion.dev/) |
| **Framer Motion Tutorial** | 📺 YouTube | [youtube.com/watch?v=znbCa4Rr054](https://www.youtube.com/watch?v=znbCa4Rr054) |
| **CSS Variables Deep Dive** | 📺 YouTube | [youtube.com/watch?v=NtRmIp4eMjs](https://www.youtube.com/watch?v=NtRmIp4eMjs) |

### State Management

| Resource | Type | Link |
|----------|------|------|
| **Zustand Docs** | 📖 Official | [docs.pmnd.rs/zustand](https://docs.pmnd.rs/zustand/getting-started/introduction) |
| **Zustand Tutorial — Jack Herrington** | 📺 YouTube | [youtube.com/watch?v=KCr-UNsM3vA](https://www.youtube.com/watch?v=KCr-UNsM3vA) |

### Chat UI Inspiration

| Resource | Type | Link |
|----------|------|------|
| **Signal Desktop (open source)** | 📖 GitHub | [github.com/signalapp/Signal-Desktop](https://github.com/signalapp/Signal-Desktop) |
| **Telegram Web (open source)** | 📖 GitHub | [github.com/nicegram/nicegram-web](https://github.com/nicegram/nicegram-web) |
| **Dribbble — Chat UI** | 🎨 Inspiration | [dribbble.com/search/chat-app-ui](https://dribbble.com/search/chat-app-ui) |

---

## 14. Common Pitfalls

### ❌ "Module not found: @/..."

**Cause**: Path alias not configured.
**Fix**: Make sure both `tsconfig.json` and `vite.config.ts` have the `@` alias pointing to `src/`.

### ❌ Components not updating when store changes

**Cause**: Selecting the whole store instead of a slice.
**Fix**: Always select specific fields:
```typescript
// BAD — re-renders on ANY store change
const store = useChatStore();

// GOOD — re-renders only when activeChat changes
const activeChat = useChatStore((s) => s.activeChat);
```

### ❌ Emoji picker breaks build with peer dependency errors

**Fix**: Use `npm install --legacy-peer-deps`. React 19 has a peer dep conflict with emoji-mart that's harmless.

### ❌ Animations lag with many messages

**Fix**: Use `react-virtuoso` to only render visible messages. Never render 10,000 MessageBubbles at once.

### ❌ Dark mode flickers on page load

**Cause**: Theme is applied after React hydrates.
**Fix**: Add a script in `index.html` that runs before React:
```html
<script>
  if (localStorage.getItem('ui-store') &&
      JSON.parse(localStorage.getItem('ui-store')).state.theme === 'dark') {
    document.documentElement.classList.add('dark');
  }
</script>
```

### 💡 Tip: Keep Components Dumb

Components should only render UI. Business logic belongs in stores and services:

```typescript
// BAD — component fetches data directly
function ContactList() {
  const [contacts, setContacts] = useState([]);
  useEffect(() => {
    fetch("/friends").then(r => r.json()).then(setContacts);
  }, []);
}

// GOOD — component reads from store, store handles fetching
function ContactList() {
  const contacts = useContactStore((s) => s.contacts);
  // Store's fetchContacts() is called elsewhere (hook or on mount)
}
```

---

**← [Phase 4 — Offline Messages](./phase-4-offline-messages.md) | [Phase 6 — Integration →](./phase-6-integration.md)**
