# 01 — PySide6 (Qt) Basics Guide

> **Audience**: Beginners learning Python GUI development.
> This guide teaches you everything about building desktop UIs with PySide6.

---

## Table of Contents

1. [What is PySide6?](#1-what-is-pyside6)
2. [Installation & First Window](#2-installation--first-window)
3. [Widgets](#3-widgets)
4. [Layouts](#4-layouts)
5. [Signals & Slots](#5-signals--slots)
6. [QMainWindow](#6-qmainwindow)
7. [Styling with QSS](#7-styling-with-qss)
8. [Dialogs](#8-dialogs)
9. [Icons & Resources](#9-icons--resources)
10. [Building Our Chat Window](#10-building-our-chat-window)
11. [Common Mistakes](#11-common-mistakes)
12. [Tips & Tricks](#12-tips--tricks)

---

## 1. What is PySide6?

PySide6 is the official Python binding for Qt 6, a powerful cross-platform GUI framework.

**Why PySide6 over Tkinter?**
| Feature | Tkinter | PySide6 |
|---------|---------|---------|
| Look & Feel | ❌ Dated | ✅ Modern, native |
| Widgets | ⚠️ Basic | ✅ Rich set |
| Styling | ❌ Limited | ✅ CSS-like stylesheets |
| Threading | ❌ Hard | ✅ QThread, signals |
| Community | ⚠️ Small | ✅ Huge (Qt) |

### Key Concepts

- **QApplication**: The one "engine" that runs everything. You need exactly ONE per program.
- **QWidget**: The base class for all visible things (buttons, text boxes, windows).
- **Signal/Slot**: Qt's way of connecting events (button click → run function).
- **Layout**: Automatically arranges widgets (no manual x,y positioning).
- **Event Loop**: `app.exec()` starts the loop that listens for clicks, keys, etc.

---

## 2. Installation & First Window

### Install PySide6

```bash
pip install PySide6
```

### Your Very First Window

```python
import sys
from PySide6.QtWidgets import QApplication, QWidget, QLabel, QVBoxLayout

# Step 1: Create the application (MUST be first)
app = QApplication(sys.argv)

# Step 2: Create a window
window = QWidget()
window.setWindowTitle("Hello PySide6!")
window.resize(400, 300)

# Step 3: Add a label
layout = QVBoxLayout()
label = QLabel("Hello, World! 👋")
layout.addWidget(label)
window.setLayout(layout)

# Step 4: Show the window
window.show()

# Step 5: Start the event loop (this blocks until window closes)
sys.exit(app.exec())
```

### ⚠️ Critical: QApplication Must Come First

```python
# ❌ BAD — crashes!
label = QLabel("Hello")  # ERROR: No QApplication created yet!

# ✅ GOOD
app = QApplication(sys.argv)
label = QLabel("Hello")  # Now it works
```

---

## 3. Widgets

### QLabel — Display Text

```python
from PySide6.QtWidgets import QLabel
from PySide6.QtCore import Qt

label = QLabel("Hello, World!")
label.setAlignment(Qt.AlignCenter)  # Center the text

# Rich text (HTML)
rich_label = QLabel("<b>Bold</b> and <i>italic</i>")
rich_label.setTextFormat(Qt.RichText)

# Selectable text (user can copy)
label.setTextInteractionFlags(Qt.TextSelectableByMouse)
```

### QPushButton — Clickable Button

```python
from PySide6.QtWidgets import QPushButton

button = QPushButton("Click Me!")
button.setToolTip("This is a tooltip")

# Connect click to a function
def on_click():
    print("Button clicked!")

button.clicked.connect(on_click)

# Disable/enable
button.setEnabled(False)   # Grey out
button.setEnabled(True)    # Re-enable
```

### QLineEdit — Single-Line Text Input

```python
from PySide6.QtWidgets import QLineEdit

# Text input field
input_field = QLineEdit()
input_field.setPlaceholderText("Enter your username...")
input_field.setMaxLength(20)

# Get the text
text = input_field.text()

# React to Enter key
def on_enter():
    print(f"User typed: {input_field.text()}")

input_field.returnPressed.connect(on_enter)

# Password mode (hides characters)
password = QLineEdit()
password.setEchoMode(QLineEdit.Password)
```

### QTextEdit — Multi-Line Text Area

```python
from PySide6.QtWidgets import QTextEdit

# Editable text area
editor = QTextEdit()
editor.setPlaceholderText("Type your message...")

# Get/set text
editor.setPlainText("Hello!")
text = editor.toPlainText()

# Read-only (for chat display)
chat_display = QTextEdit()
chat_display.setReadOnly(True)

# Append text (like a chat log)
chat_display.append("<b>Alice:</b> Hello!")
chat_display.append("<b>Bob:</b> Hi there!")

# Scroll to bottom
scrollbar = chat_display.verticalScrollBar()
scrollbar.setValue(scrollbar.maximum())
```

### QListWidget — List of Items

```python
from PySide6.QtWidgets import QListWidget, QListWidgetItem

# Create a list
friend_list = QListWidget()

# Add items
friend_list.addItem("alice")
friend_list.addItem("bob")
friend_list.addItem("charlie")

# Add item with data
item = QListWidgetItem("diana")
item.setData(256, {"ip": "192.168.1.5", "online": True})  # Store extra data
friend_list.addItem(item)

# React to selection
def on_select(current, previous):
    if current:
        print(f"Selected: {current.text()}")

friend_list.currentItemChanged.connect(on_select)

# Get selected item
selected = friend_list.currentItem()
if selected:
    print(f"Currently selected: {selected.text()}")
```

---

## 4. Layouts

### QVBoxLayout — Vertical Stack

```python
from PySide6.QtWidgets import QVBoxLayout, QLabel, QPushButton

layout = QVBoxLayout()
layout.addWidget(QLabel("Top"))
layout.addWidget(QLabel("Middle"))
layout.addWidget(QPushButton("Bottom"))

# Result:
# ┌──────────┐
# │   Top    │
# │  Middle  │
# │ [Bottom] │
# └──────────┘
```

### QHBoxLayout — Horizontal Row

```python
from PySide6.QtWidgets import QHBoxLayout

layout = QHBoxLayout()
layout.addWidget(QLabel("Left"))
layout.addWidget(QLabel("Center"))
layout.addWidget(QPushButton("Right"))

# Result:
# ┌──────────────────────┐
# │ Left  Center  [Right]│
# └──────────────────────┘
```

### Nesting Layouts

```python
# Main vertical layout
main_layout = QVBoxLayout()

# Top row (horizontal)
top_row = QHBoxLayout()
top_row.addWidget(QLabel("Username:"))
top_row.addWidget(QLineEdit())
main_layout.addLayout(top_row)

# Content area
main_layout.addWidget(QTextEdit())

# Bottom row (horizontal)
bottom_row = QHBoxLayout()
bottom_row.addWidget(QLineEdit())
bottom_row.addWidget(QPushButton("Send"))
main_layout.addLayout(bottom_row)

# Result:
# ┌─────────────────────────┐
# │ Username: [___________] │
# │ ┌─────────────────────┐ │
# │ │                     │ │
# │ │   Chat messages     │ │
# │ │                     │ │
# │ └─────────────────────┘ │
# │ [Type message...] [Send]│
# └─────────────────────────┘
```

### Stretch Factors

```python
# Make the chat area take most of the space
main_layout = QVBoxLayout()
main_layout.addWidget(QLabel("Header"))
main_layout.addWidget(chat_display, stretch=1)  # Takes all remaining space
main_layout.addWidget(input_field)
```

### QSplitter — Resizable Panels

```python
from PySide6.QtWidgets import QSplitter
from PySide6.QtCore import Qt

splitter = QSplitter(Qt.Horizontal)
splitter.addWidget(friend_list)     # Left panel
splitter.addWidget(chat_area)       # Right panel
splitter.setSizes([200, 600])       # Initial widths
```

---

## 5. Signals & Slots

### What Are They?

Signals and slots are Qt's event system:
- **Signal**: "Something happened!" (button clicked, text changed)
- **Slot**: "Do this when it happens!" (a function)
- **connect()**: Links a signal to a slot

```python
# Signal → Slot connection
button.clicked.connect(my_function)
#       ^^^^^^^ signal  ^^^^^^^^^^^ slot (function)
```

### Built-in Signals

```python
# Button clicked
button.clicked.connect(on_click)

# Text changed
input_field.textChanged.connect(on_text_changed)

# Item selected in list
list_widget.currentItemChanged.connect(on_selection)

# Return pressed in text field
input_field.returnPressed.connect(on_enter)

# Window resized
# (use resizeEvent override instead)
```

### Signals with Arguments

```python
def on_text_changed(new_text):
    print(f"Text is now: {new_text}")

input_field.textChanged.connect(on_text_changed)
# Qt automatically passes the new text to your function
```

### Custom Signals

```python
from PySide6.QtCore import Signal, QObject

class BackendService(QObject):
    # Define custom signals
    message_received = Signal(str, str)  # (from_user, content)
    connection_lost = Signal()
    friend_online = Signal(str)          # (username)

    def check_messages(self):
        # When you detect a new message:
        self.message_received.emit("alice", "Hello!")

# Connect to custom signals
service = BackendService()
service.message_received.connect(
    lambda from_user, content: print(f"{from_user}: {content}"))
```

### Lambda Slots

```python
# Instead of defining a separate function:
button.clicked.connect(lambda: print("Clicked!"))

# With arguments:
for username in ["alice", "bob", "charlie"]:
    btn = QPushButton(username)
    btn.clicked.connect(lambda checked, u=username: select_user(u))
    # ⚠️ The 'u=username' trick is important! (see Common Mistakes)
```

---

## 6. QMainWindow

QMainWindow is the standard window with menu bar, toolbar, status bar:

```python
from PySide6.QtWidgets import QMainWindow, QMenuBar, QStatusBar

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("P2P Chat")
        self.resize(800, 600)

        # Menu bar
        menu_bar = self.menuBar()
        file_menu = menu_bar.addMenu("&File")
        file_menu.addAction("&Settings", self.open_settings)
        file_menu.addSeparator()
        file_menu.addAction("&Quit", self.close)

        help_menu = menu_bar.addMenu("&Help")
        help_menu.addAction("&About", self.show_about)

        # Status bar
        self.statusBar().showMessage("Ready")

        # Central widget (your main content)
        central = QWidget()
        self.setCentralWidget(central)

        # Build layout on central widget
        layout = QVBoxLayout(central)
        layout.addWidget(QLabel("Welcome to P2P Chat!"))

    def open_settings(self):
        print("Settings clicked!")

    def show_about(self):
        from PySide6.QtWidgets import QMessageBox
        QMessageBox.about(self, "About", "P2P Chat v1.0")
```

---

## 7. Styling with QSS

QSS (Qt Style Sheets) are like CSS for Qt widgets:

### Basic Styling

```python
# Style a single widget
button.setStyleSheet("""
    QPushButton {
        background-color: #4CAF50;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 4px;
        font-size: 14px;
    }
    QPushButton:hover {
        background-color: #45a049;
    }
    QPushButton:pressed {
        background-color: #3d8b40;
    }
""")
```

### Dark Theme for Entire App

```python
DARK_THEME = """
QWidget {
    background-color: #1e1e2e;
    color: #cdd6f4;
    font-family: "Segoe UI", Arial;
    font-size: 13px;
}

QMainWindow {
    background-color: #1e1e2e;
}

QTextEdit, QLineEdit {
    background-color: #313244;
    color: #cdd6f4;
    border: 1px solid #45475a;
    border-radius: 6px;
    padding: 6px;
    selection-background-color: #585b70;
}

QTextEdit:focus, QLineEdit:focus {
    border-color: #89b4fa;
}

QListWidget {
    background-color: #181825;
    color: #cdd6f4;
    border: none;
    outline: 0;
}

QListWidget::item {
    padding: 8px;
    border-bottom: 1px solid #313244;
}

QListWidget::item:selected {
    background-color: #313244;
    color: #89b4fa;
}

QListWidget::item:hover {
    background-color: #282838;
}

QPushButton {
    background-color: #89b4fa;
    color: #1e1e2e;
    border: none;
    padding: 8px 16px;
    border-radius: 6px;
    font-weight: bold;
}

QPushButton:hover {
    background-color: #74c7ec;
}

QPushButton:pressed {
    background-color: #585b70;
}

QPushButton:disabled {
    background-color: #45475a;
    color: #6c7086;
}

QScrollBar:vertical {
    background-color: #181825;
    width: 8px;
}

QScrollBar::handle:vertical {
    background-color: #45475a;
    border-radius: 4px;
    min-height: 20px;
}

QScrollBar::handle:vertical:hover {
    background-color: #585b70;
}

QMenuBar {
    background-color: #181825;
    color: #cdd6f4;
}

QMenuBar::item:selected {
    background-color: #313244;
}

QStatusBar {
    background-color: #181825;
    color: #6c7086;
}
"""

# Apply to entire application
app.setStyleSheet(DARK_THEME)
```

---

## 8. Dialogs

### Message Boxes

```python
from PySide6.QtWidgets import QMessageBox

# Information
QMessageBox.information(self, "Info", "Message sent successfully!")

# Warning
QMessageBox.warning(self, "Warning", "Peer is offline!")

# Error
QMessageBox.critical(self, "Error", "Cannot connect to backend!")

# Yes/No question
reply = QMessageBox.question(
    self, "Confirm",
    "Remove friend 'alice'?",
    QMessageBox.Yes | QMessageBox.No,
    QMessageBox.No  # Default button
)
if reply == QMessageBox.Yes:
    remove_friend("alice")
```

### Input Dialog

```python
from PySide6.QtWidgets import QInputDialog

# Get text input
username, ok = QInputDialog.getText(
    self, "Add Friend", "Enter username:")
if ok and username:
    add_friend(username)

# Get number
port, ok = QInputDialog.getInt(
    self, "Port", "Enter port:", 8080, 1024, 65535)
```

---

## 9. Icons & Resources

```python
from PySide6.QtGui import QIcon

# Window icon
self.setWindowIcon(QIcon("assets/icon.png"))

# Button with icon
send_btn = QPushButton()
send_btn.setIcon(QIcon("assets/send.png"))
send_btn.setToolTip("Send message")
```

---

## 10. Building Our Chat Window

Here's the complete chat window layout for our project:

```python
import sys
from PySide6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout,
    QHBoxLayout, QSplitter, QListWidget, QListWidgetItem,
    QTextEdit, QLineEdit, QPushButton, QLabel, QMessageBox,
    QInputDialog
)
from PySide6.QtCore import Qt, QTimer


class ChatWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Secure P2P Chat")
        self.resize(900, 600)
        self.setMinimumSize(600, 400)

        # Central widget
        central = QWidget()
        self.setCentralWidget(central)
        main_layout = QHBoxLayout(central)
        main_layout.setContentsMargins(0, 0, 0, 0)

        # === Left Panel: Friends List ===
        left_panel = QWidget()
        left_layout = QVBoxLayout(left_panel)
        left_layout.setContentsMargins(8, 8, 4, 8)

        # Header with Add Friend button
        header = QHBoxLayout()
        header.addWidget(QLabel("Friends"))
        add_btn = QPushButton("+")
        add_btn.setFixedSize(30, 30)
        add_btn.setToolTip("Add friend")
        add_btn.clicked.connect(self.add_friend_dialog)
        header.addWidget(add_btn)
        left_layout.addLayout(header)

        # Friends list
        self.friend_list = QListWidget()
        self.friend_list.currentItemChanged.connect(
            self.on_friend_selected)
        left_layout.addWidget(self.friend_list)

        # === Right Panel: Chat Area ===
        right_panel = QWidget()
        right_layout = QVBoxLayout(right_panel)
        right_layout.setContentsMargins(4, 8, 8, 8)

        # Chat header (shows who you're talking to)
        self.chat_header = QLabel("Select a friend to start chatting")
        self.chat_header.setAlignment(Qt.AlignCenter)
        right_layout.addWidget(self.chat_header)

        # Chat messages display
        self.chat_display = QTextEdit()
        self.chat_display.setReadOnly(True)
        right_layout.addWidget(self.chat_display, stretch=1)

        # Input area
        input_layout = QHBoxLayout()
        self.message_input = QLineEdit()
        self.message_input.setPlaceholderText("Type a message...")
        self.message_input.returnPressed.connect(self.send_message)
        input_layout.addWidget(self.message_input, stretch=1)

        self.send_btn = QPushButton("Send")
        self.send_btn.clicked.connect(self.send_message)
        self.send_btn.setEnabled(False)
        input_layout.addWidget(self.send_btn)

        right_layout.addLayout(input_layout)

        # === Splitter ===
        splitter = QSplitter(Qt.Horizontal)
        splitter.addWidget(left_panel)
        splitter.addWidget(right_panel)
        splitter.setSizes([250, 650])
        main_layout.addWidget(splitter)

        # Menu bar
        file_menu = self.menuBar().addMenu("&File")
        file_menu.addAction("&Settings", self.open_settings)
        file_menu.addSeparator()
        file_menu.addAction("&Quit", self.close)

        # Status bar
        self.statusBar().showMessage("Connecting to backend...")

        # Current state
        self.current_friend = None

    def add_friend_dialog(self):
        username, ok = QInputDialog.getText(
            self, "Add Friend", "Enter username:")
        if ok and username.strip():
            # TODO: Call backend API to add friend
            self.friend_list.addItem(username.strip())
            self.statusBar().showMessage(
                f"Added friend: {username.strip()}")

    def on_friend_selected(self, current, previous):
        if current:
            self.current_friend = current.text()
            self.chat_header.setText(f"Chat with {self.current_friend}")
            self.send_btn.setEnabled(True)
            self.message_input.setFocus()
            self.chat_display.clear()
            # TODO: Load message history from backend
            self.statusBar().showMessage(
                f"Chatting with {self.current_friend}")

    def send_message(self):
        text = self.message_input.text().strip()
        if not text or not self.current_friend:
            return

        # Display in chat
        self.chat_display.append(
            f'<div style="text-align: right; color: #89b4fa;">'
            f'<b>You:</b> {text}</div>')

        # TODO: Send via backend API
        self.message_input.clear()
        self.message_input.setFocus()

        # Scroll to bottom
        sb = self.chat_display.verticalScrollBar()
        sb.setValue(sb.maximum())

    def open_settings(self):
        QMessageBox.information(
            self, "Settings", "Settings dialog coming soon!")


if __name__ == "__main__":
    app = QApplication(sys.argv)
    # app.setStyleSheet(DARK_THEME)  # Apply dark theme
    window = ChatWindow()
    window.show()
    sys.exit(app.exec())
```

---

## 11. Common Mistakes

### ❌ Not Creating QApplication First

```python
# BAD — crashes with cryptic error
label = QLabel("Hello")

# GOOD
app = QApplication(sys.argv)
label = QLabel("Hello")
```

### ❌ Forgetting app.exec()

```python
# BAD — window appears and immediately disappears!
window.show()
# Script ends here, window is destroyed

# GOOD
window.show()
sys.exit(app.exec())  # Blocks until window is closed
```

### ❌ Not Keeping References to Widgets

```python
# BAD — button gets garbage collected!
def create_ui(layout):
    btn = QPushButton("Click")  # Local variable!
    layout.addWidget(btn)
# btn goes out of scope, Qt might crash

# GOOD — store as instance variable
def create_ui(self, layout):
    self.btn = QPushButton("Click")  # Stored on self!
    layout.addWidget(self.btn)
```

### ❌ Lambda Capture in Loops

```python
# BAD — all buttons print "charlie"!
for name in ["alice", "bob", "charlie"]:
    btn = QPushButton(name)
    btn.clicked.connect(lambda: print(name))  # Captures last value!

# GOOD — use default argument to capture current value
for name in ["alice", "bob", "charlie"]:
    btn = QPushButton(name)
    btn.clicked.connect(lambda checked, n=name: print(n))
```

### ❌ Modifying Widgets from Another Thread

```python
# BAD — crashes! Qt widgets are NOT thread-safe
import threading
def background_task():
    label.setText("Updated!")  # CRASH or undefined behavior!
threading.Thread(target=background_task).start()

# GOOD — use signals (see 03-threading-async.md)
```

---

## 12. Tips & Tricks

### Tip 1: Use F-strings for Dynamic Labels

```python
self.status_label.setText(f"Connected to {username} ({ip})")
```

### Tip 2: Clear and Rebuild Lists

```python
def refresh_friends(self, friends):
    self.friend_list.clear()
    for f in friends:
        item = QListWidgetItem(f["username"])
        if f.get("online"):
            item.setForeground(Qt.green)
        self.friend_list.addItem(item)
```

### Tip 3: Use QTimer for Delayed Actions

```python
from PySide6.QtCore import QTimer

# Show status message for 3 seconds
self.statusBar().showMessage("Message sent!", 3000)

# Periodic polling
timer = QTimer(self)
timer.timeout.connect(self.poll_messages)
timer.start(2000)  # Every 2 seconds
```

---

## Learning Resources

- [Qt for Python Documentation](https://doc.qt.io/qtforpython-6/) — Official docs
- [PySide6 Tutorial](https://www.pythonguis.com/pyside6/) — Comprehensive tutorial
- [Qt Widgets Gallery](https://doc.qt.io/qt-6/gallery.html) — See all available widgets
