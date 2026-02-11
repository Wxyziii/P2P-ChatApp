# HTTP Server Guide (LocalAPI)

> How to build the localhost HTTP server that the Python UI talks to.
> Includes two approaches: the easy way (cpp-httplib) and the learning way (raw ASIO).

---

## Table of Contents

1. [Overview](#1-overview)
2. [Option A: cpp-httplib (Recommended for Getting Started)](#2-option-a-cpp-httplib)
3. [Option B: Raw ASIO HTTP Parser (For Learning)](#3-option-b-raw-asio-http-parser)
4. [Routing Requests](#4-routing-requests)
5. [Parsing JSON Request Bodies](#5-parsing-json-request-bodies)
6. [Sending JSON Responses](#6-sending-json-responses)
7. [Query Parameter Parsing](#7-query-parameter-parsing)
8. [Error Responses](#8-error-responses)
9. [Integration with Node](#9-integration-with-node)
10. [Testing with curl](#10-testing-with-curl)

---

## 1. Overview

The LocalAPI is an HTTP server running on `127.0.0.1:8080` that the Python UI
calls. It translates HTTP requests into C++ function calls on the Node object.

```
Python UI                    LocalAPI                    Node
=========                    ========                    ====
POST /messages  ──HTTP──>  parse request  ──call──>  send_message()
                <──HTTP──  format response <──return──  result
```

---

## 2. Option A: cpp-httplib (Recommended for Getting Started)

[cpp-httplib](https://github.com/yhirose/cpp-httplib) is a **single header file**
that gives you a full HTTP server. Perfect for getting started quickly.

### Setup:

1. Download `httplib.h` from https://github.com/yhirose/cpp-httplib/blob/master/httplib.h
2. Place it in `backend/include/`
3. Or add to CMakeLists.txt via FetchContent:

```cmake
FetchContent_Declare(
    httplib
    GIT_REPOSITORY https://github.com/yhirose/cpp-httplib.git
    GIT_TAG        v0.15.3
)
FetchContent_MakeAvailable(httplib)

target_link_libraries(${PROJECT_NAME} PRIVATE httplib::httplib)
```

### Complete working example:

```cpp
#include <httplib.h>
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

using json = nlohmann::json;

int main() {
    httplib::Server svr;

    // ─── GET /status ─────────────────────────────────────────
    svr.Get("/status", [](const httplib::Request&, httplib::Response& res) {
        json response = {
            {"status", "ok"},
            {"username", "alice"},
            {"uptime_seconds", 42}
        };
        res.set_content(response.dump(), "application/json");
    });

    // ─── GET /friends ────────────────────────────────────────
    svr.Get("/friends", [](const httplib::Request&, httplib::Response& res) {
        json friends = json::array({
            {{"username", "bob"}, {"online", true}},
            {{"username", "charlie"}, {"online", false}}
        });
        res.set_content(friends.dump(), "application/json");
    });

    // ─── POST /friends ───────────────────────────────────────
    svr.Post("/friends", [](const httplib::Request& req, httplib::Response& res) {
        // Parse the JSON body
        json body;
        try {
            body = json::parse(req.body);
        } catch (...) {
            res.status = 400;
            res.set_content(R"({"error":"Invalid JSON"})", "application/json");
            return;
        }

        // Validate required fields
        if (!body.contains("username")) {
            res.status = 400;
            res.set_content(R"({"error":"Missing 'username' field"})",
                            "application/json");
            return;
        }

        std::string username = body["username"];
        spdlog::info("Adding friend: {}", username);

        // TODO: Call node->add_friend(username) here
        // For now, return a fake response:
        json response = {
            {"username", username},
            {"public_key", "fake_key_base64"},
            {"online", false}
        };
        res.status = 201;
        res.set_content(response.dump(), "application/json");
    });

    // ─── GET /messages?peer=bob&limit=50 ─────────────────────
    svr.Get("/messages", [](const httplib::Request& req, httplib::Response& res) {
        // cpp-httplib parses query params automatically!
        std::string peer = req.get_param_value("peer");
        std::string limit_str = req.get_param_value("limit");
        int limit = limit_str.empty() ? 50 : std::stoi(limit_str);

        if (peer.empty()) {
            res.status = 400;
            res.set_content(R"({"error":"Missing 'peer' query parameter"})",
                            "application/json");
            return;
        }

        spdlog::info("Getting messages with {} (limit {})", peer, limit);

        // TODO: Query local SQLite for messages with this peer
        json response = {
            {"messages", json::array()},
            {"total", 0},
            {"has_more", false}
        };
        res.set_content(response.dump(), "application/json");
    });

    // ─── POST /messages ──────────────────────────────────────
    svr.Post("/messages", [](const httplib::Request& req, httplib::Response& res) {
        json body;
        try {
            body = json::parse(req.body);
        } catch (...) {
            res.status = 400;
            res.set_content(R"({"error":"Invalid JSON"})", "application/json");
            return;
        }

        if (!body.contains("to") || !body.contains("text")) {
            res.status = 400;
            res.set_content(R"({"error":"Missing 'to' and/or 'text' fields"})",
                            "application/json");
            return;
        }

        std::string to = body["to"];
        std::string text = body["text"];

        spdlog::info("Sending to {}: {}", to, text);

        // TODO: Call node->send_message(to, text)
        // For now, return fake response:
        json response = {
            {"msg_id", "fake-uuid"},
            {"delivered", true},
            {"method", "direct"},
            {"timestamp", "2026-02-11T16:00:00Z"}
        };
        res.set_content(response.dump(), "application/json");
    });

    // ─── Start server ────────────────────────────────────────
    spdlog::info("LocalAPI listening on 127.0.0.1:8080");
    svr.listen("127.0.0.1", 8080);
    // IMPORTANT: "127.0.0.1" not "0.0.0.0"!
    // 0.0.0.0 would be accessible from the network — security risk.
}
```

### ⚠️ Watch Out: cpp-httplib is BLOCKING

`svr.listen()` blocks the calling thread. If you're using ASIO for the peer
server, you have two options:

**Option 1: Run cpp-httplib in a separate thread:**
```cpp
std::thread api_thread([&svr]() {
    svr.listen("127.0.0.1", 8080);
});

// Main thread runs ASIO
io.run();
```

**Option 2: Use the raw ASIO HTTP approach (Section 3) instead.**

---

## 3. Option B: Raw ASIO HTTP Parser (For Learning)

If you want to learn how HTTP works under the hood, build a minimal parser:

```cpp
#include <asio.hpp>
#include <sstream>
#include <string>
#include <map>
#include <functional>

using asio::ip::tcp;

struct HttpRequest {
    std::string method;   // "GET", "POST", "DELETE"
    std::string path;     // "/friends", "/messages"
    std::string query;    // "peer=bob&limit=50"
    std::map<std::string, std::string> headers;
    std::string body;
};

struct HttpResponse {
    int status_code = 200;
    std::string status_text = "OK";
    std::string content_type = "application/json";
    std::string body;

    std::string to_string() const {
        std::ostringstream ss;
        ss << "HTTP/1.1 " << status_code << " " << status_text << "\r\n"
           << "Content-Type: " << content_type << "\r\n"
           << "Content-Length: " << body.size() << "\r\n"
           << "Connection: close\r\n"
           << "\r\n"
           << body;
        return ss.str();
    }
};

HttpRequest parse_request(const std::string& raw) {
    HttpRequest req;
    std::istringstream stream(raw);

    // Parse request line: "GET /path?query HTTP/1.1"
    std::string line;
    std::getline(stream, line);
    std::istringstream request_line(line);
    std::string full_path, version;
    request_line >> req.method >> full_path >> version;

    // Split path and query
    auto q = full_path.find('?');
    if (q != std::string::npos) {
        req.path = full_path.substr(0, q);
        req.query = full_path.substr(q + 1);
    } else {
        req.path = full_path;
    }

    // Parse headers
    while (std::getline(stream, line) && line != "\r" && !line.empty()) {
        if (line.back() == '\r') line.pop_back();
        auto colon = line.find(": ");
        if (colon != std::string::npos) {
            req.headers[line.substr(0, colon)] = line.substr(colon + 2);
        }
    }

    // Read body (rest of the data)
    std::ostringstream body_stream;
    body_stream << stream.rdbuf();
    req.body = body_stream.str();

    return req;
}

std::map<std::string, std::string> parse_query_params(const std::string& query) {
    std::map<std::string, std::string> params;
    std::istringstream stream(query);
    std::string pair;
    while (std::getline(stream, pair, '&')) {
        auto eq = pair.find('=');
        if (eq != std::string::npos) {
            params[pair.substr(0, eq)] = pair.substr(eq + 1);
        }
    }
    return params;
}
```

---

## 4. Routing Requests

Whether you use cpp-httplib or raw ASIO, you need to route requests to handlers:

```cpp
// Simple router for raw ASIO approach
using Handler = std::function<HttpResponse(const HttpRequest&)>;

struct Route {
    std::string method;
    std::string path;
    Handler handler;
};

class Router {
public:
    void add(const std::string& method, const std::string& path, Handler h) {
        routes_.push_back({method, path, std::move(h)});
    }

    HttpResponse handle(const HttpRequest& req) const {
        for (const auto& route : routes_) {
            if (route.method == req.method && route.path == req.path) {
                return route.handler(req);
            }
        }
        // No matching route
        return {404, "Not Found", "application/json",
                R"({"error":"Endpoint not found"})"};
    }

private:
    std::vector<Route> routes_;
};

// Usage:
Router router;

router.add("GET", "/status", [](const HttpRequest&) {
    return HttpResponse{200, "OK", "application/json",
        R"({"status":"ok"})"};
});

router.add("POST", "/messages", [&node](const HttpRequest& req) {
    auto body = json::parse(req.body);
    // ... handle message
    return HttpResponse{200, "OK", "application/json", result.dump()};
});
```

---

## 5. Parsing JSON Request Bodies

```cpp
#include <nlohmann/json.hpp>
using json = nlohmann::json;

// Safe JSON parsing with error handling:
HttpResponse handle_post_message(const HttpRequest& req) {
    json body;
    try {
        body = json::parse(req.body);
    } catch (const json::parse_error& e) {
        return {400, "Bad Request", "application/json",
                json({{"error", "Invalid JSON: " + std::string(e.what())}}).dump()};
    }

    // Check for required fields
    if (!body.contains("to") || !body["to"].is_string()) {
        return {400, "Bad Request", "application/json",
                R"({"error":"Missing or invalid 'to' field"})"};
    }
    if (!body.contains("text") || !body["text"].is_string()) {
        return {400, "Bad Request", "application/json",
                R"({"error":"Missing or invalid 'text' field"})"};
    }

    std::string to = body["to"].get<std::string>();
    std::string text = body["text"].get<std::string>();

    // Validate
    if (to.empty()) {
        return {400, "Bad Request", "application/json",
                R"({"error":"'to' cannot be empty"})"};
    }
    if (text.size() > 10000) {
        return {400, "Bad Request", "application/json",
                R"({"error":"Message too long (max 10000 chars)"})"};
    }

    // Call node logic...
    auto result = node->send_message(to, text);
    return {result.delivered ? 200 : 202, "OK", "application/json",
            result.to_json().dump()};
}
```

---

## 6. Sending JSON Responses

```cpp
// Helper function to create JSON responses easily:
HttpResponse json_response(int status, const json& data) {
    std::string status_text;
    switch (status) {
        case 200: status_text = "OK"; break;
        case 201: status_text = "Created"; break;
        case 202: status_text = "Accepted"; break;
        case 204: status_text = "No Content"; break;
        case 400: status_text = "Bad Request"; break;
        case 404: status_text = "Not Found"; break;
        case 409: status_text = "Conflict"; break;
        case 500: status_text = "Internal Server Error"; break;
        default:  status_text = "Unknown"; break;
    }
    return {status, status_text, "application/json", data.dump()};
}

// Usage:
return json_response(200, {{"status", "ok"}, {"username", "alice"}});
return json_response(404, {{"error", "User not found"}});
return json_response(201, {{"username", "bob"}, {"online", true}});
```

---

## 7. Query Parameter Parsing

For endpoints like `GET /messages?peer=bob&limit=20`:

```cpp
// If using cpp-httplib:
std::string peer = req.get_param_value("peer");
int limit = 50;  // default
if (req.has_param("limit")) {
    limit = std::stoi(req.get_param_value("limit"));
}

// If using raw ASIO:
auto params = parse_query_params(req.query);
std::string peer = params["peer"];
int limit = params.count("limit") ? std::stoi(params["limit"]) : 50;
```

---

## 8. Error Responses

Always return consistent error JSON:

```cpp
HttpResponse error_response(int status, const std::string& message) {
    return json_response(status, {{"error", message}});
}

// Usage:
if (!node->has_friend(to)) {
    return error_response(404,
        "'" + to + "' is not in your friend list. Add them first.");
}
```

---

## 9. Integration with Node

The LocalAPI needs a reference to the Node object:

```cpp
class LocalAPI {
public:
    LocalAPI(Node& node, uint16_t port) : node_(node) {
        // Set up routes that call node_ methods
        server_.Get("/status", [this](auto& req, auto& res) {
            json j = {
                {"status", "ok"},
                {"username", node_.username()},
                {"node_id", node_.node_id()}
            };
            res.set_content(j.dump(), "application/json");
        });

        server_.Post("/messages", [this](auto& req, auto& res) {
            auto body = json::parse(req.body);
            auto result = node_.send_message(
                body["to"].get<std::string>(),
                body["text"].get<std::string>()
            );
            res.status = result.delivered ? 200 : 202;
            res.set_content(result.to_json().dump(), "application/json");
        });
    }

    void start() {
        server_.listen("127.0.0.1", port_);
    }

private:
    Node& node_;
    httplib::Server server_;
    uint16_t port_;
};
```

---

## 10. Testing with curl

Before connecting the Python UI, test every endpoint with curl:

```bash
# Health check
curl -s http://127.0.0.1:8080/status | python -m json.tool

# Add a friend
curl -s -X POST http://127.0.0.1:8080/friends \
  -H "Content-Type: application/json" \
  -d '{"username":"bob"}' | python -m json.tool

# List friends
curl -s http://127.0.0.1:8080/friends | python -m json.tool

# Send a message
curl -s -X POST http://127.0.0.1:8080/messages \
  -H "Content-Type: application/json" \
  -d '{"to":"bob","text":"Hello from curl!"}' | python -m json.tool

# Get messages
curl -s "http://127.0.0.1:8080/messages?peer=bob&limit=10" | python -m json.tool

# Windows PowerShell alternative:
Invoke-RestMethod http://127.0.0.1:8080/status | ConvertTo-Json
```

### 💡 Tip: Create a test script

Save this as `test_api.sh` (Linux/macOS) or `test_api.ps1` (Windows):

```bash
#!/bin/bash
BASE="http://127.0.0.1:8080"
echo "=== Status ==="
curl -s $BASE/status | python -m json.tool
echo "\n=== Friends ==="
curl -s $BASE/friends | python -m json.tool
echo "\n=== Add Friend ==="
curl -s -X POST $BASE/friends -H "Content-Type: application/json" \
  -d '{"username":"testuser"}' | python -m json.tool
echo "\n=== Send Message ==="
curl -s -X POST $BASE/messages -H "Content-Type: application/json" \
  -d '{"to":"testuser","text":"test message"}' | python -m json.tool
echo "\n=== Get Messages ==="
curl -s "$BASE/messages?peer=testuser" | python -m json.tool
```
