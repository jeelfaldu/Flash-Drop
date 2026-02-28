import { create } from 'zustand';

// ─────────────────────────────────────────────────────────────────────────────
// PC Connection Store
// Manages the state for the PC Connection screen (server URL, shared files, etc.)
// Not persisted — resets when server stops.
// ─────────────────────────────────────────────────────────────────────────────

interface PCConnectionState {
  serverUrl: string | null;
  isServerRunning: boolean;
  sharedFiles: any[];
  port: number;

  // Actions
  setServerUrl: (url: string | null) => void;
  setIsServerRunning: (running: boolean) => void;
  addFiles: (files: any[]) => void;
  setPort: (port: number) => void;
  reset: () => void;
}

export const usePCConnectionStore = create<PCConnectionState>((set) => ({
  serverUrl: null,
  isServerRunning: false,
  sharedFiles: [],
  port: 8080,

  setServerUrl: (url) => set({ serverUrl: url }),
  setIsServerRunning: (running) => set({ isServerRunning: running }),
  addFiles: (files) => set((state) => ({ sharedFiles: [...state.sharedFiles, ...files] })),
  setPort: (port) => set({ port }),
  reset: () => set({ serverUrl: null, isServerRunning: false, sharedFiles: [] }),
}));
