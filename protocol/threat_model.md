# Threat Model — Secure P2P Chat

> Version 0.1 — Draft
>
> A threat model is how professional security engineers think about protecting
> a system. It answers: "What could go wrong? How bad would it be? What can
> we do about it?" This document walks through every threat we've identified,
> explains it in plain language, and describes our defense.
>
> **If you're new to security**, read this document top to bottom. It's written
> to teach you how to think about security, not just list mitigations.

---

## Table of Contents

1. [What is a Threat Model?](#1-what-is-a-threat-model)
2. [System Overview & Trust Boundaries](#2-system-overview--trust-boundaries)
3. [Assets to Protect](#3-assets-to-protect)
4. [Attacker Profiles](#4-attacker-profiles)
5. [Threat Analysis](#5-threat-analysis)
6. [STRIDE Classification Summary](#6-stride-classification-summary)
7. [What's Out of Scope (and Why)](#7-whats-out-of-scope-and-why)
8. [Recommendations for Future Improvements](#8-recommendations-for-future-improvements)
9. [Security Checklist for Development](#9-security-checklist-for-development)
10. [Glossary of Security Terms](#10-glossary-of-security-terms)

---

## 1. What is a Threat Model?

A threat model is a structured way of thinking about security. Instead of hoping
nothing bad happens, you **systematically identify** what could go wrong, then
**design defenses** for each threat.

The process:
1. **Draw the system** — understand all components and how they connect.
2. **Identify assets** — what are you protecting? (Messages, keys, identity.)
3. **Identify threats** — what could an attacker do? (Eavesdrop, tamper, impersonate.)
4. **Assess risk** — how likely is each threat? How bad would it be?
5. **Design mitigations** — what defenses neutralize each threat?

We use the **STRIDE** model (developed by Microsoft) to categorize threats:

| Letter | Threat Category | Question |
|---|---|---|
| **S** | Spoofing | Can someone pretend to be someone else? |
| **T** | Tampering | Can someone modify data in transit or at rest? |
| **R** | Repudiation | Can someone deny they did something? |
| **I** | Information Disclosure | Can someone read data they shouldn't? |
| **D** | Denial of Service | Can someone prevent the system from working? |
| **E** | Elevation of Privilege | Can someone gain unauthorized access? |

---

## 2. System Overview & Trust Boundaries

### 2.1 Architecture Diagram

```
    +-- TRUST BOUNDARY 1: Same Machine ---------------------------+
    |                                                             |
    |  +-------------+  localhost HTTP  +------------------+      |
    |  | Python UI   | <-------------> | C++ Backend      |       |
    |  | (PySide6)   |                 | (P2P Node)       |       |
    |  +-------------+                 +--------+---------+       |
    |                                           |                 |
    +-------------------------------------------+------------------+
                                                |
                    +---------------------------+---------------------+
                    |                           |                     |
         --- TRUST BOUNDARY 2: Internet ---     |                     |
                    |                           |                     |
                    v                           v                     |
          +-----------------+        +-----------------+              |
          | Remote Peer     |        | Supabase (DB)   |              |
          | (untrusted)     |        | (semi-trusted)  |              |
          +-----------------+        +-----------------+              |
                    |                                                 |
                    |   Network observers, ISPs, attackers            |
                    +-------------------------------------------------+
```

### 2.2 Trust Boundaries Explained

A **trust boundary** is a line where the level of trust changes. Data crossing
a trust boundary needs extra protection.

| Boundary | Between | Trust Level | Protection Needed |
|---|---|---|---|
| **Boundary 1** | UI <-> Backend | **Full trust** — both run on your machine, communicate via localhost. No one else can access 127.0.0.1. | Minimal. No encryption or auth needed. |
| **Boundary 2a** | Backend <-> Remote Peer | **Zero trust** — the remote peer could be anyone. They could be a legitimate friend, a hacker, or a bot. | **Full E2EE**: encrypt all messages, verify all signatures. |
| **Boundary 2b** | Backend <-> Supabase | **Partial trust** — we trust Supabase won't tamper with data, but we don't trust it to keep secrets. It could be breached. | Only store encrypted data and public keys. Never send private keys or plaintext. |
| **Boundary 2c** | Backend <-> Network | **Zero trust** — anyone on the network path (your ISP, a Wi-Fi snooper, a government) can see and modify traffic. | HTTPS for Supabase. E2EE for peer traffic (the TCP content is encrypted, though the TCP connection itself is not TLS-wrapped). |

### 2.3 What "Trust" Means in Practice

- **Full trust:** You don't verify data from this source. (UI trusts the backend
  completely because they're on the same machine.)
- **Partial trust:** You trust them to not be actively malicious, but you don't
  give them sensitive data. (Supabase: we trust their HTTPS, but we encrypt
  messages before storing.)
- **Zero trust:** Assume the worst. Verify everything. Encrypt everything.
  (Remote peers and the network.)

---

## 3. Assets to Protect

An "asset" is anything valuable that an attacker might want to access, steal,
modify, or destroy.

| Asset | Where It Lives | Sensitivity | What Happens if Compromised |
|---|---|---|---|
| **Private keys** (X25519 + Ed25519) | Local filesystem (JSON file) | CRITICAL | Attacker can decrypt ALL past and future messages, impersonate you. Game over. |
| **Plaintext messages** | RAM (briefly), local SQLite DB | HIGH | Attacker reads your private conversations. |
| **Local SQLite database** | Local filesystem | HIGH | Contains decrypted chat history, friend list, keys. |
| **Supabase anon key** | config.json (local) | MEDIUM | Attacker can read/write to your Supabase tables (public keys, encrypted messages). Cannot decrypt messages. |
| **Encrypted messages** | Supabase messages table | LOW | Already encrypted. Useless without private keys. |
| **Public keys** | Supabase users table, local DB | LOW | Public by design. No harm in exposure. |
| **IP addresses** | Supabase users table, peer connections | MEDIUM | Reveals physical location / ISP. Enables targeted attacks. |
| **Usernames** | Supabase, local DB | LOW | Semi-public. Used for discovery. |
| **Metadata** (who talks to whom, when, how often) | Supabase messages table, network traffic | MEDIUM | Reveals social graph even without reading messages. |

---

## 4. Attacker Profiles

Understanding WHO might attack you helps prioritize defenses.

### 4.1 Curious Network Observer ("Wi-Fi Snooper")

- **Capability:** Can see all network traffic on the same LAN (e.g., coffee shop Wi-Fi).
- **Goal:** Read your chat messages.
- **Defense:** E2EE — messages are encrypted before they hit the network. The observer sees gibberish.

### 4.2 Internet Service Provider (ISP)

- **Capability:** Can see all your internet traffic (but not HTTPS content).
- **Goal:** Logging, advertising, or government compliance.
- **Defense:** Supabase traffic uses HTTPS (encrypted). Peer-to-peer TCP traffic is E2EE at the application layer. The ISP can see you're connecting to a peer's IP but can't read the messages.

### 4.3 Malicious Peer

- **Capability:** Has a valid node and can connect to your backend.
- **Goal:** Crash your node (DoS), send malicious data, flood you with spam.
- **Defense:** Rate limiting, input validation, signature verification. Never trust input from peers.

### 4.4 Supabase Breach / Rogue Supabase Employee

- **Capability:** Full access to the PostgreSQL database.
- **Goal:** Read messages, steal identities.
- **Defense:** Messages are encrypted before upload. Only public keys are stored (not private). A breach reveals encrypted ciphertext (useless) and IP addresses (unfortunate but acceptable).

### 4.5 Local Malware

- **Capability:** Running on your machine with your user account privileges.
- **Goal:** Steal private keys, read local database, hijack the backend process.
- **Defense:** **Out of scope.** If malware is on your machine, it can do anything you can do. Use OS-level security (antivirus, disk encryption, strong passwords). Our app can't defend against this.

### 4.6 Sophisticated Attacker (Nation-State)

- **Capability:** Can intercept traffic, compromise Supabase, and potentially target your machine.
- **Defense:** Mostly out of scope. We provide E2EE which protects message content. For higher security, users should use Tor/VPN and full-disk encryption. The Double Ratchet protocol (future) would add forward secrecy.

---

## 5. Threat Analysis

### 5.1 Eavesdropping on P2P Traffic

| | |
|---|---|
| **STRIDE Category** | Information Disclosure |
| **Threat** | An attacker on the network path intercepts TCP traffic between two peers and reads the chat messages. |
| **Likelihood** | HIGH on public Wi-Fi, MEDIUM on home networks. |
| **Impact** | HIGH — complete loss of message confidentiality. |

**How the attack works:**

If messages were plaintext, a network observer can read everything. Even on a home
network, another device (or compromised router) could sniff traffic.

**Our defense:**
All messages are encrypted with crypto_box_easy (XSalsa20-Poly1305) before
being sent over TCP. The attacker sees only ciphertext — random-looking bytes
that cannot be decrypted without Alice's or Bob's private key.

**Residual risk:**
The attacker can see **that** Alice and Bob are communicating (traffic analysis)
and **how much** data they're exchanging. They cannot read the content.

---

### 5.2 Message Tampering (Man-in-the-Middle)

| | |
|---|---|
| **STRIDE Category** | Tampering |
| **Threat** | An attacker intercepts a message in transit and modifies it before forwarding to the recipient. |
| **Likelihood** | MEDIUM — requires active network position (ARP spoofing, DNS hijacking). |
| **Impact** | HIGH — recipient receives a modified message they think is authentic. |

**Our defense — two layers:**

1. **Poly1305 MAC (part of crypto_box_easy):** The encryption itself includes
   an authentication tag. If even one bit of the ciphertext is changed,
   crypto_box_open_easy will fail and return an error. The modified message
   is rejected entirely.

2. **Ed25519 signature:** We also sign the ciphertext with the sender's Ed25519
   key. The recipient verifies the signature before decrypting. This provides an
   independent proof that the message came from the claimed sender and was not
   modified.

**Together:** An attacker would need both Alice's encryption secret key AND her
signing secret key to forge a message. Since those never leave Alice's machine,
this is effectively impossible.

---

### 5.3 Replay Attacks

| | |
|---|---|
| **STRIDE Category** | Tampering / Spoofing |
| **Threat** | An attacker captures a valid encrypted message and re-sends it to the recipient later. |
| **Likelihood** | LOW — requires network interception capability. |
| **Impact** | MEDIUM — recipient sees a duplicate message. |

**Our defense:**

1. **Unique msg_id (UUID):** Every message has a random UUID. The recipient
   tracks all seen UUIDs in the local database. If a UUID is seen twice, the
   second message is silently dropped.

2. **Timestamp checking:** Messages include a timestamp. The recipient can
   reject messages with timestamps too far in the past (e.g., more than 5
   minutes old for direct messages).

---

### 5.4 Impersonation / Identity Spoofing

| | |
|---|---|
| **STRIDE Category** | Spoofing |
| **Threat** | An attacker creates a node with a username that looks like a legitimate user, or registers a different public key for an existing username. |
| **Likelihood** | MEDIUM — easy to attempt, but detectable. |
| **Impact** | HIGH — victim communicates with the wrong person. |

**Our defenses:**

1. **Trust On First Use (TOFU):** When you add a friend, their public key is
   stored locally. If the key ever changes, the UI shows a prominent warning.

2. **Username is PRIMARY KEY in Supabase:** Duplicates are rejected.

3. **Out-of-band verification (recommended):** For high-security conversations,
   verify your friend's public key fingerprint through a separate channel (e.g.,
   in person, phone call).

---

### 5.5 Supabase Data Breach

| | |
|---|---|
| **STRIDE Category** | Information Disclosure |
| **Threat** | Supabase is compromised. Attacker gets full access to the PostgreSQL database. |
| **Likelihood** | LOW — Supabase is a professional service with security teams. But breaches happen. |
| **Impact** | See breakdown below. |

**What the attacker gets:**

| Data | Risk |
|---|---|
| users.username | Low — usernames are semi-public. |
| users.public_key | Low — public by design. Cannot derive private key. |
| users.last_ip | Medium — reveals location/ISP. |
| messages.ciphertext | Low — encrypted. Useless without private keys. |
| messages.from_user / to_user | Medium — reveals who talks to whom (social graph). |

**What the attacker CANNOT get:**
- Private keys (never leave the local machine).
- Plaintext messages (only ciphertext is stored).

---

### 5.6 Compromised Node / Malware

| | |
|---|---|
| **STRIDE Category** | Elevation of Privilege |
| **Threat** | Malware running on your machine with your user account privileges. |
| **Impact** | CRITICAL — complete compromise. |

**Our defense:** **None.** This is explicitly out of scope. If an attacker has code running on
your machine with your privileges, they can do everything you can do.

**Recommendations for users:**
- Keep your OS and software updated.
- Use antivirus / endpoint protection.
- Enable full-disk encryption (BitLocker on Windows, FileVault on macOS, LUKS on Linux).
- Use strong passwords and multi-factor authentication for your OS account.

---

### 5.7 IP Address Exposure

| | |
|---|---|
| **STRIDE Category** | Information Disclosure |
| **Threat** | Peers and Supabase learn your IP address. |
| **Likelihood** | CERTAIN — this is by design. |
| **Impact** | MEDIUM — reveals approximate location, ISP, and enables targeted attacks. |

**Our defense:** This is an **accepted trade-off**. For a direct P2P connection without relay
servers, IP visibility is unavoidable. Users can use a VPN.

---

### 5.8 Denial of Service (DoS)

| | |
|---|---|
| **STRIDE Category** | Denial of Service |
| **Threat** | An attacker floods your node with connections or messages. |
| **Likelihood** | LOW — your node is behind a home router. Attacker needs your IP. |
| **Impact** | MEDIUM — your node becomes unresponsive. |

**Our defenses:**

| Attack | Defense |
|---|---|
| TCP connection flood | Max connection limit per IP (e.g., 5). Close connections that don't authenticate within 10 seconds. |
| Message flood | Rate limit per peer (e.g., 10 messages/second). Max message size (e.g., 64 KB). |
| Offline message flood | Supabase Row Level Security (RLS). Query limit on fetch. |

---

### 5.9 Local API Abuse

| | |
|---|---|
| **STRIDE Category** | Elevation of Privilege / Spoofing |
| **Threat** | A malicious program on your computer sends requests to the backend's localhost API (port 8080). |
| **Impact** | HIGH — attacker can send messages as you, read your chat history. |

**Our defense:**
1. **Bind to 127.0.0.1 only.**
2. **Optional: Shared secret token** in config.json as X-Auth-Token header.

---

### 5.10 Supabase API Key Abuse

| | |
|---|---|
| **STRIDE Category** | Elevation of Privilege |
| **Threat** | Someone extracts your Supabase anon_key and uses it to directly access your database. |
| **Impact** | MEDIUM — attacker can read/write to Supabase tables. |

**Our defense:**
1. **Row Level Security (RLS):** Configure Supabase RLS policies.
2. **Don't commit config.json to Git:** Add it to .gitignore. Only commit config.example.json.

---

### 5.11 Key Compromise — No Forward Secrecy

| | |
|---|---|
| **STRIDE Category** | Information Disclosure |
| **Threat** | An attacker obtains your private key. They can now decrypt ALL past messages encrypted with that key. |
| **Impact** | CRITICAL — all past and future messages compromised. |

**Why this happens:**
We use a **static key pair**. The same X25519 key pair is used for every
message. If the secret key is ever compromised, the attacker can decrypt all
past messages (if they captured the ciphertext) and all future messages (until
the key is changed).

**What forward secrecy means:**
With **forward secrecy**, each message uses a unique ephemeral key. If a
long-term key is compromised, past messages remain safe because the ephemeral
keys were deleted.

**Why we don't have it:**
Implementing forward secrecy requires the **Double Ratchet** protocol (used by
Signal). It's complex — this is a future enhancement.

**Our defense (partial):**
- Protect your private keys (file permissions, disk encryption).
- Key rotation: periodically generate a new key pair and update Supabase.

---

### 5.12 Metadata Leakage

| | |
|---|---|
| **STRIDE Category** | Information Disclosure |
| **Threat** | Even without reading message content, an observer learns WHO talks to WHOM, WHEN, and HOW OFTEN. |
| **Likelihood** | CERTAIN — metadata is inherent in the system design. |
| **Impact** | MEDIUM — reveals social relationships and activity patterns. |

Metadata protection requires advanced techniques like onion routing (Tor) or mix
networks, which are out of scope. Accept the risk. Users concerned about
metadata should use a VPN.

---

### 5.13 Local Database Theft

| | |
|---|---|
| **STRIDE Category** | Information Disclosure |
| **Threat** | Someone copies your local SQLite database file. |
| **Impact** | HIGH — the database contains decrypted plaintext messages. |

**Recommendation:** Use **SQLCipher** (encrypted SQLite variant) and enable
**OS-level full-disk encryption**.

---

## 6. STRIDE Classification Summary

| # | Threat | S | T | R | I | D | E | Severity | Mitigated? |
|---|---|---|---|---|---|---|---|---|---|
| 5.1 | Eavesdropping | | | | X | | | HIGH | Yes (E2EE) |
| 5.2 | Message tampering | | X | | | | | HIGH | Yes (MAC + signature) |
| 5.3 | Replay attacks | X | X | | | | | MEDIUM | Yes (msg_id + timestamp) |
| 5.4 | Impersonation | X | | | | | | HIGH | Partial (TOFU) |
| 5.5 | Supabase breach | | | | X | | | MEDIUM | Yes (encrypted storage) |
| 5.6 | Compromised node | | | | X | | X | CRITICAL | Out of scope |
| 5.7 | IP exposure | | | | X | | | MEDIUM | Accepted trade-off |
| 5.8 | Denial of service | | | | | X | | MEDIUM | Partial (rate limits) |
| 5.9 | Local API abuse | X | | | | | X | HIGH | Partial (localhost bind) |
| 5.10 | API key abuse | | | | | | X | MEDIUM | Partial (RLS) |
| 5.11 | No forward secrecy | | | | X | | | CRITICAL | Future (Double Ratchet) |
| 5.12 | Metadata leakage | | | | X | | | MEDIUM | Accepted trade-off |
| 5.13 | Local DB theft | | | | X | | | HIGH | Future (SQLCipher) |

---

## 7. What's Out of Scope (and Why)

| Item | Why Out of Scope |
|---|---|
| **NAT traversal (STUN/TURN)** | Significant complexity. Requires running relay servers. For development, use LAN or port-forwarding. |
| **Forward secrecy (Double Ratchet)** | The Signal protocol's Double Ratchet is a complex state machine. Great future project, but too much for Phase 1-5. |
| **Push notifications** | Desktop-only app. No mobile OS integration needed. |
| **Mobile clients** | Out of scope entirely — desktop first. |
| **Tor / onion routing** | Massive complexity. Users can run a VPN separately. |
| **Defending against local malware** | Impossible at the application layer. Rely on OS security. |
| **Legal / regulatory compliance** | This is a learning project, not a production service. |
| **Multi-device support** | One device per user for simplicity. Would need key syncing. |

---

## 8. Recommendations for Future Improvements

Listed in order of security impact:

### 8.1 Double Ratchet Protocol (Forward Secrecy)
**Impact:** Critical improvement
**Effort:** HIGH (several weeks of work)
**What it does:** Each message uses a unique ephemeral key. If your long-term key
is compromised, past messages remain secure.
**Learn more:** https://signal.org/docs/specifications/doubleratchet/

### 8.2 SQLCipher (Local Database Encryption)
**Impact:** High improvement
**Effort:** LOW (drop-in replacement for SQLite)
**What it does:** Encrypts the local SQLite database at rest.
**Learn more:** https://www.zetetic.net/sqlcipher/

### 8.3 Key Rotation
**Impact:** High improvement
**Effort:** MEDIUM
**What it does:** Periodically generate new key pairs and update Supabase. Limits
the damage window if a key is compromised.

### 8.4 Certificate Pinning (for Supabase)
**Impact:** Medium improvement
**Effort:** LOW
**What it does:** Pin Supabase's TLS certificate so rogue CAs can't intercept HTTPS.

### 8.5 Supabase Auth (instead of anon key)
**Impact:** Medium improvement
**Effort:** MEDIUM
**What it does:** Each user authenticates with Supabase using email/password. RLS
policies can then properly restrict access per user.

### 8.6 Relay Server (for NAT traversal)
**Impact:** Usability improvement
**Effort:** HIGH
**What it does:** Users behind strict NATs can still communicate through a relay.
The relay never sees plaintext (messages are still E2EE).

---

## 9. Security Checklist for Development

Use this checklist while coding to make sure you don't accidentally introduce
security issues:

### Encryption & Keys
- [ ] Call sodium_init() at program start.
- [ ] Generate a new random nonce for EVERY message. Never reuse nonces.
- [ ] Private keys are stored with restrictive file permissions (owner-only).
- [ ] Private keys are NEVER logged, printed, or sent over the network.
- [ ] Private keys are NEVER stored in Supabase or any remote database.
- [ ] Use sodium_memzero() to clear key material from memory when done.

### Network
- [ ] The LocalAPI binds to 127.0.0.1, NOT 0.0.0.0.
- [ ] All data from remote peers is validated before processing.
- [ ] Signature is verified BEFORE decryption.
- [ ] Messages with duplicate msg_id are rejected.
- [ ] Connection limits and rate limiting are implemented.
- [ ] Maximum message size is enforced (e.g., 64 KB).

### Supabase
- [ ] config.json is in .gitignore.
- [ ] Only encrypted messages are uploaded.
- [ ] Fetched offline messages are deleted after successful decryption.
- [ ] RLS policies are configured (when using Supabase Auth).

### Local Storage
- [ ] SQLite database file has restrictive permissions.
- [ ] SQL queries use parameterized statements (NOT string concatenation).
- [ ] Key files are not world-readable.

### General
- [ ] No secrets in source code (use config files / environment variables).
- [ ] Error messages don't leak sensitive information.
- [ ] spdlog level is set appropriately (don't log message content in production).

---

## 10. Glossary of Security Terms

| Term | Definition |
|---|---|
| **E2EE** | End-to-End Encryption. Only the sender and recipient can read messages. No intermediate server (including Supabase) can decrypt them. |
| **TOFU** | Trust On First Use. You trust a peer's public key the first time you see it, and flag any changes afterward. Similar to how SSH works when you connect to a new server for the first time. |
| **Forward Secrecy** | A property where compromising a long-term key doesn't compromise past session keys. Achieved via ephemeral key exchange (e.g., Double Ratchet). |
| **MITM** | Man-in-the-Middle. An attacker positions themselves between two communicating parties and can read/modify messages in transit. |
| **MAC** | Message Authentication Code. A short tag computed from a message and a key. Used to verify that a message hasn't been tampered with. |
| **Nonce** | Number Used Once. A random value that ensures each encryption is unique, even for identical plaintexts. |
| **STRIDE** | A threat classification framework: Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege. |
| **RLS** | Row Level Security. A PostgreSQL feature that restricts which rows a user can access, based on policies. |
| **Anon Key** | Supabase's public API key for unauthenticated access. Not secret, but should be paired with RLS policies. |
| **Double Ratchet** | A cryptographic algorithm used by Signal that provides forward secrecy and break-in recovery. Each message uses new keys derived from a ratcheting process. |
| **Key Pinning** | Storing a peer's public key locally and rejecting changes unless explicitly approved. Prevents MITM attacks where the attacker substitutes their own key. |
| **Traffic Analysis** | Observing metadata (timing, volume, source/destination) of encrypted traffic to infer information without reading content. |
| **SQL Injection** | An attack where malicious SQL code is inserted into a query through user input. Prevented by using parameterized queries. |
| **DoS** | Denial of Service. Overwhelming a system with requests so it can't serve legitimate users. |
