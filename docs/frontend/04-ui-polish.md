# 04 — UI Polish & Advanced Qt Techniques

> **Audience**: Beginners ready to make their chat app look professional.
> This guide covers system tray, themes, chat bubbles, notifications, and more.

---

## Table of Contents

1. [System Tray Icon](#1-system-tray-icon)
2. [Dark Theme](#2-dark-theme)
3. [Chat Bubbles](#3-chat-bubbles)
4. [Online/Offline Indicators](#4-onlineoffline-indicators)
5. [Settings Dialog](#5-settings-dialog)
6. [Keyboard Shortcuts](#6-keyboard-shortcuts)
7. [Desktop Notifications](#7-desktop-notifications)
8. [Window State Persistence](#8-window-state-persistence)
9. [Loading Indicators](#9-loading-indicators)
10. [Tips & Tricks](#10-tips--tricks)

---

## 1. System Tray Icon

Minimize to system tray instead of closing, and show notifications:

```python
from PySide6.QtWidgets import QSystemTrayIcon, QMenu
from PySide6.QtGui import QIcon, QAction

class MainWindow(QMainWindow):
    def setup_tray(self):
        # Create tray icon
        self.tray = QSystemTrayIcon(self)
        self.tray.setIcon(QIcon("assets/icon.png"))
        self.tray.setToolTip("P2P Chat")

        # Tray menu
        tray_menu = QMenu()
        show_action = QAction("Show", self)
        show_action.triggered.connect(self.show_and_activate)
        tray_menu.addAction(show_action)

        quit_action = QAction("Quit", self)
        quit_action.triggered.connect(self.quit_app)
        tray_menu.addAction(quit_action)

        self.tray.setContextMenu(tray_menu)
        self.tray.activated.connect(self.on_tray_click)
        self.tray.show()

    def closeEvent(self, event):
        """Minimize to tray instead of closing."""
        if self.tray.isVisible():
            self.hide()
            self.tray.showMessage(
                "P2P Chat",
                "Running in background. Click to open.",
                QSystemTrayIcon.Information,
                2000
            )
            event.ignore()  # Don't actually close!
        else:
            event.accept()

    def on_tray_click(self, reason):
        if reason == QSystemTrayIcon.DoubleClick:
            self.show_and_activate()

    def show_and_activate(self):
        self.show()
        self.raise_()
        self.activateWindow()

    def quit_app(self):
        """Actually quit the application."""
        self.tray.hide()
        from PySide6.QtWidgets import QApplication
        QApplication.quit()

    def notify_new_message(self, from_user, preview):
        """Show tray notification for new message."""
        if not self.isVisible() or self.isMinimized():
            self.tray.showMessage(
                f"Message from {from_user}",
                preview[:100],
                QSystemTrayIcon.Information,
                5000
            )
```

---

## 2. Dark Theme

### Complete Dark Theme Implementation

```python
class ThemeManager:
    """Manages light/dark themes for the application."""

    DARK = """
    QWidget {
        background-color: #1e1e2e;
        color: #cdd6f4;
        font-family: "Segoe UI", "SF Pro", Arial;
        font-size: 13px;
    }
    QMainWindow { background-color: #1e1e2e; }

    QTextEdit, QLineEdit {
        background-color: #313244;
        color: #cdd6f4;
        border: 1px solid #45475a;
        border-radius: 6px;
        padding: 6px;
    }
    QTextEdit:focus, QLineEdit:focus {
        border-color: #89b4fa;
    }

    QListWidget {
        background-color: #181825;
        border: none;
        outline: none;
    }
    QListWidget::item {
        padding: 10px 8px;
        border-bottom: 1px solid #313244;
    }
    QListWidget::item:selected {
        background-color: #313244;
        color: #89b4fa;
    }
    QListWidget::item:hover { background-color: #282838; }

    QPushButton {
        background-color: #89b4fa;
        color: #1e1e2e;
        border: none;
        padding: 8px 16px;
        border-radius: 6px;
        font-weight: bold;
    }
    QPushButton:hover { background-color: #74c7ec; }
    QPushButton:pressed { background-color: #585b70; }
    QPushButton:disabled {
        background-color: #45475a;
        color: #6c7086;
    }

    QMenuBar { background-color: #181825; }
    QMenuBar::item:selected { background-color: #313244; }
    QMenu {
        background-color: #1e1e2e;
        border: 1px solid #45475a;
    }
    QMenu::item:selected { background-color: #313244; }

    QStatusBar { background-color: #181825; color: #6c7086; }

    QScrollBar:vertical {
        background-color: transparent;
        width: 8px;
    }
    QScrollBar::handle:vertical {
        background-color: #45475a;
        border-radius: 4px;
        min-height: 20px;
    }
    QScrollBar::add-line, QScrollBar::sub-line { height: 0; }

    QSplitter::handle { background-color: #313244; width: 2px; }
    """

    LIGHT = """
    QWidget {
        background-color: #ffffff;
        color: #1e1e2e;
        font-family: "Segoe UI", "SF Pro", Arial;
        font-size: 13px;
    }
    QTextEdit, QLineEdit {
        background-color: #f5f5f5;
        border: 1px solid #ddd;
        border-radius: 6px;
        padding: 6px;
    }
    QListWidget { background-color: #fafafa; border: none; }
    QListWidget::item {
        padding: 10px 8px;
        border-bottom: 1px solid #eee;
    }
    QListWidget::item:selected {
        background-color: #e3f2fd;
        color: #1976d2;
    }
    QPushButton {
        background-color: #1976d2;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 6px;
    }
    QPushButton:hover { background-color: #1565c0; }
    """

    @staticmethod
    def apply(app, theme="dark"):
        if theme == "dark":
            app.setStyleSheet(ThemeManager.DARK)
        else:
            app.setStyleSheet(ThemeManager.LIGHT)
```

---

## 3. Chat Bubbles

### HTML-Based Chat Bubbles in QTextEdit

```python
class ChatDisplay(QTextEdit):
    """Custom chat display with message bubbles."""

    def __init__(self):
        super().__init__()
        self.setReadOnly(True)
        self.document().setDefaultStyleSheet("""
            .sent {
                background-color: #89b4fa;
                color: #1e1e2e;
                border-radius: 12px;
                padding: 8px 12px;
                margin: 4px 8px 4px 80px;
                text-align: right;
            }
            .received {
                background-color: #313244;
                color: #cdd6f4;
                border-radius: 12px;
                padding: 8px 12px;
                margin: 4px 80px 4px 8px;
            }
            .timestamp {
                color: #6c7086;
                font-size: 10px;
            }
            .sender {
                font-weight: bold;
                font-size: 12px;
            }
        """)

    def add_sent_message(self, content, timestamp=""):
        html = f"""
        <div class="sent">
            <div>{self._escape(content)}</div>
            <div class="timestamp">{timestamp} ✓</div>
        </div><br>
        """
        self.append(html)
        self._scroll_to_bottom()

    def add_received_message(self, from_user, content, timestamp=""):
        html = f"""
        <div class="received">
            <div class="sender">{self._escape(from_user)}</div>
            <div>{self._escape(content)}</div>
            <div class="timestamp">{timestamp}</div>
        </div><br>
        """
        self.append(html)
        self._scroll_to_bottom()

    def add_system_message(self, text):
        html = f"""
        <div style="text-align: center; color: #6c7086;
                    font-style: italic; margin: 8px;">
            {self._escape(text)}
        </div>
        """
        self.append(html)

    def _scroll_to_bottom(self):
        sb = self.verticalScrollBar()
        sb.setValue(sb.maximum())

    @staticmethod
    def _escape(text):
        """Escape HTML special characters."""
        return (text
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace('"', "&quot;"))
```

---

## 4. Online/Offline Indicators

```python
from PySide6.QtWidgets import QListWidget, QListWidgetItem
from PySide6.QtGui import QColor, QBrush, QFont

class FriendListWidget(QListWidget):
    """Friend list with online/offline indicators."""

    def update_friends(self, friends):
        """Update the friend list with status indicators."""
        current = self.currentItem()
        current_name = current.text() if current else None

        self.clear()
        for f in friends:
            username = f["username"]
            online = f.get("online", False)

            # Add status dot to name
            display = f"● {username}" if online else f"○ {username}"
            item = QListWidgetItem(display)

            # Color the status dot
            if online:
                item.setForeground(QBrush(QColor("#a6e3a1")))  # Green
            else:
                item.setForeground(QBrush(QColor("#6c7086")))  # Grey

            # Store username without dot for later use
            item.setData(256, username)
            self.addItem(item)

            # Restore selection
            if username == current_name:
                self.setCurrentItem(item)

    def get_selected_username(self):
        """Get the actual username (without status dot)."""
        item = self.currentItem()
        if item:
            return item.data(256) or item.text()
        return None
```

---

## 5. Settings Dialog

```python
from PySide6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QFormLayout,
    QLineEdit, QSpinBox, QComboBox, QPushButton,
    QGroupBox, QLabel
)
import json
import os


class SettingsDialog(QDialog):
    """Settings dialog for configuring the application."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Settings")
        self.setMinimumWidth(450)

        layout = QVBoxLayout(self)

        # --- User Settings ---
        user_group = QGroupBox("User")
        user_form = QFormLayout()

        self.username_input = QLineEdit()
        self.username_input.setPlaceholderText("Your display name")
        user_form.addRow("Username:", self.username_input)

        user_group.setLayout(user_form)
        layout.addWidget(user_group)

        # --- Backend Settings ---
        backend_group = QGroupBox("Backend")
        backend_form = QFormLayout()

        self.port_input = QSpinBox()
        self.port_input.setRange(1024, 65535)
        self.port_input.setValue(8080)
        backend_form.addRow("Port:", self.port_input)

        self.backend_host = QLineEdit("localhost")
        backend_form.addRow("Host:", self.backend_host)

        backend_group.setLayout(backend_form)
        layout.addWidget(backend_group)

        # --- Supabase Settings ---
        supa_group = QGroupBox("Supabase")
        supa_form = QFormLayout()

        self.supa_url = QLineEdit()
        self.supa_url.setPlaceholderText("https://xxx.supabase.co")
        supa_form.addRow("URL:", self.supa_url)

        self.supa_key = QLineEdit()
        self.supa_key.setPlaceholderText("your-anon-key")
        self.supa_key.setEchoMode(QLineEdit.Password)
        supa_form.addRow("API Key:", self.supa_key)

        supa_group.setLayout(supa_form)
        layout.addWidget(supa_group)

        # --- Appearance ---
        appear_group = QGroupBox("Appearance")
        appear_form = QFormLayout()

        self.theme_combo = QComboBox()
        self.theme_combo.addItems(["Dark", "Light"])
        appear_form.addRow("Theme:", self.theme_combo)

        appear_group.setLayout(appear_form)
        layout.addWidget(appear_group)

        # --- Buttons ---
        btn_layout = QHBoxLayout()
        btn_layout.addStretch()

        cancel_btn = QPushButton("Cancel")
        cancel_btn.clicked.connect(self.reject)
        btn_layout.addWidget(cancel_btn)

        save_btn = QPushButton("Save")
        save_btn.clicked.connect(self.save_and_accept)
        btn_layout.addWidget(save_btn)

        layout.addLayout(btn_layout)

        # Load current settings
        self.load_settings()

    def load_settings(self):
        """Load settings from config file."""
        config_path = "config.json"
        if os.path.exists(config_path):
            with open(config_path) as f:
                config = json.load(f)

            self.username_input.setText(config.get("username", ""))
            self.port_input.setValue(config.get("port", 8080))
            self.supa_url.setText(
                config.get("supabase", {}).get("url", ""))
            self.supa_key.setText(
                config.get("supabase", {}).get("api_key", ""))

    def save_and_accept(self):
        """Save settings and close dialog."""
        config = {
            "username": self.username_input.text(),
            "port": self.port_input.value(),
            "supabase": {
                "url": self.supa_url.text(),
                "api_key": self.supa_key.text()
            },
            "theme": self.theme_combo.currentText().lower()
        }

        with open("config.json", "w") as f:
            json.dump(config, f, indent=2)

        self.accept()

# Usage in MainWindow:
# def open_settings(self):
#     dialog = SettingsDialog(self)
#     if dialog.exec() == QDialog.Accepted:
#         self.reload_config()
```

---

## 6. Keyboard Shortcuts

```python
from PySide6.QtGui import QShortcut, QKeySequence

class MainWindow(QMainWindow):
    def setup_shortcuts(self):
        # Enter to send message
        self.message_input.returnPressed.connect(self.on_send_clicked)

        # Ctrl+Enter for newline in message (if using QTextEdit)
        # (QLineEdit doesn't support multiline)

        # Ctrl+F to search messages
        search_shortcut = QShortcut(QKeySequence("Ctrl+F"), self)
        search_shortcut.activated.connect(self.toggle_search)

        # Ctrl+N for new chat / add friend
        add_shortcut = QShortcut(QKeySequence("Ctrl+N"), self)
        add_shortcut.activated.connect(self.add_friend_dialog)

        # Escape to deselect / close search
        esc_shortcut = QShortcut(QKeySequence("Escape"), self)
        esc_shortcut.activated.connect(self.on_escape)

        # Ctrl+Q to quit
        quit_shortcut = QShortcut(QKeySequence("Ctrl+Q"), self)
        quit_shortcut.activated.connect(self.quit_app)

    def toggle_search(self):
        """Show/hide search bar for messages."""
        if hasattr(self, 'search_bar'):
            visible = not self.search_bar.isVisible()
            self.search_bar.setVisible(visible)
            if visible:
                self.search_bar.setFocus()
```

---

## 7. Desktop Notifications

### Cross-Platform Notifications

```python
import platform

def send_notification(title, message):
    """Send a desktop notification (cross-platform)."""
    system = platform.system()

    if system == "Windows":
        # Use Windows toast (via tray icon)
        # Already handled by QSystemTrayIcon.showMessage()
        pass

    elif system == "Darwin":  # macOS
        import subprocess
        subprocess.run([
            "osascript", "-e",
            f'display notification "{message}" with title "{title}"'
        ])

    elif system == "Linux":
        import subprocess
        subprocess.run(["notify-send", title, message])
```

---

## 8. Window State Persistence

```python
from PySide6.QtCore import QSettings

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.settings = QSettings("P2PChat", "SecureP2PChat")
        self.restore_state()

    def restore_state(self):
        """Restore window size and position from last session."""
        geometry = self.settings.value("geometry")
        if geometry:
            self.restoreGeometry(geometry)

        state = self.settings.value("windowState")
        if state:
            self.restoreState(state)

    def closeEvent(self, event):
        """Save window state before closing."""
        self.settings.setValue("geometry", self.saveGeometry())
        self.settings.setValue("windowState", self.saveState())
        # ... tray logic ...
```

---

## 9. Loading Indicators

```python
class MainWindow(QMainWindow):
    def show_loading(self, message="Loading..."):
        """Show loading state in the UI."""
        self.statusBar().showMessage(message)
        self.send_btn.setEnabled(False)
        self.send_btn.setText("⏳")
        from PySide6.QtWidgets import QApplication
        QApplication.processEvents()  # Force UI update

    def hide_loading(self):
        """Restore normal UI state."""
        self.send_btn.setEnabled(True)
        self.send_btn.setText("Send")
        self.statusBar().clearMessage()
```

---

## 10. Tips & Tricks

### Tip 1: Emoji Support

Qt handles Unicode/emoji natively. Just use them in strings:

```python
self.send_btn.setText("📤 Send")
self.statusBar().showMessage("✅ Message delivered!")
online_text = "🟢 Online" if online else "⚫ Offline"
```

### Tip 2: Scroll to Bottom Smoothly

```python
from PySide6.QtCore import QPropertyAnimation, QEasingCurve

def smooth_scroll_bottom(text_edit):
    sb = text_edit.verticalScrollBar()
    anim = QPropertyAnimation(sb, b"value")
    anim.setDuration(300)
    anim.setStartValue(sb.value())
    anim.setEndValue(sb.maximum())
    anim.setEasingCurve(QEasingCurve.OutCubic)
    anim.start()
```

### Tip 3: "Typing..." Indicator

```python
# Show when a friend is typing (if you add this to the protocol)
self.typing_label = QLabel("")
self.typing_label.setStyleSheet("color: #6c7086; font-style: italic;")

def show_typing(self, username):
    self.typing_label.setText(f"{username} is typing...")
    # Auto-hide after 3 seconds
    QTimer.singleShot(3000, lambda: self.typing_label.setText(""))
```

---

## Learning Resources

- [Qt Style Sheets Reference](https://doc.qt.io/qt-6/stylesheet-reference.html) — Full QSS properties
- [Qt System Tray Example](https://doc.qt.io/qt-6/qtwidgets-desktop-systray-example.html) — Official example
- [Catppuccin Theme Colors](https://catppuccin.com/) — Beautiful color palette (used in our dark theme)
