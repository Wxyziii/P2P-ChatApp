/**
 * CryptoManager — Handles all libsodium cryptographic operations.
 *
 * - X25519 key exchange (crypto_box)
 * - Ed25519 signing / verification
 * - Key generation and persistence
 */

#include "crypto/crypto_manager.h"

// TODO: Implement
// - CryptoManager::init()                     — call sodium_init()
// - CryptoManager::generate_keypair()         — X25519 + Ed25519
// - CryptoManager::load_keypair(path)         — from local file
// - CryptoManager::save_keypair(path)         — to local file
// - CryptoManager::encrypt(plaintext, peer_pk) — sealed box or crypto_box
// - CryptoManager::decrypt(ciphertext, peer_pk)
// - CryptoManager::sign(message)              — Ed25519
// - CryptoManager::verify(message, sig, pk)   — Ed25519
