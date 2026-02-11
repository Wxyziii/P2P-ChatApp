/**
 * LocalAPI — HTTP server on localhost for the Python UI.
 *
 * Exposes a simple REST API that the PySide6 frontend uses to:
 *   - send messages
 *   - list friends
 *   - add friends
 *   - fetch chat history
 *
 * Runs on 127.0.0.1:<api_port> using ASIO.
 */

#include "api/local_api.h"

// TODO: Implement a minimal HTTP/1.1 server (or use a micro-framework)
//
// Endpoints (see protocol/api_contract.md for details):
//
//   GET  /status                — health check
//   GET  /friends               — list friends
//   POST /friends               — add friend by username
//   GET  /messages?peer=<user>  — chat history with a peer
//   POST /messages              — send a message { "to": "...", "text": "..." }
