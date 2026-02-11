"""
BackendService — HTTP client that talks to the C++ backend on localhost.

All communication with the network / crypto layer goes through this service.
The UI never touches the network directly.
"""

import requests
from typing import Optional


class BackendService:
    """Thin wrapper around the C++ backend's local REST API."""

    def __init__(self, base_url: str = "http://127.0.0.1:8080"):
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()

    # ── Health ────────────────────────────────────────────────────────

    def status(self) -> dict:
        """GET /status — check if the backend is running."""
        r = self.session.get(f"{self.base_url}/status")
        r.raise_for_status()
        return r.json()

    # ── Friends ───────────────────────────────────────────────────────

    def list_friends(self) -> list[dict]:
        """GET /friends — return all friends."""
        r = self.session.get(f"{self.base_url}/friends")
        r.raise_for_status()
        return r.json()

    def add_friend(self, username: str) -> dict:
        """POST /friends — add a friend by username."""
        r = self.session.post(
            f"{self.base_url}/friends",
            json={"username": username},
        )
        r.raise_for_status()
        return r.json()

    # ── Messages ──────────────────────────────────────────────────────

    def get_messages(self, peer: str, limit: int = 50) -> list[dict]:
        """GET /messages?peer=<user>&limit=<n> — chat history."""
        r = self.session.get(
            f"{self.base_url}/messages",
            params={"peer": peer, "limit": limit},
        )
        r.raise_for_status()
        return r.json()

    def send_message(self, to_user: str, text: str) -> dict:
        """POST /messages — send a message to a peer."""
        r = self.session.post(
            f"{self.base_url}/messages",
            json={"to": to_user, "text": text},
        )
        r.raise_for_status()
        return r.json()
