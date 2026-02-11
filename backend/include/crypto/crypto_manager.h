#pragma once

#include <string>
#include <vector>
#include <cstdint>

/**
 * Wraps libsodium for key management, encryption, and signing.
 *
 * Key exchange:  X25519  (crypto_box_keypair / crypto_box_easy)
 * Signing:       Ed25519 (crypto_sign_keypair / crypto_sign_detached)
 */
class CryptoManager {
public:
    CryptoManager();

    /// Must be called once before any other method.
    static bool init();

    /// Generate a fresh X25519 + Ed25519 key pair.
    void generate_keypair();

    /// Persist keys to disk (JSON).
    void save_keypair(const std::string& path) const;

    /// Load keys from disk.
    bool load_keypair(const std::string& path);

    /// Encrypt a plaintext message for a given peer public key.
    std::string encrypt(const std::string& plaintext,
                        const std::vector<uint8_t>& peer_public_key) const;

    /// Decrypt a ciphertext from a given peer public key.
    std::string decrypt(const std::string& ciphertext,
                        const std::vector<uint8_t>& peer_public_key) const;

    /// Sign a message with Ed25519.
    std::string sign(const std::string& message) const;

    /// Verify an Ed25519 signature.
    bool verify(const std::string& message,
                const std::string& signature,
                const std::vector<uint8_t>& peer_signing_key) const;

    [[nodiscard]] const std::vector<uint8_t>& public_key() const { return public_key_; }
    [[nodiscard]] const std::vector<uint8_t>& signing_public_key() const { return signing_public_key_; }

private:
    std::vector<uint8_t> public_key_;       // X25519
    std::vector<uint8_t> secret_key_;       // X25519
    std::vector<uint8_t> signing_public_key_; // Ed25519
    std::vector<uint8_t> signing_secret_key_; // Ed25519
};
