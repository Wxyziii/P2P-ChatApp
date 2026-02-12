# Phase 4 — Offline Messages via Supabase

> **Goal**: When a peer is offline, messages are encrypted and stored in Supabase.
> When the peer comes back online, they fetch, decrypt, and delete those messages
> automatically. No message is ever lost.

---

## Table of Contents

1. [What We're Building](#1-what-were-building)
2. [The Delivery Pipeline](#2-the-delivery-pipeline)
3. [Step 1: Push Offline Messages to Supabase](#3-step-1-push-offline-messages)
4. [Step 2: Fetch Offline Messages on Startup](#4-step-2-fetch-offline-messages)
5. [Step 3: Auto-Delete After Delivery](#5-step-3-auto-delete-after-delivery)
6. [Step 4: Update the Send Pipeline](#6-step-4-update-send-pipeline)
7. [Step 5: Supabase Cron (Auto-Cleanup)](#7-step-5-supabase-cron)
8. [Step 6: Frontend — Handling Delivery Status](#8-step-6-frontend-delivery-status)
9. [Testing the Full Flow](#9-testing-the-full-flow)
10. [Learning Resources](#10-learning-resources)
11. [Common Pitfalls](#11-common-pitfalls)

---

## 1. What We're Building

```
 Alice sends to Bob (OFFLINE)           Bob comes online
 ─────────────────────────────          ──────────────────────────

 1. Alice encrypts message              5. Bob starts backend
 2. Alice tries TCP → FAIL              6. Backend calls fetch_offline_messages()
 3. Alice pushes to Supabase            7. Supabase returns encrypted messages
 4. API responds: 202 Accepted          8. Bob decrypts each message
                                        9. Bob deletes from Supabase
                                       10. Messages appear in Bob's chat

 ┌──────┐    ┌──────────┐    ┌──────┐
 │Alice │───►│ Supabase │───►│ Bob  │
 │      │    │ (mailbox)│    │      │
 └──────┘    └──────────┘    └──────┘
               encrypted       decrypted
               stored here     read here
```

After this phase:
- ✅ Failed direct sends fall back to Supabase automatically
- ✅ On startup, backend fetches all pending offline messages
- ✅ Messages are decrypted and delivered to the frontend via WebSocket
- ✅ Delivered messages are deleted from Supabase
- ✅ Messages older than 7 days auto-delete via Supabase cron
- ✅ Frontend shows "direct" vs "offline" delivery badges

---

## 2. The Delivery Pipeline

Here's the complete flow for every message:

```
User types message in frontend
         │
         ▼
POST /messages { to: "bob", text: "hey" }
         │
         ▼
┌─────────────────────────┐
│ 1. Look up Bob's keys   │
│ 2. Encrypt with X25519  │
│ 3. Sign with Ed25519    │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐     ┌───────────────────┐
│ 4. Try TCP to Bob       │────►│ SUCCESS            │
│    (peer_client.connect)│     │ → Store locally    │
└────────┬────────────────┘     │ → Respond 200      │
         │ FAIL                 │ → WS: new_message  │
         ▼                      └───────────────────┘
┌─────────────────────────┐
│ 5. Push to Supabase     │
│    (offline fallback)   │
│ → Store locally         │
│ → Respond 202           │
└─────────────────────────┘
```

---

## 3. Step 1: Push Offline Messages

When direct TCP delivery fails, store the encrypted message in Supabase:

```cpp
bool SupabaseClient::push_offline_message(
    const std::string& to_user,
    const std::string& from_user,
    const std::string& ciphertext,
    const std::string& signature)
{
    nlohmann::json body;
    body["to_user"]    = to_user;
    body["from_user"]  = from_user;
    body["ciphertext"] = ciphertext;   // Already base64-encoded
    body["signature"]  = signature;     // Already base64-encoded

    std::string response = http_post("/rest/v1/messages", body.dump());

    // Check for errors
    try {
        auto json_resp = nlohmann::json::parse(response);
        if (json_resp.contains("code")) {
            spdlog::error("Failed to push offline message: {}",
                          json_resp.value("message", "Unknown error"));
            return false;
        }
    } catch (...) {
        // Empty response is OK for successful insert
    }

    spdlog::info("Offline message stored for '{}' from '{}'", to_user, from_user);
    return true;
}
```

### What Gets Stored in Supabase

```json
{
    "id": "auto-generated-uuid",
    "to_user": "bob",
    "from_user": "alice",
    "ciphertext": "nonce+encrypted_base64...",
    "signature": "ed25519_signature_base64...",
    "created_at": "2025-06-15T10:30:00Z"
}
```

**Security**: Supabase never sees the plaintext. The `ciphertext` field is an opaque blob. Even if Supabase is breached, attackers only see encrypted data.

---

## 4. Step 2: Fetch Offline Messages on Startup

When the backend starts, it checks Supabase for any waiting messages:

```cpp
std::vector<nlohmann::json> SupabaseClient::fetch_offline_messages(
    const std::string& username)
{
    // PostgREST: SELECT * FROM messages WHERE to_user = 'username'
    //            ORDER BY created_at ASC
    std::string endpoint = "/rest/v1/messages"
                           "?to_user=eq." + username +
                           "&order=created_at.asc";

    std::string response = http_get(endpoint);
    std::vector<nlohmann::json> messages;

    try {
        auto arr = nlohmann::json::parse(response);
        if (arr.is_array()) {
            for (auto& msg : arr) {
                messages.push_back(msg);
            }
        }
    } catch (const std::exception& e) {
        spdlog::error("Failed to parse offline messages: {}", e.what());
    }

    spdlog::info("Fetched {} offline messages for '{}'",
                 messages.size(), username);
    return messages;
}
```

### Processing Fetched Messages

```cpp
void Node::process_offline_messages() {
    auto messages = supabase_.fetch_offline_messages(username_);

    for (const auto& msg : messages) {
        std::string from_user  = msg["from_user"];
        std::string ciphertext = msg["ciphertext"];
        std::string signature  = msg["signature"];
        std::string msg_id     = msg["id"];

        // Look up sender's keys
        auto friend_info = db_.get_friend(from_user);
        if (!friend_info) {
            spdlog::warn("Offline message from unknown user '{}' — skipping",
                         from_user);
            continue;
        }

        auto peer_public_key  = from_base64(friend_info->public_key);
        auto peer_signing_key = from_base64(friend_info->signing_key);

        // Verify signature
        if (!crypto_.verify(ciphertext, signature, peer_signing_key)) {
            spdlog::error("Offline message from '{}' failed signature check!",
                          from_user);
            continue;
        }

        // Decrypt
        std::string plaintext = crypto_.decrypt(ciphertext, peer_public_key);
        if (plaintext.empty()) {
            spdlog::error("Failed to decrypt offline message from '{}'",
                          from_user);
            continue;
        }

        // Store locally
        std::string timestamp = msg.value("created_at", now_iso8601());
        db_.store_message(msg_id, from_user, username_,
                          plaintext, timestamp, true, "offline");

        // Push to frontend via WebSocket
        nlohmann::json ws_event;
        ws_event["event"] = "new_message";
        ws_event["data"]["msg_id"] = msg_id;
        ws_event["data"]["from"] = from_user;
        ws_event["data"]["to"] = username_;
        ws_event["data"]["text"] = plaintext;
        ws_event["data"]["timestamp"] = timestamp;
        ws_event["data"]["delivered"] = true;
        ws_event["data"]["delivery_method"] = "offline";
        ws_server_.broadcast(ws_event.dump());

        spdlog::info("Delivered offline message from '{}': {}", from_user,
                     plaintext.substr(0, 50));

        // Delete from Supabase (it's been delivered)
        supabase_.delete_message(msg_id);
    }
}
```

### Call It on Startup

```cpp
// In main.cpp, after services are running:
spdlog::info("Checking for offline messages...");
node.process_offline_messages();
```

---

## 5. Step 3: Auto-Delete After Delivery

After a message is successfully delivered, delete it from Supabase:

```cpp
bool SupabaseClient::delete_message(const std::string& msg_id) {
    // PostgREST: DELETE FROM messages WHERE id = 'uuid'
    std::string endpoint = "/rest/v1/messages?id=eq." + msg_id;
    http_delete(endpoint);
    spdlog::debug("Deleted offline message {}", msg_id);
    return true;
}
```

**Why delete?**
1. Privacy — once delivered, there's no reason to keep encrypted data in the cloud
2. Storage — Supabase free tier has 500MB limit
3. Security — reduces attack surface if Supabase is compromised

---

## 6. Step 4: Update the Send Pipeline

Wire the offline fallback into the `POST /messages` handler:

```cpp
// In LocalAPI::handle_request(), POST /messages section:
else if (req.method == "POST" && req.path == "/messages") {
    try {
        json body = json::parse(req.body);
        std::string to = body["to"];
        std::string text = body["text"];

        // Node::send_message handles:
        //   1. Encrypt with peer's public key
        //   2. Sign with our Ed25519 key
        //   3. Try direct TCP
        //   4. Fall back to Supabase if TCP fails
        bool delivered = node_.send_message(to, text);

        json result;
        result["msg_id"] = "uuid-here";  // from Node
        result["delivered"] = delivered;
        result["delivery_method"] = delivered ? "direct" : "offline";

        // 200 = delivered now, 202 = stored for later
        int status = delivered ? 200 : 202;
        response = make_response(status, result.dump());

    } catch (const json::exception& e) {
        response = make_response(400,
            json({{"error", e.what()}}).dump());
    }
}
```

---

## 7. Step 5: Supabase Cron (Auto-Cleanup)

Messages older than 7 days should be auto-deleted. Set this up in Supabase:

### Option A: pg_cron (Supabase Extension)

1. Go to Supabase Dashboard → SQL Editor
2. Run:

```sql
-- Enable the pg_cron extension (if not enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule cleanup every hour
SELECT cron.schedule(
    'delete-old-messages',
    '0 * * * *',   -- Every hour
    $$DELETE FROM messages WHERE created_at < now() - interval '7 days'$$
);
```

### Option B: Application-Level Cleanup

If pg_cron isn't available, run cleanup from the backend:

```cpp
void SupabaseClient::cleanup_old_messages() {
    // PostgREST: DELETE FROM messages WHERE created_at < (now - 7 days)
    std::string endpoint = "/rest/v1/messages?created_at=lt." +
        seven_days_ago_iso8601();
    http_delete(endpoint);
    spdlog::info("Cleaned up old offline messages");
}
```

---

## 8. Step 6: Frontend — Handling Delivery Status

The frontend already handles this! The `MessageBubble` component shows delivery status:

```typescript
// In MessageBubble.tsx — the delivery indicator
{msg.direction === "sent" && (
    <div className="bubble__delivery">
        {msg.delivered ? (
            // Double checkmark = delivered
            <>
                <CheckCheck size={12} className="bubble__delivery-icon--delivered" />
            </>
        ) : (
            // Single checkmark = stored offline
            <Check size={12} className="bubble__delivery-icon" />
        )}
    </div>
)}
```

### What the User Sees

| Status | Icon | Meaning |
|--------|------|---------|
| `delivered: true, method: "direct"` | ✓✓ (blue) | Delivered directly to peer |
| `delivered: false, method: "offline"` | ✓ (gray) | Stored in Supabase, waiting |
| `delivered: true, method: "offline"` | ✓✓ (blue) | Was offline, now delivered |

### When Does "offline" Become "delivered"?

When Bob comes online, fetches the message, and the backend could optionally send a delivery receipt back to Alice. For MVP, the single checkmark for "offline" is sufficient.

---

## 9. Testing the Full Flow

### Test 1: Direct Delivery (Both Online)

```bash
# Terminal 1: Alice
./secure-p2p-chat-backend config-alice.json

# Terminal 2: Bob
./secure-p2p-chat-backend config-bob.json

# Terminal 3: Send message
curl -X POST http://127.0.0.1:8080/messages \
  -H "Content-Type: application/json" \
  -d '{"to":"bob","text":"Hello Bob!"}'

# Expected: 200 { "delivered": true, "delivery_method": "direct" }
```

### Test 2: Offline Delivery (Recipient Offline)

```bash
# Terminal 1: Alice (Bob is NOT running)
./secure-p2p-chat-backend config-alice.json

# Terminal 2: Send message (Bob is offline)
curl -X POST http://127.0.0.1:8080/messages \
  -H "Content-Type: application/json" \
  -d '{"to":"bob","text":"Are you there?"}'

# Expected: 202 { "delivered": false, "delivery_method": "offline" }

# Verify it's in Supabase:
curl "https://YOUR_PROJECT.supabase.co/rest/v1/messages?to_user=eq.bob" \
  -H "apikey: YOUR_KEY" \
  -H "Authorization: Bearer YOUR_KEY"

# Expected: Array with one encrypted message
```

### Test 3: Fetch on Startup

```bash
# Now start Bob (after sending offline messages)
./secure-p2p-chat-backend config-bob.json

# Bob's logs should show:
#   "Fetched 1 offline messages for 'bob'"
#   "Delivered offline message from 'alice': Are you there?"
#   "Deleted offline message <uuid>"

# Verify it's gone from Supabase:
curl "https://YOUR_PROJECT.supabase.co/rest/v1/messages?to_user=eq.bob" \
  -H "apikey: YOUR_KEY" \
  -H "Authorization: Bearer YOUR_KEY"

# Expected: Empty array []
```

---

## 10. Learning Resources

### Offline-First Architecture

| Resource | Type | Link |
|----------|------|------|
| **Offline First — Web Fundamentals** | 📖 Google | [web.dev/offline-first](https://web.dev/articles/offline-first) |
| **Message Queuing Patterns** | 📖 Guide | [enterpriseintegrationpatterns.com](https://www.enterpriseintegrationpatterns.com/patterns/messaging/) |

### Supabase Advanced

| Resource | Type | Link |
|----------|------|------|
| **Supabase Row Level Security** | 📖 Docs | [supabase.com/docs/guides/auth/row-level-security](https://supabase.com/docs/guides/auth/row-level-security) |
| **pg_cron in Supabase** | 📖 Docs | [supabase.com/docs/guides/database/extensions/pg_cron](https://supabase.com/docs/guides/database/extensions/pg_cron) |
| **Supabase Database Functions** | 📖 Docs | [supabase.com/docs/guides/database/functions](https://supabase.com/docs/guides/database/functions) |

---

## 11. Common Pitfalls

### ❌ Fetching messages for the wrong user

**Cause**: Using hardcoded username instead of config value.
**Fix**: Always use `config["node"]["username"]` for the query.

### ❌ Messages re-appear after restart

**Cause**: Not deleting from Supabase after delivery.
**Fix**: Always call `delete_message(msg_id)` after successful decrypt + store.

### ❌ Supabase 413 Payload Too Large

**Cause**: Encrypted messages with large base64 encoding.
**Fix**: Supabase has a default 1MB body limit. Keep messages under ~500KB plaintext (which becomes ~700KB base64 ciphertext). For a chat app, this is more than enough.

### ❌ Duplicate messages

**Cause**: Backend crashes after decrypting but before deleting from Supabase.
**Fix**: Use message IDs and check `db_.has_message(msg_id)` before inserting:
```cpp
if (db_.has_message(msg_id)) {
    spdlog::debug("Skipping duplicate message {}", msg_id);
    supabase_.delete_message(msg_id);  // Clean up
    continue;
}
```

### ❌ Offline messages from unknown senders

**Cause**: Someone you haven't friended sends you a message.
**Fix**: Skip messages from unknown senders (already handled in the code above). You can't decrypt without their public key anyway.

### 💡 Tip: Periodic Offline Check

Besides checking on startup, also check periodically while running:

```cpp
// Every 60 seconds, check for new offline messages
void start_offline_check_timer(asio::io_context& io, Node& node) {
    auto timer = std::make_shared<asio::steady_timer>(io);

    std::function<void()> check = [&, timer, check]() {
        node.process_offline_messages();

        timer->expires_after(std::chrono::seconds(60));
        timer->async_wait([check](asio::error_code ec) {
            if (!ec) check();
        });
    };

    // First check after 5 seconds (give services time to start)
    timer->expires_after(std::chrono::seconds(5));
    timer->async_wait([check](asio::error_code ec) {
        if (!ec) check();
    });
}
```

---

**← [Phase 3 — Encryption](./phase-3-encryption.md) | [Phase 5 — Tauri Frontend →](./phase-5-tauri-frontend.md)**
