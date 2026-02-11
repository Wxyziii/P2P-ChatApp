# 02 — Backend Service & HTTP Client Guide

> **Audience**: Beginners learning Python HTTP clients.
> This guide teaches you how to build the Python service that communicates with the C++ backend.

---

## Table of Contents

1. [What is the BackendService?](#1-what-is-the-backendservice)
2. [Python requests Library](#2-python-requests-library)
3. [GET Requests](#3-get-requests)
4. [POST Requests](#4-post-requests)
5. [DELETE Requests](#5-delete-requests)
6. [Error Handling](#6-error-handling)
7. [Complete BackendService Class](#7-complete-backendservice-class)
8. [Retry Logic](#8-retry-logic)
9. [Mock Backend for Testing](#9-mock-backend-for-testing)
10. [Common Mistakes](#10-common-mistakes)
11. [Tips & Tricks](#11-tips--tricks)

---

## 1. What is the BackendService?

The BackendService is a Python class that talks to the C++ backend over HTTP. It's the bridge between the UI and the backend.

```
┌───────────┐     HTTP (localhost:8080)     ┌───────────┐
│ Python UI │ ◄──────────────────────────► │ C++ Backend│
│ (PySide6) │     BackendService            │  (ASIO)   │
└───────────┘                               └───────────┘
```

**All communication is via localhost** — the Python UI and C++ backend run on the same machine.

---

## 2. Python requests Library

### Install

```bash
pip install requests
```

### Basic Concepts

```python
import requests

# The URL structure
# http://localhost:8080/api/friends
# ^^^^   ^^^^^^^^^  ^^^^ ^^^^^^^^^^^
# scheme  host      port  path
```

---

## 3. GET Requests

### Simple GET

```python
import requests

# Get the backend status
response = requests.get("http://localhost:8080/api/status")

# Check if successful
print(response.status_code)  # 200 = OK

# Get JSON response
data = response.json()
print(data)
# {"status": "online", "username": "alice", "uptime": 3600}
```

### GET with Query Parameters

```python
# Get messages for a specific friend
response = requests.get(
    "http://localhost:8080/api/messages",
    params={"peer": "bob", "limit": 50}
)
# This sends: GET /api/messages?peer=bob&limit=50

messages = response.json()
for msg in messages.get("messages", []):
    print(f"{msg['direction']}: {msg['content']}")
```

### GET with Timeout

```python
try:
    response = requests.get(
        "http://localhost:8080/api/status",
        timeout=5  # Wait max 5 seconds
    )
except requests.Timeout:
    print("Backend not responding!")
```

---

## 4. POST Requests

### POST with JSON Body

```python
# Send a message
response = requests.post(
    "http://localhost:8080/api/messages",
    json={  # Automatically sets Content-Type: application/json
        "to": "bob",
        "content": "Hello Bob!"
    }
)

if response.status_code == 200:
    result = response.json()
    print(f"Message sent! ID: {result.get('message_id')}")
else:
    print(f"Error: {response.status_code}")
```

### POST to Add a Friend

```python
response = requests.post(
    "http://localhost:8080/api/friends",
    json={"username": "bob"}
)

if response.status_code == 200:
    data = response.json()
    print(f"Added {data['username']}, online: {data.get('online')}")
elif response.status_code == 404:
    print("User not found on network!")
elif response.status_code == 409:
    print("Already in your friends list!")
```

---

## 5. DELETE Requests

```python
# Remove a friend
response = requests.delete(
    "http://localhost:8080/api/friends/bob"
)

if response.status_code == 200:
    print("Friend removed")
elif response.status_code == 404:
    print("Friend not found")
```

---

## 6. Error Handling

### The Three Types of Errors

```python
import requests

def safe_request():
    try:
        response = requests.get(
            "http://localhost:8080/api/status",
            timeout=5
        )

        # 1. HTTP error (4xx, 5xx)
        response.raise_for_status()

        return response.json()

    except requests.ConnectionError:
        # 2. Backend is not running or unreachable
        print("Cannot connect to backend!")
        return None

    except requests.Timeout:
        # 3. Backend is too slow
        print("Backend timed out!")
        return None

    except requests.HTTPError as e:
        # HTTP error (4xx or 5xx)
        print(f"HTTP error: {e}")
        return None

    except requests.JSONDecodeError:
        # Response is not valid JSON
        print("Invalid JSON from backend!")
        return None
```

### Checking Status Codes

```python
response = requests.get("http://localhost:8080/api/friends")

if response.ok:  # True for 2xx status codes
    data = response.json()
elif response.status_code == 401:
    print("Not authenticated!")
elif response.status_code == 404:
    print("Not found!")
elif response.status_code >= 500:
    print("Backend error!")
```

---

## 7. Complete BackendService Class

Here's the full implementation for our project:

```python
"""
backend_service.py — HTTP client for the C++ backend

This class handles ALL communication between the Python UI
and the C++ backend. The UI should NEVER make HTTP requests
directly; always use this class.
"""

import requests
import logging
from typing import Optional

logger = logging.getLogger(__name__)


class BackendService:
    """Communicates with the C++ backend via localhost HTTP API."""

    def __init__(self, host: str = "localhost", port: int = 8080):
        self.base_url = f"http://{host}:{port}/api"
        self.timeout = 5  # seconds
        logger.info("BackendService initialized: %s", self.base_url)

    # ---- Health ----

    def status(self) -> Optional[dict]:
        """Get backend status. Returns None if backend is down."""
        try:
            resp = requests.get(
                f"{self.base_url}/status",
                timeout=self.timeout
            )
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as e:
            logger.error("Status check failed: %s", e)
            return None

    def is_online(self) -> bool:
        """Quick check: is the backend running?"""
        return self.status() is not None

    # ---- Friends ----

    def list_friends(self) -> list:
        """Get list of all friends. Returns empty list on error."""
        try:
            resp = requests.get(
                f"{self.base_url}/friends",
                timeout=self.timeout
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("friends", [])
        except requests.RequestException as e:
            logger.error("list_friends failed: %s", e)
            return []

    def add_friend(self, username: str) -> dict:
        """
        Add a friend by username.
        Returns: {"success": True, "username": "...", "online": True/False}
        Or: {"success": False, "error": "..."}
        """
        try:
            resp = requests.post(
                f"{self.base_url}/friends",
                json={"username": username},
                timeout=self.timeout
            )
            if resp.ok:
                result = resp.json()
                result["success"] = True
                return result
            else:
                return {
                    "success": False,
                    "error": resp.json().get("error", f"HTTP {resp.status_code}")
                }
        except requests.RequestException as e:
            logger.error("add_friend failed: %s", e)
            return {"success": False, "error": str(e)}

    def remove_friend(self, username: str) -> bool:
        """Remove a friend. Returns True if successful."""
        try:
            resp = requests.delete(
                f"{self.base_url}/friends/{username}",
                timeout=self.timeout
            )
            return resp.ok
        except requests.RequestException as e:
            logger.error("remove_friend failed: %s", e)
            return False

    # ---- Messages ----

    def get_messages(self, peer: str, limit: int = 50) -> list:
        """
        Get chat messages with a specific friend.
        Returns list of message dicts.
        """
        try:
            resp = requests.get(
                f"{self.base_url}/messages",
                params={"peer": peer, "limit": limit},
                timeout=self.timeout
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("messages", [])
        except requests.RequestException as e:
            logger.error("get_messages failed: %s", e)
            return []

    def send_message(self, to: str, content: str) -> dict:
        """
        Send a message to a friend.
        Returns: {"success": True, "message_id": "...", "delivered": True/False}
        Or: {"success": False, "error": "..."}
        """
        try:
            resp = requests.post(
                f"{self.base_url}/messages",
                json={"to": to, "content": content},
                timeout=self.timeout
            )
            if resp.ok:
                result = resp.json()
                result["success"] = True
                return result
            else:
                return {
                    "success": False,
                    "error": resp.json().get("error", f"HTTP {resp.status_code}")
                }
        except requests.RequestException as e:
            logger.error("send_message failed: %s", e)
            return {"success": False, "error": str(e)}

    def delete_message(self, message_id: str) -> bool:
        """Delete a message by ID. Returns True if successful."""
        try:
            resp = requests.delete(
                f"{self.base_url}/messages/{message_id}",
                timeout=self.timeout
            )
            return resp.ok
        except requests.RequestException as e:
            logger.error("delete_message failed: %s", e)
            return False


# ---- Usage Example ----

if __name__ == "__main__":
    logging.basicConfig(level=logging.DEBUG)

    svc = BackendService()

    # Check if backend is running
    if not svc.is_online():
        print("Backend is not running! Start it first.")
        exit(1)

    # List friends
    friends = svc.list_friends()
    print(f"Friends: {[f['username'] for f in friends]}")

    # Send a message
    result = svc.send_message("bob", "Hello from Python!")
    if result["success"]:
        print(f"Sent! ID: {result['message_id']}")
    else:
        print(f"Failed: {result['error']}")
```

---

## 8. Retry Logic

```python
import time
import requests

def request_with_retry(method, url, max_retries=3, **kwargs):
    """Make an HTTP request with exponential backoff retry."""
    kwargs.setdefault("timeout", 5)

    for attempt in range(max_retries):
        try:
            response = requests.request(method, url, **kwargs)
            return response
        except requests.ConnectionError:
            if attempt < max_retries - 1:
                wait = 2 ** attempt  # 1s, 2s, 4s
                logger.warning(
                    "Connection failed, retry %d/%d in %ds",
                    attempt + 1, max_retries, wait)
                time.sleep(wait)
            else:
                raise

# Usage:
resp = request_with_retry("GET", "http://localhost:8080/api/status")
```

---

## 9. Mock Backend for Testing

Test your UI without the C++ backend running:

```python
"""
mock_backend.py — Fake backend for UI testing

Run this instead of the C++ backend during UI development:
  python mock_backend.py

It responds to all the same endpoints with fake data.
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import json

FRIENDS = [
    {"username": "alice", "online": True, "last_seen": "2024-01-15T10:00:00"},
    {"username": "bob", "online": False, "last_seen": "2024-01-14T20:00:00"},
]

MESSAGES = {
    "alice": [
        {"id": "1", "peer": "alice", "direction": "received",
         "content": "Hey!", "timestamp": "2024-01-15T10:00:00"},
        {"id": "2", "peer": "alice", "direction": "sent",
         "content": "Hi Alice!", "timestamp": "2024-01-15T10:01:00"},
    ],
    "bob": [
        {"id": "3", "peer": "bob", "direction": "sent",
         "content": "Are you there?", "timestamp": "2024-01-14T19:00:00"},
    ]
}


class MockHandler(BaseHTTPRequestHandler):
    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_GET(self):
        if self.path == "/api/status":
            self._send_json({
                "status": "online",
                "username": "me",
                "uptime": 3600
            })
        elif self.path == "/api/friends":
            self._send_json({"friends": FRIENDS})
        elif self.path.startswith("/api/messages"):
            # Parse peer from query string
            from urllib.parse import urlparse, parse_qs
            params = parse_qs(urlparse(self.path).query)
            peer = params.get("peer", [""])[0]
            msgs = MESSAGES.get(peer, [])
            self._send_json({"messages": msgs})
        else:
            self._send_json({"error": "Not found"}, 404)

    def do_POST(self):
        content_len = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(content_len)) if content_len else {}

        if self.path == "/api/friends":
            self._send_json({
                "username": body.get("username", "unknown"),
                "online": True
            })
        elif self.path == "/api/messages":
            self._send_json({
                "message_id": "mock-uuid-123",
                "delivered": True
            })
        else:
            self._send_json({"error": "Not found"}, 404)

    def do_DELETE(self):
        self._send_json({"ok": True})

    def log_message(self, format, *args):
        print(f"[MOCK] {args[0]}")


if __name__ == "__main__":
    server = HTTPServer(("localhost", 8080), MockHandler)
    print("Mock backend running on http://localhost:8080")
    print("Press Ctrl+C to stop")
    server.serve_forever()
```

### Using the Mock

```bash
# Terminal 1: Run mock backend
python mock_backend.py

# Terminal 2: Run UI
python ui/main.py
```

This lets the Python developer work on the UI while the C++ developer works on the backend.

---

## 10. Common Mistakes

### ❌ Not Handling Connection Errors

```python
# BAD — crashes if backend is down!
response = requests.get("http://localhost:8080/api/status")

# GOOD — handle the error
try:
    response = requests.get("http://localhost:8080/api/status", timeout=5)
except requests.ConnectionError:
    print("Backend is not running!")
```

### ❌ Forgetting Timeout

```python
# BAD — hangs forever if backend is stuck!
response = requests.get("http://localhost:8080/api/status")

# GOOD — always set a timeout
response = requests.get("http://localhost:8080/api/status", timeout=5)
```

### ❌ Not Checking Response Status

```python
# BAD — assumes success
data = requests.post(url, json=body).json()

# GOOD — check first
resp = requests.post(url, json=body, timeout=5)
if resp.ok:
    data = resp.json()
else:
    print(f"Error: {resp.status_code}")
```

### ❌ Calling Backend from UI Thread

```python
# BAD — freezes UI while waiting for response!
def on_send_clicked(self):
    result = self.backend.send_message("bob", "Hello")  # BLOCKS UI!

# GOOD — use a worker thread (see 03-threading-async.md)
```

---

## 11. Tips & Tricks

### Tip 1: Use a Session for Connection Reuse

```python
# Reuses TCP connections (faster!)
session = requests.Session()
session.headers.update({"Accept": "application/json"})

response = session.get("http://localhost:8080/api/status")
response = session.get("http://localhost:8080/api/friends")
```

### Tip 2: Log All Requests During Development

```python
import logging
logging.basicConfig(level=logging.DEBUG)

# Now requests will print every HTTP call:
# DEBUG:urllib3.connectionpool:Starting new HTTP connection (1): localhost:8080
# DEBUG:urllib3.connectionpool:http://localhost:8080 "GET /api/status HTTP/1.1" 200
```

### Tip 3: Pretty Print JSON Responses

```python
import json
response = requests.get("http://localhost:8080/api/friends")
print(json.dumps(response.json(), indent=2))
```

---

## Learning Resources

- [requests Documentation](https://docs.python-requests.org/) — Official docs
- [Real Python: requests Tutorial](https://realpython.com/python-requests/) — Beginner guide
- [HTTP Status Codes](https://httpstatuses.com/) — What each code means
