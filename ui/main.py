"""
secure-p2p-chat — Python UI Entry Point

Launches the PySide6 (Qt) desktop application that communicates
with the local C++ backend over HTTP (localhost).
"""

import sys
from PySide6.QtWidgets import QApplication

# TODO: Uncomment as you implement each view
# from views.main_window import MainWindow


def main():
    app = QApplication(sys.argv)
    app.setApplicationName("Secure P2P Chat")
    app.setOrganizationName("secure-p2p-chat")

    # TODO: Replace with MainWindow once implemented
    from PySide6.QtWidgets import QLabel, QMainWindow

    window = QMainWindow()
    window.setWindowTitle("Secure P2P Chat")
    window.setCentralWidget(QLabel("🚀 Secure P2P Chat — UI coming soon!"))
    window.resize(800, 600)
    window.show()

    sys.exit(app.exec())


if __name__ == "__main__":
    main()
