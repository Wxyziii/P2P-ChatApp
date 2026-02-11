#pragma once

#include <string>
#include <vector>
#include <nlohmann/json.hpp>

/**
 * Represents the local P2P chat node.
 */
class Node {
public:
    explicit Node(const nlohmann::json& config);

    /// Register this node's public key and IP with Supabase.
    void register_with_supabase();

    /// Look up a friend by username via Supabase and store them locally.
    bool add_friend(const std::string& username);

    /// Encrypt and send a message (direct or offline fallback).
    bool send_message(const std::string& to_user, const std::string& plaintext);

    /// Called when a message is received from a peer.
    void on_message_received(const std::string& from_user,
                             const std::string& ciphertext,
                             const std::string& signature);

    [[nodiscard]] const std::string& username() const { return username_; }
    [[nodiscard]] const std::string& node_id()  const { return node_id_; }

private:
    std::string username_;
    std::string node_id_;
    // TODO: Add key pair fields, friend list, DB handle, etc.
};
