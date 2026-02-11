# Message Format Specification

> Version 0.1 — Draft
>
> This document describes **exactly** how messages are structured when they
> travel between two peers over TCP, and how they are stored in Supabase for
> offline delivery. If you're new to networking or cryptography, read every
> section — we explain the *why* behind every design choice.

---

## Table of Contents

1. [Background Concepts](#1-background-concepts)
2. [Wire Protocol (Peer ↔ Peer TCP)](#2-wire-protocol-peer--peer-tcp)
3. [Envelope JSON — the "outer wrapper"](#3-envelope-json--the-outer-wrapper)
4. [Plaintext Payload — the "inner message"](#4-plaintext-payload--the-inner-message)
5. [Offline Message Format (Supabase)](#5-offline-message-format-supabase)
6. [Encryption Deep-Dive](#6-encryption-deep-dive)
7. [Signing Deep-Dive](#7-signing-deep-dive)
8. [Full Send / Receive Walkthrough](#8-full-send--receive-walkthrough)
9. [Message Types Reference](#9-message-types-reference)
10. [Common Mistakes & Pitfalls](#10-common-mistakes--pitfalls)
11. [Glossary](#11-glossary)

---

## 1. Background Concepts

Before diving into the format, let's make sure we understand the basics.

### 1.1 What is TCP?

TCP (Transmission Control Protocol) is one of the core internet protocols.
Think of it like a **reliable phone call** between two computers:

- You **connect** first (like dialing a number).
- Data arrives **in order** and **without gaps** (unlike UDP, which is more like
  throwing letters — some might get lost or arrive out of order).
- When you're done, you **close** the connection (hang up).

In our app, when Alice wants to send a message to Bob, her backend opens a TCP
connection to Bob's backend. She writes the message bytes into that connection,
and Bob reads them out the other end.

**Why TCP and not UDP?**
Chat messages must arrive reliably and in order. TCP handles retransmission and
ordering for us. UDP is better for real-time things like voice/video where
occasional packet loss is acceptable.

### 1.2 What is JSON?

JSON (JavaScript Object Notation) is a text format for structured data. Example:

```json
{
  "name": "Alice",
  "age": 22,
  "friends": ["Bob", "Charlie"]
}
```

We use JSON because:
- Both C++ (nlohmann/json) and Python have excellent JSON libraries.
- It's human-readable, so you can debug by just printing the raw bytes.
- It's flexible — we can add new fields later without breaking old code.

### 1.3 What is Base64?

Base64 is a way to represent **binary data** (like encrypted bytes) as **text
characters**. Encrypted output is raw bytes — they can contain null bytes, weird
control characters, etc. You can't safely put that inside a JSON string.

Base64 converts binary to a safe alphabet: `A-Z`, `a-z`, `0-9`, `+`, `/`, `=`.

Example:
```
Binary bytes:  [0xDE, 0xAD, 0xBE, 0xEF]
Base64 string: "3q2+7w=="
```

Every time you see "base64-encoded" in this document, it means: take the raw
bytes → convert to a base64 string → put that string in the JSON field.

**libsodium has built-in Base64 helpers:**
- `sodium_bin2base64()` — binary → base64 string
- `sodium_base642bin()` — base64 string → binary

### 1.4 What is a Nonce?

A **nonce** (Number used ONCE) is a random value that makes each encryption
unique. Even if you encrypt the exact same message twice, different nonces
produce completely different ciphertext.

**Why it matters:** Without a nonce, an attacker could see "these two encrypted
messages are identical" and deduce the plaintext is the same. The nonce
prevents this.

**Rules:**
- Generate a **fresh** random nonce for every message. Never reuse one.
- The nonce is **not secret** — it's sent alongside the ciphertext.
- In libsodium's `crypto_box_easy`, the nonce is 24 bytes (192 bits).

---

## 2. Wire Protocol (Peer ↔ Peer TCP)

### 2.1 The Problem: Where Does One Message End?

TCP is a **stream** of bytes — it has no built-in concept of "messages." If
Alice sends two 100-byte messages quickly, Bob might receive them as:
- One chunk of 200 bytes, or
- Three chunks of 50, 80, and 70 bytes, or
- Any other combination.

We need a way to tell Bob: "the first message is exactly N bytes, and the next
message starts right after."

### 2.2 The Solution: Length-Prefixed Framing

We prepend every JSON message with a **4-byte header** that says how long the
JSON payload is:

```
┌─────────────────────────┬──────────────────────────────────────────┐
│  4 bytes                │  Variable-length JSON payload            │
│  (unsigned 32-bit int,  │  (UTF-8 encoded text)                   │
│   big-endian byte order)│                                          │
└─────────────────────────┴──────────────────────────────────────────┘
```

**Example:** If the JSON is 256 bytes long:

```
Bytes on the wire:
  [0x00] [0x00] [0x01] [0x00]   ← 4-byte header: 256 in big-endian
  [0x7B] [0x22] [0x74] ...      ← 256 bytes of JSON (starts with {"t...)
```

### 2.3 What is "Big-Endian"?

Computers can store multi-byte numbers in different orders:
- **Big-endian:** Most significant byte first. The number 256 = `0x00000100`
  is stored as `[0x00, 0x00, 0x01, 0x00]`.
- **Little-endian:** Least significant byte first: `[0x00, 0x01, 0x00, 0x00]`.

Network protocols traditionally use big-endian (also called "network byte
order"). We follow this convention.

**In C++ code:**
```cpp
#include <cstdint>
#include <arpa/inet.h>  // htonl on Linux; winsock2.h on Windows

// Writing the length header
uint32_t payload_length = json_string.size();
uint32_t header = htonl(payload_length);  // host-to-network (big-endian)
// Write `header` (4 bytes) then `json_string` to the socket.

// Reading the length header
uint32_t header;
// Read 4 bytes from socket into `header`
uint32_t payload_length = ntohl(header);  // network-to-host
// Now read exactly `payload_length` bytes for the JSON.
```

### 2.4 Reading Algorithm (Pseudocode)

```
loop:
    1. Read exactly 4 bytes from TCP socket → store as `header`
    2. Convert `header` from big-endian to native uint32 → `length`
    3. Allocate a buffer of `length` bytes
    4. Read exactly `length` bytes from TCP socket → store in buffer
    5. Parse buffer as UTF-8 JSON → you now have a complete message
    6. Process the message (decrypt, verify, display, etc.)
    7. Go to step 1
```

**Important:** "Read exactly N bytes" may require multiple `recv()` calls!
TCP can return fewer bytes than you asked for. You must loop until you've
accumulated all N bytes. ASIO's `asio::async_read()` handles this for you.

---

## 3. Envelope JSON — the "Outer Wrapper"

Every message sent between peers uses this JSON structure (we call it the
"envelope" because it wraps the actual content):

```json
{
  "type": "message",
  "from": "alice",
  "to": "bob",
  "timestamp": "2026-02-11T16:00:00Z",
  "nonce": "dGhpcyBpcyBhIDI0LWJ5dGUgbm9uY2Uh",
  "ciphertext": "U2VjcmV0IG1lc3NhZ2UgZW5jcnlwdGVkIHdpdGggY3J5cHRvX2JveF9lYXN5",
  "signature": "RWQyNTUxOSBzaWduYXR1cmUgb2YgdGhlIGNpcGhlcnRleHQ="
}
```

### 3.1 Field-by-Field Explanation

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | string | ✅ | What kind of message this is. See [Message Types](#9-message-types-reference). |
| `from` | string | ✅ | The sender's username. The recipient uses this to look up the sender's public key for decryption and signature verification. |
| `to` | string | ✅ | The intended recipient's username. If this doesn't match your own username, reject the message. |
| `timestamp` | string | ✅ | When the message was created, in [ISO 8601](https://en.wikipedia.org/wiki/ISO_8601) UTC format. Example: `"2026-02-11T16:00:00Z"`. The `Z` suffix means UTC timezone. |
| `nonce` | string | ✅ (for `message` type) | Base64-encoded 24-byte random nonce used for encryption. The recipient needs this exact nonce to decrypt. |
| `ciphertext` | string | ✅ (for `message` type) | Base64-encoded encrypted payload. This is the output of `crypto_box_easy()`. |
| `signature` | string | ✅ (for `message` type) | Base64-encoded Ed25519 detached signature of the `ciphertext` bytes. Proves the message came from the claimed sender. |

### 3.2 Why is `from` Outside the Encryption?

You might wonder: "If the `from` field is unencrypted, can't someone fake it?"

Good question! That's exactly what the `signature` field prevents. The signature
is created using the sender's **private** Ed25519 key. Only the real sender has
that key. The recipient verifies the signature using the sender's **public** key
(which they stored when they first added this friend).

We keep `from` unencrypted so the recipient knows **whose** public key to use
for decryption before they can read the content.

### 3.3 Timestamp Format

We use ISO 8601 with UTC timezone:

```
2026-02-11T16:00:00Z
│         │        │
│         │        └─ "Z" = UTC (Zulu time)
│         └─ Time: 16:00:00 (4 PM)
└─ Date: February 11, 2026
```

**In C++** (using `<chrono>` in C++20):
```cpp
#include <chrono>
#include <format>

auto now = std::chrono::system_clock::now();
std::string ts = std::format("{:%FT%TZ}", std::chrono::floor<std::chrono::seconds>(now));
// Result: "2026-02-11T16:00:00Z"
```

**In Python:**
```python
from datetime import datetime, timezone
ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
```

---

## 4. Plaintext Payload — the "Inner Message"

Before encryption, the actual chat message looks like this:

```json
{
  "text": "Hello, Bob! How are you?",
  "msg_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

| Field | Type | Description |
|---|---|---|
| `text` | string | The actual human-readable chat message. This is what gets displayed in the UI. Can contain any UTF-8 text including emoji. |
| `msg_id` | string | A UUID v4 (universally unique identifier) that uniquely identifies this message. Used for deduplication and delivery acknowledgements. |

### 4.1 What is a UUID v4?

A UUID (Universally Unique Identifier) is a 128-bit number formatted as:
```
a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

Version 4 means it's **randomly generated**. The chance of two UUIDs colliding
is astronomically small (like 1 in 2^122).

**In C++** — you can generate UUIDs with a simple random approach or use a library.
**In Python** — `import uuid; str(uuid.uuid4())`

### 4.2 Encryption Process

This plaintext JSON is what gets encrypted. Here's the flow:

```
Step 1: Create the plaintext JSON string
        {"text": "Hello, Bob!", "msg_id": "uuid-here"}

Step 2: Encrypt it
        ciphertext = crypto_box_easy(
            plaintext_json_string,    ← the bytes of the JSON above
            nonce,                     ← 24 random bytes
            bob_public_key,            ← Bob's X25519 public key
            alice_secret_key           ← Alice's X25519 secret key
        )

Step 3: Sign the ciphertext
        signature = crypto_sign_detached(
            ciphertext,                ← the encrypted bytes
            alice_signing_secret_key   ← Alice's Ed25519 secret key
        )

Step 4: Encode for JSON
        nonce_b64      = base64_encode(nonce)
        ciphertext_b64 = base64_encode(ciphertext)
        signature_b64  = base64_encode(signature)

Step 5: Build the envelope JSON (see Section 3)
```

---

## 5. Offline Message Format (Supabase)

When Bob is offline, Alice can't deliver the message directly over TCP.
Instead, she uploads the encrypted message to Supabase for Bob to fetch later.

### 5.1 The `messages` Table in Supabase

```sql
CREATE TABLE messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    to_user     TEXT NOT NULL,
    from_user   TEXT NOT NULL,
    ciphertext  TEXT NOT NULL,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

| Column | Type | What Goes Here |
|---|---|---|
| `id` | UUID | Auto-generated by Supabase. Uniquely identifies this row. |
| `to_user` | TEXT | The recipient's username (e.g., `"bob"`). Bob will query: `SELECT * FROM messages WHERE to_user = 'bob'`. |
| `from_user` | TEXT | The sender's username (e.g., `"alice"`). So Bob knows who sent it. |
| `ciphertext` | TEXT | The **entire envelope JSON** (from Section 3), base64-encoded or stored as a JSON string. This contains the nonce, ciphertext, signature — everything Bob needs to decrypt. |
| `created_at` | TIMESTAMP | Auto-set by Supabase to the current time. Used for the 7-day auto-delete. |

### 5.2 Why Store the Whole Envelope?

We store the complete envelope JSON (not just the encrypted bytes) because Bob
needs all the fields to decrypt and verify:
- `nonce` — required for decryption
- `ciphertext` — the encrypted content
- `signature` — to verify it's really from Alice
- `from` — to know whose public key to use

### 5.3 Uploading an Offline Message (C++ Backend)

Using libcurl to POST to Supabase's REST API:

```
POST https://YOUR_PROJECT.supabase.co/rest/v1/messages
Headers:
    apikey: YOUR_ANON_KEY
    Authorization: Bearer YOUR_ANON_KEY
    Content-Type: application/json

Body:
{
    "to_user": "bob",
    "from_user": "alice",
    "ciphertext": "<base64 of full envelope JSON>"
}
```

### 5.4 Fetching Offline Messages (C++ Backend, on startup)

```
GET https://YOUR_PROJECT.supabase.co/rest/v1/messages?to_user=eq.bob
Headers:
    apikey: YOUR_ANON_KEY
    Authorization: Bearer YOUR_ANON_KEY

Response: JSON array of matching rows
```

After successfully decrypting and storing locally, **delete them**:

```
DELETE https://YOUR_PROJECT.supabase.co/rest/v1/messages?to_user=eq.bob
Headers:
    apikey: YOUR_ANON_KEY
    Authorization: Bearer YOUR_ANON_KEY
```

### 5.5 Auto-Deleting Old Messages

Messages older than 7 days should be cleaned up. Two options:

**Option A: pg_cron (if available on your Supabase plan)**
```sql
SELECT cron.schedule(
    'delete-old-messages',
    '0 * * * *',   -- runs every hour
    $$DELETE FROM messages WHERE created_at < NOW() - INTERVAL '7 days'$$
);
```

**Option B: Backend does it**
Your C++ backend can periodically send:
```
DELETE https://…/rest/v1/messages?created_at=lt.2026-02-04T00:00:00Z
```

We recommend Option B for free-tier Supabase since pg_cron may not be available.

---

## 6. Encryption Deep-Dive

This section explains the cryptographic algorithms we use and **why** we chose
them. You don't need to understand the math — libsodium handles that. But you
should understand what each piece does.

### 6.1 X25519 — Key Exchange

**What it is:** An algorithm for two people to create a **shared secret** even
though they only know each other's **public** keys.

**Analogy:** Imagine Alice and Bob each have a padlock (public key) and a key
(private key). Alice locks a box with Bob's padlock. Only Bob's key can open it.
X25519 does something similar but much more cleverly — both sides can compute
the same shared secret without ever sending their private keys.

**In libsodium:**
```cpp
// Generate a key pair (do this ONCE, on first run)
unsigned char pk[crypto_box_PUBLICKEYBYTES];  // 32 bytes — share this
unsigned char sk[crypto_box_SECRETKEYBYTES];  // 32 bytes — NEVER share
crypto_box_keypair(pk, sk);
```

### 6.2 XSalsa20-Poly1305 — Authenticated Encryption

**What it is:** The actual algorithm that encrypts your message. "Authenticated"
means it also detects if someone tampered with the ciphertext.

- **XSalsa20** — the stream cipher (scrambles the data)
- **Poly1305** — the MAC (Message Authentication Code — detects tampering)

**In libsodium:**
```cpp
// Encrypt
unsigned char nonce[crypto_box_NONCEBYTES];  // 24 bytes
randombytes_buf(nonce, sizeof(nonce));        // Generate random nonce

// ciphertext will be plaintext_len + crypto_box_MACBYTES (16) bytes
unsigned char ciphertext[PLAINTEXT_LEN + crypto_box_MACBYTES];
crypto_box_easy(
    ciphertext,        // output
    plaintext,         // input (your JSON bytes)
    plaintext_len,     // length of plaintext
    nonce,             // 24-byte random nonce
    recipient_pk,      // Bob's public key (32 bytes)
    sender_sk          // Alice's secret key (32 bytes)
);

// Decrypt (Bob's side)
unsigned char decrypted[PLAINTEXT_LEN];
if (crypto_box_open_easy(
    decrypted,         // output
    ciphertext,        // input
    ciphertext_len,    // length of ciphertext
    nonce,             // same nonce Alice used (she sends it in the envelope)
    sender_pk,         // Alice's public key
    recipient_sk       // Bob's secret key
) != 0) {
    // Decryption FAILED — message was tampered with or wrong keys
}
```

**Key sizes to remember:**
| Constant | Value | Meaning |
|---|---|---|
| `crypto_box_PUBLICKEYBYTES` | 32 | Public key size |
| `crypto_box_SECRETKEYBYTES` | 32 | Secret key size |
| `crypto_box_NONCEBYTES` | 24 | Nonce size |
| `crypto_box_MACBYTES` | 16 | Authentication tag (added to ciphertext) |

### 6.3 Why `crypto_box_easy` and Not `crypto_secretbox_easy`?

libsodium has two main encryption functions:

| Function | Key Type | Use Case |
|---|---|---|
| `crypto_box_easy` | Public-key (asymmetric) | Two parties who each have a key pair. **This is what we use.** |
| `crypto_secretbox_easy` | Shared secret (symmetric) | Both parties already share a single secret key. |

We use `crypto_box_easy` because Alice and Bob don't share a secret key in
advance — they only know each other's public keys (from Supabase).

---

## 7. Signing Deep-Dive

### 7.1 Ed25519 — Digital Signatures

**What it is:** An algorithm that lets you "sign" data with your private key.
Anyone with your public key can verify the signature is genuine.

**Why we need it:** Encryption guarantees that **only Bob can read** the
message. But it doesn't prove **who sent it**. Someone could encrypt a message
to Bob and claim to be Alice. Signing proves the message really came from
Alice's private key.

**Analogy:** Think of a wax seal on a letter. Everyone can see it, and everyone
knows what your seal looks like (public key). But only you have the stamp
(private key) that makes that exact impression.

### 7.2 Why Two Key Pairs?

We have **two separate** key pairs per node:

| Key Pair | Algorithm | Purpose |
|---|---|---|
| **Encryption keys** | X25519 | Used with `crypto_box_easy` to encrypt/decrypt messages |
| **Signing keys** | Ed25519 | Used with `crypto_sign_detached` to sign/verify messages |

**Why not use the same key pair for both?**
It's a cryptographic best practice to separate encryption and signing keys.
Using the same key for different purposes can sometimes create subtle
vulnerabilities. libsodium provides both, so we use both.

### 7.3 Signing in libsodium

```cpp
// Generate signing key pair (do ONCE, on first run)
unsigned char sign_pk[crypto_sign_PUBLICKEYBYTES];  // 32 bytes — share this
unsigned char sign_sk[crypto_sign_SECRETKEYBYTES];  // 64 bytes — NEVER share
crypto_sign_keypair(sign_pk, sign_sk);

// Sign a message (Alice's side)
unsigned char signature[crypto_sign_BYTES];  // 64 bytes
crypto_sign_detached(
    signature,             // output: 64-byte signature
    NULL,                  // optional: actual signature length (always 64)
    ciphertext,            // the data to sign (we sign the CIPHERTEXT, not plaintext)
    ciphertext_len,        // length of ciphertext
    sign_sk                // Alice's signing secret key
);

// Verify (Bob's side)
if (crypto_sign_verify_detached(
    signature,             // the 64-byte signature Alice sent
    ciphertext,            // the ciphertext (must be identical to what was signed)
    ciphertext_len,        // length
    sender_sign_pk         // Alice's signing PUBLIC key (Bob has this from when he added Alice as friend)
) != 0) {
    // Signature is INVALID — reject this message!
    // Either it wasn't sent by Alice, or it was tampered with.
}
```

### 7.4 What Do We Sign?

We sign the **ciphertext** (the encrypted bytes), NOT the plaintext. Why?

1. The ciphertext is what travels over the network. Signing it proves it wasn't
   modified in transit.
2. Signing the plaintext would require the verifier to decrypt first — but what
   if decryption fails because the message was tampered? You'd have no way to
   know if it was an attack or a bug.
3. Sign-then-encrypt vs encrypt-then-sign is a classic debate. We use
   **encrypt-then-sign** for simplicity, which is safe for our use case.

---

## 8. Full Send / Receive Walkthrough

Let's trace a complete message from Alice to Bob, step by step.

### 8.1 Alice Sends "Hello, Bob!"

```
ALICE'S BACKEND
───────────────

1. UI calls: POST /messages { "to": "bob", "text": "Hello, Bob!" }

2. Generate a UUID for this message:
       msg_id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"

3. Build the plaintext JSON:
       plaintext = '{"text":"Hello, Bob!","msg_id":"a1b2c3d4-..."}'

4. Look up Bob's X25519 public key from local friend database.
       bob_pk = [32 bytes]

5. Generate a random 24-byte nonce:
       nonce = randombytes_buf(24)
       nonce = [0xA3, 0x7F, 0x1C, ... 24 bytes total]

6. Encrypt the plaintext:
       ciphertext = crypto_box_easy(plaintext, nonce, bob_pk, alice_sk)
       ciphertext = [47 + 16 = 63 bytes]
       (plaintext was 47 bytes; crypto_box adds 16-byte MAC)

7. Sign the ciphertext with Alice's Ed25519 key:
       signature = crypto_sign_detached(ciphertext, alice_sign_sk)
       signature = [64 bytes]

8. Base64-encode the binary values:
       nonce_b64      = base64(nonce)       → "o38c..."
       ciphertext_b64 = base64(ciphertext)  → "U2Vj..."
       signature_b64  = base64(signature)   → "RWQy..."

9. Build the envelope JSON:
       {
           "type": "message",
           "from": "alice",
           "to": "bob",
           "timestamp": "2026-02-11T16:00:00Z",
           "nonce": "o38c...",
           "ciphertext": "U2Vj...",
           "signature": "RWQy..."
       }

10. Convert envelope to UTF-8 string → 287 bytes

11. Build the TCP frame:
        [0x00, 0x00, 0x01, 0x1F]  ← 4-byte header (287 in big-endian)
        [0x7B, 0x22, 0x74, ...]   ← 287 bytes of envelope JSON

12. Open TCP connection to Bob's IP:port (from friend database)

13. Write the frame to the TCP socket

14. Store in local DB: msg_id, "bob", "sent", "Hello, Bob!", timestamp, delivered=true
```

### 8.2 Bob Receives the Message

```
BOB'S BACKEND
─────────────

1. PeerServer accepts TCP connection from Alice's IP

2. Read 4 bytes → header = [0x00, 0x00, 0x01, 0x1F] → length = 287

3. Read exactly 287 bytes → raw JSON string

4. Parse JSON → envelope object

5. Check envelope["to"] == "bob" ← yes, it's for us

6. Look up Alice's signing public key from friend database
       alice_sign_pk = [32 bytes]

7. Base64-decode the signature:
       signature = base64_decode(envelope["signature"])  → [64 bytes]

8. Base64-decode the ciphertext:
       ciphertext = base64_decode(envelope["ciphertext"]) → [63 bytes]

9. VERIFY the signature:
       result = crypto_sign_verify_detached(signature, ciphertext, alice_sign_pk)
       if result != 0 → REJECT MESSAGE! Log a warning and close connection.
       result == 0 → Signature is valid ✓

10. Base64-decode the nonce:
        nonce = base64_decode(envelope["nonce"])  → [24 bytes]

11. Look up Alice's X25519 public key from friend database:
        alice_pk = [32 bytes]

12. DECRYPT:
        plaintext = crypto_box_open_easy(ciphertext, nonce, alice_pk, bob_sk)
        if decryption fails → REJECT (tampered or wrong keys)
        plaintext = '{"text":"Hello, Bob!","msg_id":"a1b2c3d4-..."}'

13. Parse plaintext JSON → { text: "Hello, Bob!", msg_id: "a1b2..." }

14. Check if msg_id was already seen (deduplication)
        if seen → ignore (replay attack protection)
        if new → continue

15. Store in local DB: msg_id, "alice", "received", "Hello, Bob!", timestamp

16. Next time UI polls GET /messages?peer=alice → this message appears
```

### 8.3 Offline Scenario (Bob is not online)

```
ALICE'S BACKEND
───────────────

Steps 1–10 are identical (build the envelope).

11. Try to open TCP connection to Bob's IP:port
        → Connection REFUSED or TIMEOUT (Bob is offline)

12. Fallback: upload encrypted envelope to Supabase
        POST /rest/v1/messages
        {
            "to_user": "bob",
            "from_user": "alice",
            "ciphertext": "<base64 of entire envelope JSON>"
        }

13. Store in local DB: msg_id, "bob", "sent", "Hello, Bob!", timestamp, delivered=false
        (The UI shows a "pending" or "clock" icon)

─── Later, Bob comes online ───

BOB'S BACKEND (starting up)
───────────────────────────

1. SupabaseClient::fetch_offline_messages("bob")
       GET /rest/v1/messages?to_user=eq.bob

2. For each message in the response:
       a. Base64-decode the ciphertext field → envelope JSON
       b. Parse envelope JSON
       c. Verify signature (steps 6–9 from Section 8.2)
       d. Decrypt (steps 10–12 from Section 8.2)
       e. Store in local DB

3. Delete fetched messages from Supabase:
       DELETE /rest/v1/messages?to_user=eq.bob
```

---

## 9. Message Types Reference

The `type` field in the envelope can be one of these values:

### `"message"` — Chat Message

The primary message type. Contains encrypted text from one user to another.
All fields (nonce, ciphertext, signature) are required.

### `"ack"` — Delivery Acknowledgement

Sent back to the sender to confirm a message was received and decrypted
successfully.

```json
{
  "type": "ack",
  "from": "bob",
  "to": "alice",
  "timestamp": "2026-02-11T16:00:01Z",
  "ack_msg_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

| Field | Description |
|---|---|
| `ack_msg_id` | The `msg_id` of the message being acknowledged. |

No encryption needed for acks — they contain no sensitive data. But they
SHOULD be signed so you can verify the ack is genuine.

### `"ping"` — Keep-Alive / Presence Check

A lightweight message to check if a peer is still connected. No payload needed.

```json
{
  "type": "ping",
  "from": "alice",
  "to": "bob",
  "timestamp": "2026-02-11T16:05:00Z"
}
```

The expected response is a `"ping"` back (acting as a "pong").

### `"key_exchange"` — Reserved

Reserved for future use. Will be needed if we implement key rotation (changing
keys periodically for better security) or the Double Ratchet protocol.

---

## 10. Common Mistakes & Pitfalls

These are mistakes that beginners commonly make. Watch out for them!

### ❌ Reusing a nonce

**Never** use the same nonce twice with the same key pair. If you do, an
attacker can XOR the two ciphertexts and recover information about the
plaintexts. Always call `randombytes_buf()` for a fresh nonce per message.

### ❌ Forgetting to verify the signature before decrypting

Always verify first, then decrypt. If you decrypt unverified messages, you
might process tampered data.

### ❌ Signing the plaintext instead of the ciphertext

Sign the ciphertext. This follows the "encrypt-then-sign" pattern and ensures
the signature covers exactly what was transmitted.

### ❌ Not handling partial TCP reads

`recv()` can return fewer bytes than you requested. Always loop until you've
read the exact number of bytes specified in the length header. Use ASIO's
`asio::async_read()` which does this automatically.

### ❌ Storing private keys in Supabase

Private keys (secret keys) must NEVER leave the local machine. Only public
keys are stored in Supabase. If your private key is compromised, all your
past and future messages are compromised.

### ❌ Using `std::string` for binary data without care

In C++, `std::string` can hold binary data (including null bytes), but be
careful with `.c_str()` — it stops at the first null byte. Use `.data()` and
`.size()` instead when working with binary data.

### ❌ Forgetting the MAC overhead

`crypto_box_easy` output is `plaintext_length + 16` bytes (16 bytes for the
Poly1305 MAC). Make sure your buffer is large enough.

---

## 11. Glossary

| Term | Definition |
|---|---|
| **Plaintext** | The original, unencrypted message content. In our app, this is the JSON `{"text": "...", "msg_id": "..."}`. |
| **Ciphertext** | The encrypted version of the plaintext. Unreadable without the correct decryption key. |
| **Envelope** | The outer JSON structure that wraps the ciphertext along with metadata (from, to, nonce, signature, etc.). |
| **Nonce** | A random value used once to ensure each encryption is unique. Sent alongside the ciphertext (not secret). |
| **MAC** | Message Authentication Code. A short tag appended to ciphertext that detects tampering. Poly1305 generates a 16-byte MAC. |
| **Key pair** | A public key + private key that belong together. The public key is shared; the private key is kept secret. |
| **X25519** | An elliptic-curve Diffie-Hellman key agreement algorithm. Used to derive a shared encryption secret from two key pairs. |
| **Ed25519** | An elliptic-curve digital signature algorithm. Used to sign and verify messages. |
| **XSalsa20** | A stream cipher (encryption algorithm). The "X" means it uses a 24-byte nonce (extended). |
| **Poly1305** | A MAC algorithm. Combined with XSalsa20 to provide authenticated encryption. |
| **Base64** | An encoding that represents binary data as ASCII text. Used to safely embed binary values in JSON. |
| **Big-endian** | Byte order where the most significant byte comes first. Used in our length-prefix header. |
| **TOFU** | Trust On First Use. The first time you see a peer's public key, you trust it. Changes trigger a warning. |
| **UUID** | Universally Unique Identifier. A 128-bit random ID. Format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`. |
| **Detached signature** | A signature stored separately from the data it signs (as opposed to prepended). Our signatures are detached. |
| **PostgREST** | A tool that auto-generates a REST API from a PostgreSQL database. Supabase uses this under the hood. |
