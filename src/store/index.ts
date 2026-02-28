import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Transfer State Interfaces
export interface FileItem {
  id: string;
  name: string;
  size: number;
  uri: string;
  type: string;
  status?: 'pending' | 'uploading' | 'downloading' | 'completed' | 'error';
  progress?: number;
  [key: string]: any; // Allow other properties for flexibility
}

export interface TransferStats {
  totalSize: number;
  transferredSize: number;
  leftData: string;
  freeSpace: string;
  overallProgress: number;
  transferSpeed: string;
  eta: string;
  lastUpdateTime: number;
  lastTransferredSize: number;
}

// Transfer State Store
interface TransferState {
  // Current transfer role
  role: 'sender' | 'receiver' | null;
  deviceName: string;
  isTransferring: boolean;
  
  // Selected items for sending
  selectedItems: FileItem[];
  setSelectedItems: (items: FileItem[]) => void;
  toggleItem: (item: FileItem) => void;
  clearSelection: () => void;
  
  // Transfer session
  setRole: (role: 'sender' | 'receiver' | null, deviceName?: string) => void;
  setTransferring: (status: boolean) => void;

  // New: Transfer Progress State
  currentFiles: Record<string, FileItem>;
  transferStats: TransferStats;
  setFiles: (files: Record<string, FileItem> | ((prev: Record<string, FileItem>) => Record<string, FileItem>)) => void;
  setTransferStats: (stats: Partial<TransferStats> | ((prev: TransferStats) => Partial<TransferStats>)) => void;

  resetTransfer: () => void;
}

export const useTransferStore = create<TransferState>()(
  persist(
    (set) => ({
      role: null,
      deviceName: '',
      isTransferring: false,
      selectedItems: [],
      currentFiles: {},
      transferStats: {
        totalSize: 0,
        transferredSize: 0,
        leftData: '0GB',
        freeSpace: '0GB',
        overallProgress: 0,
        transferSpeed: '0 KB/s',
        eta: '--:--',
        lastUpdateTime: Date.now(),
        lastTransferredSize: 0
      },
      
      setSelectedItems: (items) => set({ selectedItems: Array.isArray(items) ? items : [] }),
      
      toggleItem: (item) => set((state) => {
        const index = state.selectedItems.findIndex(i => i.id === item.id);
        if (index > -1) {
          const newItems = [...state.selectedItems];
          newItems.splice(index, 1);
          return { selectedItems: newItems };
        }
        return { selectedItems: [...state.selectedItems, item] };
      }),
      
      clearSelection: () => set({ selectedItems: [] }),
      
      setRole: (role, deviceName = '') => set({ role, deviceName }),
      
      setTransferring: (status) => set({ isTransferring: status }),

      setFiles: (filesUpdate) => set((state) => ({
        currentFiles: typeof filesUpdate === 'function' ? filesUpdate(state.currentFiles) : filesUpdate
      })),

      setTransferStats: (statsUpdate) => set((state) => {
        const newStats = typeof statsUpdate === 'function' ? statsUpdate(state.transferStats) : statsUpdate;
        return { transferStats: { ...state.transferStats, ...newStats } };
      }),

      resetTransfer: () => set({
        role: null,
        deviceName: '',
        isTransferring: false,
        selectedItems: [],
        currentFiles: {},
        transferStats: {
          totalSize: 0,
          transferredSize: 0,
          leftData: '0GB',
          freeSpace: '0GB',
          overallProgress: 0,
          transferSpeed: '0 KB/s',
          eta: '--:--',
          lastUpdateTime: Date.now(),
          lastTransferredSize: 0
        }
      }),
    }),
    {
      name: 'transfer-storage',
      storage: createJSONStorage(() => AsyncStorage),
      // ⚠️ Do NOT persist isTransferring — it should always be false on app start.
      // Persisting it caused the overlay to appear even with no active connection.
      partialize: (state) => ({
        role: state.role,
        deviceName: state.deviceName,
        selectedItems: state.selectedItems
      }),
    }
  )
);

// Connection State Store
interface ConnectionState {
  isConnected: boolean;
  connectionType: 'wifi-direct' | 'hotspot' | null;
  ipAddress: string;
  ssid: string;
  
  setConnected: (connected: boolean) => void;
  setConnectionDetails: (details: {
    type: 'wifi-direct' | 'hotspot' | null;
    ip?: string;
    ssid?: string;
  }) => void;
  resetConnection: () => void;
}

export const useConnectionStore = create<ConnectionState>()(
  persist(
    (set) => ({
      isConnected: false,
      connectionType: null,
      ipAddress: '',
      ssid: '',
      
      setConnected: (connected) => set({ isConnected: connected }),
      
      setConnectionDetails: (details) => set({
        connectionType: details.type,
        ipAddress: details.ip || '',
        ssid: details.ssid || ''
      }),
      
      resetConnection: () => set({
        isConnected: false,
        connectionType: null,
        ipAddress: '',
        ssid: ''
      }),
    }),
    {
      name: 'connection-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

// Media store is in its own file for cleanliness
export { useMediaStore } from './mediaStore';

// History store
export { useHistoryStore } from './historyStore';

// PC Connection store
export { usePCConnectionStore } from './pcConnectionStore';


// UI State Store (persisted for user preferences)
interface UIState {
  activeTab: 'photos' | 'videos' | 'contacts' | 'files';
  permissionGranted: boolean;
  
  setActiveTab: (tab: 'photos' | 'videos' | 'contacts' | 'files') => void;
  setPermissionGranted: (granted: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      activeTab: 'photos',
      permissionGranted: false,
      
      setActiveTab: (tab) => set({ activeTab: tab }),
      setPermissionGranted: (granted) => set({ permissionGranted: granted }),
    }),
    {
      name: 'ui-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

