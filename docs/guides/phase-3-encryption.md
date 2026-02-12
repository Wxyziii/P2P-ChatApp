# Phase 3 — End-to-End Encryption with libsodium

> **Goal**: Every message is encrypted before it leaves your computer and can only
> be decrypted by the intended recipient. Even if Supabase is compromised, attackers
> see only gibberish. This phase adds real security to your chat.

---

## Table of Contents

1. [What We're Building](#1-what-were-building)
2. [Cryptography Crash Course](#2-cryptography-crash-course)
3. [Step 1: Initialize libsodium](#3-step-1-initialize-libsodium)
4. [Step 2: Generate Key Pairs](#4-step-2-generate-key-pairs)
5. [Step 3: Save & Load Keys](#5-step-3-save--load-keys)
6. [Step 4: Encrypt Messages (crypto_box)](#6-step-4-encrypt-messages)
7. [Step 5: Decrypt Messages](#7-step-5-decrypt-messages)
8. [Step 6: Sign Messages (Ed25519)](#8-step-6-sign-messages)
9. [Step 7: Verify Signatures](#9-step-7-verify-signatures)
10. [Step 8: Complete CryptoManager Implementation](#10-step-8-complete-cryptomanager)
11. [Step 9: Integrate into the Message Pipeline](#11-step-9-integrate-into-pipeline)
12. [Why Each Step Matters](#12-why-each-step-matters)
13. [Learning Resources](#13-learning-resources)
14. [Common Pitfalls](#14-common-pitfalls)

---

## 1. What We're Building

```
  Alice                                              Bob
  ┌──────────────────┐                              ┌──────────────────┐
  │ "Hello Bob!"     │                              │                  │
  │       │          │                              │                  │
  │       ▼          │                              │                  │
  │ ┌────────────┐   │    Encrypted blob            │ ┌────────────┐  │
  │ │ ENCRYPT    │   │    (unreadable)              │ │ DECRYPT    │  │
  │ │ with Bob's │──────────────────────────────────►│ │ with Bob's │  │
  │ │ public key │   │                              │ │ secret key │  │
  │ └────────────┘   │                              │ └─────┬──────┘  │
  │       │          │                              │       │         │
  │       ▼          │                              │       ▼         │
  │ ┌────────────┐   │    Signature                 │ ┌────────────┐  │
  │ │ SIGN       │   │    (proves Alice sent it)    │ │ VERIFY     │  │
  │ │ with Alice's│─────────────────────────────────►│ │ with Alice's│ │
  │ │ secret key │   │                              │ │ public key │  │
  │ └────────────┘   │                              │ └────────────┘  │
  └──────────────────┘                              └──────────────────┘

  Only Bob can read the message (encryption)
  Bob knows Alice sent it (signing)
  Nobody in between can read or forge it
```

After this phase:
- ✅ Each node has a unique X25519 + Ed25519 key pair
- ✅ Messages are encrypted before sending (only recipient can read)
- ✅ Messages are signed before sending (recipient verifies sender)
- ✅ Keys are stored locally and public keys are shared via Supabase
- ✅ **The frontend sees only plaintext** — all crypto is in C++

---

## 2. Cryptography Crash Course

### What Is End-to-End Encryption (E2E)?

"End-to-end" means the message is encrypted on Alice's device and decrypted on Bob's device. **No one in between** — not the internet, not Supabase, not even us — can read it.

### Two Types of Keys We Use

| Algorithm | Purpose | Analogy |
|-----------|---------|---------|
| **X25519** (key exchange) | Encrypt & decrypt messages | A lockbox: you lock with Bob's key, only Bob can open it |
| **Ed25519** (signing) | Prove who sent a message | Your handwritten signature: only you can create it, anyone can verify it |

### Public Key vs Secret Key

```
Public Key  = Your "email address" — share it with everyone
Secret Key  = Your "password" — NEVER share it, NEVER store it in Supabase

Anyone can ENCRYPT with your public key.
Only YOU can DECRYPT with your secret key.
```

### Why Two Separate Key Pairs?

- **X25519** is designed for encryption (Diffie-Hellman key exchange)
- **Ed25519** is designed for signing (digital signatures)

They serve different purposes and mixing them would be insecure.

> 📺 **Must Watch**: [Public Key Cryptography — Computerphile](https://www.youtube.com/watch?v=GSIDS_lvRv4)
> 📺 **Excellent**: [Diffie-Hellman Key Exchange — Computerphile](https://www.youtube.com/watch?v=NmM9HA2MQGI)
> 📺 **Video**: [Digital Signatures — Computerphile](https://www.youtube.com/watch?v=s22eJ1eVLTU)
> 📖 **libsodium Docs**: [doc.libsodium.org](https://doc.libsodium.org/)

---

## 3. Step 1: Initialize libsodium

libsodium must be initialized once before ANY crypto function is called.

```cpp
#include <sodium.h>
#include <spdlog/spdlog.h>

bool CryptoManager::init() {
    // sodium_init() returns 0 on success, -1 on failure, 1 if already initialized
    if (sodium_init() < 0) {
        spdlog::error("Failed to initialize libsodium!");
        return false;
    }
    spdlog::info("libsodium initialized successfully");
    return true;
}
```

**Call this in `main.cpp` BEFORE anything else:**

```cpp
int main() {
    if (!CryptoManager::init()) {
        return 1;  // Abort if crypto fails
    }
    // ... rest of startup
}
```

**Why?** libsodium initializes a secure random number generator. Without this, key generation produces predictable (insecure) keys.

---

## 4. Step 2: Generate Key Pairs

```cpp
#include <sodium.h>
#include <vector>

void CryptoManager::generate_keypair() {
    // ── X25519 (encryption) ──
    public_key_.resize(crypto_box_PUBLICKEYBYTES);      // 32 bytes
    secret_key_.resize(crypto_box_SECRETKEYBYTES);      // 32 bytes
    crypto_box_keypair(public_key_.data(), secret_key_.data());

    // ── Ed25519 (signing) ──
    signing_public_key_.resize(crypto_sign_PUBLICKEYBYTES);  // 32 bytes
    signing_secret_key_.resize(crypto_sign_SECRETKEYBYTES);  // 64 bytes
    crypto_sign_keypair(signing_public_key_.data(), signing_secret_key_.data());

    spdlog::info("Generated new key pair");
    spdlog::info("  X25519 public key:  {} bytes", public_key_.size());
    spdlog::info("  Ed25519 public key: {} bytes", signing_public_key_.size());
}
```

### Key Sizes

| Key | Size | Constant |
|-----|------|----------|
| X25519 public key | 32 bytes | `crypto_box_PUBLICKEYBYTES` |
| X25519 secret key | 32 bytes | `crypto_box_SECRETKEYBYTES` |
| Ed25519 public key | 32 bytes | `crypto_sign_PUBLICKEYBYTES` |
| Ed25519 secret key | 64 bytes | `crypto_sign_SECRETKEYBYTES` |
| Nonce | 24 bytes | `crypto_box_NONCEBYTES` |

---

## 5. Step 3: Save & Load Keys

Keys must persist across restarts. Store them in a local JSON file.

```cpp
#include <fstream>
#include <sodium.h>
#include <nlohmann/json.hpp>

// Helper: convert raw bytes to base64 string for storage
static std::string to_base64(const std::vector<uint8_t>& data) {
    // libsodium has built-in base64 encoding!
    size_t b64_len = sodium_base64_encoded_len(data.size(),
                                                sodium_base64_VARIANT_ORIGINAL);
    std::string b64(b64_len, '\0');
    sodium_bin2base64(b64.data(), b64_len, data.data(), data.size(),
                      sodium_base64_VARIANT_ORIGINAL);
    // Remove trailing null
    b64.resize(strlen(b64.c_str()));
    return b64;
}

// Helper: convert base64 string back to raw bytes
static std::vector<uint8_t> from_base64(const std::string& b64) {
    std::vector<uint8_t> bin(b64.size());  // Overallocate, will shrink
    size_t bin_len = 0;
    sodium_base642bin(bin.data(), bin.size(),
                      b64.c_str(), b64.size(),
                      nullptr, &bin_len, nullptr,
                      sodium_base64_VARIANT_ORIGINAL);
    bin.resize(bin_len);
    return bin;
}

void CryptoManager::save_keypair(const std::string& path) const {
    nlohmann::json keys;
    keys["x25519_public"]  = to_base64(public_key_);
    keys["x25519_secret"]  = to_base64(secret_key_);
    keys["ed25519_public"] = to_base64(signing_public_key_);
    keys["ed25519_secret"] = to_base64(signing_secret_key_);

    std::ofstream file(path);
    file << keys.dump(2);  // Pretty print with 2-space indent
    spdlog::info("Keys saved to {}", path);
}

bool CryptoManager::load_keypair(const std::string& path) {
    std::ifstream file(path);
    if (!file.is_open()) {
        spdlog::warn("No key file found at {}. Will generate new keys.", path);
        return false;
    }

    try {
        auto keys = nlohmann::json::parse(file);
        public_key_         = from_base64(keys["x25519_public"]);
        secret_key_         = from_base64(keys["x25519_secret"]);
        signing_public_key_ = from_base64(keys["ed25519_public"]);
        signing_secret_key_ = from_base64(keys["ed25519_secret"]);
        spdlog::info("Keys loaded from {}", path);
        return true;
    } catch (const std::exception& e) {
        spdlog::error("Failed to load keys: {}", e.what());
        return false;
    }
}
```

### Usage in main.cpp

```cpp
CryptoManager crypto;

// Try to load existing keys, generate new ones if not found
if (!crypto.load_keypair("keys.json")) {
    crypto.generate_keypair();
    crypto.save_keypair("keys.json");
}

// Register public key with Supabase
supabase.register_user(username, node_id,
    to_base64(crypto.public_key()),
    to_base64(crypto.signing_public_key()),
    public_ip);
```

**⚠️ CRITICAL**: The `keys.json` file contains your **secret keys**. NEVER commit it to Git. Add it to `.gitignore`:
```
keys.json
config.json
```

---

## 6. Step 4: Encrypt Messages

We use `crypto_box_easy` which combines:
1. Diffie-Hellman key exchange (your secret + their public → shared secret)
2. XSalsa20 symmetric encryption (fast stream cipher)
3. Poly1305 authentication tag (tamper detection)

```cpp
std::string CryptoManager::encrypt(const std::string& plaintext,
                                    const std::vector<uint8_t>& peer_public_key) const {
    // Generate a random nonce (24 bytes)
    // IMPORTANT: Each message MUST have a unique nonce!
    std::vector<uint8_t> nonce(crypto_box_NONCEBYTES);
    randombytes_buf(nonce.data(), nonce.size());

    // Allocate output buffer
    // ciphertext = encrypted data + authentication tag (16 bytes extra)
    size_t ciphertext_len = plaintext.size() + crypto_box_MACBYTES;
    std::vector<uint8_t> ciphertext(ciphertext_len);

    // Encrypt!
    int result = crypto_box_easy(
        ciphertext.data(),                              // Output
        reinterpret_cast<const uint8_t*>(plaintext.data()),  // Input
        plaintext.size(),                               // Input length
        nonce.data(),                                   // Nonce (24 bytes)
        peer_public_key.data(),                         // Recipient's public key
        secret_key_.data()                              // Our secret key
    );

    if (result != 0) {
        spdlog::error("Encryption failed!");
        return "";
    }

    // Prepend nonce to ciphertext (receiver needs it to decrypt)
    // Format: [nonce (24 bytes)][ciphertext (N + 16 bytes)]
    std::vector<uint8_t> combined;
    combined.reserve(nonce.size() + ciphertext.size());
    combined.insert(combined.end(), nonce.begin(), nonce.end());
    combined.insert(combined.end(), ciphertext.begin(), ciphertext.end());

    return to_base64(combined);
}
```

### Why Include the Nonce?

The nonce (Number used ONCE) ensures that encrypting the same message twice produces different ciphertext. The receiver needs the exact nonce to decrypt, so we prepend it to the ciphertext.

**NEVER reuse a nonce with the same key pair.** `randombytes_buf()` generates a cryptographically random nonce, making collision virtually impossible.

---

## 7. Step 5: Decrypt Messages

```cpp
std::string CryptoManager::decrypt(const std::string& ciphertext_b64,
                                    const std::vector<uint8_t>& peer_public_key) const {
    // Decode from base64
    std::vector<uint8_t> combined = from_base64(ciphertext_b64);

    // Split nonce and ciphertext
    if (combined.size() < crypto_box_NONCEBYTES + crypto_box_MACBYTES) {
        spdlog::error("Ciphertext too short to contain nonce + MAC");
        return "";
    }

    std::vector<uint8_t> nonce(combined.begin(),
                                combined.begin() + crypto_box_NONCEBYTES);
    std::vector<uint8_t> ciphertext(combined.begin() + crypto_box_NONCEBYTES,
                                     combined.end());

    // Allocate output buffer
    size_t plaintext_len = ciphertext.size() - crypto_box_MACBYTES;
    std::vector<uint8_t> plaintext(plaintext_len);

    // Decrypt!
    int result = crypto_box_open_easy(
        plaintext.data(),           // Output
        ciphertext.data(),          // Input (encrypted)
        ciphertext.size(),          // Input length
        nonce.data(),               // Same nonce used for encryption
        peer_public_key.data(),     // Sender's public key
        secret_key_.data()          // Our secret key
    );

    if (result != 0) {
        spdlog::error("Decryption failed! (wrong key or tampered message)");
        return "";
    }

    return std::string(plaintext.begin(), plaintext.end());
}
```

**Why can decryption fail?**
1. Wrong key pair (message wasn't meant for you)
2. Message was tampered with in transit
3. Corrupted ciphertext

`crypto_box_open_easy` returns -1 in all these cases. Never show the garbled output to the user.

---

## 8. Step 6: Sign Messages

Signing proves the message actually came from the claimed sender. Without signing, an attacker could send a message pretending to be your friend.

```cpp
std::string CryptoManager::sign(const std::string& message) const {
    // Create a detached signature (separate from the message)
    std::vector<uint8_t> signature(crypto_sign_BYTES);  // 64 bytes

    crypto_sign_detached(
        signature.data(),           // Output: signature
        nullptr,                    // Output: signature length (optional)
        reinterpret_cast<const uint8_t*>(message.data()),
        message.size(),
        signing_secret_key_.data()  // Our Ed25519 secret key
    );

    return to_base64(signature);
}
```

**Why "detached"?** A detached signature is separate from the message. This lets us encrypt the message AND sign the ciphertext independently.

---

## 9. Step 7: Verify Signatures

```cpp
bool CryptoManager::verify(const std::string& message,
                            const std::string& signature_b64,
                            const std::vector<uint8_t>& peer_signing_key) const {
    std::vector<uint8_t> signature = from_base64(signature_b64);

    if (signature.size() != crypto_sign_BYTES) {
        spdlog::error("Invalid signature size: {} (expected {})",
                      signature.size(), crypto_sign_BYTES);
        return false;
    }

    int result = crypto_sign_verify_detached(
        signature.data(),
        reinterpret_cast<const uint8_t*>(message.data()),
        message.size(),
        peer_signing_key.data()     // Sender's Ed25519 public key
    );

    if (result != 0) {
        spdlog::warn("Signature verification FAILED — message may be forged!");
        return false;
    }

    return true;
}
```

---

## 10. Step 8: Complete CryptoManager

Here's the complete header with everything wired together:

```cpp
// include/crypto/crypto_manager.h
#pragma once
#include <string>
#include <vector>
#include <cstdint>

class CryptoManager {
public:
    CryptoManager() = default;

    static bool init();                          // Call once at startup

    void generate_keypair();                     // Create new keys
    void save_keypair(const std::string& path) const;
    bool load_keypair(const std::string& path);

    // Encryption (X25519 + XSalsa20-Poly1305)
    std::string encrypt(const std::string& plaintext,
                        const std::vector<uint8_t>& peer_public_key) const;
    std::string decrypt(const std::string& ciphertext_b64,
                        const std::vector<uint8_t>& peer_public_key) const;

    // Signing (Ed25519)
    std::string sign(const std::string& message) const;
    bool verify(const std::string& message,
                const std::string& signature_b64,
                const std::vector<uint8_t>& peer_signing_key) const;

    // Accessors
    const std::vector<uint8_t>& public_key() const { return public_key_; }
    const std::vector<uint8_t>& signing_public_key() const { return signing_public_key_; }

private:
    std::vector<uint8_t> public_key_;           // X25519 (32 bytes)
    std::vector<uint8_t> secret_key_;           // X25519 (32 bytes)
    std::vector<uint8_t> signing_public_key_;   // Ed25519 (32 bytes)
    std::vector<uint8_t> signing_secret_key_;   // Ed25519 (64 bytes)
};
```

---

## 11. Step 9: Integrate into the Message Pipeline

### Sending a Message (Encrypt → Sign → Send)

```cpp
// In Node::send_message()
bool Node::send_message(const std::string& to_user,
                         const std::string& plaintext) {
    // 1. Look up recipient's public key (from local friends DB)
    auto friend_info = db_.get_friend(to_user);
    if (!friend_info) {
        spdlog::error("User '{}' not in friends list", to_user);
        return false;
    }

    auto peer_public_key = from_base64(friend_info->public_key);

    // 2. Encrypt the plaintext
    std::string ciphertext = crypto_.encrypt(plaintext, peer_public_key);
    if (ciphertext.empty()) return false;

    // 3. Sign the ciphertext (so recipient can verify it's from us)
    std::string signature = crypto_.sign(ciphertext);

    // 4. Build the wire message
    nlohmann::json msg;
    msg["type"] = "chat";
    msg["msg_id"] = generate_uuid();
    msg["from"] = username_;
    msg["to"] = to_user;
    msg["ciphertext"] = ciphertext;     // Encrypted text (base64)
    msg["signature"] = signature;        // Signature of ciphertext (base64)
    msg["timestamp"] = now_iso8601();

    // 5. Try to send directly via TCP
    PeerClient client(io_);
    if (client.connect(friend_info->last_ip, 9100)) {
        if (client.send(msg.dump())) {
            // Store plaintext locally for our own chat history
            db_.store_message(msg["msg_id"], username_, to_user,
                              plaintext, msg["timestamp"], true, "direct");
            return true;
        }
    }

    // 6. Direct send failed — store in Supabase for offline delivery
    supabase_.push_offline_message(to_user, username_, ciphertext, signature);
    db_.store_message(msg["msg_id"], username_, to_user,
                      plaintext, msg["timestamp"], false, "offline");
    return false;
}
```

### Receiving a Message (Verify → Decrypt → Store)

```cpp
// In PeerServer callback
void Node::on_message_received(const std::string& from_user,
                                const std::string& raw_payload) {
    auto msg = nlohmann::json::parse(raw_payload);

    std::string ciphertext = msg["ciphertext"];
    std::string signature = msg["signature"];

    // 1. Look up sender's keys
    auto friend_info = db_.get_friend(from_user);
    if (!friend_info) {
        spdlog::warn("Message from unknown user '{}' — ignored", from_user);
        return;
    }

    auto peer_public_key = from_base64(friend_info->public_key);
    auto peer_signing_key = from_base64(friend_info->signing_key);

    // 2. Verify the signature FIRST (before decryption)
    if (!crypto_.verify(ciphertext, signature, peer_signing_key)) {
        spdlog::error("Signature verification FAILED for message from '{}'", from_user);
        return;  // Drop the message — it may be forged!
    }

    // 3. Decrypt the message
    std::string plaintext = crypto_.decrypt(ciphertext, peer_public_key);
    if (plaintext.empty()) {
        spdlog::error("Decryption failed for message from '{}'", from_user);
        return;
    }

    // 4. Store decrypted message locally
    db_.store_message(msg["msg_id"], from_user, username_,
                      plaintext, msg["timestamp"], true, "direct");

    // 5. Push to WebSocket so frontend can display it
    nlohmann::json ws_event;
    ws_event["event"] = "new_message";
    ws_event["data"]["msg_id"] = msg["msg_id"];
    ws_event["data"]["from"] = from_user;
    ws_event["data"]["to"] = username_;
    ws_event["data"]["text"] = plaintext;  // ← Decrypted!
    ws_event["data"]["timestamp"] = msg["timestamp"];
    ws_event["data"]["delivered"] = true;
    ws_event["data"]["delivery_method"] = "direct";

    ws_server_.broadcast(ws_event.dump());

    spdlog::info("Received message from '{}': {}", from_user, plaintext);
}
```

**⚠️ Important**: The WebSocket event sends **plaintext** to the frontend. The frontend never touches ciphertext. All crypto happens in C++.

---

## 12. Why Each Step Matters

| Step | What Happens If You Skip It |
|------|----------------------------|
| **Initialize libsodium** | Random number generator isn't seeded → keys are predictable → easily cracked |
| **Generate unique keys** | All users share the same keys → anyone can read anyone's messages |
| **Save keys to disk** | Keys regenerated every restart → old messages can't be decrypted, friends see a new identity |
| **Encrypt with crypto_box** | Messages sent in plaintext → anyone on the network can read them |
| **Use a random nonce** | Same plaintext produces same ciphertext → attacker can detect repeated messages |
| **Sign with Ed25519** | Attacker sends messages pretending to be your friend → you can't tell the difference |
| **Verify before decrypt** | You decrypt a forged message → attacker controls what you see |

---

## 13. Learning Resources

### Cryptography Concepts

| Resource | Type | Link |
|----------|------|------|
| **Computerphile — Public Key Crypto** | 📺 YouTube | [youtube.com/watch?v=GSIDS_lvRv4](https://www.youtube.com/watch?v=GSIDS_lvRv4) |
| **Computerphile — Diffie-Hellman** | 📺 YouTube | [youtube.com/watch?v=NmM9HA2MQGI](https://www.youtube.com/watch?v=NmM9HA2MQGI) |
| **Computerphile — Digital Signatures** | 📺 YouTube | [youtube.com/watch?v=s22eJ1eVLTU](https://www.youtube.com/watch?v=s22eJ1eVLTU) |
| **Practical Cryptography for Developers** | 📖 Free book | [cryptobook.nakov.com](https://cryptobook.nakov.com/) |

### libsodium Specific

| Resource | Type | Link |
|----------|------|------|
| **libsodium Official Docs** | 📖 Must read | [doc.libsodium.org](https://doc.libsodium.org/) |
| **Public-key authenticated encryption** | 📖 API docs | [doc.libsodium.org/public-key_cryptography/authenticated_encryption](https://doc.libsodium.org/public-key_cryptography/authenticated_encryption) |
| **Public-key signatures** | 📖 API docs | [doc.libsodium.org/public-key_cryptography/public-key_signatures](https://doc.libsodium.org/public-key_cryptography/public-key_signatures) |
| **libsodium Quick Start** | 📖 Guide | [doc.libsodium.org/usage](https://doc.libsodium.org/usage) |
| **Intro to libsodium — Coding Tech** | 📺 YouTube | [youtube.com/watch?v=jE5vKgbJ0F0](https://www.youtube.com/watch?v=jE5vKgbJ0F0) |

### Signal Protocol (Inspiration)

| Resource | Type | Link |
|----------|------|------|
| **Signal Protocol Explained** | 📺 YouTube | [youtube.com/watch?v=DXv1boalsDI](https://www.youtube.com/watch?v=DXv1boalsDI) |
| **How Signal Works — Computerphile** | 📺 YouTube | [youtube.com/watch?v=9sO2qdTci-s](https://www.youtube.com/watch?v=9sO2qdTci-s) |

---

## 14. Common Pitfalls

### ❌ "Decryption failed" — wrong key pair

**Cause**: You're using the wrong peer public key. Each friend has a unique key.
**Fix**: Make sure you look up the SENDER's public key for decryption, not someone else's.

### ❌ Nonce reuse

**Cause**: Using a fixed or predictable nonce.
**Fix**: ALWAYS use `randombytes_buf()` for nonces. Never use a counter, timestamp, or hardcoded value.

### ❌ Signing plaintext instead of ciphertext

**Cause**: `sign(plaintext)` instead of `sign(ciphertext)`.
**Fix**: Always sign the CIPHERTEXT. This way the signature can be verified without decrypting, and the signature covers exactly what was sent over the wire.

### ❌ Secret key committed to Git

**Cause**: `keys.json` in the repository.
**Fix**: Add to `.gitignore` immediately:
```
keys.json
config.json
*.db
```

### ❌ "sodium_init: Assertion failed"

**Cause**: Calling `sodium_init()` multiple times in different threads.
**Fix**: Call it exactly once in `main()` before any threads start.

### ❌ Base64 encoding/decoding mismatch

**Cause**: Using different base64 variants (standard vs URL-safe).
**Fix**: Always use `sodium_base64_VARIANT_ORIGINAL` consistently.

### 💡 Tip: Secure Memory

libsodium can lock sensitive memory to prevent it from being swapped to disk:

```cpp
// For extra security, use sodium_malloc for secret keys:
unsigned char* secret_key = (unsigned char*)sodium_malloc(crypto_box_SECRETKEYBYTES);
// ... use it ...
sodium_free(secret_key);  // Securely zeroes memory before freeing
```

This is optional for our project but good practice for production apps.

---

**← [Phase 2 — Supabase Discovery](./phase-2-supabase-discovery.md) | [Phase 4 — Offline Messages →](./phase-4-offline-messages.md)**
