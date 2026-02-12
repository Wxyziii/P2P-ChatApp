import { useEffect } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useTheme } from "@/hooks/useTheme";
import { useUIStore } from "@/stores/uiStore";
import { api } from "@/services/api";
import { POLL_INTERVAL_MS } from "@/lib/constants";

export default function App() {
  useTheme();
  useWebSocket();

  const setBackendConnected = useUIStore((s) => s.setBackendConnected);

  // Poll backend health
  useEffect(() => {
    const check = async () => {
      try {
        await api.getStatus();
        setBackendConnected(true);
      } catch {
        setBackendConnected(false);
      }
    };
    check();
    const interval = setInterval(check, POLL_INTERVAL_MS * 3);
    return () => clearInterval(interval);
  }, [setBackendConnected]);

  return <AppShell />;
}
