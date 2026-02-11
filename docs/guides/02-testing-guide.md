# 02 — Testing Guide

> **Audience**: Beginners who want to verify their code works correctly.
> This guide provides testing strategies for each development phase.

---

## Table of Contents

1. [Testing Philosophy](#1-testing-philosophy)
2. [Phase 1: Plaintext Chat](#2-phase-1-plaintext-chat)
3. [Phase 2: Supabase Discovery](#3-phase-2-supabase-discovery)
4. [Phase 3: Encryption](#4-phase-3-encryption)
5. [Phase 4: Offline Messages](#5-phase-4-offline-messages)
6. [Python UI Testing](#6-python-ui-testing)
7. [Integration Test Scripts](#7-integration-test-scripts)

---

## 1. Testing Philosophy

> **Test manually first, automate later.**

For a learning project, you don't need a full test framework. Instead:

1. **Build one feature at a time**
2. **Test it manually with curl/scripts**
3. **Write a small test program** if the feature is complex (like crypto)
4. **Keep a checklist** of what to test after each change

---

## 2. Phase 1: Plaintext Chat

### Test 1: Backend Starts Successfully

```bash
# Build and run the backend
cd backend/build && ./p2p_chat_backend

# Expected output:
# [info] === P2P Chat Backend Starting ===
# [info] Listening on port 8080
```

### Test 2: Local API Responds

```bash
# In another terminal:
curl -s http://localhost:8080/api/status | python -m json.tool

# Expected:
# {
#   "status": "online",
#   "username": "alice"
# }
```

### Test 3: Two Backends Can Connect

```bash
# Terminal 1: Start backend as Alice
./p2p_chat_backend --config alice_config.json
# Listening on port 8080, peer port 9000

# Terminal 2: Start backend as Bob
./p2p_chat_backend --config bob_config.json
# Listening on port 8081, peer port 9001

# Terminal 3: Tell Alice to connect to Bob
curl -X POST http://localhost:8080/api/friends \
  -H "Content-Type: application/json" \
  -d '{"username": "bob", "ip": "127.0.0.1", "port": 9001}'

# Check logs — you should see a TCP connection established
```

### Test 4: Send a Message Between Backends

```bash
# Send from Alice to Bob
curl -X POST http://localhost:8080/api/messages \
  -H "Content-Type: application/json" \
  -d '{"to": "bob", "content": "Hello Bob!"}'

# Check Bob's messages
curl -s http://localhost:8081/api/messages?peer=alice | python -m json.tool
# Should show the message!
```

### Test 5: Python UI Connects

```bash
python ui/main.py
# Status bar should show "Connected to backend"
# Friends list should be empty (that's OK)
```

---

## 3. Phase 2: Supabase Discovery

### Test 1: Supabase Connection

```bash
# Test from curl first:
curl "https://YOUR_PROJECT.supabase.co/rest/v1/users" \
  -H "apikey: YOUR_KEY"

# Should return [] (empty array) or your test data
```

### Test 2: User Registration

```bash
# Start backend — it should auto-register
./p2p_chat_backend

# Check Supabase:
curl "https://YOUR_PROJECT.supabase.co/rest/v1/users?username=eq.alice" \
  -H "apikey: YOUR_KEY"

# Should show Alice's entry with public_key and last_ip
```

### Test 3: User Lookup

```bash
# From Alice's backend, look up Bob:
curl http://localhost:8080/api/friends \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"username": "bob"}'

# Backend should:
# 1. Query Supabase for bob's info
# 2. Get Bob's IP and public key
# 3. Store in local friends list
# 4. Return bob's info
```

### Test 4: Heartbeat

```bash
# Start backend and wait 60 seconds
# Check Supabase — last_seen should update every minute
curl "https://YOUR_PROJECT.supabase.co/rest/v1/users?username=eq.alice&select=last_seen" \
  -H "apikey: YOUR_KEY"
```

---

## 4. Phase 3: Encryption

### Test 1: Key Generation Round-Trip

Write a simple test program:

```cpp
// test_crypto.cpp
#include <sodium.h>
#include "crypto/crypto_manager.h"
#include <iostream>
#include <cassert>

int main() {
    sodium_init();

    CryptoManager alice, bob;
    alice.generate_keys();
    bob.generate_keys();

    // Test 1: Encrypt and decrypt
    std::string original = "Hello, Bob! This is a test message.";
    auto encrypted = alice.encrypt_and_sign(
        original, bob.get_encryption_public_key_b64());

    auto decrypted = bob.decrypt_and_verify(
        encrypted.ciphertext_b64,
        encrypted.nonce_b64,
        encrypted.signature_b64,
        alice.get_encryption_public_key_b64(),
        alice.get_signing_public_key_b64());

    assert(decrypted.has_value());
    assert(*decrypted == original);
    std::cout << "✅ Test 1: Encrypt/decrypt round-trip PASSED" << std::endl;

    // Test 2: Tampered message fails
    std::string tampered_ct = encrypted.ciphertext_b64;
    tampered_ct[10] = (tampered_ct[10] == 'A') ? 'B' : 'A';

    auto result = bob.decrypt_and_verify(
        tampered_ct,
        encrypted.nonce_b64,
        encrypted.signature_b64,
        alice.get_encryption_public_key_b64(),
        alice.get_signing_public_key_b64());

    assert(!result.has_value());
    std::cout << "✅ Test 2: Tampered message rejected PASSED" << std::endl;

    // Test 3: Wrong key fails
    CryptoManager eve;
    eve.generate_keys();

    result = eve.decrypt_and_verify(
        encrypted.ciphertext_b64,
        encrypted.nonce_b64,
        encrypted.signature_b64,
        alice.get_encryption_public_key_b64(),
        alice.get_signing_public_key_b64());

    assert(!result.has_value());
    std::cout << "✅ Test 3: Wrong key rejected PASSED" << std::endl;

    // Test 4: Save and load keys
    alice.save_keys("test_keys.json");
    CryptoManager alice2;
    alice2.load_keys("test_keys.json");
    assert(alice2.get_encryption_public_key_b64() ==
           alice.get_encryption_public_key_b64());
    std::cout << "✅ Test 4: Key save/load PASSED" << std::endl;

    std::remove("test_keys.json");
    std::cout << "\n✅ All crypto tests passed!" << std::endl;
    return 0;
}
```

### Test 2: Encrypted Messages Between Peers

```bash
# Send encrypted message from Alice
curl -X POST http://localhost:8080/api/messages \
  -H "Content-Type: application/json" \
  -d '{"to": "bob", "content": "Secret message!"}'

# Verify: Bob receives it decrypted
curl -s http://localhost:8081/api/messages?peer=alice | python -m json.tool
# content should be "Secret message!" (decrypted)

# Verify: If you sniff the TCP traffic (Wireshark), you see ciphertext, NOT plaintext
```

---

## 5. Phase 4: Offline Messages

### Test 1: Store Message When Peer Offline

```bash
# Start only Alice's backend (Bob is offline)
./p2p_chat_backend --config alice_config.json

# Send message to Bob (who is offline)
curl -X POST http://localhost:8080/api/messages \
  -H "Content-Type: application/json" \
  -d '{"to": "bob", "content": "Are you there?"}'

# Response should indicate offline delivery:
# {"message_id": "...", "delivered": false, "stored_offline": true}

# Check Supabase — message should be stored
curl "https://YOUR_PROJECT.supabase.co/rest/v1/messages?to_user=eq.bob" \
  -H "apikey: YOUR_KEY"
```

### Test 2: Deliver When Peer Comes Online

```bash
# Now start Bob's backend
./p2p_chat_backend --config bob_config.json

# Bob should automatically:
# 1. Fetch offline messages from Supabase
# 2. Decrypt them
# 3. Store locally
# 4. Delete from Supabase

# Verify Bob got the message:
curl -s http://localhost:8081/api/messages?peer=alice | python -m json.tool

# Verify Supabase is cleaned up:
curl "https://YOUR_PROJECT.supabase.co/rest/v1/messages?to_user=eq.bob" \
  -H "apikey: YOUR_KEY"
# Should be empty []
```

---

## 6. Python UI Testing

### Manual Testing Checklist

- [ ] App launches without errors
- [ ] Status bar shows "Connected to backend"
- [ ] Friends list populates
- [ ] Selecting a friend loads messages
- [ ] Typing and pressing Enter/Send delivers message
- [ ] Message appears in chat display
- [ ] Adding a friend works
- [ ] Removing a friend works
- [ ] Status updates (online/offline indicators)
- [ ] App handles backend being down gracefully

### Test with Mock Backend

```bash
# Run the mock backend (from 02-backend-service.md)
python mock_backend.py

# Run the UI in another terminal
python ui/main.py

# Test all UI features without needing the C++ backend
```

---

## 7. Integration Test Scripts

### Full System Test (PowerShell/Bash)

```bash
#!/bin/bash
echo "=== P2P Chat Integration Test ==="

# Start Alice's backend
./p2p_chat_backend --config alice.json &
ALICE_PID=$!
sleep 2

# Start Bob's backend
./p2p_chat_backend --config bob.json &
BOB_PID=$!
sleep 2

# Check both are running
echo "Checking Alice..."
curl -s http://localhost:8080/api/status | grep -q "online" && echo "✅ Alice OK" || echo "❌ Alice FAIL"

echo "Checking Bob..."
curl -s http://localhost:8081/api/status | grep -q "online" && echo "✅ Bob OK" || echo "❌ Bob FAIL"

# Alice adds Bob as friend
echo "Adding friend..."
curl -s -X POST http://localhost:8080/api/friends \
  -H "Content-Type: application/json" \
  -d '{"username":"bob"}' | grep -q "success" && echo "✅ Add friend OK" || echo "❌ Add friend FAIL"

# Alice sends message
echo "Sending message..."
curl -s -X POST http://localhost:8080/api/messages \
  -H "Content-Type: application/json" \
  -d '{"to":"bob","content":"Integration test!"}' | grep -q "message_id" && echo "✅ Send OK" || echo "❌ Send FAIL"

sleep 1

# Bob checks messages
echo "Checking delivery..."
curl -s http://localhost:8081/api/messages?peer=alice | grep -q "Integration test" && echo "✅ Delivery OK" || echo "❌ Delivery FAIL"

# Cleanup
kill $ALICE_PID $BOB_PID 2>/dev/null
echo "=== Test Complete ==="
```

---

## Testing Checklist Per Phase

### Phase 1 ✅
- [ ] Backend compiles and starts
- [ ] API endpoints respond
- [ ] Two backends can connect via TCP
- [ ] Messages flow between backends
- [ ] UI connects to backend

### Phase 2 ✅
- [ ] Backend registers on Supabase at startup
- [ ] Can look up a user by username
- [ ] Heartbeat updates last_seen
- [ ] Adding a friend by username works

### Phase 3 ✅
- [ ] Keys are generated and saved
- [ ] Encrypt → decrypt round-trip works
- [ ] Tampered messages are rejected
- [ ] Wrong keys fail decryption
- [ ] Signed messages verify correctly

### Phase 4 ✅
- [ ] Offline message stored in Supabase
- [ ] Message is encrypted in Supabase
- [ ] Coming online fetches offline messages
- [ ] Messages deleted from Supabase after delivery
- [ ] Old messages (7+ days) are cleaned up
