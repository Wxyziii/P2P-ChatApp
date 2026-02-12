import { useRef, useCallback } from "react";
import { Sidebar } from "./Sidebar";
import { TitleBar } from "./TitleBar";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { EmptyChat } from "@/components/chat/EmptyChat";
import { useChatStore } from "@/stores/chatStore";
import { useUIStore } from "@/stores/uiStore";

export function AppShell() {
  const activeChat = useChatStore((s) => s.activeChat);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const resizing = useRef(false);

  const handleMouseDown = useCallback(() => {
    resizing.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizing.current) return;
      const newWidth = Math.max(280, Math.min(420, e.clientX - 20));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      resizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }, [setSidebarWidth]);

  return (
    <div className="app-shell">
      <TitleBar />
      <div className="main-area">
        <div className="sidebar" style={{ width: sidebarWidth }}>
          <Sidebar />
        </div>

        <div className="resize-handle" onMouseDown={handleMouseDown} />

        {activeChat ? <ChatPanel peer={activeChat} /> : <EmptyChat />}
      </div>
    </div>
  );
}
