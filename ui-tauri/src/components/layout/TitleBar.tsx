import { ThemeToggle } from "@/components/common/ThemeToggle";
import { useUIStore } from "@/stores/uiStore";
import { Shield, ShieldOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

export function TitleBar() {
  const backendConnected = useUIStore((s) => s.backendConnected);

  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar__brand" data-tauri-drag-region>
        <div className="titlebar__logo">P2</div>
        <span className="titlebar__name">P2P Chat</span>

        <motion.div
          className={cn(
            "titlebar__status",
            backendConnected
              ? "titlebar__status--online"
              : "titlebar__status--offline"
          )}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          key={backendConnected ? "on" : "off"}
        >
          {backendConnected ? (
            <Shield size={11} className="fill-current opacity-80" />
          ) : (
            <ShieldOff size={11} />
          )}
          {backendConnected ? "Secure" : "Disconnected"}
        </motion.div>
      </div>

      <div className="titlebar__controls">
        <ThemeToggle />
      </div>
    </div>
  );
}
