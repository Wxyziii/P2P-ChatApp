# 04 — libcurl & Supabase REST Client Guide

> **Audience**: Beginners learning C++ and REST APIs.
> This guide teaches you how to use libcurl to communicate with Supabase's PostgREST API.

---

## Table of Contents

1. [What is libcurl?](#1-what-is-libcurl)
2. [What is Supabase PostgREST?](#2-what-is-supabase-postgrest)
3. [libcurl Basics](#3-libcurl-basics)
4. [Making GET Requests](#4-making-get-requests)
5. [Making POST Requests](#5-making-post-requests)
6. [Making PATCH Requests](#6-making-patch-requests)
7. [Making DELETE Requests](#7-making-delete-requests)
8. [Setting Headers](#8-setting-headers)
9. [Reading Responses](#9-reading-responses)
10. [Complete SupabaseClient Class](#10-complete-supabaseclient-class)
11. [PostgREST Query Syntax](#11-postgrest-query-syntax)
12. [Error Handling](#12-error-handling)
13. [Common Mistakes](#13-common-mistakes)
14. [Tips & Tricks](#14-tips--tricks)

---

## 1. What is libcurl?

libcurl is the most widely used C/C++ library for making HTTP requests. Think of it as the C++ equivalent of Python's `requests` library.

**Why libcurl?**
- Battle-tested (used by billions of devices)
- Supports HTTP, HTTPS, FTP, and many more protocols
- Available on every operating system
- Handles SSL/TLS automatically

**How it works**: You create a "handle" (like opening a browser tab), configure it (set the URL, headers, body), and then "perform" the request (like clicking "Go").

---

## 2. What is Supabase PostgREST?

Supabase exposes your PostgreSQL tables as a REST API automatically. This means:

- **Table** → **URL endpoint**
- `users` table → `https://YOUR_PROJECT.supabase.co/rest/v1/users`
- `messages` table → `https://YOUR_PROJECT.supabase.co/rest/v1/messages`

**Every request needs two headers**:
```
apikey: YOUR_ANON_KEY
Content-Type: application/json
```

**Operations map to HTTP methods**:
| Operation | HTTP Method | SQL Equivalent |
|-----------|-------------|----------------|
| Read data | GET | SELECT |
| Insert data | POST | INSERT |
| Update data | PATCH | UPDATE |
| Delete data | DELETE | DELETE |

---

## 3. libcurl Basics

### The Lifecycle

Every libcurl request follows this pattern:

```cpp
#include <curl/curl.h>
#include <string>
#include <iostream>

int main() {
    // 1. Initialize libcurl globally (call ONCE at program start)
    curl_global_init(CURL_GLOBAL_DEFAULT);

    // 2. Create a handle (like opening a browser tab)
    CURL* curl = curl_easy_init();

    if (curl) {
        // 3. Configure the request
        curl_easy_setopt(curl, CURLOPT_URL, "https://example.com");

        // 4. Perform the request (like pressing Enter)
        CURLcode res = curl_easy_perform(curl);

        // 5. Check for errors
        if (res != CURLE_OK) {
            std::cerr << "Request failed: "
                      << curl_easy_strerror(res) << std::endl;
        }

        // 6. Clean up the handle (ALWAYS do this!)
        curl_easy_cleanup(curl);
    }

    // 7. Clean up globally (call ONCE at program end)
    curl_global_cleanup();
    return 0;
}
```

### ⚠️ Critical Rules

1. **Always call `curl_easy_cleanup()`** — forgetting this leaks memory
2. **Always call `curl_global_init()` before any curl calls**
3. **Always check `CURLcode` return values**
4. **Always free `curl_slist` headers**

---

## 4. Making GET Requests

### Simple GET

```cpp
#include <curl/curl.h>
#include <string>
#include <iostream>

// This function is called by libcurl when it receives data
// It's like a callback that says "here's some data, do something with it"
static size_t WriteCallback(void* contents, size_t size, size_t nmemb,
                            void* userp) {
    size_t total_size = size * nmemb;
    std::string* response = static_cast<std::string*>(userp);
    response->append(static_cast<char*>(contents), total_size);
    return total_size;
}

std::string http_get(const std::string& url,
                     const std::string& apikey) {
    std::string response_body;

    CURL* curl = curl_easy_init();
    if (!curl) {
        throw std::runtime_error("Failed to init curl");
    }

    // Set the URL
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());

    // Set up headers
    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers,
        ("apikey: " + apikey).c_str());
    headers = curl_slist_append(headers,
        "Content-Type: application/json");
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);

    // Set up the response callback
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response_body);

    // Perform the request
    CURLcode res = curl_easy_perform(curl);

    // Get HTTP status code
    long http_code = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &http_code);

    // Clean up
    curl_slist_free_all(headers);  // Free headers!
    curl_easy_cleanup(curl);       // Free handle!

    if (res != CURLE_OK) {
        throw std::runtime_error(
            std::string("GET failed: ") + curl_easy_strerror(res));
    }

    if (http_code >= 400) {
        throw std::runtime_error(
            "HTTP " + std::to_string(http_code) + ": " + response_body);
    }

    return response_body;
}
```

### Understanding the WriteCallback

This is the most confusing part of libcurl for beginners. Here's what happens:

1. You tell curl: "When you get data, call this function"
2. curl downloads data in chunks
3. For each chunk, curl calls your function with the data
4. Your function appends it to a string
5. After the request completes, your string has the full response

```
curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
//                                             ^^^^^^^^^^^^^^^^
//                            "Call THIS function with the data"

curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response_body);
//                                        ^^^^^^^^^^^^^^
//                            "Pass THIS as the last argument"
```

---

## 5. Making POST Requests

### POST with JSON Body

```cpp
std::string http_post(const std::string& url,
                      const std::string& apikey,
                      const std::string& json_body) {
    std::string response_body;

    CURL* curl = curl_easy_init();
    if (!curl) throw std::runtime_error("Failed to init curl");

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());

    // Tell curl this is a POST request
    curl_easy_setopt(curl, CURLOPT_POST, 1L);

    // Set the JSON body
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, json_body.c_str());

    // Headers
    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers,
        ("apikey: " + apikey).c_str());
    headers = curl_slist_append(headers,
        "Content-Type: application/json");
    // This tells PostgREST to return the inserted row
    headers = curl_slist_append(headers,
        "Prefer: return=representation");
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);

    // Response
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response_body);

    CURLcode res = curl_easy_perform(curl);
    long http_code = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &http_code);

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    if (res != CURLE_OK) {
        throw std::runtime_error(
            std::string("POST failed: ") + curl_easy_strerror(res));
    }

    return response_body;
}
```

### UPSERT (Insert or Update)

For our `register_user` function, we want to insert if the user doesn't exist,
or update if they do. PostgREST supports this with a special header:

```cpp
// Add this header for UPSERT:
headers = curl_slist_append(headers,
    "Prefer: resolution=merge-duplicates,return=representation");
```

This is equivalent to SQL's `INSERT ... ON CONFLICT DO UPDATE`.

---

## 6. Making PATCH Requests

### PATCH (Update Existing Data)

```cpp
std::string http_patch(const std::string& url,
                       const std::string& apikey,
                       const std::string& json_body) {
    std::string response_body;

    CURL* curl = curl_easy_init();
    if (!curl) throw std::runtime_error("Failed to init curl");

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());

    // Tell curl this is a PATCH request
    curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, "PATCH");
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, json_body.c_str());

    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers,
        ("apikey: " + apikey).c_str());
    headers = curl_slist_append(headers,
        "Content-Type: application/json");
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);

    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response_body);

    CURLcode res = curl_easy_perform(curl);
    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    if (res != CURLE_OK) {
        throw std::runtime_error(
            std::string("PATCH failed: ") + curl_easy_strerror(res));
    }

    return response_body;
}
```

---

## 7. Making DELETE Requests

```cpp
std::string http_delete(const std::string& url,
                        const std::string& apikey) {
    std::string response_body;

    CURL* curl = curl_easy_init();
    if (!curl) throw std::runtime_error("Failed to init curl");

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, "DELETE");

    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers,
        ("apikey: " + apikey).c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);

    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response_body);

    CURLcode res = curl_easy_perform(curl);
    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    if (res != CURLE_OK) {
        throw std::runtime_error(
            std::string("DELETE failed: ") + curl_easy_strerror(res));
    }

    return response_body;
}
```

---

## 8. Setting Headers

### Headers We Need for Supabase

```cpp
struct curl_slist* build_supabase_headers(
        const std::string& apikey) {
    struct curl_slist* headers = nullptr;

    // Required: API key for authentication
    headers = curl_slist_append(headers,
        ("apikey: " + apikey).c_str());

    // Required: Tell Supabase we're sending JSON
    headers = curl_slist_append(headers,
        "Content-Type: application/json");

    // Optional: Also set Authorization header (same key for anon)
    headers = curl_slist_append(headers,
        ("Authorization: Bearer " + apikey).c_str());

    return headers;  // Remember to curl_slist_free_all() later!
}
```

### Special Supabase Headers

| Header | Value | When to Use |
|--------|-------|-------------|
| `Prefer` | `return=representation` | When you want the result back after INSERT/UPDATE |
| `Prefer` | `resolution=merge-duplicates` | For UPSERT operations |
| `Prefer` | `return=minimal` | When you don't need the result back (faster) |

---

## 9. Reading Responses

### Parsing JSON Responses

Supabase always returns JSON. Combine with nlohmann/json:

```cpp
#include <nlohmann/json.hpp>
using json = nlohmann::json;

// After getting response_body from http_get():
json result = json::parse(response_body);

// PostgREST returns ARRAYS for GET queries
// Even for single results!
if (result.is_array() && !result.empty()) {
    std::string username = result[0]["username"];
    std::string public_key = result[0]["public_key"];
}
```

### ⚠️ Important: PostgREST Returns Arrays

When you GET data, PostgREST ALWAYS returns a JSON array, even for single results:

```json
[
  {
    "username": "alice",
    "node_id": "abc123",
    "public_key": "base64..."
  }
]
```

NOT this:
```json
{
  "username": "alice",
  ...
}
```

Always access `result[0]` for single results, and check `result.empty()` first!

---

## 10. Complete SupabaseClient Class

Here's the full implementation you can reference when building your SupabaseClient:

```cpp
// supabase_client.h
#pragma once
#include <string>
#include <vector>
#include <optional>
#include <nlohmann/json.hpp>

using json = nlohmann::json;

struct UserInfo {
    std::string username;
    std::string node_id;
    std::string public_key;
    std::string last_ip;
    std::string last_seen;
};

struct OfflineMessage {
    std::string id;        // UUID
    std::string from_user;
    std::string to_user;
    std::string ciphertext;
    std::string created_at;
};

class SupabaseClient {
public:
    SupabaseClient(const std::string& project_url,
                   const std::string& api_key);
    ~SupabaseClient();

    // User operations
    bool register_user(const std::string& username,
                       const std::string& node_id,
                       const std::string& public_key,
                       const std::string& ip);

    bool heartbeat(const std::string& username,
                   const std::string& ip);

    std::optional<UserInfo> lookup_user(const std::string& username);

    // Message operations
    bool push_offline_message(const std::string& to_user,
                              const std::string& from_user,
                              const std::string& ciphertext);

    std::vector<OfflineMessage> fetch_offline_messages(
        const std::string& for_user);

    bool delete_messages(const std::vector<std::string>& ids);

private:
    std::string base_url_;  // e.g., "https://abc.supabase.co/rest/v1"
    std::string api_key_;

    // Helper methods
    std::string do_get(const std::string& endpoint);
    std::string do_post(const std::string& endpoint,
                        const std::string& body,
                        const std::string& prefer = "");
    std::string do_patch(const std::string& endpoint,
                         const std::string& body);
    std::string do_delete(const std::string& endpoint);

    static size_t WriteCallback(void* contents, size_t size,
                                size_t nmemb, void* userp);
};
```

### Implementation

```cpp
// supabase_client.cpp
#include "supabase/supabase_client.h"
#include <curl/curl.h>
#include <spdlog/spdlog.h>
#include <stdexcept>

SupabaseClient::SupabaseClient(const std::string& project_url,
                               const std::string& api_key)
    : base_url_(project_url + "/rest/v1")
    , api_key_(api_key)
{
    spdlog::info("SupabaseClient initialized: {}", project_url);
}

SupabaseClient::~SupabaseClient() = default;

size_t SupabaseClient::WriteCallback(void* contents, size_t size,
                                     size_t nmemb, void* userp) {
    size_t total = size * nmemb;
    static_cast<std::string*>(userp)->append(
        static_cast<char*>(contents), total);
    return total;
}

// ---------- HTTP Helpers ----------

std::string SupabaseClient::do_get(const std::string& endpoint) {
    std::string response;
    CURL* curl = curl_easy_init();
    if (!curl) throw std::runtime_error("curl_easy_init failed");

    std::string url = base_url_ + endpoint;
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());

    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers,
        ("apikey: " + api_key_).c_str());
    headers = curl_slist_append(headers,
        ("Authorization: Bearer " + api_key_).c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);

    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);

    CURLcode res = curl_easy_perform(curl);
    long code = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &code);

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    if (res != CURLE_OK) {
        spdlog::error("GET {} failed: {}", endpoint,
                      curl_easy_strerror(res));
        throw std::runtime_error(curl_easy_strerror(res));
    }
    if (code >= 400) {
        spdlog::error("GET {} HTTP {}: {}", endpoint, code, response);
        throw std::runtime_error("HTTP " + std::to_string(code));
    }

    spdlog::debug("GET {} -> {} bytes", endpoint, response.size());
    return response;
}

std::string SupabaseClient::do_post(const std::string& endpoint,
                                    const std::string& body,
                                    const std::string& prefer) {
    std::string response;
    CURL* curl = curl_easy_init();
    if (!curl) throw std::runtime_error("curl_easy_init failed");

    std::string url = base_url_ + endpoint;
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_POST, 1L);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.c_str());

    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers,
        ("apikey: " + api_key_).c_str());
    headers = curl_slist_append(headers,
        ("Authorization: Bearer " + api_key_).c_str());
    headers = curl_slist_append(headers,
        "Content-Type: application/json");
    if (!prefer.empty()) {
        headers = curl_slist_append(headers,
            ("Prefer: " + prefer).c_str());
    }
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);

    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);

    CURLcode res = curl_easy_perform(curl);
    long code = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &code);

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    if (res != CURLE_OK) {
        spdlog::error("POST {} failed: {}", endpoint,
                      curl_easy_strerror(res));
        throw std::runtime_error(curl_easy_strerror(res));
    }

    spdlog::debug("POST {} -> HTTP {}", endpoint, code);
    return response;
}

std::string SupabaseClient::do_patch(const std::string& endpoint,
                                     const std::string& body) {
    std::string response;
    CURL* curl = curl_easy_init();
    if (!curl) throw std::runtime_error("curl_easy_init failed");

    std::string url = base_url_ + endpoint;
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, "PATCH");
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.c_str());

    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers,
        ("apikey: " + api_key_).c_str());
    headers = curl_slist_append(headers,
        ("Authorization: Bearer " + api_key_).c_str());
    headers = curl_slist_append(headers,
        "Content-Type: application/json");
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);

    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);

    CURLcode res = curl_easy_perform(curl);
    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    if (res != CURLE_OK) throw std::runtime_error(curl_easy_strerror(res));
    return response;
}

std::string SupabaseClient::do_delete(const std::string& endpoint) {
    std::string response;
    CURL* curl = curl_easy_init();
    if (!curl) throw std::runtime_error("curl_easy_init failed");

    std::string url = base_url_ + endpoint;
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, "DELETE");

    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers,
        ("apikey: " + api_key_).c_str());
    headers = curl_slist_append(headers,
        ("Authorization: Bearer " + api_key_).c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);

    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);

    CURLcode res = curl_easy_perform(curl);
    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    if (res != CURLE_OK) throw std::runtime_error(curl_easy_strerror(res));
    return response;
}

// ---------- User Operations ----------

bool SupabaseClient::register_user(const std::string& username,
                                   const std::string& node_id,
                                   const std::string& public_key,
                                   const std::string& ip) {
    json body = {
        {"username",   username},
        {"node_id",    node_id},
        {"public_key", public_key},
        {"last_ip",    ip},
        {"last_seen",  "now()"}
    };

    try {
        // UPSERT: insert or update if username exists
        do_post("/users",
                body.dump(),
                "resolution=merge-duplicates,return=minimal");
        spdlog::info("Registered user: {}", username);
        return true;
    } catch (const std::exception& e) {
        spdlog::error("Failed to register {}: {}", username, e.what());
        return false;
    }
}

bool SupabaseClient::heartbeat(const std::string& username,
                               const std::string& ip) {
    json body = {
        {"last_ip",   ip},
        {"last_seen", "now()"}
    };

    try {
        // PATCH users where username = X
        do_patch("/users?username=eq." + username, body.dump());
        spdlog::debug("Heartbeat sent for {}", username);
        return true;
    } catch (const std::exception& e) {
        spdlog::warn("Heartbeat failed: {}", e.what());
        return false;
    }
}

std::optional<UserInfo> SupabaseClient::lookup_user(
        const std::string& username) {
    try {
        std::string resp = do_get(
            "/users?username=eq." + username + "&limit=1");
        json arr = json::parse(resp);

        if (arr.empty()) {
            spdlog::info("User {} not found", username);
            return std::nullopt;
        }

        UserInfo info;
        info.username   = arr[0].value("username", "");
        info.node_id    = arr[0].value("node_id", "");
        info.public_key = arr[0].value("public_key", "");
        info.last_ip    = arr[0].value("last_ip", "");
        info.last_seen  = arr[0].value("last_seen", "");

        spdlog::info("Found user {}: ip={}", username, info.last_ip);
        return info;
    } catch (const std::exception& e) {
        spdlog::error("Lookup failed for {}: {}", username, e.what());
        return std::nullopt;
    }
}

// ---------- Message Operations ----------

bool SupabaseClient::push_offline_message(
        const std::string& to_user,
        const std::string& from_user,
        const std::string& ciphertext) {
    json body = {
        {"to_user",    to_user},
        {"from_user",  from_user},
        {"ciphertext", ciphertext}
    };

    try {
        do_post("/messages", body.dump(), "return=minimal");
        spdlog::info("Pushed offline message to {}", to_user);
        return true;
    } catch (const std::exception& e) {
        spdlog::error("Push message failed: {}", e.what());
        return false;
    }
}

std::vector<OfflineMessage> SupabaseClient::fetch_offline_messages(
        const std::string& for_user) {
    std::vector<OfflineMessage> messages;

    try {
        std::string resp = do_get(
            "/messages?to_user=eq." + for_user
            + "&order=created_at.asc");
        json arr = json::parse(resp);

        for (auto& item : arr) {
            OfflineMessage msg;
            msg.id         = item.value("id", "");
            msg.from_user  = item.value("from_user", "");
            msg.to_user    = item.value("to_user", "");
            msg.ciphertext = item.value("ciphertext", "");
            msg.created_at = item.value("created_at", "");
            messages.push_back(std::move(msg));
        }

        spdlog::info("Fetched {} offline messages for {}",
                     messages.size(), for_user);
    } catch (const std::exception& e) {
        spdlog::error("Fetch messages failed: {}", e.what());
    }

    return messages;
}

bool SupabaseClient::delete_messages(
        const std::vector<std::string>& ids) {
    // Delete each message by ID
    // PostgREST: DELETE /messages?id=in.(uuid1,uuid2,...)
    if (ids.empty()) return true;

    std::string id_list;
    for (size_t i = 0; i < ids.size(); ++i) {
        if (i > 0) id_list += ",";
        id_list += ids[i];
    }

    try {
        do_delete("/messages?id=in.(" + id_list + ")");
        spdlog::info("Deleted {} messages", ids.size());
        return true;
    } catch (const std::exception& e) {
        spdlog::error("Delete messages failed: {}", e.what());
        return false;
    }
}
```

---

## 11. PostgREST Query Syntax

PostgREST uses URL query parameters to filter data. Here's a cheat sheet:

### Comparison Operators

| Operator | Meaning | Example |
|----------|---------|---------|
| `eq` | Equal | `?username=eq.alice` |
| `neq` | Not equal | `?status=neq.offline` |
| `gt` | Greater than | `?last_seen=gt.2024-01-01` |
| `lt` | Less than | `?last_seen=lt.2024-06-01` |
| `gte` | Greater or equal | `?age=gte.18` |
| `lte` | Less or equal | `?age=lte.65` |
| `like` | Pattern match | `?username=like.*alice*` |
| `in` | In list | `?id=in.(uuid1,uuid2,uuid3)` |
| `is` | Is null/true/false | `?last_ip=is.null` |

### Ordering

```
?order=created_at.desc          # Newest first
?order=username.asc             # Alphabetical
?order=created_at.desc&limit=10 # Last 10
```

### Limiting Results

```
?limit=10           # Maximum 10 results
?offset=20          # Skip first 20
?limit=10&offset=20 # Pagination: page 3 (items 20-29)
```

### Selecting Columns

```
?select=username,public_key     # Only these columns
?select=*                       # All columns (default)
```

### Combining Filters

```
?to_user=eq.alice&order=created_at.asc&limit=50
```

---

## 12. Error Handling

### HTTP Status Codes from Supabase

| Code | Meaning | What to Do |
|------|---------|------------|
| 200 | OK (GET/PATCH/DELETE) | Success! |
| 201 | Created (POST) | Row inserted |
| 204 | No Content | Success, no body |
| 400 | Bad Request | Check your query syntax |
| 401 | Unauthorized | Wrong API key |
| 404 | Not Found | Wrong URL or table name |
| 409 | Conflict | Duplicate key violation |
| 429 | Too Many Requests | Rate limited, slow down |
| 500 | Server Error | Supabase issue, retry later |

### CURLcode Error Codes

| Code | Name | Meaning |
|------|------|---------|
| 0 | CURLE_OK | Success |
| 6 | CURLE_COULDNT_RESOLVE_HOST | DNS failure, check URL |
| 7 | CURLE_COULDNT_CONNECT | Server unreachable |
| 28 | CURLE_OPERATION_TIMEDOUT | Request timed out |
| 35 | CURLE_SSL_CONNECT_ERROR | HTTPS/SSL error |

### Setting Timeouts

```cpp
// Timeout after 10 seconds
curl_easy_setopt(curl, CURLOPT_TIMEOUT, 10L);

// Connection timeout (separate from transfer)
curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 5L);
```

---

## 13. Common Mistakes

### ❌ Forgetting to free curl resources

```cpp
// BAD — memory leak!
CURL* curl = curl_easy_init();
curl_easy_perform(curl);
// forgot curl_easy_cleanup(curl)!

// GOOD — always clean up
CURL* curl = curl_easy_init();
// ... do stuff ...
curl_slist_free_all(headers);
curl_easy_cleanup(curl);
```

### ❌ Not URL-encoding special characters

```cpp
// BAD — space in username breaks URL
std::string url = "/users?username=eq.John Doe";

// GOOD — URL-encode the value
char* encoded = curl_easy_escape(curl, "John Doe", 0);
std::string url = "/users?username=eq." + std::string(encoded);
curl_free(encoded);
```

### ❌ Forgetting the apikey header

Supabase will return 401 Unauthorized without the apikey header.

### ❌ Using service_role key in client code

The `service_role` key bypasses Row Level Security. Only use the `anon` key.

### ❌ Not checking if array is empty

```cpp
// BAD — crashes if no results
json result = json::parse(response);
std::string name = result[0]["username"]; // CRASH if empty!

// GOOD — check first
json result = json::parse(response);
if (!result.empty()) {
    std::string name = result[0]["username"];
}
```

---

## 14. Tips & Tricks

### Enable Verbose Mode for Debugging

```cpp
curl_easy_setopt(curl, CURLOPT_VERBOSE, 1L);
// This prints ALL HTTP headers and data to stderr
// Extremely useful when debugging!
```

### Test with curl CLI First

Before writing C++ code, test your queries with the `curl` command:

```bash
# Lookup a user
curl "https://YOUR_PROJECT.supabase.co/rest/v1/users?username=eq.alice" \
  -H "apikey: YOUR_ANON_KEY"

# Insert a user
curl -X POST "https://YOUR_PROJECT.supabase.co/rest/v1/users" \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{"username":"alice","node_id":"abc","public_key":"xyz"}'

# Fetch messages for a user
curl "https://YOUR_PROJECT.supabase.co/rest/v1/messages?to_user=eq.alice&order=created_at.asc" \
  -H "apikey: YOUR_ANON_KEY"

# Delete a message by ID
curl -X DELETE "https://YOUR_PROJECT.supabase.co/rest/v1/messages?id=eq.SOME_UUID" \
  -H "apikey: YOUR_ANON_KEY"
```

### Use a Helper Class to Avoid Repetition

The SupabaseClient class above wraps all the boilerplate so you only write:

```cpp
auto user = client.lookup_user("alice");
if (user) {
    std::cout << "Found: " << user->last_ip << std::endl;
}
```

Instead of 30 lines of curl setup every time.

### Connection Reuse

For better performance, reuse curl handles:

```cpp
// Create once, reuse for multiple requests
CURL* curl = curl_easy_init();

// Request 1
curl_easy_setopt(curl, CURLOPT_URL, "...");
curl_easy_perform(curl);

// Request 2 — reuses the TCP connection!
curl_easy_setopt(curl, CURLOPT_URL, "...");
curl_easy_perform(curl);

// Clean up once when done
curl_easy_cleanup(curl);
```

---

## Quick Reference

```
┌─────────────────────────────────────────────┐
│           Supabase Request Flow             │
│                                             │
│  C++ Code                                   │
│    │                                        │
│    ▼                                        │
│  curl_easy_init()                           │
│    │                                        │
│    ▼                                        │
│  Set URL: base_url + "/users?username=eq.X" │
│  Set Headers: apikey, Content-Type          │
│  Set Body: json.dump() (for POST/PATCH)     │
│    │                                        │
│    ▼                                        │
│  curl_easy_perform() ──► HTTPS ──► Supabase │
│    │                            PostgREST   │
│    ▼                               │        │
│  WriteCallback fills response      ▼        │
│    │                          PostgreSQL     │
│    ▼                                        │
│  json::parse(response)                      │
│    │                                        │
│    ▼                                        │
│  Use data in your app                       │
│                                             │
│  curl_slist_free_all(headers)               │
│  curl_easy_cleanup(curl)                    │
└─────────────────────────────────────────────┘
```
