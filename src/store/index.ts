import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import TransferClient, { TransferStatus } from '../utils/TransferClient';
import TransferServer, { ServerStatus } from '../utils/TransferServer';

export interface FileItem {
  name: string;
  size: number;
  progress: number;
  status: 'pending' | 'transferring' | 'completed' | 'error';
  type?: string;
  uri?: string;
}

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
  transferringFiles: Record<string, FileItem>;
  setRole: (role: 'sender' | 'receiver' | null, deviceName?: string) => void;
  setTransferring: (status: boolean) => void;
  resetTransfer: () => void;

  // File tracking
  addFile: (file: FileItem) => void;
  updateFileProgress: (name: string, progress: number, status?: FileItem['status']) => void;
  setFiles: (files: Record<string, FileItem>) => void;

  // Listeners
  setupListeners: (role: 'sender' | 'receiver') => void;
  cleanupListeners: () => void;
}

export const useTransferStore = create<TransferState>()(
  persist(
    (set, get) => ({
      role: null,
      deviceName: '',
      isTransferring: false,
      selectedItems: [],
      transferringFiles: {},
      
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
      
      resetTransfer: () => {
        get().cleanupListeners();
        set({
          role: null,
          deviceName: '',
          isTransferring: false,
          selectedItems: [],
          transferringFiles: {}
        });
      },

      addFile: (file) => set((state) => ({
        transferringFiles: { ...state.transferringFiles, [file.name]: file }
      })),

      updateFileProgress: (name, progress, status) => set((state) => {
        const file = state.transferringFiles[name];
        if (!file) return state;

        return {
          transferringFiles: {
            ...state.transferringFiles,
            [name]: {
              ...file,
              progress,
              status: status || (progress >= 1 ? 'completed' : 'transferring')
            }
          }
        };
      }),

      setFiles: (files) => set({ transferringFiles: files }),

      setupListeners: (role) => {
        const { updateFileProgress } = get();
        const { setStatus, setLog, setConnected } = useConnectionStore.getState();

        if (role === 'receiver') {
          TransferClient.onStatus = (status: TransferStatus) => {
            if (status.type === 'log') {
              setLog(status.message || '');
            } else if (status.type === 'connection') {
              setConnected(status.connected);
              setStatus(status.connected ? 'connected' : 'idle');
              if (status.message) setLog(status.message);
            } else if (status.type === 'progress' && status.fileProgress) {
              updateFileProgress(
                status.fileProgress.name,
                status.fileProgress.percent / 100
              );
            } else if (status.files) {
               // Initial metadata received
               const newFiles: Record<string, FileItem> = {};
               status.files.forEach((f: any) => {
                 newFiles[f.name] = {
                   name: f.name,
                   size: f.size,
                   progress: 0,
                   status: 'pending',
                   type: f.type
                 };
               });
               // Merge with existing to avoid overwriting if partial updates
               set((state) => ({
                 transferringFiles: { ...state.transferringFiles, ...newFiles }
               }));
            }
          };
        } else if (role === 'sender') {
          TransferServer.statusCallback = (status: ServerStatus) => {
             if (status.type === 'client_connected') {
               setStatus('connected');
               setConnected(true);
               if (status.clientAddress) setLog(`Client connected: ${status.clientAddress}`);
             } else if (status.type === 'error') {
               setStatus('error');
               if (status.message) setLog(status.message);
             } else if (status.type === 'progress' && status.fileProgress) {
               updateFileProgress(
                 status.fileProgress.name,
                 status.fileProgress.percent / 100
               );
             }
          };
        }
      },

      cleanupListeners: () => {
        TransferClient.onStatus = undefined;
        TransferServer.statusCallback = undefined;
      }
    }),
    {
      name: 'transfer-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        // Only persist these fields
        selectedItems: state.selectedItems,
        role: state.role,
        deviceName: state.deviceName
      }),
    }
  )
);

// Connection State Store
interface ConnectionState {
  isConnected: boolean;
  status: 'idle' | 'connecting' | 'connected' | 'error';
  connectionType: 'wifi-direct' | 'hotspot' | null;
  ipAddress: string;
  ssid: string;
  connectionLog: string;
  
  setConnected: (connected: boolean) => void;
  setStatus: (status: 'idle' | 'connecting' | 'connected' | 'error') => void;
  setLog: (log: string) => void;
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
      status: 'idle',
      connectionType: null,
      ipAddress: '',
      ssid: '',
      connectionLog: '',
      
      setConnected: (connected) => set({ isConnected: connected }),
      setStatus: (status) => set({ status }),
      setLog: (log) => set({ connectionLog: log }),
      
      setConnectionDetails: (details) => set({
        connectionType: details.type,
        ipAddress: details.ip || '',
        ssid: details.ssid || ''
      }),
      
      resetConnection: () => set({
        isConnected: false,
        status: 'idle',
        connectionType: null,
        ipAddress: '',
        ssid: '',
        connectionLog: ''
      }),
    }),
    {
      name: 'connection-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        // Don't persist logs or transient status usually, but maybe helpful for debugging.
        // Let's persist basic details.
        connectionType: state.connectionType,
        ipAddress: state.ipAddress,
        ssid: state.ssid
      })
    }
  )
);

// Media State Store (No persistence - too large for AsyncStorage)
interface MediaState {
  photos: any[];
  videos: any[];
  documents: any[];
  audio: any[];
  contacts: any[];
  apps: any[];
  
  isLoading: boolean;
  error: string | null;
  
  setPhotos: (photos: any[]) => void;
  setVideos: (videos: any[]) => void;
  setDocuments: (documents: any[]) => void;
  setAudio: (audio: any[]) => void;
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
  audio: [],
  contacts: [],
  apps: [],
  isLoading: false,
  error: null,
  
  setPhotos: (photos) => set({ photos }),
  setVideos: (videos) => set({ videos }),
  setDocuments: (documents) => set({ documents }),
  setAudio: (audio) => set({ audio }),
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
    audio: [],
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
