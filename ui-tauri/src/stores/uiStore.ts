import { create } from "zustand";
import { persist } from "zustand/middleware";

type Theme = "light" | "dark" | "system";

interface UIState {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  sidebarWidth: number;
  showAddFriendDialog: boolean;
  showEmojiPicker: boolean;
  backendConnected: boolean;
  wsConnected: boolean;

  // Actions
  setTheme: (theme: Theme) => void;
  setResolvedTheme: (resolved: "light" | "dark") => void;
  setSidebarWidth: (width: number) => void;
  setShowAddFriendDialog: (show: boolean) => void;
  setShowEmojiPicker: (show: boolean) => void;
  setBackendConnected: (connected: boolean) => void;
  setWsConnected: (connected: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      theme: "system",
      resolvedTheme: "dark",
      sidebarWidth: 320,
      showAddFriendDialog: false,
      showEmojiPicker: false,
      backendConnected: false,
      wsConnected: false,

      setTheme: (theme) => set({ theme }),
      setResolvedTheme: (resolvedTheme) => set({ resolvedTheme }),
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
      setShowAddFriendDialog: (show) => set({ showAddFriendDialog: show }),
      setShowEmojiPicker: (show) => set({ showEmojiPicker: show }),
      setBackendConnected: (connected) => set({ backendConnected: connected }),
      setWsConnected: (connected) => set({ wsConnected: connected }),
    }),
    {
      name: "p2p-chat-ui",
      partialize: (state) => ({
        theme: state.theme,
        sidebarWidth: state.sidebarWidth,
      }),
    }
  )
);
