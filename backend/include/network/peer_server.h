#pragma once

#include <asio.hpp>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>

/**
 * Async TCP server that accepts peer connections.
 */
class PeerServer {
public:
    using MessageCallback = std::function<void(const std::string& from,
                                                const std::string& payload)>;

    PeerServer(asio::io_context& io, uint16_t port);

    void start();
    void stop();

    /// Set the callback invoked when a complete message arrives.
    void set_on_message(MessageCallback cb);

private:
    void do_accept();

    asio::ip::tcp::acceptor acceptor_;
    MessageCallback on_message_;
};
