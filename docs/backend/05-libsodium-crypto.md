# 05 — libsodium Cryptography Guide

> **Audience**: Beginners learning C++ and cryptography.
> This guide teaches you EVERYTHING about using libsodium for end-to-end encrypted messaging.

---

## Table of Contents

1. [What is libsodium?](#1-what-is-libsodium)
2. [Why libsodium? (Not OpenSSL)](#2-why-libsodium-not-openssl)
3. [Initialization](#3-initialization)
4. [Key Concepts](#4-key-concepts)
5. [Key Generation](#5-key-generation)
6. [Encryption (crypto_box)](#6-encryption-crypto_box)
7. [Decryption (crypto_box_open)](#7-decryption-crypto_box_open)
8. [Digital Signatures](#8-digital-signatures)
9. [Base64 Encoding](#9-base64-encoding)
10. [Saving & Loading Keys](#10-saving--loading-keys)
11. [Complete CryptoManager Class](#11-complete-cryptomanager-class)
12. [Step-by-Step Walkthrough](#12-step-by-step-walkthrough)
13. [Key Sizes Reference](#13-key-sizes-reference)
14. [Memory Safety](#14-memory-safety)
15. [Common Mistakes](#15-common-mistakes)
16. [Tips & Tricks](#16-tips--tricks)

---

## 1. What is libsodium?

libsodium is a modern, easy-to-use cryptography library. It provides all the tools you need to:

- **Encrypt** messages so only the intended recipient can read them
- **Sign** messages so the recipient knows you sent them (not someone else)
- **Generate** secure random numbers and key pairs

Think of it like a locksmith's toolkit — it gives you locks (encryption), keys (key pairs), and wax seals (signatures).

### Installing libsodium

**Windows (vcpkg)**:
```bash
vcpkg install libsodium:x64-windows
```

**Linux (Ubuntu/Debian)**:
```bash
sudo apt install libsodium-dev
```

**macOS (Homebrew)**:
```bash
brew install libsodium
```

### Including in Your Code

```cpp
#include <sodium.h>

// That's it! One header gives you everything.
```

### CMake Integration

```cmake
find_package(PkgConfig REQUIRED)
pkg_check_modules(SODIUM REQUIRED libsodium)
target_link_libraries(your_target ${SODIUM_LIBRARIES})
target_include_directories(your_target PRIVATE ${SODIUM_INCLUDE_DIRS})

# Or on Windows with vcpkg:
find_package(unofficial-sodium CONFIG REQUIRED)
target_link_libraries(your_target unofficial-sodium::sodium)
```

---

## 2. Why libsodium? (Not OpenSSL)

| Feature | libsodium | OpenSSL |
|---------|-----------|---------|
| Ease of use | ✅ Very easy | ❌ Very complex |
| Footgun-proof | ✅ Hard to misuse | ❌ Easy to make mistakes |
| Documentation | ✅ Excellent | ⚠️ Dense and confusing |
| Modern crypto | ✅ All modern algorithms | ⚠️ Mix of old and new |
| API design | ✅ Simple functions | ❌ Context objects, callbacks |

**Bottom line**: libsodium was designed so that even beginners can use crypto safely. OpenSSL gives you a million options, most of which are wrong.

---

## 3. Initialization

**You MUST call `sodium_init()` before using ANY libsodium function.**

```cpp
#include <sodium.h>
#include <iostream>

int main() {
    // Call this ONCE at program startup
    if (sodium_init() < 0) {
        std::cerr << "FATAL: libsodium initialization failed!" << std::endl;
        return 1;
    }

    // Now you can use libsodium functions
    std::cout << "libsodium initialized successfully!" << std::endl;
    return 0;
}
```

### What happens if you forget?

If you call libsodium functions without `sodium_init()`, you'll get:
- Random-looking crashes
- Keys that are all zeros
- Encryption that produces garbage

**Always call it first. Put it in your `main()` before anything else.**

---

## 4. Key Concepts

### Asymmetric Encryption (Public-Key Crypto)

Imagine a mailbox:
- **Public key** = the mail slot (anyone can put letters in)
- **Private key** = the key to open the mailbox (only you have it)

When Alice wants to send Bob a secret message:
1. Alice uses **Bob's public key** to encrypt (put letter in Bob's mailbox)
2. Bob uses **his private key** to decrypt (open his mailbox and read the letter)

### Two Key Pairs in Our Project

We use TWO separate key pairs for different purposes:

| Purpose | Algorithm | Key Type |
|---------|-----------|----------|
| **Encryption** | X25519 (Curve25519) | `crypto_box` keys |
| **Signing** | Ed25519 | `crypto_sign` keys |

**Why two?** Because encryption and signing are different operations:
- **Encryption** = keeping messages secret
- **Signing** = proving who sent the message

### What is a Nonce?

A nonce (Number used ONCE) is a random value added to each encryption operation.

**Why?** If you encrypt the same message twice with the same key, you get the SAME ciphertext. An attacker could notice "hey, they sent the same message again!" The nonce makes every ciphertext unique, even for identical messages.

```
"Hello" + Key + Nonce1 → "x8f2k9..."  (different!)
"Hello" + Key + Nonce2 → "p3m7q1..."  (different!)
```

**⚠️ CRITICAL RULE: Never reuse a nonce with the same key pair.** This is the #1 crypto mistake.

---

## 5. Key Generation

### Encryption Keys (X25519)

```cpp
#include <sodium.h>
#include <iostream>

void generate_encryption_keys() {
    // These arrays will hold the keys
    unsigned char public_key[crypto_box_PUBLICKEYBYTES];  // 32 bytes
    unsigned char secret_key[crypto_box_SECRETKEYBYTES];  // 32 bytes

    // Generate a random key pair
    crypto_box_keypair(public_key, secret_key);

    std::cout << "Encryption key pair generated!" << std::endl;
    std::cout << "Public key size: "
              << crypto_box_PUBLICKEYBYTES << " bytes" << std::endl;
    std::cout << "Secret key size: "
              << crypto_box_SECRETKEYBYTES << " bytes" << std::endl;

    // public_key → share with everyone (put on Supabase)
    // secret_key → NEVER share, keep local only!
}
```

### Signing Keys (Ed25519)

```cpp
void generate_signing_keys() {
    unsigned char sign_pk[crypto_sign_PUBLICKEYBYTES];  // 32 bytes
    unsigned char sign_sk[crypto_sign_SECRETKEYBYTES];  // 64 bytes

    crypto_sign_keypair(sign_pk, sign_sk);

    std::cout << "Signing key pair generated!" << std::endl;
    std::cout << "Public key size: "
              << crypto_sign_PUBLICKEYBYTES << " bytes" << std::endl;
    std::cout << "Secret key size: "
              << crypto_sign_SECRETKEYBYTES << " bytes" << std::endl;

    // sign_pk → share with everyone
    // sign_sk → NEVER share!
}
```

### ⚠️ Warning: Key Arrays Are Raw Bytes

The keys are stored as raw binary data (not strings). You can't print them directly or put them in JSON. You need to convert them to Base64 first (see Section 9).

---

## 6. Encryption (crypto_box)

### How crypto_box_easy Works

`crypto_box_easy` encrypts a message using:
- Your secret key (private)
- Recipient's public key
- A random nonce

```
┌──────────────────────────────────────────────┐
│              crypto_box_easy                 │
│                                              │
│  Inputs:                                     │
│    • plaintext message ("Hello Bob!")         │
│    • nonce (24 random bytes)                 │
│    • recipient's public key                  │
│    • your secret key                         │
│                                              │
│  Output:                                     │
│    • ciphertext (message + 16 bytes MAC)     │
│                                              │
│  The MAC (Message Authentication Code)       │
│  lets the recipient verify the message       │
│  wasn't tampered with.                       │
└──────────────────────────────────────────────┘
```

### Complete Encryption Example

```cpp
#include <sodium.h>
#include <string>
#include <vector>
#include <iostream>
#include <stdexcept>

struct EncryptedMessage {
    std::vector<unsigned char> ciphertext;
    std::vector<unsigned char> nonce;
};

EncryptedMessage encrypt_message(
    const std::string& plaintext,
    const unsigned char* recipient_public_key,  // Their public key
    const unsigned char* my_secret_key)         // My secret key
{
    EncryptedMessage result;

    // Step 1: Generate a random nonce
    result.nonce.resize(crypto_box_NONCEBYTES);   // 24 bytes
    randombytes_buf(result.nonce.data(), crypto_box_NONCEBYTES);

    // Step 2: Allocate space for ciphertext
    // Ciphertext = plaintext + MAC (16 bytes overhead)
    size_t ciphertext_len = plaintext.size() + crypto_box_MACBYTES;
    result.ciphertext.resize(ciphertext_len);

    // Step 3: Encrypt!
    int ret = crypto_box_easy(
        result.ciphertext.data(),                          // output
        reinterpret_cast<const unsigned char*>(
            plaintext.data()),                             // input
        plaintext.size(),                                  // input length
        result.nonce.data(),                               // nonce
        recipient_public_key,                              // their public key
        my_secret_key                                      // my secret key
    );

    if (ret != 0) {
        throw std::runtime_error("Encryption failed!");
    }

    std::cout << "Encrypted " << plaintext.size() << " bytes → "
              << ciphertext_len << " bytes" << std::endl;

    return result;
}
```

### What Just Happened?

1. We generated 24 random bytes as a nonce
2. We allocated space for ciphertext (message + 16 bytes MAC)
3. We called `crypto_box_easy` which:
   - Computed a shared secret from our private key + their public key
   - Encrypted the message with that shared secret
   - Added a MAC (authentication tag) so tampering is detected
4. We return both the ciphertext and the nonce (both needed for decryption)

---

## 7. Decryption (crypto_box_open)

### Complete Decryption Example

```cpp
std::string decrypt_message(
    const std::vector<unsigned char>& ciphertext,
    const std::vector<unsigned char>& nonce,
    const unsigned char* sender_public_key,  // Their public key
    const unsigned char* my_secret_key)      // My secret key
{
    // Step 1: Allocate space for plaintext
    // Plaintext = ciphertext - MAC (16 bytes)
    size_t plaintext_len = ciphertext.size() - crypto_box_MACBYTES;
    std::vector<unsigned char> plaintext(plaintext_len);

    // Step 2: Decrypt!
    int ret = crypto_box_open_easy(
        plaintext.data(),                  // output
        ciphertext.data(),                 // input (encrypted)
        ciphertext.size(),                 // input length
        nonce.data(),                      // nonce (from sender)
        sender_public_key,                 // their public key
        my_secret_key                      // my secret key
    );

    // Step 3: Check if decryption succeeded
    if (ret != 0) {
        // This means either:
        // - The message was tampered with
        // - Wrong keys were used
        // - Wrong nonce was used
        throw std::runtime_error(
            "Decryption failed! Message may be tampered or wrong keys.");
    }

    // Step 4: Convert to string
    return std::string(plaintext.begin(), plaintext.end());
}
```

### Using Encrypt + Decrypt Together

```cpp
int main() {
    if (sodium_init() < 0) return 1;

    // Alice's keys
    unsigned char alice_pk[crypto_box_PUBLICKEYBYTES];
    unsigned char alice_sk[crypto_box_SECRETKEYBYTES];
    crypto_box_keypair(alice_pk, alice_sk);

    // Bob's keys
    unsigned char bob_pk[crypto_box_PUBLICKEYBYTES];
    unsigned char bob_sk[crypto_box_SECRETKEYBYTES];
    crypto_box_keypair(bob_pk, bob_sk);

    // Alice encrypts a message for Bob
    std::string message = "Hello Bob! This is a secret message.";
    auto encrypted = encrypt_message(message, bob_pk, alice_sk);
    //                                        ^^^^^^  ^^^^^^^^
    //                                Bob's PUBLIC   Alice's SECRET

    // Bob decrypts the message from Alice
    std::string decrypted = decrypt_message(
        encrypted.ciphertext,
        encrypted.nonce,
        alice_pk,    // Alice's PUBLIC key
        bob_sk       // Bob's SECRET key
    );

    std::cout << "Original:  " << message << std::endl;
    std::cout << "Decrypted: " << decrypted << std::endl;
    // Output: they're the same!

    return 0;
}
```

### ⚠️ Key Direction Matters!

```
Alice encrypts FOR Bob:
  crypto_box_easy(..., bob_pk, alice_sk)
                       ^^^^^^  ^^^^^^^^
                       Bob's   Alice's
                       PUBLIC  SECRET

Bob decrypts FROM Alice:
  crypto_box_open_easy(..., alice_pk, bob_sk)
                            ^^^^^^^^  ^^^^^^
                            Alice's   Bob's
                            PUBLIC    SECRET
```

It's symmetric: Alice's SK + Bob's PK generates the SAME shared secret as Bob's SK + Alice's PK. This is the beauty of Diffie-Hellman key exchange!

---

## 8. Digital Signatures

### Why Sign Messages?

Encryption keeps messages secret, but it doesn't prove WHO sent them. An attacker could encrypt a message pretending to be Alice. Signatures fix this.

Think of it like a wax seal on a letter:
- Anyone can see the seal (verify)
- Only you can create the seal (sign)
- If the seal is broken, the letter was tampered with

### Signing a Message

```cpp
#include <sodium.h>
#include <string>
#include <vector>

std::vector<unsigned char> sign_message(
    const std::string& message,
    const unsigned char* sign_secret_key)  // Ed25519 secret key
{
    std::vector<unsigned char> signature(crypto_sign_BYTES);  // 64 bytes

    // Create a detached signature
    // "Detached" means the signature is separate from the message
    crypto_sign_detached(
        signature.data(),                                  // output signature
        nullptr,                                           // signature length (can be NULL)
        reinterpret_cast<const unsigned char*>(
            message.data()),                               // message
        message.size(),                                    // message length
        sign_secret_key                                    // your signing secret key
    );

    return signature;
}
```

### Verifying a Signature

```cpp
bool verify_signature(
    const std::string& message,
    const std::vector<unsigned char>& signature,
    const unsigned char* sign_public_key)  // Ed25519 public key
{
    int ret = crypto_sign_verify_detached(
        signature.data(),                                  // the signature
        reinterpret_cast<const unsigned char*>(
            message.data()),                               // the message
        message.size(),                                    // message length
        sign_public_key                                    // sender's signing public key
    );

    // Returns 0 if valid, -1 if invalid
    return (ret == 0);
}
```

### Using Signing + Verification Together

```cpp
int main() {
    if (sodium_init() < 0) return 1;

    // Generate signing keys
    unsigned char sign_pk[crypto_sign_PUBLICKEYBYTES];
    unsigned char sign_sk[crypto_sign_SECRETKEYBYTES];
    crypto_sign_keypair(sign_pk, sign_sk);

    // Alice signs a message
    std::string message = "I owe Bob $10";
    auto signature = sign_message(message, sign_sk);

    // Anyone can verify Alice's signature
    bool valid = verify_signature(message, signature, sign_pk);
    std::cout << "Signature valid: " << (valid ? "YES" : "NO")
              << std::endl;  // YES

    // If the message is tampered with, verification fails
    std::string tampered = "I owe Bob $1000";
    bool tamper_check = verify_signature(tampered, signature, sign_pk);
    std::cout << "Tampered check: " << (tamper_check ? "YES" : "NO")
              << std::endl;  // NO — caught!

    return 0;
}
```

### Our Message Flow: Sign Then Encrypt

For our chat app, we do BOTH signing and encryption:

```
┌─────────────────────────────────────────────────┐
│              Sending a Message                  │
│                                                 │
│  1. Sign the plaintext with your Ed25519 SK     │
│     signature = sign(plaintext, my_sign_sk)     │
│                                                 │
│  2. Build the payload:                          │
│     payload = { plaintext, signature }          │
│                                                 │
│  3. Encrypt the payload with crypto_box:        │
│     ciphertext = encrypt(payload, nonce,        │
│                          their_pk, my_sk)       │
│                                                 │
│  4. Send { ciphertext, nonce } to the peer      │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│              Receiving a Message                │
│                                                 │
│  1. Decrypt with crypto_box_open:               │
│     payload = decrypt(ciphertext, nonce,        │
│                       their_pk, my_sk)          │
│                                                 │
│  2. Parse the payload:                          │
│     { plaintext, signature } = payload          │
│                                                 │
│  3. Verify signature with their Ed25519 PK:     │
│     valid = verify(plaintext, signature,        │
│                    their_sign_pk)               │
│                                                 │
│  4. If valid → display. If not → reject!        │
└─────────────────────────────────────────────────┘
```

---

## 9. Base64 Encoding

### Why Base64?

Keys and ciphertext are raw binary data. You can't put raw bytes in JSON, URLs, or databases. Base64 converts binary data to safe ASCII text.

```
Raw bytes:  [0x48, 0x65, 0x6C, 0x6C, 0x6F]
Base64:     "SGVsbG8="
```

### Encoding to Base64

```cpp
#include <sodium.h>
#include <string>

std::string to_base64(const unsigned char* data, size_t len) {
    // Calculate the maximum Base64 output size
    size_t b64_maxlen = sodium_base64_ENCODED_LEN(
        len, sodium_base64_VARIANT_ORIGINAL);

    // Allocate buffer
    std::string b64(b64_maxlen, '\0');

    // Encode
    sodium_bin2base64(
        b64.data(),                       // output buffer
        b64_maxlen,                        // output buffer size
        data,                              // input binary data
        len,                               // input length
        sodium_base64_VARIANT_ORIGINAL     // standard Base64
    );

    // Remove trailing null bytes
    b64.resize(strlen(b64.c_str()));
    return b64;
}

// Convenience overloads
std::string to_base64(const std::vector<unsigned char>& data) {
    return to_base64(data.data(), data.size());
}
```

### Decoding from Base64

```cpp
std::vector<unsigned char> from_base64(const std::string& b64) {
    // Allocate buffer (decoded is always smaller than encoded)
    std::vector<unsigned char> bin(b64.size());
    size_t bin_len;

    int ret = sodium_base642bin(
        bin.data(),                        // output buffer
        bin.size(),                        // output buffer size
        b64.c_str(),                       // input Base64 string
        b64.size(),                        // input length
        nullptr,                           // ignore characters (none)
        &bin_len,                          // actual decoded length
        nullptr,                           // end pointer (don't need)
        sodium_base64_VARIANT_ORIGINAL     // standard Base64
    );

    if (ret != 0) {
        throw std::runtime_error("Base64 decode failed!");
    }

    bin.resize(bin_len);
    return bin;
}
```

### Using Base64 with Keys

```cpp
// Encode a public key for JSON/Supabase storage
unsigned char pk[crypto_box_PUBLICKEYBYTES];
unsigned char sk[crypto_box_SECRETKEYBYTES];
crypto_box_keypair(pk, sk);

std::string pk_b64 = to_base64(pk, crypto_box_PUBLICKEYBYTES);
std::cout << "Public key (Base64): " << pk_b64 << std::endl;
// Output: "dGhpcyBpcyBhIHRlc3Qga2V5Li4uLi4uLi4=" (example)

// Decode back
auto pk_decoded = from_base64(pk_b64);
// pk_decoded now contains the same bytes as pk
```

---

## 10. Saving & Loading Keys

### Saving Keys to a JSON File

```cpp
#include <nlohmann/json.hpp>
#include <fstream>
#include <sodium.h>

using json = nlohmann::json;

struct KeyBundle {
    unsigned char box_pk[crypto_box_PUBLICKEYBYTES];   // Encryption public
    unsigned char box_sk[crypto_box_SECRETKEYBYTES];   // Encryption secret
    unsigned char sign_pk[crypto_sign_PUBLICKEYBYTES]; // Signing public
    unsigned char sign_sk[crypto_sign_SECRETKEYBYTES]; // Signing secret
};

void save_keys(const KeyBundle& keys, const std::string& filepath) {
    json j;
    j["encryption"]["public_key"] = to_base64(
        keys.box_pk, crypto_box_PUBLICKEYBYTES);
    j["encryption"]["secret_key"] = to_base64(
        keys.box_sk, crypto_box_SECRETKEYBYTES);
    j["signing"]["public_key"] = to_base64(
        keys.sign_pk, crypto_sign_PUBLICKEYBYTES);
    j["signing"]["secret_key"] = to_base64(
        keys.sign_sk, crypto_sign_SECRETKEYBYTES);

    std::ofstream file(filepath);
    if (!file.is_open()) {
        throw std::runtime_error("Cannot open file: " + filepath);
    }
    file << j.dump(2);  // Pretty-printed with 2-space indent
    file.close();

    std::cout << "Keys saved to " << filepath << std::endl;
}
```

### The Keys File Looks Like This

```json
{
  "encryption": {
    "public_key": "dGhpcyBpcyBhIGZha2UgcHVibGljIGtleQ==",
    "secret_key": "dGhpcyBpcyBhIGZha2Ugc2VjcmV0IGtleQ=="
  },
  "signing": {
    "public_key": "c2lnbmluZyBwdWJsaWMga2V5IGhlcmU=",
    "secret_key": "c2lnbmluZyBzZWNyZXQga2V5IGhlcmU="
  }
}
```

### Loading Keys from a JSON File

```cpp
KeyBundle load_keys(const std::string& filepath) {
    std::ifstream file(filepath);
    if (!file.is_open()) {
        throw std::runtime_error("Cannot open file: " + filepath);
    }

    json j = json::parse(file);
    KeyBundle keys;

    // Decode encryption keys
    auto box_pk = from_base64(j["encryption"]["public_key"]);
    auto box_sk = from_base64(j["encryption"]["secret_key"]);
    std::memcpy(keys.box_pk, box_pk.data(), crypto_box_PUBLICKEYBYTES);
    std::memcpy(keys.box_sk, box_sk.data(), crypto_box_SECRETKEYBYTES);

    // Decode signing keys
    auto sign_pk = from_base64(j["signing"]["public_key"]);
    auto sign_sk = from_base64(j["signing"]["secret_key"]);
    std::memcpy(keys.sign_pk, sign_pk.data(), crypto_sign_PUBLICKEYBYTES);
    std::memcpy(keys.sign_sk, sign_sk.data(), crypto_sign_SECRETKEYBYTES);

    std::cout << "Keys loaded from " << filepath << std::endl;
    return keys;
}
```

### First-Run Key Generation

```cpp
KeyBundle get_or_create_keys(const std::string& filepath) {
    // Check if keys file exists
    std::ifstream check(filepath);
    if (check.good()) {
        check.close();
        std::cout << "Loading existing keys..." << std::endl;
        return load_keys(filepath);
    }

    // Generate new keys
    std::cout << "First run! Generating new key pairs..." << std::endl;
    KeyBundle keys;
    crypto_box_keypair(keys.box_pk, keys.box_sk);
    crypto_sign_keypair(keys.sign_pk, keys.sign_sk);

    // Save them
    save_keys(keys, filepath);
    return keys;
}
```

---

## 11. Complete CryptoManager Class

Here's the full class implementation you can reference:

```cpp
// crypto_manager.h
#pragma once
#include <string>
#include <vector>
#include <optional>

struct EncryptedPayload {
    std::string ciphertext_b64;   // Base64-encoded ciphertext
    std::string nonce_b64;        // Base64-encoded nonce
    std::string signature_b64;    // Base64-encoded signature
};

class CryptoManager {
public:
    CryptoManager();
    ~CryptoManager();

    // Key management
    void generate_keys();
    void save_keys(const std::string& filepath);
    void load_keys(const std::string& filepath);

    // Get public keys (safe to share)
    std::string get_encryption_public_key_b64() const;
    std::string get_signing_public_key_b64() const;

    // Encrypt + Sign (for sending)
    EncryptedPayload encrypt_and_sign(
        const std::string& plaintext,
        const std::string& recipient_public_key_b64);

    // Decrypt + Verify (for receiving)
    std::optional<std::string> decrypt_and_verify(
        const std::string& ciphertext_b64,
        const std::string& nonce_b64,
        const std::string& signature_b64,
        const std::string& sender_encryption_pk_b64,
        const std::string& sender_signing_pk_b64);

private:
    // Encryption keys (X25519 / Curve25519)
    unsigned char box_pk_[crypto_box_PUBLICKEYBYTES];
    unsigned char box_sk_[crypto_box_SECRETKEYBYTES];

    // Signing keys (Ed25519)
    unsigned char sign_pk_[crypto_sign_PUBLICKEYBYTES];
    unsigned char sign_sk_[crypto_sign_SECRETKEYBYTES];

    // Helper functions
    static std::string to_base64(const unsigned char* data, size_t len);
    static std::vector<unsigned char> from_base64(const std::string& b64);
};
```

### Implementation

```cpp
// crypto_manager.cpp
#include "crypto/crypto_manager.h"
#include <sodium.h>
#include <nlohmann/json.hpp>
#include <fstream>
#include <stdexcept>
#include <cstring>
#include <iostream>

using json = nlohmann::json;

CryptoManager::CryptoManager() {
    // Zero out all keys initially
    sodium_memzero(box_pk_, sizeof(box_pk_));
    sodium_memzero(box_sk_, sizeof(box_sk_));
    sodium_memzero(sign_pk_, sizeof(sign_pk_));
    sodium_memzero(sign_sk_, sizeof(sign_sk_));
}

CryptoManager::~CryptoManager() {
    // Securely wipe secret keys from memory
    sodium_memzero(box_sk_, sizeof(box_sk_));
    sodium_memzero(sign_sk_, sizeof(sign_sk_));
}

void CryptoManager::generate_keys() {
    crypto_box_keypair(box_pk_, box_sk_);
    crypto_sign_keypair(sign_pk_, sign_sk_);
}

void CryptoManager::save_keys(const std::string& filepath) {
    json j;
    j["encryption"]["public_key"] = to_base64(box_pk_,
        crypto_box_PUBLICKEYBYTES);
    j["encryption"]["secret_key"] = to_base64(box_sk_,
        crypto_box_SECRETKEYBYTES);
    j["signing"]["public_key"] = to_base64(sign_pk_,
        crypto_sign_PUBLICKEYBYTES);
    j["signing"]["secret_key"] = to_base64(sign_sk_,
        crypto_sign_SECRETKEYBYTES);

    std::ofstream file(filepath);
    if (!file) throw std::runtime_error("Cannot write: " + filepath);
    file << j.dump(2);
}

void CryptoManager::load_keys(const std::string& filepath) {
    std::ifstream file(filepath);
    if (!file) throw std::runtime_error("Cannot read: " + filepath);

    json j = json::parse(file);

    auto pk = from_base64(j["encryption"]["public_key"]);
    auto sk = from_base64(j["encryption"]["secret_key"]);
    std::memcpy(box_pk_, pk.data(), crypto_box_PUBLICKEYBYTES);
    std::memcpy(box_sk_, sk.data(), crypto_box_SECRETKEYBYTES);

    auto spk = from_base64(j["signing"]["public_key"]);
    auto ssk = from_base64(j["signing"]["secret_key"]);
    std::memcpy(sign_pk_, spk.data(), crypto_sign_PUBLICKEYBYTES);
    std::memcpy(sign_sk_, ssk.data(), crypto_sign_SECRETKEYBYTES);
}

std::string CryptoManager::get_encryption_public_key_b64() const {
    return to_base64(box_pk_, crypto_box_PUBLICKEYBYTES);
}

std::string CryptoManager::get_signing_public_key_b64() const {
    return to_base64(sign_pk_, crypto_sign_PUBLICKEYBYTES);
}

EncryptedPayload CryptoManager::encrypt_and_sign(
    const std::string& plaintext,
    const std::string& recipient_public_key_b64)
{
    // Decode recipient's public key
    auto their_pk = from_base64(recipient_public_key_b64);
    if (their_pk.size() != crypto_box_PUBLICKEYBYTES) {
        throw std::runtime_error("Invalid recipient public key size");
    }

    // Step 1: Sign the plaintext
    std::vector<unsigned char> signature(crypto_sign_BYTES);
    crypto_sign_detached(
        signature.data(), nullptr,
        reinterpret_cast<const unsigned char*>(plaintext.data()),
        plaintext.size(),
        sign_sk_);

    // Step 2: Generate random nonce
    std::vector<unsigned char> nonce(crypto_box_NONCEBYTES);
    randombytes_buf(nonce.data(), crypto_box_NONCEBYTES);

    // Step 3: Encrypt the plaintext
    size_t ciphertext_len = plaintext.size() + crypto_box_MACBYTES;
    std::vector<unsigned char> ciphertext(ciphertext_len);

    int ret = crypto_box_easy(
        ciphertext.data(),
        reinterpret_cast<const unsigned char*>(plaintext.data()),
        plaintext.size(),
        nonce.data(),
        their_pk.data(),
        box_sk_);

    if (ret != 0) {
        throw std::runtime_error("Encryption failed");
    }

    // Step 4: Return everything as Base64
    EncryptedPayload result;
    result.ciphertext_b64 = to_base64(ciphertext.data(),
                                       ciphertext.size());
    result.nonce_b64 = to_base64(nonce.data(), nonce.size());
    result.signature_b64 = to_base64(signature.data(),
                                      signature.size());
    return result;
}

std::optional<std::string> CryptoManager::decrypt_and_verify(
    const std::string& ciphertext_b64,
    const std::string& nonce_b64,
    const std::string& signature_b64,
    const std::string& sender_encryption_pk_b64,
    const std::string& sender_signing_pk_b64)
{
    // Decode everything from Base64
    auto ciphertext = from_base64(ciphertext_b64);
    auto nonce = from_base64(nonce_b64);
    auto signature = from_base64(signature_b64);
    auto their_box_pk = from_base64(sender_encryption_pk_b64);
    auto their_sign_pk = from_base64(sender_signing_pk_b64);

    // Validate sizes
    if (nonce.size() != crypto_box_NONCEBYTES ||
        their_box_pk.size() != crypto_box_PUBLICKEYBYTES ||
        their_sign_pk.size() != crypto_sign_PUBLICKEYBYTES ||
        signature.size() != crypto_sign_BYTES) {
        return std::nullopt;
    }

    // Step 1: Decrypt
    size_t plaintext_len = ciphertext.size() - crypto_box_MACBYTES;
    std::vector<unsigned char> plaintext(plaintext_len);

    int ret = crypto_box_open_easy(
        plaintext.data(),
        ciphertext.data(),
        ciphertext.size(),
        nonce.data(),
        their_box_pk.data(),
        box_sk_);

    if (ret != 0) {
        // Decryption failed: wrong keys or tampered
        return std::nullopt;
    }

    // Step 2: Verify signature
    std::string text(plaintext.begin(), plaintext.end());

    ret = crypto_sign_verify_detached(
        signature.data(),
        reinterpret_cast<const unsigned char*>(text.data()),
        text.size(),
        their_sign_pk.data());

    if (ret != 0) {
        // Signature invalid: message not from claimed sender
        return std::nullopt;
    }

    return text;
}

// ----- Base64 helpers -----

std::string CryptoManager::to_base64(
    const unsigned char* data, size_t len)
{
    size_t b64_len = sodium_base64_ENCODED_LEN(
        len, sodium_base64_VARIANT_ORIGINAL);
    std::string result(b64_len, '\0');

    sodium_bin2base64(
        result.data(), b64_len,
        data, len,
        sodium_base64_VARIANT_ORIGINAL);

    result.resize(strlen(result.c_str()));
    return result;
}

std::vector<unsigned char> CryptoManager::from_base64(
    const std::string& b64)
{
    std::vector<unsigned char> bin(b64.size());
    size_t bin_len;

    int ret = sodium_base642bin(
        bin.data(), bin.size(),
        b64.c_str(), b64.size(),
        nullptr, &bin_len, nullptr,
        sodium_base64_VARIANT_ORIGINAL);

    if (ret != 0) {
        throw std::runtime_error("Base64 decode failed");
    }

    bin.resize(bin_len);
    return bin;
}
```

---

## 12. Step-by-Step Walkthrough

Let's trace exactly what happens when Alice sends "Hello World" to Bob:

### 1. Input

```
plaintext = "Hello World" (11 bytes)
```

### 2. Sign the Plaintext

```
signature = crypto_sign_detached("Hello World", alice_sign_sk)
→ 64 bytes signature
```

### 3. Generate Random Nonce

```
nonce = randombytes_buf(24)
→ 24 random bytes, e.g.: [0xa3, 0x7f, 0x12, ...]
```

### 4. Encrypt

```
ciphertext = crypto_box_easy("Hello World", nonce, bob_box_pk, alice_box_sk)
→ 11 + 16 = 27 bytes (message + MAC)
```

### 5. Encode to Base64

```
ciphertext_b64 = base64(27 bytes) → "..." (36 characters)
nonce_b64 = base64(24 bytes) → "..." (32 characters)
signature_b64 = base64(64 bytes) → "..." (88 characters)
```

### 6. Build JSON Envelope

```json
{
  "type": "chat",
  "from": "alice",
  "to": "bob",
  "ciphertext": "dGhpcyBpcyBjaXBoZXJ0ZXh0Li4u",
  "nonce": "cmFuZG9tIG5vbmNlIGhlcmU=",
  "signature": "c2lnbmF0dXJlIGJhc2U2NA==",
  "timestamp": 1700000000
}
```

### 7. Send Over TCP

The JSON envelope is sent to Bob's peer server using the length-prefixed TCP protocol (see 02-asio-networking.md).

### 8. Bob Receives and Processes

```
1. Parse JSON envelope
2. Decode ciphertext, nonce, signature from Base64
3. Decrypt: crypto_box_open_easy(ciphertext, nonce, alice_box_pk, bob_box_sk)
   → "Hello World"
4. Verify: crypto_sign_verify_detached(signature, "Hello World", alice_sign_pk)
   → 0 (valid!)
5. Display "Hello World" from alice
```

---

## 13. Key Sizes Reference

| Constant | Size | What It Is |
|----------|------|------------|
| `crypto_box_PUBLICKEYBYTES` | 32 bytes | X25519 public key |
| `crypto_box_SECRETKEYBYTES` | 32 bytes | X25519 secret key |
| `crypto_box_NONCEBYTES` | 24 bytes | Nonce for crypto_box |
| `crypto_box_MACBYTES` | 16 bytes | Authentication tag |
| `crypto_sign_PUBLICKEYBYTES` | 32 bytes | Ed25519 public key |
| `crypto_sign_SECRETKEYBYTES` | 64 bytes | Ed25519 secret key |
| `crypto_sign_BYTES` | 64 bytes | Signature size |

### Size Calculation Example

```
Message "Hello World" (11 bytes):
  Ciphertext = 11 + 16 (MAC) = 27 bytes
  Nonce = 24 bytes
  Signature = 64 bytes
  Base64 overhead ≈ 33%

  Total data sent ≈ 36 + 32 + 88 = 156 Base64 characters
  + JSON overhead ≈ 300 characters total
```

---

## 14. Memory Safety

### Wiping Sensitive Data

When you're done with secret keys, wipe them from memory:

```cpp
unsigned char secret_key[crypto_box_SECRETKEYBYTES];

// ... use the key ...

// When done, securely erase it
sodium_memzero(secret_key, sizeof(secret_key));
```

**Why?** If your program crashes and creates a memory dump, an attacker could find your keys in the dump. `sodium_memzero` ensures the compiler doesn't "optimize away" the clearing.

### Don't Use `memset` for Security

```cpp
// BAD — compiler might optimize this away!
memset(secret_key, 0, sizeof(secret_key));

// GOOD — guaranteed to actually clear the memory
sodium_memzero(secret_key, sizeof(secret_key));
```

### The CryptoManager Destructor

Notice our destructor wipes secret keys:

```cpp
CryptoManager::~CryptoManager() {
    sodium_memzero(box_sk_, sizeof(box_sk_));
    sodium_memzero(sign_sk_, sizeof(sign_sk_));
}
```

This ensures keys are wiped when the CryptoManager goes out of scope.

---

## 15. Common Mistakes

### ❌ Mistake 1: Reusing Nonces

```cpp
// CATASTROPHICALLY BAD — same nonce for two messages!
unsigned char nonce[crypto_box_NONCEBYTES] = {0};  // Always zero!
crypto_box_easy(ct1, msg1, msg1_len, nonce, pk, sk);
crypto_box_easy(ct2, msg2, msg2_len, nonce, pk, sk);  // SAME nonce!
// An attacker can XOR ct1 and ct2 to recover both messages!

// GOOD — random nonce every time
unsigned char nonce[crypto_box_NONCEBYTES];
randombytes_buf(nonce, sizeof(nonce));  // Fresh random nonce!
```

### ❌ Mistake 2: Not Verifying Before Trusting

```cpp
// BAD — decrypt and use immediately
auto plaintext = decrypt(ciphertext, nonce, pk, sk);
display(plaintext);  // But who sent this? Could be forged!

// GOOD — decrypt, THEN verify signature
auto plaintext = decrypt(ciphertext, nonce, pk, sk);
if (!verify(plaintext, signature, sender_sign_pk)) {
    log_error("Signature verification failed!");
    return;  // Don't use the message!
}
display(plaintext);  // Now we know it's authentic
```

### ❌ Mistake 3: Confusing Key Types

```cpp
// BAD — using signing keys for encryption
crypto_box_easy(ct, msg, len, nonce,
    sign_pk,  // WRONG! This is an Ed25519 key!
    box_sk);

// GOOD — use the right key types
crypto_box_easy(ct, msg, len, nonce,
    box_pk,   // X25519 public key
    box_sk);  // X25519 secret key
```

### ❌ Mistake 4: Forgetting to Initialize

```cpp
// BAD — calling functions before init
crypto_box_keypair(pk, sk);  // Undefined behavior!

// GOOD — init first
sodium_init();
crypto_box_keypair(pk, sk);  // Now it's safe
```

### ❌ Mistake 5: Logging Secret Keys

```cpp
// BAD — secret key in log file!
spdlog::info("My secret key: {}", to_base64(sk, 32));

// GOOD — only log public keys
spdlog::info("My public key: {}", to_base64(pk, 32));
spdlog::debug("Key pair generated successfully");
```

---

## 16. Tips & Tricks

### Tip 1: Test Encryption/Decryption Round-Trip First

Before integrating with networking, write a simple test:

```cpp
// test_crypto.cpp
int main() {
    sodium_init();

    CryptoManager alice, bob;
    alice.generate_keys();
    bob.generate_keys();

    // Alice encrypts for Bob
    auto encrypted = alice.encrypt_and_sign(
        "Hello Bob!",
        bob.get_encryption_public_key_b64());

    // Bob decrypts from Alice
    auto decrypted = bob.decrypt_and_verify(
        encrypted.ciphertext_b64,
        encrypted.nonce_b64,
        encrypted.signature_b64,
        alice.get_encryption_public_key_b64(),
        alice.get_signing_public_key_b64());

    if (decrypted && *decrypted == "Hello Bob!") {
        std::cout << "✅ Crypto round-trip works!" << std::endl;
    } else {
        std::cout << "❌ Crypto round-trip FAILED!" << std::endl;
    }

    return 0;
}
```

### Tip 2: Use Hex for Quick Debugging

```cpp
// Print first 8 bytes of a key in hex for visual debugging
char hex[17];
sodium_bin2hex(hex, sizeof(hex), pk, 8);
std::cout << "Key starts with: " << hex << std::endl;
// Output: "a3f78bc1d2e45f00"
```

### Tip 3: The Nonce Doesn't Need to Be Secret

Nonces are sent alongside the ciphertext in plaintext. They're not secret — they just must be unique. Think of them as a serial number, not a password.

### Tip 4: Key Derivation from Password (Optional)

If you want to protect the keys file with a password:

```cpp
// Derive a key from a password (for encrypting the keys file)
unsigned char key[crypto_secretbox_KEYBYTES];
unsigned char salt[crypto_pwhash_SALTBYTES];
randombytes_buf(salt, sizeof(salt));

crypto_pwhash(
    key, sizeof(key),
    password, strlen(password),
    salt,
    crypto_pwhash_OPSLIMIT_INTERACTIVE,
    crypto_pwhash_MEMLIMIT_INTERACTIVE,
    crypto_pwhash_ALG_DEFAULT);
```

---

## Learning Resources

- [libsodium Documentation](https://doc.libsodium.org/) — Official docs, very well written
- [libsodium Quick Start](https://doc.libsodium.org/quickstart) — Start here
- [NaCl Crypto Library](https://nacl.cr.yp.to/) — The academic paper behind libsodium
- [Crypto 101](https://www.crypto101.io/) — Free book on cryptography basics
