# 01 — Supabase Complete Setup Guide

> **Audience**: Beginners who have never used Supabase or PostgreSQL.
> This guide walks you through EVERYTHING from account creation to a working setup.

---

## Table of Contents

1. [What is Supabase?](#1-what-is-supabase)
2. [Create an Account](#2-create-an-account)
3. [Create a Project](#3-create-a-project)
4. [Find Your API Keys](#4-find-your-api-keys)
5. [Create Tables](#5-create-tables)
6. [Row Level Security (RLS)](#6-row-level-security-rls)
7. [Test with curl](#7-test-with-curl)
8. [Auto-Delete Old Messages](#8-auto-delete-old-messages)
9. [Free Tier Limits](#9-free-tier-limits)
10. [Common Mistakes](#10-common-mistakes)
11. [Dashboard Tips](#11-dashboard-tips)

---

## 1. What is Supabase?

Supabase is an open-source alternative to Firebase. For our project, it provides:

- **PostgreSQL database** — stores user profiles and offline messages
- **REST API (PostgREST)** — automatically exposes tables as HTTP endpoints
- **Free tier** — generous limits for hobby projects

### How We Use It

```
┌─────────────┐     HTTPS      ┌──────────────┐
│ C++ Backend │ ──────────────► │   Supabase   │
│  (libcurl)  │                 │  PostgreSQL  │
│             │ ◄────────────── │  + PostgREST │
└─────────────┘     JSON        └──────────────┘

We use Supabase for TWO things only:
1. User discovery (find friend's IP by username)
2. Offline message storage (encrypted messages)
```

---

## 2. Create an Account

1. Go to [https://supabase.com](https://supabase.com)
2. Click **"Start your project"** (top right)
3. Sign up with **GitHub** (recommended) or email
4. Verify your email if needed

---

## 3. Create a Project

1. After login, click **"New Project"**
2. Fill in:
   - **Organization**: Select your org (or create one)
   - **Project name**: `p2p-chat` (or anything you like)
   - **Database password**: Choose a strong password (save it!)
   - **Region**: Pick the closest to you (e.g., "West EU (Ireland)" for Europe)
3. Click **"Create new project"**
4. Wait 1–2 minutes for setup to complete

---

## 4. Find Your API Keys

After the project is created:

1. Click **Settings** (gear icon in sidebar)
2. Click **API** (under Configuration)
3. You'll see:

```
Project URL:     https://abcdefg.supabase.co
                 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                 This is your SUPABASE_URL

anon public:     eyJhbGciOiJIUzI1NiIsInR5cCI6...
                 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                 This is your SUPABASE_ANON_KEY
                 SAFE to use in your app

service_role:    eyJhbGciOiJIUzI1NiIsInR5cCI6...
                 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                 ⚠️ DANGER — NEVER put this in your code!
                 Only use in server-side admin scripts
```

### Put Them in Your Config

```json
{
  "supabase": {
    "url": "https://abcdefg.supabase.co",
    "api_key": "eyJhbGciOiJIUzI1NiIsInR5cCI6..."
  }
}
```

**⚠️ NEVER commit your API key to Git.** Add `config.json` to `.gitignore` and use `config.example.json` as a template.

---

## 5. Create Tables

### Option A: SQL Editor (Recommended)

1. In Supabase dashboard, click **SQL Editor** (left sidebar)
2. Click **"New query"**
3. Paste this entire SQL block and click **"Run"**:

```sql
-- ============================================
-- P2P Chat Supabase Schema
-- Run this ONCE to set up your database
-- ============================================

-- Users table: stores registered users and their connection info
CREATE TABLE IF NOT EXISTS users (
    username    TEXT PRIMARY KEY,
    node_id     TEXT UNIQUE NOT NULL,
    public_key  TEXT NOT NULL,
    last_ip     TEXT,
    last_seen   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for looking up users by node_id
CREATE INDEX IF NOT EXISTS idx_users_node_id ON users(node_id);

-- Messages table: stores encrypted offline messages
CREATE TABLE IF NOT EXISTS messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    to_user     TEXT NOT NULL REFERENCES users(username),
    from_user   TEXT NOT NULL,
    ciphertext  TEXT NOT NULL,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fetching messages by recipient (most common query)
CREATE INDEX IF NOT EXISTS idx_messages_to_user ON messages(to_user);

-- Index for cleaning up old messages
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
```

4. You should see **"Success. No rows returned"** — that means it worked!

### Option B: Table Editor (Visual)

1. Click **Table Editor** in the sidebar
2. Click **"Create a new table"**
3. Create each table manually with the columns above
4. This is more tedious but gives you a visual feel

### Verify Tables Were Created

1. Go to **Table Editor**
2. You should see `users` and `messages` in the left sidebar
3. Click each to see the columns

---

## 6. Row Level Security (RLS)

### What is RLS?

Row Level Security is a PostgreSQL feature that controls who can read/write each row. Supabase enables it by default.

### For Our Project: Simple Approach

Since we use the `anon` key without user authentication, we have two options:

#### Option 1: Disable RLS (Simple, Less Secure)

Good for development and learning:

```sql
-- Disable RLS on both tables
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE messages DISABLE ROW LEVEL SECURITY;
```

**Tradeoff**: Anyone with the anon key can read/write all data. For a learning project, this is acceptable.

#### Option 2: Enable RLS with Policies (More Secure)

```sql
-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Users table: anyone can read, anyone can insert/update
CREATE POLICY "Anyone can read users"
    ON users FOR SELECT
    USING (true);

CREATE POLICY "Anyone can insert users"
    ON users FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Anyone can update their own info"
    ON users FOR UPDATE
    USING (true);

-- Messages table: anyone can insert, recipient can read and delete
CREATE POLICY "Anyone can send messages"
    ON messages FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Anyone can read messages"
    ON messages FOR SELECT
    USING (true);

CREATE POLICY "Anyone can delete messages"
    ON messages FOR DELETE
    USING (true);
```

**Recommendation**: Start with Option 1 (disabled). Switch to Option 2 when you want to learn about security.

---

## 7. Test with curl

Before writing any C++ code, test your setup with curl:

### Insert a User

```bash
curl -X POST "https://YOUR_PROJECT.supabase.co/rest/v1/users" \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{
    "username": "test_alice",
    "node_id": "node-abc-123",
    "public_key": "dGVzdCBwdWJsaWMga2V5",
    "last_ip": "192.168.1.100"
  }'
```

Expected response:
```json
[{"username":"test_alice","node_id":"node-abc-123","public_key":"dGVzdCBwdWJsaWMga2V5","last_ip":"192.168.1.100","last_seen":"2024-01-15T10:30:00+00:00"}]
```

### Lookup a User

```bash
curl "https://YOUR_PROJECT.supabase.co/rest/v1/users?username=eq.test_alice" \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

### Insert a Message

```bash
curl -X POST "https://YOUR_PROJECT.supabase.co/rest/v1/messages" \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{
    "to_user": "test_alice",
    "from_user": "test_bob",
    "ciphertext": "ZW5jcnlwdGVkIG1lc3NhZ2UgaGVyZQ=="
  }'
```

### Fetch Messages for a User

```bash
curl "https://YOUR_PROJECT.supabase.co/rest/v1/messages?to_user=eq.test_alice&order=created_at.asc" \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

### Delete a Specific Message

```bash
curl -X DELETE "https://YOUR_PROJECT.supabase.co/rest/v1/messages?id=eq.SOME_UUID_HERE" \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

### Clean Up Test Data

```bash
curl -X DELETE "https://YOUR_PROJECT.supabase.co/rest/v1/messages?from_user=eq.test_bob" \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Authorization: Bearer YOUR_ANON_KEY"

curl -X DELETE "https://YOUR_PROJECT.supabase.co/rest/v1/users?username=eq.test_alice" \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

---

## 8. Auto-Delete Old Messages

Messages older than 7 days should be automatically cleaned up.

### Option A: Backend Cleanup (Recommended)

Have the C++ backend delete old messages on startup and periodically:

```
Supabase URL: /rest/v1/messages?created_at=lt.{7_days_ago}
Method: DELETE
```

In C++:
```cpp
void cleanup_old_messages(SupabaseClient& client) {
    // Calculate 7 days ago
    auto now = std::chrono::system_clock::now();
    auto week_ago = now - std::chrono::hours(24 * 7);

    // Format as ISO 8601
    auto time_t = std::chrono::system_clock::to_time_t(week_ago);
    std::tm tm = *std::gmtime(&time_t);
    char buf[64];
    std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S+00:00", &tm);

    // DELETE /messages?created_at=lt.2024-01-08T10:00:00+00:00
    std::string endpoint = "/messages?created_at=lt." + std::string(buf);
    client.do_delete(endpoint);
}
```

### Option B: PostgreSQL Function + pg_cron (If Available)

```sql
-- Create a cleanup function
CREATE OR REPLACE FUNCTION cleanup_old_messages()
RETURNS void AS $$
BEGIN
    DELETE FROM messages
    WHERE created_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- If pg_cron extension is available (check in Extensions):
SELECT cron.schedule(
    'cleanup-old-messages',
    '0 3 * * *',  -- Run daily at 3 AM
    $$SELECT cleanup_old_messages()$$
);
```

**Note**: pg_cron may not be available on the free tier. Use Option A instead.

---

## 9. Free Tier Limits

| Resource | Limit | Our Usage |
|----------|-------|-----------|
| Database size | 500 MB | Each user ≈ 100 bytes, each message ≈ 500 bytes. You'd need millions of records to hit this. |
| API requests | Unlimited (fair use) | Heartbeats + lookups = ~100/hour per user. Very safe. |
| Bandwidth | 5 GB/month | Each request ≈ 1 KB. 5 million requests/month. Fine. |
| File storage | 1 GB | We don't use file storage. |
| Edge functions | 500K invocations | We don't use edge functions. |
| Realtime | 200 connections | We don't use realtime. |

### Tips for Staying Under Limits

1. **Heartbeat interval**: Every 60 seconds, not faster
2. **Clean up messages**: Delete after delivery
3. **Don't poll Supabase**: The C++ backend caches friend info locally
4. **Batch deletes**: Delete multiple messages in one request

### Pausing Warning

Supabase **pauses inactive projects** after 7 days of no API activity on the free tier. To prevent this:
- Your backend's heartbeat automatically keeps it active
- If both users are offline for a week, manually visit the dashboard

---

## 10. Common Mistakes

### ❌ Using the Wrong Key

```
# BAD — service_role key in client code!
"api_key": "eyJhbGci...service_role..."
# This key bypasses ALL security rules!

# GOOD — anon key in client code
"api_key": "eyJhbGci...anon..."
```

### ❌ Wrong API URL Format

```
# BAD
url: "https://abcdefg.supabase.co/"  (trailing slash)
url: "abcdefg.supabase.co"           (missing https://)
url: "https://supabase.co/abcdefg"   (wrong format)

# GOOD
url: "https://abcdefg.supabase.co"
```

### ❌ Forgetting Headers

```
# BAD — 401 Unauthorized
curl "https://xxx.supabase.co/rest/v1/users"
# Missing apikey header!

# GOOD
curl "https://xxx.supabase.co/rest/v1/users" \
  -H "apikey: YOUR_KEY"
```

### ❌ Not Using `Prefer: return=representation`

```
# Without Prefer header, POST returns empty body
# Add this to get the inserted data back:
-H "Prefer: return=representation"
```

---

## 11. Dashboard Tips

### Viewing Table Data

1. Click **Table Editor** in the sidebar
2. Click on a table name (e.g., `users`)
3. You'll see all rows in a spreadsheet-like view
4. You can edit cells directly!

### Running SQL Queries

1. Click **SQL Editor**
2. Type your query and click **Run**
3. Useful queries:

```sql
-- Count messages per user
SELECT to_user, COUNT(*) as msg_count
FROM messages
GROUP BY to_user;

-- Find users not seen in 24 hours
SELECT username, last_seen
FROM users
WHERE last_seen < NOW() - INTERVAL '24 hours';

-- Check database size
SELECT pg_size_pretty(pg_database_size(current_database()));
```

### Monitoring

1. Click **Reports** to see API usage graphs
2. Check **Logs** for recent API calls and errors

---

## Learning Resources

- [Supabase Docs](https://supabase.com/docs) — Official documentation
- [PostgREST Docs](https://postgrest.org/en/stable/) — REST API query syntax
- [PostgreSQL Tutorial](https://www.postgresqltutorial.com/) — SQL basics
- [Supabase YouTube](https://www.youtube.com/c/Supabase) — Video tutorials
