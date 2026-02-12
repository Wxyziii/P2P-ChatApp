import { useEffect, useCallback } from "react";
import { useUIStore } from "@/stores/uiStore";

export function useTheme() {
  const theme = useUIStore((s) => s.theme);
  const resolvedTheme = useUIStore((s) => s.resolvedTheme);
  const setTheme = useUIStore((s) => s.setTheme);
  const setResolvedTheme = useUIStore((s) => s.setResolvedTheme);

  const applyTheme = useCallback(
    (resolved: "light" | "dark") => {
      document.documentElement.classList.toggle("dark", resolved === "dark");
      setResolvedTheme(resolved);
    },
    [setResolvedTheme]
  );

  useEffect(() => {
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      applyTheme(mq.matches ? "dark" : "light");
      const handler = (e: MediaQueryListEvent) =>
        applyTheme(e.matches ? "dark" : "light");
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    } else {
      applyTheme(theme);
    }
  }, [theme, applyTheme]);

  const cycleTheme = useCallback(() => {
    const order: Array<"light" | "dark" | "system"> = ["system", "light", "dark"];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setTheme(next);
  }, [theme, setTheme]);

  return { theme, resolvedTheme, setTheme, cycleTheme };
}
