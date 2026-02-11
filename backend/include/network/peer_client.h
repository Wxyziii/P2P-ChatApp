#pragma once

#include <asio.hpp>
#include <string>
#include <cstdint>

/**
 * TCP client for connecting to a single remote peer.
 */
class PeerClient {
public:
    explicit PeerClient(asio::io_context& io);

    bool connect(const std::string& ip, uint16_t port);
    bool send(const std::string& json_payload);
    void disconnect();

private:
    asio::ip::tcp::socket socket_;
};
