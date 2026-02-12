# Frontend Architecture Guide

> Complete reference for the P2P Chat Tauri/React/TypeScript frontend.
> Last updated based on codebase in `ui-tauri/`.

---

## Table of Contents

1. [Tech Stack](#1-tech-stack)
2. [Project Structure](#2-project-structure)
3. [Component Hierarchy](#3-component-hierarchy)
4. [State Management](#4-state-management)
5. [CSS Architecture](#5-css-architecture)
6. [Data Flow Diagrams](#6-data-flow-diagrams)
7. [Adding New Features](#7-adding-new-features)
8. [Build & Development](#8-build--development)

---

## 1. Tech Stack

| Layer               | Technology                | Version  | Purpose                                    |
| ------------------- | ------------------------- | -------- | ------------------------------------------ |
| **Desktop shell**   | Tauri v2                  | ^2       | Rust-based native window + webview wrapper  |
| **UI framework**    | React                     | ^19.1    | Component rendering                         |
| **Language**         | TypeScript                | ~5.8     | Static typing for the entire frontend       |
| **State management** | Zustand                  | ^5.0     | Lightweight stores (3 stores)               |
| **Animations**      | Framer Motion             | ^12.34   | Spring-based, declarative animations        |
| **Styling**         | Tailwind CSS v4           | ^4.1     | Utility classes + `@tailwindcss/vite` plugin |
| **Styling (custom)**| CSS Modules               | —        | 6 hand-written CSS files for custom design  |
| **Virtualized lists**| react-virtuoso           | ^4.18    | Efficient message list rendering            |
| **Emoji picker**    | emoji-mart                | ^5.6     | Full emoji picker + data bundle             |
| **Icons**           | lucide-react              | ^0.563   | Tree-shakable SVG icons                     |
| **Date formatting** | date-fns                  | ^4.1     | `formatDistanceToNow`, `format`, `isToday`  |
| **Class merging**   | clsx + tailwind-merge     | —        | Conditional class composition via `cn()`    |
| **Bundler**         | Vite                      | ^7.0     | Dev server on port 1420, HMR               |

### Why These Choices?

- **Tauri v2** — Produces ~5 MB installers (vs. ~150 MB for Electron). The Rust shell manages the sidecar C++ backend process.
- **Zustand** — No boilerplate. Three small stores replace what would be hundreds of lines of Redux or Context code.
- **Tailwind v4** — Uses the new `@tailwindcss/vite` plugin (not PostCSS). Dark mode is handled via `@custom-variant dark (&:is(.dark *))` toggling a `.dark` class on `<html>`.
- **react-virtuoso** — The message list can have thousands of entries; only visible bubbles are rendered.
- **Framer Motion** — Every interaction (messages popping in, contacts sliding, reactions bouncing) uses spring physics.

---

## 2. Project Structure

```
ui-tauri/
├── index.html                 — Single HTML entry (Vite injects <script>)
├── package.json               — Dependencies & scripts
├── vite.config.ts             — Vite + React + Tailwind v4 plugin + @ alias
├── tsconfig.json              — TypeScript config
│
├── src/
│   ├── main.tsx               — ReactDOM.createRoot, renders <App /> in StrictMode
│   ├── App.tsx                — Root component: initializes theme, WS, health polling
│   ├── vite-env.d.ts          — Vite client type declarations
│   │
│   ├── components/
│   │   ├── layout/            — Top-level shell components
│   │   │   ├── AppShell.tsx   — Flex container: TitleBar + Sidebar + ChatPanel
│   │   │   ├── TitleBar.tsx   — Draggable title bar with logo, status badge, theme toggle
│   │   │   └── Sidebar.tsx    — Header, search input, contact list, add-friend dialog
│   │   │
│   │   ├── chat/              — Chat conversation components
│   │   │   ├── ChatPanel.tsx  — Wraps ChatHeader + MessageList + TypingIndicator + ComposeArea
│   │   │   ├── ChatHeader.tsx — Avatar, name, online status, E2E pill, menu button
│   │   │   ├── MessageList.tsx— react-virtuoso list with grouped messages, infinite scroll up
│   │   │   ├── MessageGroup.tsx— Groups consecutive messages from same sender (< 2 min gap)
│   │   │   ├── MessageBubble.tsx— Individual message: text, time, delivery icons, reactions
│   │   │   ├── ComposeArea.tsx— Textarea with emoji button, send button, typing indicator
│   │   │   ├── TypingIndicator.tsx — Animated bouncing dots with username
│   │   │   └── EmptyChat.tsx  — Placeholder when no conversation selected
│   │   │
│   │   ├── contacts/          — Contact/friend list components
│   │   │   ├── ContactList.tsx    — AnimatePresence list of ContactItems with sort/filter
│   │   │   ├── ContactItem.tsx    — Avatar, name, last message preview, unread badge, time
│   │   │   ├── AddFriendDialog.tsx— Modal dialog: input username, submit, success/error states
│   │   │   └── PresenceIndicator.tsx — Online/offline dot + label (used standalone)
│   │   │
│   │   ├── common/            — Shared UI atoms
│   │   │   ├── Avatar.tsx     — Gradient circle with initials + optional status dot
│   │   │   ├── Badge.tsx      — Unread count pill (hides at 0, caps at "99+")
│   │   │   ├── StatusDot.tsx  — Colored dot with optional pulse animation
│   │   │   └── ThemeToggle.tsx— Cycles system → light → dark with rotate animation
│   │   │
│   │   ├── emoji/             — Emoji-related components
│   │   │   ├── EmojiPicker.tsx— Wraps @emoji-mart/react with theme-awareness + outside-click
│   │   │   └── ReactionBar.tsx— Quick-react popup: 👍 ❤️ 😂 😮 😢
│   │   │
│   │   └── ui/                — (Reserved for generic primitives — currently empty)
│   │
│   ├── hooks/                 — Custom React hooks
│   │   ├── useWebSocket.ts    — Connects to WS, dispatches events to stores
│   │   ├── useMessages.ts     — Per-peer message loading, sending, typing state
│   │   ├── useContacts.ts     — Polling fetch, search, sort (online first, then by time)
│   │   ├── useTheme.ts        — Resolves system/light/dark, applies .dark class
│   │   └── useNotification.ts — Browser Notification API wrapper
│   │
│   ├── services/              — External communication layer
│   │   ├── api.ts             — REST client (ApiService class) for /status, /friends, /messages
│   │   ├── websocket.ts       — WebSocket client with auto-reconnect + exponential backoff
│   │   └── sidecar.ts         — Tauri sidecar management for C++ backend (stub during dev)
│   │
│   ├── stores/                — Zustand state stores
│   │   ├── chatStore.ts       — Active chat, messages by peer, typing, pagination
│   │   ├── contactStore.ts    — Friends list, online status, unread counts
│   │   ├── uiStore.ts         — Theme, sidebar width, connection status (persisted)
│   │   └── index.ts           — Re-exports all stores
│   │
│   ├── types/                 — TypeScript interfaces
│   │   ├── message.ts         — Message, Reaction, MessageGroup
│   │   ├── contact.ts         — Contact, ContactWithPreview
│   │   ├── events.ts          — WSEvent (server→client), WSClientEvent (client→server)
│   │   └── api.ts             — StatusResponse, MessagesResponse, ApiError
│   │
│   ├── lib/                   — Shared utilities
│   │   ├── utils.ts           — cn() helper (clsx + tailwind-merge)
│   │   ├── constants.ts       — API_BASE_URL, WS_URL, polling intervals, page sizes
│   │   └── animations.ts      — Framer Motion Variants (messagePopIn, slideIn, fadeIn, etc.)
│   │
│   └── styles/                — CSS modules (imported from globals.css)
│       ├── globals.css        — Tailwind import, custom dark variant, base resets, emoji overrides
│       ├── theme.css          — Design tokens: colors, spacing, radii, shadows, transitions
│       ├── layout.css         — App shell, titlebar, sidebar, chat panel, resize handle
│       ├── components.css     — Buttons, inputs, avatars, badges, pills, dialogs, contacts
│       ├── chat.css           — Bubbles, compose area, typing indicator, message groups
│       ├── animations.css     — @keyframes + utility animation classes
│       └── scrollbar.css      — Custom thin scrollbar styling
│
└── src-tauri/                 — Rust backend for Tauri (window management, plugins)
```

### Path Aliases

The `@` alias maps to `src/` (configured in `vite.config.ts`):

```typescript
// Instead of:
import { api } from "../../../services/api";
// Write:
import { api } from "@/services/api";
```

---

## 3. Component Hierarchy

```
App                                        ← Root: initializes theme, WebSocket, health polling
 │
 └── AppShell (.app-shell)                 ← Flex column: titlebar + main area
      │
      ├── TitleBar (.titlebar)             ← data-tauri-drag-region (native window drag)
      │    ├── Logo "P2" + Name "P2P Chat"
      │    ├── Status Badge (Shield/ShieldOff) ← "Secure" or "Disconnected"
      │    └── ThemeToggle                 ← Cycles: system → light → dark
      │
      └── Main Area (.main-area)           ← Flex row: sidebar + resize + chat
           │
           ├── Sidebar (.sidebar)          ← Fixed width (280–420px, persisted)
           │    ├── Header: "Messages" + Add Friend button (UserPlus icon)
           │    ├── Search Input (.search-wrap)
           │    ├── ContactList            ← AnimatePresence + sorted list
           │    │    └── ContactItem (×N)  ← motion.button with hover/tap animations
           │    │         ├── Avatar       ← Gradient initials circle + StatusDot
           │    │         ├── Name + Time  ← Username + relative time (date-fns)
           │    │         └── Preview + Badge ← Last message text + unread count
           │    └── AddFriendDialog        ← Modal overlay (conditional)
           │
           ├── Resize Handle (.resize-handle) ← 4px draggable divider
           │
           └── ChatPanel (.chat-panel)     ← Shown when activeChat !== null
           │    ├── ChatHeader (.chat-panel__header)
           │    │    ├── Avatar + Name + StatusDot + relative time
           │    │    └── E2E Pill (Lock icon) + Menu button (MoreVertical)
           │    │
           │    ├── MessageList (react-virtuoso) ← Virtualized, scrolls to bottom
           │    │    └── MessageGroup (×N)      ← Same sender, < 2 min apart
           │    │         ├── Group Time Label  ← "2:30 PM" / "Yesterday 4:15 PM"
           │    │         └── MessageBubble (×N) ← motion.div with messagePopIn
           │    │              ├── Text (.bubble__text)
           │    │              ├── Meta: Time + Delivery Icons
           │    │              │    ├── Cloud (offline) or Zap (direct)
           │    │              │    └── Check (pending) or CheckCheck (delivered)
           │    │              ├── Reactions (.bubble__reactions)
           │    │              └── ReactionBar (on hover, absolute positioned)
           │    │                   └── 👍 ❤️ 😂 😮 😢 buttons
           │    │
           │    ├── TypingIndicator         ← Animated dots (conditional, AnimatePresence)
           │    │
           │    └── ComposeArea (.chat-panel__compose)
           │         ├── Emoji Button → EmojiPicker (absolute, AnimatePresence)
           │         ├── Textarea (auto-resize, max 120px height)
           │         └── Send Button (active/inactive states)
           │
           └── EmptyChat (.empty-chat)     ← Shown when activeChat === null
                ├── Floating MessageCircle icon with Lock badge
                ├── "P2P Chat" heading + description
                └── Feature pills: "E2E Encrypted", "Peer-to-Peer"
```

### Component Responsibility Rules

| Principle | Description |
| --------- | ----------- |
| **Hooks own side effects** | Components don't call `api.*` or `websocket.*` directly — hooks do. |
| **Stores own state** | Components read from Zustand stores via selectors; never local `useState` for shared state. |
| **Components own presentation** | CSS classes, animations, and conditional rendering live in components. |
| **Services own I/O** | `api.ts` wraps `fetch`, `websocket.ts` wraps `WebSocket`, `sidecar.ts` wraps Tauri shell. |

---

## 4. State Management

The app uses **three Zustand stores**, each with a single responsibility. Stores are created with `create<T>()` and consumed in components via hook selectors:

```typescript
// ✅ Good — only re-renders when activeChat changes
const activeChat = useChatStore((s) => s.activeChat);

// ❌ Bad — re-renders on ANY store change
const store = useChatStore();
```

---

### 4.1 chatStore

**File:** `src/stores/chatStore.ts`
**Purpose:** Everything about the active conversation and message data.

#### State

| Field | Type | Description |
| ----- | ---- | ----------- |
| `activeChat` | `string \| null` | Username of the currently selected contact, or `null` for empty state |
| `messages` | `Record<string, Message[]>` | Messages keyed by peer username. Each array is ordered chronologically |
| `hasMore` | `Record<string, boolean>` | Whether older messages exist for pagination (per peer) |
| `loadingMessages` | `boolean` | True while a message fetch is in progress |
| `sendingMessage` | `boolean` | True while a message send is in progress |
| `typingUsers` | `Record<string, boolean>` | Which peers are currently typing |

#### Actions

| Action | Signature | What It Does |
| ------ | --------- | ------------ |
| `setActiveChat` | `(username: string \| null) => void` | Switches the active conversation |
| `fetchMessages` | `(peer: string, offset?: number) => Promise<void>` | Calls `api.getMessages()`, stores results. Offset 0 = replace; offset > 0 = prepend older messages |
| `loadMoreMessages` | `(peer: string) => Promise<void>` | Loads the next page of older messages (guards against double-loading) |
| `addMessage` | `(msg: Message) => void` | Appends a new message (deduplicates by `msg_id`) |
| `sendMessage` | `(to: string, text: string) => Promise<void>` | Calls `api.sendMessage()`, then creates an optimistic local `Message` and calls `addMessage()` |
| `setTyping` | `(username: string, typing: boolean) => void` | Marks a peer as typing. Auto-clears after 5 seconds via `setTimeout` |
| `clearTypingTimeout` | `(username: string) => void` | Manually clears the typing auto-clear timer |

#### Example Usage

```typescript
// In a component — read messages for the active peer
const messages = useChatStore((s) =>
  s.activeChat ? s.messages[s.activeChat] ?? [] : []
);

// In a hook — send a message
const sendMessage = useChatStore((s) => s.sendMessage);
await sendMessage("alice", "Hello!");
```

#### How Message Pagination Works

```
1. User opens chat with "alice"
   → fetchMessages("alice", 0)  — fetches newest 50 messages
   → stores them in messages["alice"], sets hasMore["alice"]

2. User scrolls to top of message list
   → react-virtuoso fires startReached callback
   → loadMoreMessages("alice")
   → fetchMessages("alice", 50)  — fetches messages 50–99
   → prepends to messages["alice"]

3. New message arrives via WebSocket
   → addMessage(msg) — appends to end, deduplicates by msg_id
```

---

### 4.2 contactStore

**File:** `src/stores/contactStore.ts`
**Purpose:** Friends list, online status tracking, unread counts, and search.

#### State

| Field | Type | Description |
| ----- | ---- | ----------- |
| `contacts` | `ContactWithPreview[]` | All friends with UI-augmented preview data |
| `loading` | `boolean` | True during fetch |
| `error` | `string \| null` | Last error message |
| `searchQuery` | `string` | Current search filter text |

#### The ContactWithPreview Type

```typescript
interface Contact {
  username: string;
  public_key: string;
  signing_key: string;
  online: boolean;
  last_seen: string;
  last_ip: string;
  added_at: string;
}

interface ContactWithPreview extends Contact {
  lastMessage?: string;       // Preview text for sidebar
  lastMessageTime?: string;   // ISO timestamp of last message
  unreadCount: number;        // Badge number
}
```

The `lastMessage`, `lastMessageTime`, and `unreadCount` fields are **client-side only** — they're preserved across `fetchContacts()` re-fetches by merging with existing data.

#### Actions

| Action | Signature | What It Does |
| ------ | --------- | ------------ |
| `fetchContacts` | `() => Promise<void>` | Fetches `/friends` from the API, merges with existing preview data |
| `addFriend` | `(username: string) => Promise<void>` | POSTs to `/friends`, appends the new contact |
| `removeFriend` | `(username: string) => Promise<void>` | DELETEs `/friends/:username`, removes from local list |
| `setOnline` | `(username: string) => void` | Marks a contact as online (from WebSocket event) |
| `setOffline` | `(username: string) => void` | Marks a contact as offline, updates `last_seen` to now |
| `setSearchQuery` | `(query: string) => void` | Updates the search filter |
| `updateLastMessage` | `(username: string, text: string, time: string) => void` | Updates sidebar preview text and time |
| `incrementUnread` | `(username: string) => void` | Bumps the unread badge count by 1 |
| `clearUnread` | `(username: string) => void` | Resets unread badge to 0 (called when opening a chat) |

#### Example Usage

```typescript
// In useContacts hook — sorted, filtered contacts for the sidebar
const contacts = useContactStore((s) => s.contacts);
const searchQuery = useContactStore((s) => s.searchQuery);

const filtered = searchQuery
  ? contacts.filter((c) =>
      c.username.toLowerCase().includes(searchQuery.toLowerCase())
    )
  : contacts;

const sorted = [...filtered].sort((a, b) => {
  if (a.online !== b.online) return a.online ? -1 : 1;           // Online first
  if (a.lastMessageTime && b.lastMessageTime) {
    return new Date(b.lastMessageTime).getTime()
         - new Date(a.lastMessageTime).getTime();                 // Recent first
  }
  return a.username.localeCompare(b.username);                    // Alphabetical
});
```

---

### 4.3 uiStore (Persisted)

**File:** `src/stores/uiStore.ts`
**Purpose:** UI preferences and connection status. Persisted to `localStorage` under key `"p2p-chat-ui"`.

#### State

| Field | Type | Default | Persisted? | Description |
| ----- | ---- | ------- | ---------- | ----------- |
| `theme` | `"light" \| "dark" \| "system"` | `"system"` | ✅ | User's theme preference |
| `resolvedTheme` | `"light" \| "dark"` | `"dark"` | ❌ | Actual applied theme after system detection |
| `sidebarWidth` | `number` | `320` | ✅ | Sidebar panel width in pixels (280–420 range) |
| `showAddFriendDialog` | `boolean` | `false` | ❌ | Whether the add-friend modal is open |
| `showEmojiPicker` | `boolean` | `false` | ❌ | Whether the emoji picker is visible |
| `backendConnected` | `boolean` | `false` | ❌ | Whether the C++ backend HTTP health check passes |
| `wsConnected` | `boolean` | `false` | ❌ | Whether the WebSocket connection is open |

#### Persistence Configuration

Only `theme` and `sidebarWidth` are persisted:

```typescript
persist(
  (set) => ({ /* ... */ }),
  {
    name: "p2p-chat-ui",           // localStorage key
    partialize: (state) => ({
      theme: state.theme,
      sidebarWidth: state.sidebarWidth,
    }),
  }
)
```

This means refreshing the page remembers your theme choice and sidebar width, but transient state (connection status, dialog visibility) resets.

---

### 4.4 Store Interaction Map

```
┌──────────────┐      ┌───────────────┐      ┌──────────┐
│  chatStore   │◄────►│ contactStore   │      │ uiStore  │
│              │      │               │      │          │
│ activeChat   │      │ contacts[]    │      │ theme    │
│ messages{}   │      │ searchQuery   │      │ sidebar  │
│ typingUsers  │      │ unreadCount   │      │ ws/http  │
└──────┬───────┘      └───────┬───────┘      └────┬─────┘
       │                      │                    │
       │    ┌─────────────────┼────────────────────┘
       │    │                 │
       ▼    ▼                 ▼
  ┌──────────────────────────────┐
  │        useWebSocket()        │  ← Bridges all three stores
  │  Dispatches WS events to:   │
  │  • chatStore.addMessage()    │
  │  • chatStore.setTyping()     │
  │  • contactStore.setOnline()  │
  │  • contactStore.setOffline() │
  │  • contactStore.updateLast.. │
  │  • contactStore.incUnread()  │
  │  • uiStore.setWsConnected()  │
  └──────────────────────────────┘
```

---

## 5. CSS Architecture

The styling system uses **two layers** working together:

1. **Tailwind CSS v4** — Utility classes for quick layout/spacing (e.g., `flex items-center gap-3`)
2. **Custom CSS modules** — BEM-style classes for complex, reusable components (e.g., `.bubble--sent`)

### 5.1 Import Order

In `globals.css`:
```css
@import "tailwindcss";
@custom-variant dark (&:is(.dark *));

@import "./theme.css";
@import "./layout.css";
@import "./components.css";
@import "./chat.css";
@import "./animations.css";
@import "./scrollbar.css";
```

> **Important:** Tailwind v4 uses `@tailwindcss/vite` as a Vite plugin — there is no PostCSS config file.

### 5.2 Dark Mode Strategy

Dark mode uses a **class-based strategy**:

1. `useTheme()` hook resolves `system` → actual preference via `matchMedia`
2. Applies/removes `.dark` class on `document.documentElement`
3. Tailwind's custom variant `@custom-variant dark (&:is(.dark *))` makes `dark:` utilities work
4. Custom CSS overrides variables in `.dark { ... }` block in `theme.css`

### 5.3 The 6 CSS Modules

#### theme.css — Design Tokens

The single source of truth for **every visual value** in the app. Uses Tailwind v4's `@theme` directive to register CSS custom properties as part of the Tailwind theme.

| Token Category | Examples | Count |
| -------------- | -------- | ----- |
| **Brand colors** | `--color-accent: #6366f1`, `--color-accent-hover`, `--color-accent-soft`, `--color-accent-glow` | 4 |
| **Surface colors** | `--color-bg-app`, `--color-bg-base`, `--color-bg-raised`, `--color-bg-sunken`, `--color-bg-hover`, `--color-bg-active`, `--color-bg-overlay`, `--color-bg-bubble-sent`, `--color-bg-bubble-received`, `--color-bg-input` | 10 |
| **Text colors** | `--color-text-primary`, `--color-text-secondary`, `--color-text-muted`, `--color-text-inverse`, `--color-text-accent` | 5 |
| **Border colors** | `--color-border`, `--color-border-strong` | 2 |
| **Status colors** | `--color-online`, `--color-offline`, `--color-danger`, `--color-warning`, `--color-success` | 5 |
| **Typography** | `--font-sans` (Inter stack), `--font-mono` (JetBrains Mono) | 2 |
| **Spacing** | `--space-xs` (4px) through `--space-4xl` (40px) | 8 |
| **Radii** | `--radius-sm` (8px) through `--radius-pill` (9999px) | 6 |
| **Shadows** | `--shadow-xs` through `--shadow-xl`, `--shadow-glow`, `--shadow-float` | 7 |
| **Transitions** | `--ease-out`, `--ease-spring`, `--duration-fast/normal/slow` | 5 |

Dark mode overrides are defined in a `.dark { ... }` block that redefines surfaces, text, borders, and shadows for dark backgrounds.

```css
/* Light mode (default) */
--color-bg-app: #eef0f4;
--color-bg-base: #ffffff;

/* Dark mode override */
.dark {
  --color-bg-app: #0b0d12;
  --color-bg-base: #13161d;
}
```

#### layout.css — Structural Classes

Defines the app's top-level layout structure:

| Class | Element | Key Properties |
| ----- | ------- | -------------- |
| `.app-shell` | Root container | `flex column, height: 100%, gap: 8px` |
| `.titlebar` | Top bar | `height: 52px, border-radius: 20px, box-shadow: float, -webkit-app-region: drag` |
| `.titlebar__brand` | Logo + name group | Flex row with gap |
| `.titlebar__logo` | "P2" badge | `28×28px, gradient background, white text` |
| `.titlebar__status` | Connection pill | Pill with green/red color variants |
| `.main-area` | Below titlebar | `flex row, gap: 8px, overflow: hidden` |
| `.sidebar` | Left panel | `flex column, border-radius: 20px, box-shadow: float` |
| `.resize-handle` | Divider | `width: 4px, cursor: col-resize`, accent color on hover/active |
| `.chat-panel` | Right panel | `flex column, flex: 1, border-radius: 20px` |
| `.empty-chat` | No-chat placeholder | Centered flex with `height: 100%` |

The entire app uses **rounded floating panels** with `box-shadow: var(--shadow-float)` — no hard edges. The `#root` has `padding: 20px` to create gaps around all panels.

#### components.css — Reusable UI Components

| Component | Class Prefix | Description |
| --------- | ------------ | ----------- |
| Icon button | `.icon-btn`, `.icon-btn--accent` | 32×32px transparent button, accent variant with glow |
| Text input | `.input`, `.input--search` | Rounded input with focus ring, search variant with left padding |
| Primary button | `.btn-primary` | Full-width accent button with hover glow and lift |
| Avatar | `.avatar`, `.avatar--sm/md/lg` | Relative container for gradient circle + status dot |
| Badge | `.badge` | Pill with min-width 18px, accent background |
| Feature pill | `.pill`, `.pill__icon` | Inline-flex rounded label for "E2E", "P2P" badges |
| Dialog | `.dialog-overlay`, `.dialog` | Fixed overlay with blur + centered card |
| Contact item | `.contact-item`, `.contact-item--active` | Full-width button with hover/active states |
| Search wrapper | `.search-wrap`, `.search-wrap__icon` | Positioned container for search icon overlay |

#### chat.css — Chat-Specific Styles

| Component | Class Prefix | Description |
| --------- | ------------ | ----------- |
| Bubble | `.bubble`, `.bubble--sent/received` | Max-width 65%, direction-aware styling |
| Bubble shape | `.bubble--solo/first/middle/last` | Dynamic border-radius for message groups |
| Bubble text | `.bubble__text` | 13.5px, pre-wrap, primary color |
| Bubble meta | `.bubble__meta`, `.bubble__time` | Right-aligned time + delivery status |
| Delivery icons | `.bubble__delivery-icon`, `--delivered` | Muted vs. accent-colored icon variants |
| Reactions | `.bubble__reactions`, `.bubble__reaction` | Inline emoji pills below message |
| Reaction bar | `.reaction-bar`, `.reaction-bar__btn` | Hover popup with quick-react emojis |
| Compose | `.compose`, `.compose__textarea` | Flex row with auto-resizing textarea |
| Send button | `.compose__send--active/inactive` | Active: accent bg. Inactive: muted bg |
| Typing | `.typing`, `.typing__dots`, `.typing__dot` | Inline indicator with bouncing dots |
| Message group | `.msg-group--sent/received` | Column flex with directional alignment |
| Message list | `.message-list`, `.message-list__empty` | Full height container, empty state styling |
| Chat header | `.chat-header__*` | User info + actions layout |

**Bubble Border Radius Logic:**

Messages from the same sender within 2 minutes are grouped. Each bubble gets a position class that determines its corner rounding:

```
   ╭────────────────╮     ← solo: all corners rounded
   │  Hello!         │
   ╰────────────────╯

   ╭────────────────╮     ← first: top rounded, bottom-right tight
   │  Hey there       │
   ├────────────────╮     ← middle: right side tight
   │  How are you?    │
   ├────────────────╮     ← last: bottom rounded, top-right tight
   │  What's up?      │
   ╰────────────────╯
```

#### animations.css — Keyframes & Utilities

| Keyframe | Duration | Used By |
| -------- | -------- | ------- |
| `status-pulse` | 2.5s infinite | Online status dots (green glow pulse) |
| `typing-bounce` | 1.2s infinite | Typing indicator dots (staggered with `animation-delay`) |
| `shimmer` | 1.5s infinite | Loading skeleton placeholder |
| `glow-pulse` | 3s infinite | Accent glow animation |
| `fade-in-up` | `--duration-slow` | Entry animation (translate + opacity) |
| `scale-in` | `--duration-normal` | Entry animation (scale + opacity) |
| `slide-in-left` | — | Slide in from left edge |
| `float` | 4s infinite | Gentle up-down float |
| `spin` | 0.8s linear | Loading spinners |

Utility classes: `.animate-status-pulse`, `.animate-shimmer`, `.animate-fade-in-up`, `.animate-scale-in`, `.animate-float`, `.animate-spin`, `.animate-glow`

**Note:** These CSS animations complement Framer Motion's JavaScript animations. CSS keyframes are used for infinite loops (status pulse, typing dots), while Framer Motion handles one-shot transitions (message pop-in, list item entrance).

#### scrollbar.css — Scrollbar Styling

Custom WebKit scrollbar: 5px wide, transparent track, rounded thumb using `--color-border-strong`. The `.scrollbar-thin` utility class hides scrollbars until hover.

### 5.4 Framer Motion Animations (JavaScript)

Defined in `src/lib/animations.ts` as reusable `Variants` objects:

| Variant | Animation | Used By |
| ------- | --------- | ------- |
| `messagePopIn` | `y: 12 → 0, scale: 0.95 → 1` (spring) | MessageGroup → each MessageBubble |
| `slideInLeft` | `x: -20 → 0` (spring) | — |
| `slideInRight` | `x: 20 → 0` (spring) | — |
| `fadeIn` | `opacity: 0 → 1` (200ms) | EmptyChat |
| `scaleIn` | `scale: 0.8 → 1` (spring) | — |
| `reactionBounce` | `scale: 0 → 1` (bouncy spring) | ReactionBar |
| `typingDot` | `y: [-2, 2, -2]` (repeat infinite) | — |
| `presenceGlow` | Green box-shadow pulse | — |
| `listItem` | `x: -8 → 0` (staggered by index) | ContactList items |
| `hoverScale` | `whileHover: 1.02, whileTap: 0.98` | — |
| `buttonPress` | `whileHover: 1.05, whileTap: 0.92` | Sidebar add-friend button, send button |

### 5.5 When to Use Tailwind vs. Custom CSS

| Use Case | Approach | Example |
| -------- | -------- | ------- |
| Quick layout/spacing | Tailwind utilities | `className="flex items-center gap-3 mt-2"` |
| Complex component with many states | Custom CSS class | `.bubble--sent`, `.contact-item--active` |
| One-off inline adjustment | Tailwind | `className="text-[13px] leading-relaxed"` |
| Design token value | CSS variable | `var(--color-accent)`, `var(--radius-lg)` |
| Conditional classes | `cn()` helper | `cn("bubble", isSent ? "bubble--sent" : "bubble--received")` |

---

## 6. Data Flow Diagrams

### 6.1 Sending a Message

```
User types text, hits Enter or clicks Send
         │
         ▼
┌─────────────────────┐
│    ComposeArea      │  1. Validates text is non-empty
│    component        │  2. Calls onSend(text) prop
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│   useMessages()     │  3. send(text) → sendMessage(peer, text.trim())
│   hook              │  4. Calls updateLastMessage() on contactStore
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│   chatStore         │  5. Sets sendingMessage = true
│   .sendMessage()    │  6. Calls api.sendMessage(to, text)
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│   api.sendMessage() │  7. POST /messages { to, text }
│   (REST)            │  8. Returns { msg_id, delivered, delivery_method }
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│   chatStore         │  9. Creates optimistic Message object
│   .addMessage()     │  10. Appends to messages[peer] (deduplicates by msg_id)
└─────────┬───────────┘
          │
          ▼
   React re-renders:
   MessageList → MessageGroup → new MessageBubble appears
   react-virtuoso scrolls to bottom
```

### 6.2 Receiving a Message (WebSocket)

```
Backend pushes event over WebSocket
         │
         ▼
┌─────────────────────┐
│   WebSocketService  │  1. ws.onmessage fires
│   websocket.ts      │  2. JSON.parse → WSEvent
│                     │  3. Dispatches to all subscribed handlers
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│   useWebSocket()    │  4. handleEvent() switches on event.event
│   hook              │
│                     │  case "new_message":
│                     │    5. chatStore.addMessage(event.data)
│                     │    6. contactStore.updateLastMessage(from, text, time)
│                     │    7. If from !== activeChat:
│                     │       contactStore.incrementUnread(from)
│                     │
│                     │  case "friend_online":
│                     │    8. contactStore.setOnline(username)
│                     │
│                     │  case "friend_offline":
│                     │    9. contactStore.setOffline(username)
│                     │
│                     │  case "typing":
│                     │    10. chatStore.setTyping(username, typing)
└─────────┬───────────┘
          │
          ▼
   React re-renders affected components:
   • MessageBubble (new message)
   • ContactItem (updated preview, badge, status)
   • TypingIndicator (shows/hides)
```

### 6.3 Contact List Update

```
┌─────────────────────┐
│   useContacts()     │  1. On mount: fetchContacts()
│   hook              │  2. Sets interval: fetchContacts() every 10s
│                     │     (POLL_INTERVAL_MS * 5 = 2000 * 5 = 10000ms)
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│   contactStore      │  3. Sets loading = true
│   .fetchContacts()  │  4. Calls api.listFriends()
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│   api.listFriends() │  5. GET /friends
│   (REST)            │  6. Returns Contact[]
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│   contactStore      │  7. Merges server data with existing preview data:
│   merge logic       │     - Keeps lastMessage, lastMessageTime, unreadCount
│                     │     - Updates online, last_seen, etc. from server
│                     │  8. Sets contacts = merged result
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│   useContacts()     │  9. Filters by searchQuery (case-insensitive)
│   sort & filter     │  10. Sorts: online first → recent messages → alphabetical
└─────────┬───────────┘
          │
          ▼
   ContactList re-renders with AnimatePresence
   ContactItems slide in/out with staggered animation
```

### 6.4 Theme Change

```
User clicks ThemeToggle button
         │
         ▼
┌─────────────────────┐
│   ThemeToggle       │  1. Calls cycleTheme()
│   component         │     system → light → dark → system
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│   useTheme()        │  2. setTheme(next) → uiStore updates
│   hook              │  3. useEffect triggers (theme dependency)
│                     │  4. If "system": reads matchMedia, listens for changes
│                     │     If "light"/"dark": uses directly
│                     │  5. Calls applyTheme(resolved)
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│   applyTheme()      │  6. document.documentElement.classList.toggle("dark", resolved === "dark")
│                     │  7. uiStore.setResolvedTheme(resolved)
└─────────┬───────────┘
          │
          ▼
   CSS cascade applies:
   • .dark { ... } overrides in theme.css activate/deactivate
   • All var(--color-*) references update instantly
   • Tailwind dark: variants activate via @custom-variant
   • uiStore persists theme choice to localStorage
```

### 6.5 WebSocket Connection Lifecycle

```
App mounts
    │
    ▼
useWebSocket() runs in useEffect
    │
    ├── websocket.subscribe(handleEvent)   ← Register event handler
    ├── websocket.connect()                ← Open WS to ws://127.0.0.1:8081/events
    └── setInterval(checkConnected, 1000)  ← Poll connection status → uiStore
         │
         ▼
    On disconnect:
    ├── ws.onclose fires
    ├── scheduleReconnect()
    │   └── delay = 3000ms × 1.5^attempt  ← Exponential backoff
    │       (max 10 attempts)
    └── Reconnects automatically
         │
    On cleanup (component unmount):
    ├── unsub()                            ← Remove event handler
    ├── clearInterval(interval)
    └── websocket.disconnect()             ← Close WS, cancel reconnect timer
```

---

## 7. Adding New Features

### 7.1 Add a New REST Endpoint Call

**Example:** Add `GET /friends/:username/profile`

**Step 1:** Add the response type in `src/types/api.ts`:

```typescript
export interface ProfileResponse {
  username: string;
  bio: string;
  avatar_url: string;
}
```

**Step 2:** Add the method to `src/services/api.ts`:

```typescript
async getProfile(username: string): Promise<ProfileResponse> {
  return this.request<ProfileResponse>(
    `/friends/${encodeURIComponent(username)}/profile`
  );
}
```

**Step 3:** Call it from a hook or store action:

```typescript
// In a hook
const profile = await api.getProfile("alice");
```

---

### 7.2 Add a New WebSocket Event Handler

**Example:** Handle a `"message_delivered"` event from the server.

**Step 1:** Add the event type in `src/types/events.ts`:

```typescript
export type WSEvent =
  | { event: "new_message"; data: Message }
  | { event: "friend_online"; data: { username: string } }
  | { event: "friend_offline"; data: { username: string } }
  | { event: "typing"; data: { username: string; typing: boolean } }
  | { event: "message_delivered"; data: { msg_id: string; peer: string } };  // ← Add this
```

**Step 2:** Handle it in `src/hooks/useWebSocket.ts`:

```typescript
case "message_delivered":
  // Update the message's delivered status in the store
  // (You'd add a markDelivered action to chatStore)
  markDelivered(event.data.msg_id, event.data.peer);
  break;
```

---

### 7.3 Add a New Component

**Example:** Create a `UserProfile` panel component.

**Step 1:** Create the file in the right directory:

```
src/components/contacts/UserProfile.tsx
```

**Step 2:** Follow the existing patterns:

```tsx
import { motion } from "framer-motion";
import { Avatar } from "@/components/common/Avatar";
import { cn } from "@/lib/utils";
import { fadeIn } from "@/lib/animations";

interface UserProfileProps {
  username: string;
  online: boolean;
}

export function UserProfile({ username, online }: UserProfileProps) {
  return (
    <motion.div
      className="user-profile"
      variants={fadeIn}
      initial="hidden"
      animate="visible"
    >
      <Avatar username={username} online={online} size="lg" />
      <h3 className={cn("text-lg font-semibold", "text-[var(--color-text-primary)]")}>
        {username}
      </h3>
    </motion.div>
  );
}
```

**Step 3:** Add CSS for the component in the appropriate CSS module (e.g., `components.css`):

```css
.user-profile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-lg);
  padding: var(--space-2xl);
}
```

**Conventions to follow:**
- Use named exports (not default exports)
- Use `cn()` for conditional class merging
- Use design tokens (`var(--color-*)`, `var(--space-*)`) not raw values
- Add Framer Motion animations for entrance/exit
- Keep components focused — one responsibility per file

---

### 7.4 Add a New Zustand Store Field

**Example:** Add a `replyingTo` field to `chatStore`.

**Step 1:** Add the field and action to the interface:

```typescript
interface ChatState {
  // ... existing fields
  replyingTo: Message | null;
  setReplyingTo: (msg: Message | null) => void;
}
```

**Step 2:** Add the initial state and action implementation:

```typescript
export const useChatStore = create<ChatState>((set) => ({
  // ... existing state
  replyingTo: null,
  setReplyingTo: (msg) => set({ replyingTo: msg }),
}));
```

**Step 3:** Use it in a component with a selector:

```typescript
const replyingTo = useChatStore((s) => s.replyingTo);
const setReplyingTo = useChatStore((s) => s.setReplyingTo);
```

---

### 7.5 Add a New CSS Class

**Step 1:** Choose the right CSS module:

| Type of class | Put it in |
| ------------- | --------- |
| Design token | `theme.css` (`@theme` block or `.dark` block) |
| Layout/panel structure | `layout.css` |
| Reusable component (button, input) | `components.css` |
| Chat-specific (bubble, compose) | `chat.css` |
| Animation keyframe | `animations.css` |
| Scrollbar | `scrollbar.css` |

**Step 2:** Follow the naming conventions:

```css
/* Block */
.user-profile { ... }

/* Element (double underscore) */
.user-profile__name { ... }
.user-profile__bio { ... }

/* Modifier (double dash) */
.user-profile--compact { ... }
.user-profile--expanded { ... }
```

**Step 3:** Use design tokens, not raw values:

```css
/* ✅ Good */
.user-profile {
  padding: var(--space-xl);
  border-radius: var(--radius-xl);
  background: var(--color-bg-base);
  box-shadow: var(--shadow-float);
  transition: all var(--duration-normal) var(--ease-out);
}

/* ❌ Bad */
.user-profile {
  padding: 20px;
  border-radius: 20px;
  background: #ffffff;
  box-shadow: 0 8px 30px rgba(0,0,0,0.07);
  transition: all 200ms ease-out;
}
```

---

## 8. Build & Development

### Commands

| Command | What It Does |
| ------- | ------------ |
| `npm run dev` | Starts Vite dev server at `http://localhost:1420` (frontend only, hot-reload) |
| `npm run tauri dev` | Starts full Tauri app with native window + Vite dev server inside |
| `npm run build` | Runs `tsc && vite build` — type-checks then creates production web bundle in `dist/` |
| `npm run tauri build` | Builds the full packaged desktop app (includes Rust compilation) |
| `npm run preview` | Preview the production build locally via Vite |

### Development Setup

```bash
cd ui-tauri

# Install dependencies
# ⚠️ --legacy-peer-deps is REQUIRED due to React 19 + emoji-mart peer dep conflict
npm install --legacy-peer-deps

# Start frontend dev server (for UI work without the desktop shell)
npm run dev

# Start full Tauri app (requires Rust toolchain installed)
npm run tauri dev
```

### Important Notes

1. **`--legacy-peer-deps` is required** for `npm install` because `@emoji-mart/react` declares a peer dependency on React 18, but this project uses React 19. Everything works fine at runtime.

2. **Tailwind v4 uses `@tailwindcss/vite`**, not the legacy PostCSS plugin. There is no `postcss.config.js` or `tailwind.config.js` — configuration happens inside CSS files using `@theme` and `@custom-variant` directives.

3. **The C++ backend must be running separately during development.** The frontend expects:
   - REST API at `http://127.0.0.1:8080`
   - WebSocket at `ws://127.0.0.1:8081/events`

   The `sidecar.ts` module is a stub — in production, Tauri will launch the backend binary automatically.

4. **Path alias `@`** maps to `src/`. This is configured in both:
   - `vite.config.ts` (for Vite resolution)
   - `tsconfig.json` (for TypeScript type-checking)

5. **Vite dev server port** is hardcoded to `1420` with `strictPort: true`. The Tauri webview points to this port during development.

### Production Build Pipeline

```
npm run tauri build
    │
    ├── Vite builds frontend → dist/
    │   ├── TypeScript compilation (tsc)
    │   ├── Tailwind CSS processing (@tailwindcss/vite)
    │   ├── React compilation (@vitejs/plugin-react)
    │   └── Asset bundling + tree-shaking
    │
    └── Cargo builds Tauri shell → target/release/
        ├── Compiles Rust code
        ├── Embeds dist/ into binary
        ├── Bundles sidecar (C++ backend binary)
        └── Produces installer (.msi / .dmg / .AppImage)
```

### Environment Variables

| Variable | Purpose | Default |
| -------- | ------- | ------- |
| `TAURI_DEV_HOST` | Custom dev server host (for remote debugging) | `false` (localhost) |

### Key Constants (`src/lib/constants.ts`)

| Constant | Value | Description |
| -------- | ----- | ----------- |
| `API_BASE_URL` | `http://127.0.0.1:8080` | C++ backend REST API |
| `WS_URL` | `ws://127.0.0.1:8081/events` | C++ backend WebSocket endpoint |
| `POLL_INTERVAL_MS` | `2000` | Base polling interval (health = 3×, contacts = 5×) |
| `WS_RECONNECT_DELAY_MS` | `3000` | Initial WebSocket reconnect delay |
| `WS_MAX_RECONNECT_ATTEMPTS` | `10` | Max reconnect retries before giving up |
| `MESSAGE_PAGE_SIZE` | `50` | Messages fetched per page |
| `TYPING_DEBOUNCE_MS` | `1000` | Debounce before sending "stopped typing" |
| `TYPING_TIMEOUT_MS` | `5000` | Auto-clear typing indicator |
| `APP_NAME` | `"P2P Chat"` | Application name |
| `APP_VERSION` | `"0.1.0"` | Current version |
