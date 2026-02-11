/**
 * PeerServer — Listens for incoming TCP connections from other peers.
 *
 * Uses standalone ASIO for async I/O.
 * Each connected peer gets its own session that reads length-prefixed
 * JSON messages off the wire.
 */

#include "network/peer_server.h"

// TODO: Implement
// - PeerServer::PeerServer(io_context, port)
// - PeerServer::start()           — async_accept loop
// - PeerServer::on_accept(socket) — create PeerSession
// - PeerSession::read_message()   — read header + body
// - PeerSession::write_message()  — send header + body
