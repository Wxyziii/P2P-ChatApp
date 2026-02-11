#pragma once

#include <asio.hpp>
#include <cstdint>
#include <functional>
#include <string>

/**
 * Minimal localhost-only HTTP API consumed by the Python UI.
 */
class LocalAPI {
public:
    LocalAPI(asio::io_context& io, uint16_t port);

    void start();
    void stop();

    // Callbacks wired to Node methods
    using SendCallback   = std::function<bool(const std::string& to, const std::string& text)>;
    using FriendCallback = std::function<bool(const std::string& username)>;

    void set_on_send(SendCallback cb);
    void set_on_add_friend(FriendCallback cb);

private:
    void do_accept();
    void handle_request(asio::ip::tcp::socket socket);

    asio::ip::tcp::acceptor acceptor_;
    SendCallback   on_send_;
    FriendCallback on_add_friend_;
};
