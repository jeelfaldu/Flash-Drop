import { create } from 'zustand';

// ─────────────────────────────────────────────────────────────────────────────
// Media Store
// Handles all device media fetching: photos, videos, contacts, files & APKs.
// Logic moved here from SendScreen so the screen stays pure UI.
// ─────────────────────────────────────────────────────────────────────────────

interface MediaState {
  photos: any[];
  videos: any[];
  documents: any[];
  audio: any[];
  contacts: any[];
  apps: any[];

  isLoading: boolean;
  hasLoaded: boolean; // skip re-fetch if already loaded
  error: string | null;

  // Raw setters
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

  // Async actions
  loadContacts: () => Promise<void>;
  loadMedia: () => Promise<void>;
  scanStorageFiles: () => Promise<void>;
  checkPermissionsAndLoad: () => Promise<void>;
  pickAndAddDocument: () => Promise<any[]>; // returns picked docs so caller can toggle selection
}

export const useMediaStore = create<MediaState>((set, get) => ({
  photos: [],
  videos: [],
  documents: [],
  audio: [],
  contacts: [],
  apps: [],
  isLoading: false,
  hasLoaded: false,
  error: null,

  // ── Raw setters ────────────────────────────────────────────────────────────
  setPhotos: (photos) => set({ photos }),
  setVideos: (videos) => set({ videos }),
  setDocuments: (documents) => set({ documents }),
  setAudio: (audio) => set({ audio }),
  setContacts: (contacts) => set({ contacts }),
  setApps: (apps) => set({ apps }),

  addDocuments: (newDocs) =>
    set((state) => ({ documents: [...state.documents, ...newDocs] })),

  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),

  clearAll: () =>
    set({
      photos: [],
      videos: [],
      documents: [],
      audio: [],
      contacts: [],
      apps: [],
      isLoading: false,
      hasLoaded: false,
      error: null,
    }),

  // ── Async actions ──────────────────────────────────────────────────────────

  loadContacts: async () => {
    try {
      const Contacts = require('react-native-contacts').default;
      const allContacts = await Contacts.getAll();
      const formatted = allContacts
        .map((c: any, index: number) => ({
          id: c.recordID || index.toString(),
          name: [c.givenName, c.familyName].filter(Boolean).join(' '),
          phoneNumbers: c.phoneNumbers,
          type: 'contact',
          size: 200,
          icon: 'account',
        }))
        .filter((c: any) => c.name);
      set({ contacts: formatted.sort((a: any, b: any) => a.name.localeCompare(b.name)) });
    } catch (e) {
      console.log('Error loading contacts', e);
    }
  },

  scanStorageFiles: async () => {
    try {
      const RNFS = require('react-native-fs').default;
      const rootPath = RNFS.ExternalStorageDirectoryPath;
      const foundDocs: any[] = [];
      const foundAudio: any[] = [];
      const foundApps: any[] = [];

      const walkDir = async (dirPath: string, depth = 0): Promise<void> => {
        if (depth > 8) return;
        try {
          const items = await RNFS.readDir(dirPath);
          for (const item of items) {
            if (item.isDirectory()) {
              if (
                item.name.startsWith('.') ||
                ['data', 'obb', 'lost+found'].includes(item.name)
              )
                continue;
              await walkDir(item.path, depth + 1);
            } else if (item.isFile()) {
              const ext = item.name.split('.').pop()?.toLowerCase() || '';
              const fileItem: any = {
                id: item.path,
                uri: `file://${item.path}`,
                name: item.name,
                size: item.size,
                type: 'document',
                mime: ext,
              };
              if (['mp3', 'wav', 'm4a', 'aac', 'flac'].includes(ext)) {
                fileItem.type = 'audio';
                foundAudio.push(fileItem);
              } else if (
                ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'ppt', 'pptx'].includes(ext)
              ) {
                foundDocs.push(fileItem);
              } else if (ext === 'apk') {
                fileItem.type = 'app';
                foundApps.push(fileItem);
              }
            }
          }
        } catch (_) {}
      };

      const scanRoots: string[] = [];
      if (rootPath) {
        scanRoots.push(
          `${rootPath}/Download`,
          `${rootPath}/Downloads`,
          `${rootPath}/Documents`,
          `${rootPath}/WhatsApp/Media`,
          `${rootPath}/Android/media/com.whatsapp/WhatsApp/Media`,
          `${rootPath}/Telegram`,
          `${rootPath}/Bluetooth`,
        );
      }
      if (RNFS.DownloadDirectoryPath) scanRoots.push(RNFS.DownloadDirectoryPath);
      const uniqueRoots = [...new Set(scanRoots.filter(Boolean))];

      for (const root of uniqueRoots) {
        if (await RNFS.exists(root)) await walkDir(root);
      }

      if (foundDocs.length > 0) set({ documents: foundDocs });
      if (foundAudio.length > 0) set({ audio: foundAudio });
      if (foundApps.length > 0) set({ apps: foundApps });
    } catch (err) {
      console.log('Global scan error:', err);
    }
  },

  loadMedia: async () => {
    const { Platform } = require('react-native');
    const { CameraRoll } = require('@react-native-camera-roll/camera-roll');
    const RNFS = require('react-native-fs').default;

    set({ isLoading: true });
    try {
      const [photosData, videoData] = await Promise.all([
        CameraRoll.getPhotos({
          first: 100,
          assetType: 'Photos',
          include: ['fileSize', 'filename', 'imageSize'],
        }),
        CameraRoll.getPhotos({
          first: 50,
          assetType: 'Videos',
          include: ['fileSize', 'filename', 'playableDuration'],
        }),
      ]);

      const statFile = async (uri: string, fallbackSize: number) => {
        if (fallbackSize > 0) return fallbackSize;
        try {
          return (await RNFS.stat(uri)).size;
        } catch (_) {
          return 0;
        }
      };

      const photosWithSize = await Promise.all(
        photosData.edges.map(async (e: any) => {
          const uri = e.node.image.uri;
          const size = await statFile(uri, e.node.image.fileSize || 0);
          return {
            id: uri,
            uri,
            type: 'image',
            folderPath: e.node.image.filepath || uri,
            name: e.node.image.filename || `IMG_${Date.now()}.jpg`,
            size,
            timestamp: e.node.timestamp,
          };
        }),
      );

      const videosWithSize = await Promise.all(
        videoData.edges.map(async (e: any) => {
          const uri = e.node.image.uri;
          const size = await statFile(uri, e.node.image.fileSize || 0);
          return {
            id: uri,
            uri,
            type: 'video',
            folderPath: e.node.image.filepath || uri,
            name: e.node.image.filename || `VID_${Date.now()}.mp4`,
            size,
            duration: e.node.image.playableDuration,
            timestamp: e.node.timestamp,
          };
        }),
      );

      set({ photos: photosWithSize, videos: videosWithSize });

      if (Platform.OS === 'android') {
        await get().scanStorageFiles();
      }
    } catch (error) {
      console.log('Error loading media:', error);
      set({ error: 'Failed to load media' });
    } finally {
      set({ isLoading: false, hasLoaded: true });
    }
  },

  checkPermissionsAndLoad: async () => {
    const { Platform, PermissionsAndroid } = require('react-native');
    if (get().hasLoaded) return; // already loaded, skip

    if (Platform.OS === 'android') {
      try {
        const DeviceInfo = require('react-native-device-info').default;
        const apiLevel = await DeviceInfo.getApiLevel();
        const permissions = [PermissionsAndroid.PERMISSIONS.READ_CONTACTS];
        if (apiLevel >= 33) {
          permissions.push(
            PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
            PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO,
          );
        } else {
          permissions.push(
            PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
            PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
          );
        }
        await PermissionsAndroid.requestMultiple(permissions);
      } catch (err) {
        console.warn(err);
      }
    }

    await Promise.all([get().loadMedia(), get().loadContacts()]);
  },

  pickAndAddDocument: async () => {
    const { pick, types, isErrorWithCode, errorCodes } = require('@react-native-documents/picker');
    const RNFS = require('react-native-fs').default;
    try {
      const res = await pick({ type: [types.allFiles], allowMultiSelection: true });
      const newDocs = await Promise.all(
        res.map(async (doc: any) => {
          let size = doc.size || 0;
          if (size === 0) {
            try {
              size = (await RNFS.stat(doc.uri)).size;
            } catch (_) {}
          }
          return { id: doc.uri, uri: doc.uri, name: doc.name, size, type: 'document', mime: doc.type };
        }),
      );
      get().addDocuments(newDocs);
      return newDocs;
    } catch (err: any) {
      const { isErrorWithCode: check, errorCodes: codes } = require('@react-native-documents/picker');
      if (check(err) && err.code === codes.OPERATION_CANCELED) return [];
      console.log(err);
      return [];
    }
  },
}));
