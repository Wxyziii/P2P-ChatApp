/**
 * Node — Represents the local P2P chat node.
 *
 * Owns the identity (username, node_id, key pair), manages the friend list,
 * and coordinates between the network layer and the Supabase client.
 */

#include "node/node.h"

// TODO: Implement Node class methods
// - Node::Node(config)           — load or generate identity
// - Node::register_with_supabase — publish public key + IP
// - Node::add_friend(username)   — resolve via Supabase, store locally
// - Node::send_message(to, text) — encrypt → send direct or push offline
// - Node::receive_message(…)     — decrypt, verify, store locally
