import { motion } from "framer-motion";
import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, cycleTheme } = useTheme();

  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const label =
    theme === "light" ? "Light" : theme === "dark" ? "Dark" : "System";

  return (
    <motion.button
      onClick={cycleTheme}
      className={cn("icon-btn", className)}
      title={`Theme: ${label}`}
      whileTap={{ scale: 0.9, rotate: 15 }}
    >
      <Icon size={16} strokeWidth={2} />
    </motion.button>
  );
}
