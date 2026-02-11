/**
 * SupabaseClient — REST client for the Supabase backend.
 *
 * Uses libcurl to talk to the Supabase PostgREST API.
 * Handles user registration, friend lookup, and offline messages.
 */

#include "include/supabase/supabase_client.h"

// TODO: Implement
// - SupabaseClient::SupabaseClient(url, anon_key)
// - SupabaseClient::register_user(username, node_id, public_key, ip)
// - SupabaseClient::heartbeat(username, ip)   — update last_seen
// - SupabaseClient::lookup_user(username)      — return public_key + last_ip
// - SupabaseClient::push_offline_message(to, from, ciphertext)
// - SupabaseClient::fetch_offline_messages(username) — GET + DELETE
