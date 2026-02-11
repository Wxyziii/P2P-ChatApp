#pragma once

#include <string>
#include <vector>
#include <optional>
#include <nlohmann/json.hpp>

/**
 * Lightweight REST client for Supabase PostgREST API.
 *
 * All HTTP calls use libcurl under the hood.
 */
class SupabaseClient {
public:
    SupabaseClient(const std::string& base_url, const std::string& anon_key);

    /// Insert or upsert this node into the `users` table.
    bool register_user(const std::string& username,
                       const std::string& node_id,
                       const std::string& public_key,
                       const std::string& ip);

    /// Update last_seen and last_ip for heartbeat.
    bool heartbeat(const std::string& username, const std::string& ip);

    /// Look up a user by username. Returns JSON with public_key, last_ip, etc.
    std::optional<nlohmann::json> lookup_user(const std::string& username);

    /// Push an encrypted offline message to the `messages` table.
    bool push_offline_message(const std::string& to_user,
                              const std::string& from_user,
                              const std::string& ciphertext);

    /// Fetch (and delete) all pending offline messages for this user.
    std::vector<nlohmann::json> fetch_offline_messages(const std::string& username);

private:
    /// Generic HTTP helpers
    std::string http_get(const std::string& endpoint);
    std::string http_post(const std::string& endpoint, const std::string& body);
    std::string http_patch(const std::string& endpoint, const std::string& body);
    std::string http_delete(const std::string& endpoint);

    std::string base_url_;
    std::string anon_key_;
};
