# Phase 2 — Supabase User Discovery

> **Goal**: Users find each other by username instead of IP address. The C++ backend
> registers with Supabase on startup, looks up friends via the REST API, and sends
> periodic heartbeats to keep presence data fresh.

---

## Table of Contents

1. [What We're Building](#1-what-were-building)
2. [How Supabase Works (For Beginners)](#2-how-supabase-works)
3. [Step 1: Create Supabase Tables](#3-step-1-create-supabase-tables)
4. [Step 2: Get Your API Keys](#4-step-2-get-your-api-keys)
5. [Step 3: libcurl Basics](#5-step-3-libcurl-basics)
6. [Step 4: Implement SupabaseClient](#6-step-4-implement-supabaseclient)
7. [Step 5: User Registration](#7-step-5-user-registration)
8. [Step 6: Heartbeat Loop](#8-step-6-heartbeat-loop)
9. [Step 7: Friend Lookup](#9-step-7-friend-lookup)
10. [Step 8: Wire POST /friends to Supabase](#10-step-8-wire-post-friends)
11. [Testing](#11-testing)
12. [Learning Resources](#12-learning-resources)
13. [Common Pitfalls](#13-common-pitfalls)

---

## 1. What We're Building

```
  Alice's Backend                              Bob's Backend
  ┌──────────────┐                            ┌──────────────┐
  │ POST /friends│                            │              │
  │ {"username": │                            │              │
  │  "bob"}      │                            │              │
  └──────┬───────┘                            └──────────────┘
         │                                           ▲
         │ 1. Lookup "bob"                          │
         ▼                                           │
  ┌──────────────────────────────────────────────────┐
  │              Supabase PostgreSQL                  │
  │                                                   │
  │  users table:                                     │
  │  ┌──────────┬──────────┬────────┬─────────────┐  │
  │  │ username │ node_id  │ pub_key│ last_ip      │  │
  │  ├──────────┼──────────┼────────┼─────────────┤  │
  │  │ alice    │ aaa...   │ xxx... │ 192.168.1.10│  │
  │  │ bob      │ bbb...   │ yyy... │ 192.168.1.20│◄─┤ 2. Return bob's IP
  │  └──────────┴──────────┴────────┴─────────────┘  │
  └──────────────────────────────────────────────────┘
         │
         │ 3. Now Alice knows Bob is at 192.168.1.20:9100
         │    She can connect directly via TCP!
         ▼
  Alice connects to Bob via P2P
```

After this phase:
- ✅ Backend registers itself in Supabase on startup
- ✅ `POST /friends` looks up users by username (no more IP addresses)
- ✅ Heartbeat updates `last_seen` every 30 seconds
- ✅ Frontend can add friends by typing a username

---

## 2. How Supabase Works

Supabase gives you a PostgreSQL database with an **automatic REST API**. Every table you create gets HTTP endpoints for free.

```
Your C++ code                    Supabase auto-generated API
──────────────                   ───────────────────────────
POST /rest/v1/users      →      INSERT INTO users (...)
GET  /rest/v1/users?...  →      SELECT * FROM users WHERE ...
PATCH /rest/v1/users?... →      UPDATE users SET ... WHERE ...
DELETE /rest/v1/messages →      DELETE FROM messages WHERE ...
```

Every request needs two headers:
```
apikey: YOUR_ANON_KEY
Authorization: Bearer YOUR_ANON_KEY
Content-Type: application/json
```

> 📖 **Full Supabase Setup Guide**: See `docs/infrastructure/01-supabase-setup.md`
> 📺 **Video**: [Supabase in 100 Seconds — Fireship](https://www.youtube.com/watch?v=zBZgdTb-dns)
> 📺 **Video**: [Supabase Full Course — freeCodeCamp](https://www.youtube.com/watch?v=dU7GwCOgvNY)

---

## 3. Step 1: Create Supabase Tables

Run this SQL in the Supabase SQL Editor (Dashboard → SQL Editor → New Query):

```sql
-- Users table: directory of all chat users
CREATE TABLE IF NOT EXISTS users (
    username    TEXT PRIMARY KEY,
    node_id     TEXT UNIQUE NOT NULL,
    public_key  TEXT NOT NULL,
    signing_key TEXT NOT NULL,
    last_ip     TEXT,
    last_seen   TIMESTAMPTZ DEFAULT now()
);

-- Offline messages: encrypted messages waiting for delivery
CREATE TABLE IF NOT EXISTS messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    to_user     TEXT NOT NULL REFERENCES users(username),
    from_user   TEXT NOT NULL,
    ciphertext  TEXT NOT NULL,
    signature   TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- Index for fast message lookup
CREATE INDEX IF NOT EXISTS idx_messages_to_user ON messages(to_user);

-- Auto-delete messages older than 7 days
-- (Run this as a Supabase cron job or pg_cron extension)
-- SELECT cron.schedule('delete-old-messages', '0 * * * *',
--     $$DELETE FROM messages WHERE created_at < now() - interval '7 days'$$
-- );
```

### Why These Tables?

| Table | Purpose |
|-------|---------|
| `users` | Phone book — "What's Bob's IP and public key?" |
| `messages` | Mailbox — "Store this encrypted message until Bob comes online" |

### Row Level Security (RLS)

Supabase enables RLS by default. For a simple setup, add policies:

```sql
-- Allow anyone to read users (it's a public directory)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users are publicly readable"
    ON users FOR SELECT USING (true);
CREATE POLICY "Users can insert themselves"
    ON users FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update themselves"
    ON users FOR UPDATE USING (true);

-- Messages: users can read their own, anyone can insert
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can send messages"
    ON messages FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can read their messages"
    ON messages FOR SELECT USING (true);
CREATE POLICY "Users can delete their messages"
    ON messages FOR DELETE USING (true);
```

**⚠️ Note**: These policies are permissive for development. In production, you'd restrict updates/deletes to only the row owner.

---

## 4. Step 2: Get Your API Keys

1. Go to [supabase.com](https://supabase.com) → Your Project → Settings → API
2. Copy:
   - **Project URL**: `https://abcdefgh.supabase.co`
   - **anon/public key**: `eyJhbGciOiJIUzI1NiIs...` (long JWT string)
3. Paste into your `config.json`:

```json
{
    "supabase": {
        "url": "https://abcdefgh.supabase.co",
        "anon_key": "eyJhbGciOiJIUzI1NiIs..."
    }
}
```

**⚠️ Never commit `config.json` to Git!** Add it to `.gitignore`. Only commit `config.example.json`.

---

## 5. Step 3: libcurl Basics

libcurl is the HTTP client we use to call Supabase from C++.

### How libcurl Works

```cpp
#include <curl/curl.h>
#include <string>

// Callback: libcurl calls this function as data arrives
static size_t write_callback(char* ptr, size_t size, size_t nmemb, void* userdata) {
    std::string* response = static_cast<std::string*>(userdata);
    response->append(ptr, size * nmemb);
    return size * nmemb;
}

std::string http_get(const std::string& url, const std::string& api_key) {
    CURL* curl = curl_easy_init();
    std::string response;

    if (curl) {
        // Set URL
        curl_easy_setopt(curl, CURLOPT_URL, url.c_str());

        // Set headers
        struct curl_slist* headers = nullptr;
        headers = curl_slist_append(headers,
            ("apikey: " + api_key).c_str());
        headers = curl_slist_append(headers,
            ("Authorization: Bearer " + api_key).c_str());
        headers = curl_slist_append(headers,
            "Content-Type: application/json");
        curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);

        // Set callback to capture response
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_callback);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);

        // Execute the request
        CURLcode res = curl_easy_perform(curl);
        if (res != CURLE_OK) {
            spdlog::error("curl failed: {}", curl_easy_strerror(res));
        }

        // Cleanup
        curl_slist_free_all(headers);
        curl_easy_cleanup(curl);
    }
    return response;
}
```

**Why libcurl?** It's the most battle-tested HTTP library in existence. It handles HTTPS, certificates, redirects, and retries. Writing HTTP from scratch with raw sockets is painful and error-prone.

> 📺 **Video**: [libcurl in C/C++ — Jacob Sorber](https://www.youtube.com/watch?v=q_ZpxCBMag0)
> 📖 **Docs**: [curl.se/libcurl/c/](https://curl.se/libcurl/c/)
> 📖 **Examples**: [curl.se/libcurl/c/example.html](https://curl.se/libcurl/c/example.html)

---

## 6. Step 4: Implement SupabaseClient

### Code: `src/supabase/supabase_client.cpp`

```cpp
#include "supabase/supabase_client.h"
#include <spdlog/spdlog.h>
#include <curl/curl.h>

using json = nlohmann::json;

// ── libcurl write callback ──
static size_t write_cb(char* ptr, size_t size, size_t nmemb, void* data) {
    auto* str = static_cast<std::string*>(data);
    str->append(ptr, size * nmemb);
    return size * nmemb;
}

SupabaseClient::SupabaseClient(const std::string& base_url,
                                const std::string& anon_key)
    : base_url_(base_url), anon_key_(anon_key)
{
    // Initialize libcurl globally (call once!)
    curl_global_init(CURL_GLOBAL_DEFAULT);
    spdlog::info("Supabase client initialized: {}", base_url_);
}

// ── Generic HTTP Methods ──────────────────────────────────────

std::string SupabaseClient::http_get(const std::string& endpoint) {
    CURL* curl = curl_easy_init();
    std::string response;

    if (!curl) return response;

    std::string url = base_url_ + endpoint;
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());

    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, ("apikey: " + anon_key_).c_str());
    headers = curl_slist_append(headers, ("Authorization: Bearer " + anon_key_).c_str());
    headers = curl_slist_append(headers, "Content-Type: application/json");
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);

    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_cb);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);

    CURLcode res = curl_easy_perform(curl);
    if (res != CURLE_OK) {
        spdlog::error("GET {} failed: {}", endpoint, curl_easy_strerror(res));
    }

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);
    return response;
}

std::string SupabaseClient::http_post(const std::string& endpoint,
                                       const std::string& body) {
    CURL* curl = curl_easy_init();
    std::string response;

    if (!curl) return response;

    std::string url = base_url_ + endpoint;
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.c_str());

    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, ("apikey: " + anon_key_).c_str());
    headers = curl_slist_append(headers, ("Authorization: Bearer " + anon_key_).c_str());
    headers = curl_slist_append(headers, "Content-Type: application/json");
    // Upsert support (insert or update if exists)
    headers = curl_slist_append(headers, "Prefer: resolution=merge-duplicates");
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);

    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_cb);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);

    CURLcode res = curl_easy_perform(curl);
    if (res != CURLE_OK) {
        spdlog::error("POST {} failed: {}", endpoint, curl_easy_strerror(res));
    }

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);
    return response;
}

std::string SupabaseClient::http_patch(const std::string& endpoint,
                                        const std::string& body) {
    CURL* curl = curl_easy_init();
    std::string response;

    if (!curl) return response;

    std::string url = base_url_ + endpoint;
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, "PATCH");
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.c_str());

    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, ("apikey: " + anon_key_).c_str());
    headers = curl_slist_append(headers, ("Authorization: Bearer " + anon_key_).c_str());
    headers = curl_slist_append(headers, "Content-Type: application/json");
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);

    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_cb);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);

    CURLcode res = curl_easy_perform(curl);
    if (res != CURLE_OK) {
        spdlog::error("PATCH {} failed: {}", endpoint, curl_easy_strerror(res));
    }

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);
    return response;
}

std::string SupabaseClient::http_delete(const std::string& endpoint) {
    CURL* curl = curl_easy_init();
    std::string response;

    if (!curl) return response;

    std::string url = base_url_ + endpoint;
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, "DELETE");

    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, ("apikey: " + anon_key_).c_str());
    headers = curl_slist_append(headers, ("Authorization: Bearer " + anon_key_).c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);

    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_cb);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);

    CURLcode res = curl_easy_perform(curl);
    if (res != CURLE_OK) {
        spdlog::error("DELETE {} failed: {}", endpoint, curl_easy_strerror(res));
    }

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);
    return response;
}
```

**💡 Tip**: You'll notice a lot of repeated code in the HTTP methods. This is intentional for clarity. Feel free to refactor into a single `do_request(method, endpoint, body)` helper.

---

## 7. Step 5: User Registration

On startup, the backend registers itself in Supabase:

```cpp
bool SupabaseClient::register_user(const std::string& username,
                                    const std::string& node_id,
                                    const std::string& public_key,
                                    const std::string& ip) {
    json body;
    body["username"] = username;
    body["node_id"] = node_id;
    body["public_key"] = public_key;
    body["last_ip"] = ip;
    body["last_seen"] = "now()";  // PostgreSQL function

    // POST with upsert header — creates or updates
    std::string response = http_post("/rest/v1/users", body.dump());
    spdlog::info("Registered user '{}' in Supabase", username);
    return true;
}
```

### Getting Your Public IP

```cpp
// Simple way: call an external service
std::string get_public_ip() {
    // Use curl to call a "what's my IP" service
    CURL* curl = curl_easy_init();
    std::string ip;

    if (curl) {
        curl_easy_setopt(curl, CURLOPT_URL, "https://api.ipify.org");
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_cb);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, &ip);
        curl_easy_perform(curl);
        curl_easy_cleanup(curl);
    }
    return ip;  // e.g., "203.0.113.42"
}
```

### Wire It in main.cpp

```cpp
// After creating SupabaseClient:
SupabaseClient supabase(
    config["supabase"]["url"],
    config["supabase"]["anon_key"]
);

std::string public_ip = get_public_ip();
supabase.register_user(username, node_id, public_key_b64, public_ip);
```

---

## 8. Step 6: Heartbeat Loop

Every 30 seconds, update `last_seen` and `last_ip` so friends know you're online:

```cpp
bool SupabaseClient::heartbeat(const std::string& username,
                                const std::string& ip) {
    json body;
    body["last_ip"] = ip;
    body["last_seen"] = "now()";

    // PATCH /rest/v1/users?username=eq.alice
    std::string endpoint = "/rest/v1/users?username=eq." + username;
    http_patch(endpoint, body.dump());
    return true;
}
```

### Running It as an ASIO Timer

```cpp
// In main.cpp or a HeartbeatService class:
void start_heartbeat(asio::io_context& io, SupabaseClient& supabase,
                      const std::string& username, const std::string& ip) {
    auto timer = std::make_shared<asio::steady_timer>(io);

    std::function<void()> tick = [&, timer, tick]() {
        supabase.heartbeat(username, ip);
        spdlog::debug("Heartbeat sent");

        timer->expires_after(std::chrono::seconds(30));
        timer->async_wait([tick](asio::error_code ec) {
            if (!ec) tick();
        });
    };

    tick();  // First heartbeat immediately
}
```

**Why 30 seconds?** It's a good balance. Too frequent = waste of Supabase quota. Too infrequent = friends see you as offline when you're not.

---

## 9. Step 7: Friend Lookup

When a user adds a friend, look them up in Supabase:

```cpp
std::optional<json> SupabaseClient::lookup_user(const std::string& username) {
    // PostgREST query: SELECT * FROM users WHERE username = 'bob'
    std::string endpoint = "/rest/v1/users?username=eq." + username +
                           "&select=username,node_id,public_key,signing_key,last_ip,last_seen";

    std::string response = http_get(endpoint);

    try {
        json arr = json::parse(response);
        if (arr.is_array() && !arr.empty()) {
            return arr[0];  // Return first (and only) match
        }
    } catch (const json::parse_error& e) {
        spdlog::error("Failed to parse Supabase response: {}", e.what());
    }

    return std::nullopt;  // User not found
}
```

### Understanding PostgREST Query Syntax

| What You Want | PostgREST URL |
|---------------|---------------|
| `WHERE username = 'bob'` | `?username=eq.bob` |
| `WHERE last_seen > '2025-01-01'` | `?last_seen=gt.2025-01-01` |
| `SELECT username, last_ip` | `?select=username,last_ip` |
| `LIMIT 10` | `?limit=10` |
| `ORDER BY last_seen DESC` | `?order=last_seen.desc` |

> 📖 **PostgREST Docs**: [postgrest.org/en/stable/api.html](https://postgrest.org/en/stable/api.html)

---

## 10. Step 8: Wire POST /friends

Update the `POST /friends` handler in `local_api.cpp`:

```cpp
// In handle_request(), POST /friends section:
else if (req.method == "POST" && req.path == "/friends") {
    try {
        json body = json::parse(req.body);
        std::string friend_username = body["username"];

        // 1. Look up in Supabase
        auto result = supabase_.lookup_user(friend_username);
        if (!result.has_value()) {
            response = make_response(404,
                R"({"error":"User not found"})");
            return;
        }

        // 2. Check if already friends
        if (db_.has_friend(friend_username)) {
            response = make_response(409,
                R"({"error":"Already friends with this user"})");
            return;
        }

        // 3. Store in local SQLite
        auto user = result.value();
        db_.add_friend(
            user["username"],
            user["public_key"],
            user.value("signing_key", ""),
            user.value("last_ip", "")
        );

        // 4. Respond with friend info
        json friend_info;
        friend_info["username"] = user["username"];
        friend_info["public_key"] = user["public_key"];
        friend_info["signing_key"] = user.value("signing_key", "");
        friend_info["online"] = false;
        friend_info["last_seen"] = user.value("last_seen", "");
        friend_info["last_ip"] = user.value("last_ip", "");
        friend_info["added_at"] = "now";

        response = make_response(201, friend_info.dump());
        spdlog::info("Added friend: {}", friend_username);

    } catch (const json::exception& e) {
        response = make_response(400,
            json({{"error", e.what()}}).dump());
    }
}
```

---

## 11. Testing

### Test Supabase Directly with curl

```bash
# Replace with YOUR values
BASE="https://abcdefgh.supabase.co"
KEY="eyJhbGciOiJIUzI1Ni..."

# Register a user
curl -X POST "$BASE/rest/v1/users" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates" \
  -d '{"username":"alice","node_id":"aaa","public_key":"xxx","last_ip":"1.2.3.4"}'

# Look up a user
curl "$BASE/rest/v1/users?username=eq.alice" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY"

# List all users
curl "$BASE/rest/v1/users?select=username,last_ip,last_seen" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY"
```

### Test via Backend API

```bash
# Start backend
./secure-p2p-chat-backend config.json

# Add a friend (must exist in Supabase first)
curl -X POST http://127.0.0.1:8080/friends \
  -H "Content-Type: application/json" \
  -d '{"username":"bob"}'

# Expected: 201 Created with bob's info
# Or: 404 if bob hasn't registered in Supabase yet
```

---

## 12. Learning Resources

### Supabase

| Resource | Type | Link |
|----------|------|------|
| **Supabase in 100 Seconds — Fireship** | 📺 YouTube | [youtube.com/watch?v=zBZgdTb-dns](https://www.youtube.com/watch?v=zBZgdTb-dns) |
| **Supabase Full Course — freeCodeCamp** | 📺 YouTube (3h) | [youtube.com/watch?v=dU7GwCOgvNY](https://www.youtube.com/watch?v=dU7GwCOgvNY) |
| **Supabase Docs** | 📖 Official | [supabase.com/docs](https://supabase.com/docs) |
| **PostgREST API Reference** | 📖 Docs | [postgrest.org/en/stable/api.html](https://postgrest.org/en/stable/api.html) |
| **Supabase Free Tier Limits** | 📖 Pricing | [supabase.com/pricing](https://supabase.com/pricing) |

### libcurl

| Resource | Type | Link |
|----------|------|------|
| **libcurl Tutorial — Jacob Sorber** | 📺 YouTube | [youtube.com/watch?v=q_ZpxCBMag0](https://www.youtube.com/watch?v=q_ZpxCBMag0) |
| **libcurl C Examples** | 📖 Official | [curl.se/libcurl/c/example.html](https://curl.se/libcurl/c/example.html) |
| **curl Easy Interface** | 📖 API Docs | [curl.se/libcurl/c/libcurl-easy.html](https://curl.se/libcurl/c/libcurl-easy.html) |

### Supabase Free Tier Limits (Important!)

| Limit | Value |
|-------|-------|
| Database size | 500 MB |
| API requests | 500,000 / month |
| Edge functions | 500,000 invocations / month |
| Storage | 1 GB |
| Realtime connections | 200 concurrent |
| Projects | 2 active |

**For our app**: With a 30-second heartbeat × 2 users × 30 days = ~170,000 heartbeat requests/month. That's well within the free tier, but if you add more users, consider increasing the heartbeat interval.

---

## 13. Common Pitfalls

### ❌ "401 Unauthorized" from Supabase

**Cause**: Wrong API key or missing headers.
**Fix**: Double-check you're using the `anon` key (not the `service_role` key), and include both `apikey` and `Authorization` headers.

### ❌ "No rows returned" but user exists

**Cause**: RLS policies blocking the query.
**Fix**: Check that your RLS policy allows SELECT. Or temporarily disable RLS for debugging:
```sql
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
```

### ❌ libcurl SSL certificate errors on Windows

**Cause**: libcurl can't find the CA certificate bundle.
**Fix**: Download `cacert.pem` from [curl.se/docs/caextract.html](https://curl.se/docs/caextract.html) and set:
```cpp
curl_easy_setopt(curl, CURLOPT_CAINFO, "path/to/cacert.pem");
```

### ❌ Heartbeat creates duplicate rows

**Cause**: Using POST without upsert header.
**Fix**: Use `Prefer: resolution=merge-duplicates` header on POST, or use PATCH for updates:
```cpp
// PATCH updates existing row, POST with Prefer header upserts
```

### ❌ Supabase project paused after 7 days of inactivity

**Cause**: Free tier projects auto-pause after 1 week without API calls.
**Fix**: Keep the heartbeat running, or manually unpause from the dashboard.

---

**← [Phase 1 — Plaintext P2P](./phase-1-plaintext-p2p.md) | [Phase 3 — Encryption →](./phase-3-encryption.md)**
