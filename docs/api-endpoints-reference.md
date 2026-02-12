# API Endpoints Reference

> **Version:** 0.1.0  
> **Base URL:** `http://127.0.0.1:8080`  
> **Protocol:** HTTP/1.1, JSON request/response bodies  
> **Audience:** Frontend developers and anyone integrating with the P2P Chat backend

The C++ backend exposes a localhost-only REST API on port `8080` (configurable
via `config.json` → `node.api_port`). **No authentication** is required — the
API binds to `127.0.0.1` only and is never exposed to the network.

All request bodies must be JSON with a `Content-Type: application/json` header.
All responses return JSON (except `204 No Content`). Errors always follow the
shape `{"error": "Human-readable message"}`.

---

## Table of Contents

| # | Method | Path | Summary |
|---|--------|------|---------|
| 1 | `GET` | [`/status`](#1-get-status) | Backend health check |
| 2 | `GET` | [`/friends`](#2-get-friends) | List all friends |
| 3 | `POST` | [`/friends`](#3-post-friends) | Add a friend by username |
| 4 | `DELETE` | [`/friends/:username`](#4-delete-friendsusername) | Remove a friend |
| 5 | `GET` | [`/messages`](#5-get-messagespeerxlimit50offset0) | Paginated chat history |
| 6 | `POST` | [`/messages`](#6-post-messages) | Send a message |
| 7 | `DELETE` | [`/messages/:id`](#7-delete-messagesid) | Delete a message |

---

## 1. `GET /status`

**Description:** Health-check endpoint. Returns whether the backend is running,
the current user's identity, uptime, connectivity status, and basic node
metadata. This is the first endpoint the frontend calls on startup and the one
it polls continuously to detect backend crashes.

**When frontend calls it:** `App.tsx` calls `api.getStatus()` immediately on
mount and then every **6 seconds** (`POLL_INTERVAL_MS × 3 = 2000 × 3`). If the
call fails (network error or non-2xx), the UI sets `backendConnected = false`
and shows a disconnection banner.

---

### Request

```
GET /status HTTP/1.1
Host: 127.0.0.1:8080
```

No request body. No query parameters.

---

### Response (success) — `200 OK`

```json
{
  "status": "ok",
  "username": "alice",
  "node_id": "a1b2c3d4e5f6789012345678abcdef01",
  "uptime_seconds": 3600,
  "friends_count": 5,
  "peer_port": 9100,
  "supabase_connected": true,
  "version": "0.1.0"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `string` | Always `"ok"` when the backend is healthy. |
| `username` | `string` | The local user's username (loaded from `config.json`). |
| `node_id` | `string` | Hex-encoded hash of the user's public key. Uniquely identifies this node on the network. |
| `uptime_seconds` | `number` | Whole seconds since the backend process started. |
| `friends_count` | `number` | Total friends stored in the local SQLite database. |
| `peer_port` | `number` | The TCP port the backend listens on for incoming peer-to-peer connections. |
| `supabase_connected` | `boolean` | `true` if the most recent Supabase heartbeat succeeded; `false` if the backend cannot reach Supabase (offline fallback disabled). |
| `version` | `string` | Semantic version of the backend binary. |

---

### Response (error) — `500 Internal Server Error`

```json
{
  "error": "Failed to read node configuration"
}
```

This only happens if the backend started but its internal state is corrupted.
In practice, if the backend isn't running at all the frontend gets a
`ConnectionError` / `TypeError: Failed to fetch` instead of an HTTP response.

---

### Status Codes

| Code | Meaning |
|------|---------|
| `200` | Backend is healthy, response contains node info. |
| `500` | Internal error (config unreadable, etc.). |

---

### Example with curl

```bash
# Basic health check
curl http://127.0.0.1:8080/status

# Pretty-printed output
curl -s http://127.0.0.1:8080/status | python -m json.tool
```

Expected output:
```json
{
    "status": "ok",
    "username": "alice",
    "node_id": "a1b2c3d4e5f6789012345678abcdef01",
    "uptime_seconds": 142,
    "friends_count": 3,
    "peer_port": 9100,
    "supabase_connected": true,
    "version": "0.1.0"
}
```

---

### Frontend code that calls this

```typescript
// In App.tsx — polls every 6 seconds
import { useEffect } from "react";
import { useUIStore } from "@/stores/uiStore";
import { api } from "@/services/api";
import { POLL_INTERVAL_MS } from "@/lib/constants"; // 2000

export default function App() {
  const setBackendConnected = useUIStore((s) => s.setBackendConnected);

  useEffect(() => {
    const check = async () => {
      try {
        await api.getStatus();
        setBackendConnected(true);
      } catch {
        setBackendConnected(false);
      }
    };
    check(); // immediate first check
    const interval = setInterval(check, POLL_INTERVAL_MS * 3); // 6000ms
    return () => clearInterval(interval);
  }, [setBackendConnected]);

  // ...
}
```

```typescript
// In services/api.ts — the actual fetch call
async getStatus(): Promise<StatusResponse> {
  return this.request<StatusResponse>("/status");
}
```

```typescript
// In types/api.ts — the TypeScript type for the response
export interface StatusResponse {
  status: string;
  username: string;
  node_id: string;
  uptime_seconds: number;
  friends_count: number;
  peer_port: number;
  supabase_connected: boolean;
  version: string;
}
```

---

## 2. `GET /friends`

**Description:** Returns an array of every friend stored in the local SQLite
database. Each friend object includes their cryptographic keys, online status,
last known IP address, and when they were added. The backend computes the
`online` field by checking whether `last_seen` is within the last 5 minutes.

**When frontend calls it:** The `useContacts` hook calls `api.listFriends()` on
mount and then polls every **10 seconds** (`POLL_INTERVAL_MS × 5 = 2000 × 5`).
The result populates the left-side contact list panel.

---

### Request

```
GET /friends HTTP/1.1
Host: 127.0.0.1:8080
```

No request body. No query parameters.

---

### Response (success) — `200 OK`

```json
[
  {
    "username": "bob",
    "public_key": "Ym9iX3B1YmxpY19rZXlfYmFzZTY0...",
    "signing_key": "Ym9iX3NpZ25pbmdfcHVibGljX2tleQ...",
    "online": true,
    "last_seen": "2026-02-11T16:25:00Z",
    "last_ip": "192.168.1.42",
    "added_at": "2026-02-01T10:00:00Z"
  },
  {
    "username": "charlie",
    "public_key": "Y2hhcmxpZV9wdWJsaWNfa2V5...",
    "signing_key": "Y2hhcmxpZV9zaWduaW5nX2tleQ...",
    "online": false,
    "last_seen": "2026-02-10T08:00:00Z",
    "last_ip": "10.0.0.5",
    "added_at": "2026-02-05T14:30:00Z"
  }
]
```

The response is a **JSON array** (not wrapped in an object). An empty friend
list returns `[]`.

| Field | Type | Description |
|-------|------|-------------|
| `username` | `string` | The friend's unique username. |
| `public_key` | `string` | X25519 public key, base64-encoded. Used by the backend to encrypt messages before sending. |
| `signing_key` | `string` | Ed25519 public key, base64-encoded. Used to verify signatures on received messages. |
| `online` | `boolean` | `true` if `last_seen` is within the last 5 minutes. This is a best-effort estimate updated via Supabase heartbeats. |
| `last_seen` | `string` | ISO 8601 UTC timestamp of the friend's most recent Supabase heartbeat. |
| `last_ip` | `string` | The friend's last known IP address (from Supabase). The backend uses this for direct TCP peer connections. |
| `added_at` | `string` | ISO 8601 UTC timestamp of when you added this friend. |

---

### Response (error) — `500 Internal Server Error`

```json
{
  "error": "Database query failed: unable to open database file"
}
```

---

### Status Codes

| Code | Meaning |
|------|---------|
| `200` | Success. Body is a JSON array (may be empty `[]`). |
| `500` | Database or internal error. |

---

### Example with curl

```bash
# List all friends
curl http://127.0.0.1:8080/friends

# Pretty-printed
curl -s http://127.0.0.1:8080/friends | python -m json.tool
```

Expected output (3 friends, one online):
```json
[
    {
        "username": "bob",
        "public_key": "Ym9iX3B1YmxpY19rZXlfYmFzZTY0...",
        "signing_key": "Ym9iX3NpZ25pbmdfcHVibGljX2tleQ...",
        "online": true,
        "last_seen": "2026-02-11T16:25:00Z",
        "last_ip": "192.168.1.42",
        "added_at": "2026-02-01T10:00:00Z"
    },
    {
        "username": "charlie",
        "public_key": "Y2hhcmxpZV9wdWJsaWNfa2V5...",
        "signing_key": "Y2hhcmxpZV9zaWduaW5nX2tleQ...",
        "online": false,
        "last_seen": "2026-02-10T08:00:00Z",
        "last_ip": "10.0.0.5",
        "added_at": "2026-02-05T14:30:00Z"
    },
    {
        "username": "dana",
        "public_key": "ZGFuYV9wdWJsaWNfa2V5...",
        "signing_key": "ZGFuYV9zaWduaW5nX2tleQ...",
        "online": false,
        "last_seen": "2026-02-09T22:10:00Z",
        "last_ip": "172.16.0.8",
        "added_at": "2026-02-07T09:15:00Z"
    }
]
```

---

### Frontend code that calls this

```typescript
// In hooks/useContacts.ts — polls every 10 seconds
import { useEffect } from "react";
import { useContactStore } from "@/stores/contactStore";
import { POLL_INTERVAL_MS } from "@/lib/constants"; // 2000

export function useContacts() {
  const fetchContacts = useContactStore((s) => s.fetchContacts);

  useEffect(() => {
    fetchContacts();
    const interval = setInterval(fetchContacts, POLL_INTERVAL_MS * 5); // 10000ms
    return () => clearInterval(interval);
  }, [fetchContacts]);

  // ... sorting and filtering logic
}
```

```typescript
// In stores/contactStore.ts — the store action that calls the API
fetchContacts: async () => {
  set({ loading: true, error: null });
  try {
    const friends: Contact[] = await api.listFriends();
    const existing = get().contacts;
    const contacts: ContactWithPreview[] = friends.map((f) => {
      const prev = existing.find((c) => c.username === f.username);
      return {
        ...f,
        lastMessage: prev?.lastMessage,
        lastMessageTime: prev?.lastMessageTime,
        unreadCount: prev?.unreadCount ?? 0,
      };
    });
    set({ contacts, loading: false });
  } catch (err) {
    set({ error: (err as Error).message, loading: false });
  }
},
```

```typescript
// In services/api.ts — the actual fetch call
async listFriends(): Promise<Contact[]> {
  return this.request<Contact[]>("/friends");
}
```

```typescript
// In types/contact.ts — the TypeScript type
export interface Contact {
  username: string;
  public_key: string;
  signing_key: string;
  online: boolean;
  last_seen: string;
  last_ip: string;
  added_at: string;
}
```

---

## 3. `POST /friends`

**Description:** Add a new friend by username. The backend performs a Supabase
lookup (`GET /rest/v1/users?username=eq.<username>`) to find the user's public
key, signing key, and last known IP. If found, the friend is inserted into the
local SQLite `friends` table and the full friend object is returned. If the user
doesn't exist on Supabase, a `404` is returned. If the user is already in the
local friend list, a `409` is returned.

**When frontend calls it:** The `AddFriendDialog` component calls
`contactStore.addFriend(username)` when the user submits the "Add Friend" form.
The store calls `api.addFriend(username)` and on success appends the new friend
to the contact list. On error, the dialog shows the error message inline.

---

### Request

```
POST /friends HTTP/1.1
Host: 127.0.0.1:8080
Content-Type: application/json

{
  "username": "bob"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `username` | `string` | ✅ Yes | The username to look up in Supabase and add to your local friend list. Case-sensitive. |

---

### Response (success) — `201 Created`

Returned when the friend is found on Supabase and successfully added to the
local database.

```json
{
  "username": "bob",
  "public_key": "Ym9iX3B1YmxpY19rZXlfYmFzZTY0...",
  "signing_key": "Ym9iX3NpZ25pbmdfcHVibGljX2tleQ...",
  "online": true,
  "last_seen": "2026-02-11T16:25:00Z",
  "last_ip": "192.168.1.42",
  "added_at": "2026-02-11T16:30:00Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `username` | `string` | The friend's username (echoed back). |
| `public_key` | `string` | X25519 public key fetched from Supabase (base64). |
| `signing_key` | `string` | Ed25519 public key fetched from Supabase (base64). |
| `online` | `boolean` | Whether the friend is currently online (based on last heartbeat). |
| `last_seen` | `string` | ISO 8601 UTC timestamp of their last Supabase heartbeat. |
| `last_ip` | `string` | Their last known IP address. |
| `added_at` | `string` | ISO 8601 UTC timestamp — the moment you added them (i.e., now). |

---

### Response (error) — `400 Bad Request`

Returned when the request body is missing or the `username` field is absent/empty.

```json
{
  "error": "Missing required field: 'username'"
}
```

---

### Response (error) — `404 Not Found`

Returned when the username does not exist in Supabase. The person must run their
backend and register before they can be added.

```json
{
  "error": "User 'bob' not found. They must run their backend and register first."
}
```

---

### Response (error) — `409 Conflict`

Returned when the user is already in your local friend list.

```json
{
  "error": "User 'bob' is already in your friend list."
}
```

---

### Response (error) — `500 Internal Server Error`

Returned on unexpected failures (database write error, Supabase unreachable, etc.).

```json
{
  "error": "Supabase lookup failed: connection timed out"
}
```

---

### Status Codes

| Code | Meaning |
|------|---------|
| `201` | Friend found and added successfully. |
| `400` | Request body missing or `username` field empty. |
| `404` | Username not found in Supabase. |
| `409` | User is already in your friend list. |
| `500` | Internal / Supabase error. |

---

### Example with curl

```bash
# Add a friend named "bob"
curl -X POST http://127.0.0.1:8080/friends \
  -H "Content-Type: application/json" \
  -d '{"username": "bob"}'

# See the HTTP status code too
curl -X POST http://127.0.0.1:8080/friends \
  -H "Content-Type: application/json" \
  -d '{"username": "bob"}' \
  -w "\nHTTP Status: %{http_code}\n"

# Try adding a user that doesn't exist
curl -X POST http://127.0.0.1:8080/friends \
  -H "Content-Type: application/json" \
  -d '{"username": "nonexistent_user"}'
# => {"error": "User 'nonexistent_user' not found. They must run their backend and register first."}

# Try adding someone already in your list
curl -X POST http://127.0.0.1:8080/friends \
  -H "Content-Type: application/json" \
  -d '{"username": "bob"}'
# => {"error": "User 'bob' is already in your friend list."}

# Missing body
curl -X POST http://127.0.0.1:8080/friends \
  -H "Content-Type: application/json" \
  -d '{}'
# => {"error": "Missing required field: 'username'"}
```

---

### Frontend code that calls this

```typescript
// In components/contacts/AddFriendDialog.tsx — form submission
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  if (!username.trim()) return;

  setLoading(true);
  setError(null);
  try {
    await addFriend(username.trim());  // calls contactStore.addFriend()
    setSuccess(true);
    setTimeout(onClose, 1000);         // close dialog after 1s
  } catch (err) {
    setError((err as Error).message);  // show error in dialog
  } finally {
    setLoading(false);
  }
};
```

```typescript
// In stores/contactStore.ts — the store action
addFriend: async (username: string) => {
  try {
    const friend = await api.addFriend(username);
    set((state) => ({
      contacts: [
        ...state.contacts,
        { ...friend, unreadCount: 0 },   // append to contact list
      ],
      error: null,
    }));
  } catch (err) {
    set({ error: (err as Error).message });
    throw err;   // re-throw so AddFriendDialog can display the error
  }
},
```

```typescript
// In services/api.ts — the actual fetch call
async addFriend(username: string): Promise<Contact> {
  return this.request<Contact>("/friends", {
    method: "POST",
    body: JSON.stringify({ username }),
  });
}
```

---

## 4. `DELETE /friends/:username`

**Description:** Removes a friend from your local SQLite database. This is a
local-only operation — it does **not** notify Supabase or the other person. The
friend's messages are **not** deleted (only the friend entry is removed).

**When frontend calls it:** `contactStore.removeFriend(username)` is called when
the user confirms friend removal (e.g., via a context menu or confirmation
dialog). The store calls `api.removeFriend(username)` and on success filters the
contact out of the local state.

---

### Request

```
DELETE /friends/bob HTTP/1.1
Host: 127.0.0.1:8080
```

The `:username` is a **URL path parameter** — replace it with the actual
username. Special characters in the username must be percent-encoded (the
frontend uses `encodeURIComponent()`).

No request body.

---

### Response (success) — `204 No Content`

Empty body. The friend has been removed from the local database.

```
HTTP/1.1 204 No Content
```

---

### Response (error) — `404 Not Found`

Returned when the username is not in your friend list.

```json
{
  "error": "User 'bob' is not in your friend list."
}
```

---

### Response (error) — `500 Internal Server Error`

```json
{
  "error": "Database error: unable to delete friend record"
}
```

---

### Status Codes

| Code | Meaning |
|------|---------|
| `204` | Friend removed successfully. No response body. |
| `404` | Username not found in your friend list. |
| `500` | Database error. |

---

### Example with curl

```bash
# Remove friend "bob"
curl -X DELETE http://127.0.0.1:8080/friends/bob

# Check the status code
curl -X DELETE http://127.0.0.1:8080/friends/bob \
  -w "\nHTTP Status: %{http_code}\n"
# => HTTP Status: 204

# Try removing someone not in your list
curl -X DELETE http://127.0.0.1:8080/friends/nonexistent
# => {"error": "User 'nonexistent' is not in your friend list."}

# Username with special characters (percent-encoded)
curl -X DELETE http://127.0.0.1:8080/friends/user%40name
```

---

### Frontend code that calls this

```typescript
// In stores/contactStore.ts
removeFriend: async (username: string) => {
  try {
    await api.removeFriend(username);
    set((state) => ({
      contacts: state.contacts.filter((c) => c.username !== username),
    }));
  } catch (err) {
    set({ error: (err as Error).message });
    throw err;
  }
},
```

```typescript
// In services/api.ts
async removeFriend(username: string): Promise<void> {
  return this.request<void>(`/friends/${encodeURIComponent(username)}`, {
    method: "DELETE",
  });
}
```

---

## 5. `GET /messages?peer=X&limit=50&offset=0`

**Description:** Returns paginated chat history with a specific friend from the
local SQLite database. Messages are returned in **chronological order** (oldest
first). The backend returns decrypted plaintext — encryption/decryption is
handled entirely by the backend, so the frontend always works with readable
text.

**When frontend calls it:** `chatStore.fetchMessages(peer)` is called by the
`useMessages` hook whenever the active chat peer changes (i.e., user clicks a
contact). `chatStore.loadMoreMessages(peer)` is called when the user scrolls up
and clicks "Load older messages" — it passes the current message count as
`offset` to fetch the next page.

---

### Request

```
GET /messages?peer=bob&limit=50&offset=0 HTTP/1.1
Host: 127.0.0.1:8080
```

| Parameter | Type | Default | Required | Description |
|-----------|------|---------|----------|-------------|
| `peer` | `string` | — | ✅ Yes | The friend's username to retrieve messages with. |
| `limit` | `number` | `50` | No | Maximum number of messages to return. Frontend default is `MESSAGE_PAGE_SIZE = 50`. |
| `offset` | `number` | `0` | No | Number of messages to skip from the beginning. Used for pagination — set to the number of messages already loaded to fetch older ones. |

---

### Response (success) — `200 OK`

```json
{
  "messages": [
    {
      "msg_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "from": "alice",
      "to": "bob",
      "text": "Hey Bob!",
      "timestamp": "2026-02-11T16:00:00Z",
      "direction": "sent",
      "delivered": true,
      "delivery_method": "direct"
    },
    {
      "msg_id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      "from": "bob",
      "to": "alice",
      "text": "Hi Alice! What's up?",
      "timestamp": "2026-02-11T16:00:05Z",
      "direction": "received",
      "delivered": true,
      "delivery_method": "direct"
    },
    {
      "msg_id": "c3d4e5f6-a7b8-9012-cdef-123456789012",
      "from": "alice",
      "to": "bob",
      "text": "Not much, working on our chat app!",
      "timestamp": "2026-02-11T16:00:10Z",
      "direction": "sent",
      "delivered": false,
      "delivery_method": "offline"
    }
  ],
  "total": 128,
  "has_more": true
}
```

#### Top-level fields

| Field | Type | Description |
|-------|------|-------------|
| `messages` | `Message[]` | Array of message objects in chronological order (oldest first). Empty `[]` if no messages exist. |
| `total` | `number` | Total number of messages with this peer in the database (regardless of `limit`/`offset`). Useful for showing "128 messages" in the UI. |
| `has_more` | `boolean` | `true` if there are older messages beyond the current `offset + limit`. When `false`, the user has reached the beginning of the conversation. |

#### Message object fields

| Field | Type | Description |
|-------|------|-------------|
| `msg_id` | `string` | UUID (v4) that uniquely identifies this message. Used for deletion and deduplication. |
| `from` | `string` | Username of the sender. |
| `to` | `string` | Username of the recipient. |
| `text` | `string` | The **decrypted plaintext** message content. The backend decrypts on receipt and stores plaintext locally. Max 10,000 characters. |
| `timestamp` | `string` | ISO 8601 UTC timestamp of when the message was created. |
| `direction` | `"sent" \| "received"` | `"sent"` = you sent this message; `"received"` = you received it. The frontend uses this for left/right bubble alignment. |
| `delivered` | `boolean` | `true` = delivery confirmed (peer acknowledged receipt). `false` = message was queued for offline delivery and hasn't been confirmed yet. |
| `delivery_method` | `"direct" \| "offline"` | `"direct"` = delivered via TCP peer-to-peer connection. `"offline"` = stored in Supabase for later retrieval by the recipient. |

---

### Response (error) — `400 Bad Request`

Returned when the `peer` query parameter is missing.

```json
{
  "error": "Missing required query parameter: 'peer'"
}
```

---

### Response (error) — `500 Internal Server Error`

```json
{
  "error": "Database query failed"
}
```

---

### Status Codes

| Code | Meaning |
|------|---------|
| `200` | Success. Body contains messages array (may be empty). |
| `400` | Missing `peer` parameter. |
| `500` | Database error. |

---

### Example with curl

```bash
# Get the 50 most recent messages with "bob"
curl "http://127.0.0.1:8080/messages?peer=bob"

# Get the 50 most recent messages (explicit defaults)
curl "http://127.0.0.1:8080/messages?peer=bob&limit=50&offset=0"

# Get only the last 10 messages
curl "http://127.0.0.1:8080/messages?peer=bob&limit=10"

# Load the next page (skip the first 50)
curl "http://127.0.0.1:8080/messages?peer=bob&limit=50&offset=50"

# Pretty-print the output
curl -s "http://127.0.0.1:8080/messages?peer=bob&limit=5" | python -m json.tool
```

Expected output (first page, more messages available):
```json
{
    "messages": [
        {
            "msg_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            "from": "alice",
            "to": "bob",
            "text": "Hey Bob!",
            "timestamp": "2026-02-11T16:00:00Z",
            "direction": "sent",
            "delivered": true,
            "delivery_method": "direct"
        }
    ],
    "total": 128,
    "has_more": true
}
```

---

### Frontend code that calls this

```typescript
// In hooks/useMessages.ts — fetch when peer changes
useEffect(() => {
  if (peer) {
    fetchMessages(peer);  // offset=0 by default (newest page)
  }
}, [peer, fetchMessages]);

// Load older messages (pagination)
const loadOlder = useCallback(() => {
  if (peer) loadMore(peer);
}, [peer, loadMore]);
```

```typescript
// In stores/chatStore.ts — fetch messages action
fetchMessages: async (peer, offset = 0) => {
  set({ loadingMessages: true });
  try {
    const res = await api.getMessages(peer, MESSAGE_PAGE_SIZE, offset);
    set((state) => ({
      messages: {
        ...state.messages,
        [peer]: offset === 0
          ? res.messages                                          // replace on first load
          : [...res.messages, ...(state.messages[peer] ?? [])],   // prepend older messages
      },
      hasMore: { ...state.hasMore, [peer]: res.has_more },
      loadingMessages: false,
    }));
  } catch (err) {
    console.error("Failed to fetch messages:", err);
    set({ loadingMessages: false });
  }
},

// Load more (pagination) — uses current message count as offset
loadMoreMessages: async (peer) => {
  const existing = get().messages[peer] ?? [];
  if (!get().hasMore[peer] || get().loadingMessages) return;
  await get().fetchMessages(peer, existing.length);
},
```

```typescript
// In services/api.ts — the actual fetch call
async getMessages(
  peer: string,
  limit = MESSAGE_PAGE_SIZE,    // default: 50
  offset = 0
): Promise<MessagesResponse> {
  const params = new URLSearchParams({
    peer,
    limit: String(limit),
    offset: String(offset),
  });
  return this.request<MessagesResponse>(`/messages?${params}`);
}
```

```typescript
// In types/api.ts — the TypeScript response type
export interface MessagesResponse {
  messages: Message[];
  total: number;
  has_more: boolean;
}
```

```typescript
// In types/message.ts — the Message type
export interface Message {
  msg_id: string;
  from: string;
  to: string;
  text: string;
  timestamp: string;
  direction: "sent" | "received";
  delivered: boolean;
  delivery_method: "direct" | "offline";
}
```

---

## 6. `POST /messages`

**Description:** Send a chat message to a friend. The backend handles the
entire delivery pipeline:

1. Looks up the recipient's public key from the local `friends` table.
2. Generates a random nonce and encrypts the plaintext with X25519.
3. Signs the ciphertext with your Ed25519 private key.
4. Attempts direct delivery via TCP to the friend's `last_ip:peer_port`.
5. **If TCP succeeds:** returns `200` with `delivered: true`, `delivery_method: "direct"`.
6. **If TCP fails** (peer offline/unreachable): uploads the encrypted envelope
   to Supabase for later retrieval, returns `202` with `delivered: false`,
   `delivery_method: "offline"`.
7. Stores the message in local SQLite regardless of delivery outcome.

**When frontend calls it:** `chatStore.sendMessage(to, text)` is called from
`useMessages.send()`, triggered when the user presses Enter or clicks Send in
`ComposeArea`. The store performs an optimistic update — it immediately adds the
message to the local message list using the returned `msg_id`.

---

### Request

```
POST /messages HTTP/1.1
Host: 127.0.0.1:8080
Content-Type: application/json

{
  "to": "bob",
  "text": "Hey Bob, what's up?"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | `string` | ✅ Yes | Recipient's username. Must be in your friend list (added via `POST /friends`). |
| `text` | `string` | ✅ Yes | The plaintext message to send. Maximum 10,000 characters. The backend encrypts this before transmission. |

---

### Response (delivered directly) — `200 OK`

Returned when the message was successfully delivered to the recipient via a
direct TCP peer-to-peer connection.

```json
{
  "msg_id": "d4e5f6a7-b8c9-0123-def0-234567890123",
  "delivered": true,
  "delivery_method": "direct",
  "timestamp": "2026-02-11T16:05:00Z"
}
```

---

### Response (queued for offline delivery) — `202 Accepted`

Returned when the recipient is offline or unreachable. The encrypted message has
been stored in Supabase and will be delivered when the recipient comes back
online.

```json
{
  "msg_id": "d4e5f6a7-b8c9-0123-def0-234567890123",
  "delivered": false,
  "delivery_method": "offline",
  "timestamp": "2026-02-11T16:05:00Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `msg_id` | `string` | UUID (v4) assigned to the message. Use this for future `DELETE /messages/:id` calls. |
| `delivered` | `boolean` | `true` if delivered via TCP; `false` if queued in Supabase. |
| `delivery_method` | `string` | `"direct"` (TCP peer-to-peer) or `"offline"` (Supabase relay). |
| `timestamp` | `string` | ISO 8601 UTC timestamp of when the backend processed the message. |

---

### Response (error) — `400 Bad Request`

Returned when the request body is invalid.

```json
{
  "error": "Missing required field: 'text'"
}
```

Other `400` cases:
```json
{
  "error": "Missing required field: 'to'"
}
```
```json
{
  "error": "Message text exceeds maximum length of 10000 characters"
}
```

---

### Response (error) — `404 Not Found`

Returned when the recipient is not in your friend list.

```json
{
  "error": "'charlie' is not in your friend list. Add them first with POST /friends."
}
```

---

### Response (error) — `500 Internal Server Error`

```json
{
  "error": "Encryption failed: could not load recipient public key"
}
```

---

### Status Codes

| Code | Meaning |
|------|---------|
| `200` | Message delivered directly via TCP. |
| `202` | Message accepted and queued for offline delivery via Supabase. |
| `400` | Missing `to` or `text` field, or `text` exceeds max length. |
| `404` | Recipient not in your friend list. |
| `500` | Encryption, database, or Supabase error. |

---

### Example with curl

```bash
# Send a message to "bob" (may return 200 or 202)
curl -X POST http://127.0.0.1:8080/messages \
  -H "Content-Type: application/json" \
  -d '{"to": "bob", "text": "Hello from curl!"}'

# See the HTTP status code
curl -X POST http://127.0.0.1:8080/messages \
  -H "Content-Type: application/json" \
  -d '{"to": "bob", "text": "Are you online?"}' \
  -w "\nHTTP Status: %{http_code}\n"

# Send to someone not in your friend list
curl -X POST http://127.0.0.1:8080/messages \
  -H "Content-Type: application/json" \
  -d '{"to": "stranger", "text": "Hi!"}'
# => {"error": "'stranger' is not in your friend list. Add them first with POST /friends."}

# Missing text field
curl -X POST http://127.0.0.1:8080/messages \
  -H "Content-Type: application/json" \
  -d '{"to": "bob"}'
# => {"error": "Missing required field: 'text'"}

# Send a multi-line message
curl -X POST http://127.0.0.1:8080/messages \
  -H "Content-Type: application/json" \
  -d '{"to": "bob", "text": "Line 1\nLine 2\nLine 3"}'
```

---

### Frontend code that calls this

```typescript
// In components/chat/ComposeArea.tsx — user presses Enter or clicks Send
const handleSend = async () => {
  if (!text.trim() || sending) return;
  setSending(true);
  try {
    await onSend(text);   // calls useMessages.send()
    setText("");
    textareaRef.current?.focus();
  } catch {
    // Error handled by store
  } finally {
    setSending(false);
  }
};
```

```typescript
// In hooks/useMessages.ts — wraps chatStore.sendMessage
const send = useCallback(
  async (text: string) => {
    if (!peer || !text.trim()) return;
    await sendMessage(peer, text.trim());
    updateLastMessage(peer, text.trim(), new Date().toISOString());
  },
  [peer, sendMessage, updateLastMessage]
);
```

```typescript
// In stores/chatStore.ts — optimistic update after API call
sendMessage: async (to, text) => {
  set({ sendingMessage: true });
  try {
    const res = await api.sendMessage(to, text);
    const optimistic: Message = {
      msg_id: res.msg_id,
      from: "",                                              // filled later by backend status
      to,
      text,
      timestamp: new Date().toISOString(),
      direction: "sent",
      delivered: res.delivered,
      delivery_method: res.delivery_method as "direct" | "offline",
    };
    get().addMessage(optimistic);                            // append to local message list
  } catch (err) {
    console.error("Failed to send message:", err);
    throw err;
  } finally {
    set({ sendingMessage: false });
  }
},
```

```typescript
// In services/api.ts — the actual fetch call
async sendMessage(
  to: string,
  text: string
): Promise<{ msg_id: string; delivered: boolean; delivery_method: string }> {
  return this.request("/messages", {
    method: "POST",
    body: JSON.stringify({ to, text }),
  });
}
```

---

## 7. `DELETE /messages/:id`

**Description:** Deletes a single message from your local SQLite chat history.
This is a **local-only** operation — it does not delete the message from the
peer's device or from Supabase. The message simply disappears from your local
database and will no longer appear in `GET /messages` results.

**When frontend calls it:** `api.deleteMessage(msgId)` is available in the API
service. This can be called from a message context menu (e.g., right-click →
"Delete message"). The frontend is wired to support this but the feature may
not yet be exposed in the UI.

---

### Request

```
DELETE /messages/d4e5f6a7-b8c9-0123-def0-234567890123 HTTP/1.1
Host: 127.0.0.1:8080
```

The `:id` is a **URL path parameter** — replace it with the message's `msg_id`
(UUID). Special characters must be percent-encoded (the frontend uses
`encodeURIComponent()`).

No request body.

---

### Response (success) — `204 No Content`

Empty body. The message has been deleted from the local database.

```
HTTP/1.1 204 No Content
```

---

### Response (error) — `404 Not Found`

Returned when no message with the given `msg_id` exists in the local database.

```json
{
  "error": "Message not found."
}
```

---

### Response (error) — `500 Internal Server Error`

```json
{
  "error": "Database error: unable to delete message record"
}
```

---

### Status Codes

| Code | Meaning |
|------|---------|
| `204` | Message deleted successfully. No response body. |
| `404` | No message with that `msg_id` in the local database. |
| `500` | Database error. |

---

### Example with curl

```bash
# Delete a specific message by its UUID
curl -X DELETE http://127.0.0.1:8080/messages/d4e5f6a7-b8c9-0123-def0-234567890123

# Check the status code
curl -X DELETE http://127.0.0.1:8080/messages/d4e5f6a7-b8c9-0123-def0-234567890123 \
  -w "\nHTTP Status: %{http_code}\n"
# => HTTP Status: 204

# Try deleting a message that doesn't exist
curl -X DELETE http://127.0.0.1:8080/messages/00000000-0000-0000-0000-000000000000
# => {"error": "Message not found."}
```

---

### Frontend code that calls this

```typescript
// In services/api.ts
async deleteMessage(msgId: string): Promise<void> {
  return this.request<void>(`/messages/${encodeURIComponent(msgId)}`, {
    method: "DELETE",
  });
}
```

---

## Appendix A: Error Response Format

Every error from every endpoint follows this consistent shape:

```json
{
  "error": "Human-readable description of what went wrong"
}
```

The HTTP status code tells you the **category** of error:

| Code | Category | Meaning |
|------|----------|---------|
| `400` | Client error | Your request was malformed (missing field, bad JSON, etc.). Fix the request. |
| `404` | Not found | The resource you referenced doesn't exist (friend, message, user). |
| `409` | Conflict | The resource already exists (duplicate friend). |
| `500` | Server error | Something went wrong inside the backend (crash, database error). Check backend logs. |

The frontend's generic error handler in `api.ts` extracts the error message:

```typescript
// In services/api.ts — the request wrapper
private async request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${this.baseUrl}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}
```

---

## Appendix B: WebSocket Events (Real-Time)

In addition to the REST API on port `8080`, the backend exposes a WebSocket
server on port `8081` at `ws://127.0.0.1:8081/events` for real-time push
notifications. The frontend connects via `useWebSocket` hook on startup.

| Event | Direction | Payload | Description |
|-------|-----------|---------|-------------|
| `new_message` | Server → Client | `Message` object | A new message was received from a peer. |
| `friend_online` | Server → Client | `{ username: string }` | A friend came online. |
| `friend_offline` | Server → Client | `{ username: string }` | A friend went offline. |
| `typing` | Bidirectional | `{ to: string, typing: boolean }` | Typing indicator. |

The WebSocket supplements — but does not replace — HTTP polling. The frontend
uses both: WebSocket for instant updates, polling as a fallback.

---

## Appendix C: Constants & Configuration

| Constant | Value | Defined In | Used For |
|----------|-------|------------|----------|
| `API_BASE_URL` | `http://127.0.0.1:8080` | `lib/constants.ts` | Base URL for all REST calls. |
| `WS_URL` | `ws://127.0.0.1:8081/events` | `lib/constants.ts` | WebSocket endpoint. |
| `POLL_INTERVAL_MS` | `2000` | `lib/constants.ts` | Base polling interval. |
| Status poll | `6000ms` | `App.tsx` | `POLL_INTERVAL_MS × 3` |
| Contacts poll | `10000ms` | `useContacts.ts` | `POLL_INTERVAL_MS × 5` |
| `MESSAGE_PAGE_SIZE` | `50` | `lib/constants.ts` | Default `limit` for message pagination. |
| `TYPING_DEBOUNCE_MS` | `1000` | `lib/constants.ts` | Debounce before sending "stopped typing". |
| `WS_RECONNECT_DELAY_MS` | `3000` | `lib/constants.ts` | Delay between WebSocket reconnect attempts. |
| `WS_MAX_RECONNECT_ATTEMPTS` | `10` | `lib/constants.ts` | Max WebSocket reconnect retries. |

---

## Appendix D: Quick Reference Card

```
┌─────────┬──────────────────────────────┬─────┬──────────────────────────────┐
│ Method  │ Path                         │ OK  │ Purpose                      │
├─────────┼──────────────────────────────┼─────┼──────────────────────────────┤
│ GET     │ /status                      │ 200 │ Health check + node info     │
│ GET     │ /friends                     │ 200 │ List all friends             │
│ POST    │ /friends                     │ 201 │ Add friend by username       │
│ DELETE  │ /friends/:username           │ 204 │ Remove friend                │
│ GET     │ /messages?peer=X&limit&offset│ 200 │ Paginated chat history       │
│ POST    │ /messages                    │ 200 │ Send message (direct)        │
│         │                              │ 202 │ Send message (offline queue) │
│ DELETE  │ /messages/:id                │ 204 │ Delete local message         │
└─────────┴──────────────────────────────┴─────┴──────────────────────────────┘
```
