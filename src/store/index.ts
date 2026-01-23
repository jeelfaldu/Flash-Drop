import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Transfer State Store
interface TransferState {
  // Current transfer role
  role: 'sender' | 'receiver' | null;
  deviceName: string;
  isTransferring: boolean;
  
  // Selected items for sending
  selectedItems: any[];
  setSelectedItems: (items: any[]) => void;
  toggleItem: (item: any) => void;
  clearSelection: () => void;
  
  // Transfer session
  setRole: (role: 'sender' | 'receiver' | null, deviceName?: string) => void;
  setTransferring: (status: boolean) => void;
  resetTransfer: () => void;
}

export const useTransferStore = create<TransferState>()(
  persist(
    (set) => ({
      role: null,
      deviceName: '',
      isTransferring: false,
      selectedItems: [],
      
      setSelectedItems: (items) => set({ selectedItems: items }),
      
      toggleItem: (item) => set((state) => {
        const exists = state.selectedItems.find(i => i.id === item.id);
        if (exists) {
          return { selectedItems: state.selectedItems.filter(i => i.id !== item.id) };
        }
        return { selectedItems: [...state.selectedItems, item] };
      }),
      
      clearSelection: () => set({ selectedItems: [] }),
      
      setRole: (role, deviceName = '') => set({ role, deviceName }),
      
      setTransferring: (status) => set({ isTransferring: status }),
      
      resetTransfer: () => set({
        role: null,
        deviceName: '',
        isTransferring: false,
        selectedItems: []
      }),
    }),
    {
      name: 'transfer-storage',
      storage: createJSONStorage(() => AsyncStorage),
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

// Media State Store (No persistence - too large for AsyncStorage)
interface MediaState {
  photos: any[];
  videos: any[];
  documents: any[];
  contacts: any[];
  apps: any[];
  
  isLoading: boolean;
  error: string | null;
  
  setPhotos: (photos: any[]) => void;
  setVideos: (videos: any[]) => void;
  setDocuments: (documents: any[]) => void;
  setContacts: (contacts: any[]) => void;
  setApps: (apps: any[]) => void;
  
  addDocuments: (newDocs: any[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearAll: () => void;
}

export const useMediaStore = create<MediaState>((set) => ({
  photos: [],
  videos: [],
  documents: [],
  contacts: [],
  apps: [],
  isLoading: false,
  error: null,
  
  setPhotos: (photos) => set({ photos }),
  setVideos: (videos) => set({ videos }),
  setDocuments: (documents) => set({ documents }),
  setContacts: (contacts) => set({ contacts }),
  setApps: (apps) => set({ apps }),
  
  addDocuments: (newDocs) => set((state) => ({
    documents: [...state.documents, ...newDocs]
  })),
  
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  
  clearAll: () => set({
    photos: [],
    videos: [],
    documents: [],
    contacts: [],
    apps: [],
    isLoading: false,
    error: null
  }),
}));

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

