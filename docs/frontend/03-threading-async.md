# 03 — Threading & Async in Qt

> **Audience**: Beginners learning GUI threading.
> This guide teaches you how to do background work without freezing the UI.

---

## Table of Contents

1. [The UI Freeze Problem](#1-the-ui-freeze-problem)
2. [QThread & Worker Pattern](#2-qthread--worker-pattern)
3. [Signals Between Threads](#3-signals-between-threads)
4. [QTimer for Polling](#4-qtimer-for-polling)
5. [Complete BackendWorker](#5-complete-backendworker)
6. [Wiring Worker to MainWindow](#6-wiring-worker-to-mainwindow)
7. [Common Mistakes](#7-common-mistakes)
8. [Tips & Tricks](#8-tips--tricks)

---

## 1. The UI Freeze Problem

### Why Does My UI Freeze?

Qt runs everything on one thread (the "main thread" or "GUI thread"). If you do something slow on that thread, the entire UI freezes:

```python
# ❌ THIS FREEZES THE UI FOR 5 SECONDS!
def on_send_clicked(self):
    response = requests.post(url, json=data, timeout=5)
    # While waiting for the response, the UI is completely frozen!
    # Buttons don't respond, window can't be moved, etc.
```

### The Solution: Background Threads

Move slow operations (HTTP requests, file I/O) to a separate thread:

```
Main Thread (UI)          Background Thread
──────────────            ─────────────────
User clicks "Send"
  │
  ├──► Start worker ──────► Make HTTP request
  │                         (takes 2 seconds)
  │    UI stays responsive!
  │    User can still click
  │    buttons, type, etc.
  │                         ◄── Got response!
  ◄── Signal: "done!" ─────┘
  │
  Update UI with result
```

---

## 2. QThread & Worker Pattern

### The Recommended Pattern: Worker Object

The cleanest way to do threading in Qt:

```python
from PySide6.QtCore import QObject, QThread, Signal, Slot
import requests


class Worker(QObject):
    """Runs in a background thread."""

    # Signals to communicate results back to the main thread
    finished = Signal()
    result_ready = Signal(dict)
    error = Signal(str)

    def __init__(self, url):
        super().__init__()
        self.url = url

    @Slot()
    def do_work(self):
        """This runs in the background thread."""
        try:
            response = requests.get(self.url, timeout=5)
            data = response.json()
            self.result_ready.emit(data)  # Send result to main thread
        except Exception as e:
            self.error.emit(str(e))  # Send error to main thread
        finally:
            self.finished.emit()  # Signal that we're done


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.thread = None
        self.worker = None

    def fetch_status(self):
        """Start a background fetch."""
        # Step 1: Create thread and worker
        self.thread = QThread()
        self.worker = Worker("http://localhost:8080/api/status")

        # Step 2: Move worker to the thread
        self.worker.moveToThread(self.thread)

        # Step 3: Connect signals
        self.thread.started.connect(self.worker.do_work)
        self.worker.result_ready.connect(self.on_status_received)
        self.worker.error.connect(self.on_error)
        self.worker.finished.connect(self.thread.quit)
        self.worker.finished.connect(self.worker.deleteLater)
        self.thread.finished.connect(self.thread.deleteLater)

        # Step 4: Start!
        self.thread.start()

    def on_status_received(self, data):
        """Called on main thread with the result."""
        self.statusBar().showMessage(
            f"Backend: {data.get('status', 'unknown')}")

    def on_error(self, message):
        """Called on main thread when an error occurs."""
        self.statusBar().showMessage(f"Error: {message}")
```

### Step-by-Step Explanation

```
1. Create a Worker (QObject subclass) with your slow operation
2. Create a QThread
3. Move the Worker to the QThread with moveToThread()
4. Connect signals:
   - thread.started → worker.do_work (starts the work)
   - worker.result_ready → your handler (gets the result)
   - worker.finished → thread.quit (stops the thread)
5. Start the thread with thread.start()
6. The worker runs do_work() in the background thread
7. When done, it emits a signal that's received on the main thread
```

---

## 3. Signals Between Threads

### The Golden Rule

> **NEVER touch widgets from a background thread. ALWAYS use signals.**

```python
# ❌ BAD — accessing widget from worker thread
class Worker(QObject):
    def do_work(self):
        data = requests.get(url).json()
        self.label.setText(data["status"])  # CRASH! Wrong thread!

# ✅ GOOD — emit signal, let main thread update
class Worker(QObject):
    result_ready = Signal(str)

    def do_work(self):
        data = requests.get(url).json()
        self.result_ready.emit(data["status"])  # Safe!

# In MainWindow:
self.worker.result_ready.connect(self.label.setText)  # Main thread updates
```

### How It Works

Qt's signal/slot system automatically handles cross-thread communication:

1. Worker emits a signal in the background thread
2. Qt queues the signal
3. The main thread's event loop picks up the queued signal
4. Qt calls the connected slot on the main thread
5. It's safe to update widgets in the slot

---

## 4. QTimer for Polling

### Polling for New Messages

Since our backend doesn't push messages to us, we need to poll periodically:

```python
from PySide6.QtCore import QTimer

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.backend = BackendService()
        self.current_friend = None
        self.last_message_count = 0

        # Poll for new messages every 2 seconds
        self.poll_timer = QTimer(self)
        self.poll_timer.timeout.connect(self.poll_messages)
        self.poll_timer.start(2000)  # 2000 ms = 2 seconds

        # Poll for friend status every 10 seconds
        self.status_timer = QTimer(self)
        self.status_timer.timeout.connect(self.poll_friend_status)
        self.status_timer.start(10000)  # 10 seconds

    def poll_messages(self):
        """Check for new messages from the current friend."""
        if not self.current_friend:
            return

        # ⚠️ This blocks briefly! For a production app,
        # use the Worker pattern instead.
        messages = self.backend.get_messages(self.current_friend)

        # Only update UI if there are new messages
        if len(messages) != self.last_message_count:
            self.last_message_count = len(messages)
            self.display_messages(messages)

    def poll_friend_status(self):
        """Update friend online/offline status."""
        friends = self.backend.list_friends()
        self.update_friend_list(friends)
```

### ⚠️ Polling from QTimer vs Worker Thread

For quick requests (< 100ms), QTimer on the main thread is fine. For slower requests, use a Worker thread:

```python
# Quick request: QTimer is OK
self.timer = QTimer(self)
self.timer.timeout.connect(self.quick_poll)
self.timer.start(2000)

# Slow request: Use Worker
class MessagePoller(QObject):
    messages_ready = Signal(list)

    def __init__(self, backend):
        super().__init__()
        self.backend = backend
        self.current_peer = ""
        self.running = True

    @Slot()
    def run(self):
        """Continuously polls in background thread."""
        import time
        while self.running:
            if self.current_peer:
                try:
                    msgs = self.backend.get_messages(self.current_peer)
                    self.messages_ready.emit(msgs)
                except Exception:
                    pass
            time.sleep(2)

    def stop(self):
        self.running = False
```

---

## 5. Complete BackendWorker

Here's a reusable worker class for ALL backend operations:

```python
"""
backend_worker.py — Background thread for backend communication

This worker runs in a separate thread and handles ALL HTTP
communication with the C++ backend. The UI connects to its
signals to receive results.
"""

from PySide6.QtCore import QObject, QThread, Signal, Slot, QTimer
from services.backend_service import BackendService
import logging

logger = logging.getLogger(__name__)


class BackendWorker(QObject):
    """
    Handles backend communication in a background thread.

    Signals:
        status_updated(dict) — Backend status
        friends_loaded(list) — List of friends
        friend_added(dict) — Result of add friend
        messages_loaded(list) — Messages for current peer
        message_sent(dict) — Result of send message
        error(str) — Error message
        backend_online(bool) — Backend connection status
    """

    # Signals for each operation
    status_updated = Signal(dict)
    friends_loaded = Signal(list)
    friend_added = Signal(dict)
    messages_loaded = Signal(list)
    message_sent = Signal(dict)
    error = Signal(str)
    backend_online = Signal(bool)

    def __init__(self, host="localhost", port=8080):
        super().__init__()
        self.backend = BackendService(host, port)
        self.current_peer = ""
        self._running = True

    # ---- Operations (called via signals from main thread) ----

    @Slot()
    def check_status(self):
        """Check if backend is online."""
        try:
            status = self.backend.status()
            if status:
                self.backend_online.emit(True)
                self.status_updated.emit(status)
            else:
                self.backend_online.emit(False)
        except Exception as e:
            logger.error("Status check failed: %s", e)
            self.backend_online.emit(False)

    @Slot()
    def load_friends(self):
        """Fetch friends list from backend."""
        try:
            friends = self.backend.list_friends()
            self.friends_loaded.emit(friends)
        except Exception as e:
            self.error.emit(f"Failed to load friends: {e}")

    @Slot(str)
    def add_friend(self, username):
        """Add a friend by username."""
        try:
            result = self.backend.add_friend(username)
            self.friend_added.emit(result)
            if result.get("success"):
                self.load_friends()  # Refresh list
        except Exception as e:
            self.error.emit(f"Failed to add friend: {e}")

    @Slot(str)
    def load_messages(self, peer):
        """Load messages for a specific peer."""
        self.current_peer = peer
        try:
            messages = self.backend.get_messages(peer)
            self.messages_loaded.emit(messages)
        except Exception as e:
            self.error.emit(f"Failed to load messages: {e}")

    @Slot(str, str)
    def send_message(self, to, content):
        """Send a message to a peer."""
        try:
            result = self.backend.send_message(to, content)
            self.message_sent.emit(result)
            if result.get("success"):
                self.load_messages(to)  # Refresh
        except Exception as e:
            self.error.emit(f"Failed to send message: {e}")

    @Slot()
    def poll(self):
        """Called periodically to check for new messages."""
        if self.current_peer:
            self.load_messages(self.current_peer)


def create_backend_worker(host="localhost", port=8080):
    """
    Factory function that creates and starts a BackendWorker.

    Returns: (worker, thread) tuple
    Both must be kept alive (store as instance variables).

    Usage:
        self.worker, self.worker_thread = create_backend_worker()
        self.worker.friends_loaded.connect(self.on_friends_loaded)
        self.worker.check_status()
    """
    thread = QThread()
    worker = BackendWorker(host, port)
    worker.moveToThread(thread)

    # Clean up when thread finishes
    thread.finished.connect(worker.deleteLater)
    thread.finished.connect(thread.deleteLater)

    thread.start()
    return worker, thread
```

---

## 6. Wiring Worker to MainWindow

```python
from PySide6.QtWidgets import QMainWindow
from PySide6.QtCore import QTimer, QMetaObject, Qt, Q_ARG

from services.backend_worker import create_backend_worker


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setup_ui()  # Create all widgets
        self.setup_backend()

    def setup_backend(self):
        """Create background worker and connect signals."""
        # Create worker in background thread
        self.worker, self.worker_thread = create_backend_worker()

        # Connect worker signals to UI handlers
        self.worker.backend_online.connect(self.on_backend_status)
        self.worker.friends_loaded.connect(self.on_friends_loaded)
        self.worker.friend_added.connect(self.on_friend_added)
        self.worker.messages_loaded.connect(self.on_messages_loaded)
        self.worker.message_sent.connect(self.on_message_sent)
        self.worker.error.connect(self.on_error)

        # Initial load
        QMetaObject.invokeMethod(
            self.worker, "check_status", Qt.QueuedConnection)
        QMetaObject.invokeMethod(
            self.worker, "load_friends", Qt.QueuedConnection)

        # Set up polling timer (runs on main thread, triggers worker)
        self.poll_timer = QTimer(self)
        self.poll_timer.timeout.connect(
            lambda: QMetaObject.invokeMethod(
                self.worker, "poll", Qt.QueuedConnection))
        self.poll_timer.start(2000)  # Poll every 2 seconds

        # Status check timer
        self.status_timer = QTimer(self)
        self.status_timer.timeout.connect(
            lambda: QMetaObject.invokeMethod(
                self.worker, "check_status", Qt.QueuedConnection))
        self.status_timer.start(10000)  # Every 10 seconds

    # ---- Signal Handlers (run on main thread, safe to update UI) ----

    def on_backend_status(self, online):
        if online:
            self.statusBar().showMessage("Connected to backend")
        else:
            self.statusBar().showMessage("⚠️ Backend offline!")

    def on_friends_loaded(self, friends):
        self.friend_list.clear()
        for f in friends:
            self.friend_list.addItem(f["username"])

    def on_friend_added(self, result):
        if result.get("success"):
            self.statusBar().showMessage(
                f"Added {result['username']}!")
        else:
            self.statusBar().showMessage(
                f"Failed: {result.get('error', 'Unknown error')}")

    def on_messages_loaded(self, messages):
        self.chat_display.clear()
        for msg in messages:
            if msg["direction"] == "sent":
                self.chat_display.append(
                    f'<div style="text-align:right;color:#89b4fa;">'
                    f'<b>You:</b> {msg["content"]}</div>')
            else:
                self.chat_display.append(
                    f'<div style="color:#a6e3a1;">'
                    f'<b>{msg["peer"]}:</b> {msg["content"]}</div>')

        # Scroll to bottom
        sb = self.chat_display.verticalScrollBar()
        sb.setValue(sb.maximum())

    def on_message_sent(self, result):
        if result.get("success"):
            delivered = "✓" if result.get("delivered") else "⏳"
            self.statusBar().showMessage(
                f"Message sent {delivered}", 3000)
        else:
            self.statusBar().showMessage(
                f"Send failed: {result.get('error')}")

    def on_error(self, message):
        self.statusBar().showMessage(f"Error: {message}")

    # ---- User Actions ----

    def on_send_clicked(self):
        text = self.message_input.text().strip()
        if not text or not self.current_friend:
            return

        self.message_input.clear()

        # Invoke worker method from main thread
        QMetaObject.invokeMethod(
            self.worker, "send_message",
            Qt.QueuedConnection,
            Q_ARG(str, self.current_friend),
            Q_ARG(str, text))

    def on_friend_selected(self, current, previous):
        if current:
            self.current_friend = current.text()
            self.worker.current_peer = self.current_friend

            QMetaObject.invokeMethod(
                self.worker, "load_messages",
                Qt.QueuedConnection,
                Q_ARG(str, self.current_friend))

    def closeEvent(self, event):
        """Clean up worker thread when window closes."""
        self.poll_timer.stop()
        self.status_timer.stop()
        self.worker_thread.quit()
        self.worker_thread.wait(3000)  # Wait up to 3 seconds
        event.accept()
```

---

## 7. Common Mistakes

### ❌ Modifying Widgets from Worker Thread

```python
# CATASTROPHICALLY BAD
class Worker(QObject):
    def do_work(self):
        self.label.setText("Done!")  # CRASH or corruption!

# GOOD — use signals
class Worker(QObject):
    done = Signal(str)
    def do_work(self):
        self.done.emit("Done!")  # Safe!
```

### ❌ Not Keeping References to Thread/Worker

```python
# BAD — thread gets garbage collected!
def start_work(self):
    thread = QThread()  # Local variable!
    worker = Worker()
    worker.moveToThread(thread)
    thread.start()
    # thread goes out of scope → crash!

# GOOD — store as instance variables
def start_work(self):
    self.thread = QThread()
    self.worker = Worker()
    self.worker.moveToThread(self.thread)
    self.thread.start()
```

### ❌ Blocking the Main Thread

```python
# BAD — any slow operation on main thread freezes UI
def on_click(self):
    import time
    time.sleep(5)  # UI frozen for 5 seconds!

    response = requests.get(url)  # Also blocks!

# GOOD — do slow work in a worker thread
```

### ❌ Not Cleaning Up Threads

```python
# BAD — thread keeps running after window closes!
# Can cause crashes on exit

# GOOD — stop threads in closeEvent
def closeEvent(self, event):
    self.worker_thread.quit()
    self.worker_thread.wait(3000)
    event.accept()
```

---

## 8. Tips & Tricks

### Tip 1: Use QMetaObject.invokeMethod for Thread-Safe Calls

```python
from PySide6.QtCore import QMetaObject, Qt, Q_ARG

# Call a worker method from the main thread (thread-safe)
QMetaObject.invokeMethod(
    self.worker, "load_messages",
    Qt.QueuedConnection,
    Q_ARG(str, "alice"))
```

### Tip 2: Show Loading State

```python
def on_send_clicked(self):
    self.send_btn.setEnabled(False)
    self.send_btn.setText("Sending...")

    # When done (in the signal handler):
    def on_sent(result):
        self.send_btn.setEnabled(True)
        self.send_btn.setText("Send")

    self.worker.message_sent.connect(on_sent)
```

### Tip 3: Debounce Rapid Signals

```python
# Don't load messages too rapidly during fast selections
from PySide6.QtCore import QTimer

self.load_timer = QTimer(self)
self.load_timer.setSingleShot(True)
self.load_timer.timeout.connect(self._do_load)

def on_friend_selected(self, current, previous):
    self.pending_peer = current.text() if current else None
    self.load_timer.start(300)  # Wait 300ms before loading

def _do_load(self):
    if self.pending_peer:
        self.worker.load_messages(self.pending_peer)
```

---

## Learning Resources

- [Qt Threading Basics](https://doc.qt.io/qt-6/thread-basics.html) — Official guide
- [Qt Signals Across Threads](https://doc.qt.io/qt-6/threads-qobject.html) — How signals work cross-thread
- [PySide6 Threading](https://www.pythonguis.com/tutorials/multithreading-pyside6-applications-qthreadpool-signals-slots/) — Tutorial with examples
