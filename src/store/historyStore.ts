import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getHistory, clearHistory, HistoryItem } from '../utils/HistoryService';

// ─────────────────────────────────────────────────────────────────────────────
// History Store
// Wraps HistoryService with Zustand so HistoryScreen is pure UI.
// Persists the active tab preference.
// ─────────────────────────────────────────────────────────────────────────────

interface HistoryState {
  history: HistoryItem[];
  activeTab: 'all' | 'sent' | 'received';
  isLoading: boolean;

  // Computed (derived) — filtered list based on activeTab
  filteredHistory: () => HistoryItem[];

  // Actions
  setActiveTab: (tab: 'all' | 'sent' | 'received') => void;
  loadHistory: () => Promise<void>;
  clearAll: () => Promise<void>;
}

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set, get) => ({
      history: [],
      activeTab: 'all',
      isLoading: false,

      filteredHistory: () => {
        const { history, activeTab } = get();
        if (activeTab === 'all') return history;
        return history.filter((item) => item.role === activeTab);
      },

      setActiveTab: (tab) => set({ activeTab: tab }),

      loadHistory: async () => {
        set({ isLoading: true });
        try {
          const data = await getHistory();
          set({ history: data });
        } catch (e) {
          console.log('Error loading history', e);
        } finally {
          set({ isLoading: false });
        }
      },

      clearAll: async () => {
        await clearHistory();
        set({ history: [] });
      },
    }),
    {
      name: 'history-storage',
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist the tab preference, not the history list (fetched fresh each time)
      partialize: (state) => ({ activeTab: state.activeTab }),
    },
  ),
);
