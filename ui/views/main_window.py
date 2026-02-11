"""
MainWindow — Primary application window.

Layout:
  ┌──────────┬─────────────────────────────┐
  │ Friends  │  Chat area                  │
  │ list     │                             │
  │          │                             │
  │          ├─────────────────────────────│
  │          │  Message input + Send btn   │
  └──────────┴─────────────────────────────┘
"""

from PySide6.QtWidgets import (
    QMainWindow, QWidget, QHBoxLayout, QVBoxLayout,
    QListWidget, QTextEdit, QLineEdit, QPushButton, QLabel,
)


class MainWindow(QMainWindow):
    """Top-level window that assembles all chat UI components."""

    def __init__(self):
        super().__init__()
        self.setWindowTitle("Secure P2P Chat")
        self.resize(900, 600)

        # ── Central widget ───────────────────────────────────────────
        central = QWidget()
        self.setCentralWidget(central)
        layout = QHBoxLayout(central)

        # ── Left panel: friend list ──────────────────────────────────
        left = QVBoxLayout()
        left.addWidget(QLabel("Friends"))
        self.friend_list = QListWidget()
        left.addWidget(self.friend_list)

        self.add_friend_input = QLineEdit()
        self.add_friend_input.setPlaceholderText("Add friend by username…")
        left.addWidget(self.add_friend_input)

        self.add_friend_btn = QPushButton("Add Friend")
        left.addWidget(self.add_friend_btn)
        layout.addLayout(left, 1)

        # ── Right panel: chat ────────────────────────────────────────
        right = QVBoxLayout()
        self.chat_display = QTextEdit()
        self.chat_display.setReadOnly(True)
        right.addWidget(self.chat_display, 1)

        msg_row = QHBoxLayout()
        self.message_input = QLineEdit()
        self.message_input.setPlaceholderText("Type a message…")
        msg_row.addWidget(self.message_input)

        self.send_btn = QPushButton("Send")
        msg_row.addWidget(self.send_btn)
        right.addLayout(msg_row)
        layout.addLayout(right, 3)

        # ── Signals ─────────────────────────────────────────────────
        self.send_btn.clicked.connect(self._on_send)
        self.add_friend_btn.clicked.connect(self._on_add_friend)
        self.friend_list.currentItemChanged.connect(self._on_friend_selected)

    # ── Slots (to be wired to BackendService) ────────────────────────

    def _on_send(self):
        text = self.message_input.text().strip()
        if not text:
            return
        # TODO: call BackendService.send_message(current_friend, text)
        self.message_input.clear()

    def _on_add_friend(self):
        username = self.add_friend_input.text().strip()
        if not username:
            return
        # TODO: call BackendService.add_friend(username)
        self.add_friend_input.clear()

    def _on_friend_selected(self, current, previous):
        if current is None:
            return
        # TODO: load chat history for current.text()
        pass
