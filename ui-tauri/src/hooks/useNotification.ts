import { useCallback } from "react";

export function useNotification() {
  const notify = useCallback((title: string, body: string) => {
    // Use browser Notification API (works in Tauri webview)
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body, icon: "/vite.svg" });
    } else if ("Notification" in window && Notification.permission !== "denied") {
      Notification.requestPermission().then((perm) => {
        if (perm === "granted") {
          new Notification(title, { body, icon: "/vite.svg" });
        }
      });
    }
  }, []);

  return { notify };
}
