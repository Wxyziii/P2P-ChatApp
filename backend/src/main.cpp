/**
 * secure-p2p-chat — Backend Entry Point
 *
 * Initialises the node: loads config, generates/loads key pair,
 * starts the local REST API (for the Python UI), the peer listener,
 * and the Supabase heartbeat loop.
 */

#include <iostream>
#include <fstream>
#include <string>

#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

// TODO: Uncomment as you implement each module
// #include "node/node.h"
// #include "crypto/crypto_manager.h"
// #include "network/peer_server.h"
// #include "api/local_api.h"
// #include "supabase/supabase_client.h"

using json = nlohmann::json;

static json load_config(const std::string& path) {
    std::ifstream file(path);
    if (!file.is_open()) {
        spdlog::error("Cannot open config file: {}", path);
        std::exit(1);
    }
    return json::parse(file);
}

int main(int argc, char* argv[]) {
    spdlog::set_level(spdlog::level::info);
    spdlog::info("secure-p2p-chat backend starting…");

    std::string config_path = (argc > 1) ? argv[1] : "config.json";
    json config = load_config(config_path);

    spdlog::info("Loaded config from {}", config_path);
    spdlog::info("Username: {}", config["node"]["username"].get<std::string>());

    // ── Phase 1: Plaintext P2P ──────────────────────────────────────────────
    // TODO: Initialise ASIO peer server on config["node"]["listen_port"]
    // TODO: Start local HTTP API on config["node"]["api_port"]

    // ── Phase 2: Supabase Discovery ─────────────────────────────────────────
    // TODO: Register user in Supabase (username, public_key, IP)
    // TODO: Start heartbeat loop to update last_seen

    // ── Phase 3: Encryption ─────────────────────────────────────────────────
    // TODO: Generate or load X25519 + Ed25519 key pair
    // TODO: Encrypt outgoing messages, verify incoming signatures

    // ── Phase 4: Offline Messages ───────────────────────────────────────────
    // TODO: On startup, fetch & decrypt offline messages from Supabase
    // TODO: On send failure, push encrypted message to Supabase

    spdlog::info("Backend ready. Press Ctrl+C to exit.");

    // Keep the process alive (will be replaced by ASIO io_context.run())
    std::cin.get();
    return 0;
}
