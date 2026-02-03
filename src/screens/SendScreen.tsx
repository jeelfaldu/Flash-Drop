import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  FlatList,
  PermissionsAndroid,
  Platform,
  Alert,
  Dimensions,
  ActivityIndicator,
  TextInput,
  StatusBar,
  SafeAreaView,
  Modal
} from 'react-native';
import { CameraRoll } from "@react-native-camera-roll/camera-roll";
import RNFS from 'react-native-fs';
import { pick, types, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';
import DeviceInfo from 'react-native-device-info';
import Contacts from 'react-native-contacts';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../theme/ThemeContext';
import { useTransferStore, useMediaStore, useUIStore, useConnectionStore } from '../store';

import { PhotosTab } from '../components/send/PhotosTab';
import { VideosTab } from '../components/send/VideosTab';
import { ContactsTab } from '../components/send/ContactsTab';
import { FilesTab } from '../components/send/FilesTab';

const { width } = Dimensions.get('window');

const SendScreen = ({ navigation, route }: any) => {
  const { colors, typography, layout, spacing, isDark } = useTheme();

  // Zustand stores
  const { selectedItems, toggleItem, clearSelection, setSelectedItems } = useTransferStore();
  const { isConnected, ipAddress } = useConnectionStore();
  const {
    photos,
    videos,
    documents,
    audio,
    contacts,
    apps,
    isLoading,
    setPhotos,
    setVideos,
    setDocuments,
    setAudio,
    setContacts,
    setApps,
    addDocuments,
    setLoading,
  } = useMediaStore();
  const { activeTab, permissionGranted, setActiveTab, setPermissionGranted } = useUIStore();
  const [fileCategory, setFileCategory] = useState<'audio' | 'docs' | 'apps' | 'browser'>('browser');
  const [previewItem, setPreviewItem] = useState<any>(null);

  useEffect(() => {
    checkPermissions();
  }, []);

  const checkPermissions = async () => {
    if (Platform.OS === 'android') {
      try {
        const apiLevel = await DeviceInfo.getApiLevel();
        let permissions = [
          PermissionsAndroid.PERMISSIONS.READ_CONTACTS
        ];

        if (apiLevel >= 33) {
          permissions.push(
            PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
            PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO
          );
        } else {
          permissions.push(
            PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
            PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE
          );
        }

        const result = await PermissionsAndroid.requestMultiple(permissions);

        const granted = Object.values(result).every(
          r => r === PermissionsAndroid.RESULTS.GRANTED || r === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
        );

        setPermissionGranted(true);
        loadMedia();
        loadContacts(); // Load contacts after permission check
      } catch (err) {
        console.warn(err);
        setLoading(false);
        Alert.alert("Error", "Failed to check permissions");
      }
    } else {
      setPermissionGranted(true);
      loadMedia();
      loadContacts();
    }
  };

  const loadContacts = async () => {
    try {
      const allContacts = await Contacts.getAll();
      const formatted = allContacts.map((c, index) => ({
        id: c.recordID || index.toString(),
        name: [c.givenName, c.familyName].filter(Boolean).join(' '),
        phoneNumbers: c.phoneNumbers,
        type: 'contact',
        size: 200, // Approximate size for VCF
        icon: 'account'
      })).filter(c => c.name); // Filter out empty names
      setContacts(formatted.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (e) {
      console.log("Error loading contacts", e);
    }
  };

  const loadMedia = async () => {
    setLoading(true);
    try {
      const photosData = await CameraRoll.getPhotos({
        first: 100,
        assetType: 'Photos',
        include: ['fileSize', 'filename', 'imageSize']
      });
      const videoData = await CameraRoll.getPhotos({
        first: 50,
        assetType: 'Videos',
        include: ['fileSize', 'filename', 'playableDuration']
      });


      // Get actual file sizes using RNFS
      const photosWithSize = await Promise.all(
        photosData.edges.map(async (e) => {
          const uri = e.node.image.uri;
          let size = e.node.image.fileSize || 0;
          let filePath = e.node.image.filepath || uri;

          if (size === 0) {
            try {
              const stat = await RNFS.stat(uri);
              size = stat.size;
            } catch (err) {
              console.log('Could not stat photo:', uri, err);
            }
          }

          return {
            id: uri,
            uri: uri,
            type: 'image',
            folderPath: filePath,
            name: e.node.image.filename || `IMG_${Date.now()}.jpg`,
            size: size,
            timestamp: e.node.timestamp
          };
        })
      );

      const videosWithSize = await Promise.all(
        videoData.edges.map(async (e) => {
          const uri = e.node.image.uri;
          let size = e.node.image.fileSize || 0;
          let filePath = e.node.image.filepath || uri;

          if (size === 0) {
            try {
              const stat = await RNFS.stat(uri);
              size = stat.size;
            } catch (err) {
              console.log('Could not stat video:', uri, err);
            }
          }

          return {
            id: uri,
            uri: uri,
            type: 'video',
            folderPath: filePath,
            name: e.node.image.filename || `VID_${Date.now()}.mp4`,
            size: size,
            duration: e.node.image.playableDuration,
            timestamp: e.node.timestamp
          };
        })
      );

      setPhotos(photosWithSize);
      setVideos(videosWithSize);

      // Scan for other files on Android
      if (Platform.OS === 'android') {
        await scanStorageFiles();
      }

    } catch (error) {
      console.log('Error loading media:', error);
      Alert.alert("Access Denied", "Cannot load media. Please allow access in Settings.");
    } finally {
      setLoading(false);
    }
  };

  const scanStorageFiles = async () => {
    try {
      const rootPath = RNFS.ExternalStorageDirectoryPath;
      let foundDocs: any[] = [];
      let foundAudio: any[] = [];
      let foundApps: any[] = [];

      const walkDir = async (dirPath: string, depth = 0) => {
        // Limit depth to 8 for performance
        if (depth > 8) return;

        try {
          const items = await RNFS.readDir(dirPath);
          for (const item of items) {
            if (item.isDirectory()) {
              // Ignore hidden folders and specific system folders
              if (item.name.startsWith('.') || ['data', 'obb', 'lost+found'].includes(item.name)) continue;

              await walkDir(item.path, depth + 1);
            } else if (item.isFile()) {
              const ext = item.name.split('.').pop()?.toLowerCase() || '';
              const fileItem = {
                id: item.path,
                uri: `file://${item.path}`,
                name: item.name,
                size: item.size,
                type: 'document' as const,
                mime: ext
              };

              if (['mp3', 'wav', 'm4a', 'aac', 'flac'].includes(ext)) {
                fileItem.type = 'audio' as any;
                foundAudio.push(fileItem);
              } else if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'ppt', 'pptx'].includes(ext)) {
                foundDocs.push(fileItem);
              } else if (ext === 'apk') {
                fileItem.type = 'app' as any;
                foundApps.push(fileItem);
              }
            }
          }
        } catch (e) {
          // Skip folders we can't access
        }
      };

      // Comprehensive scan roots for modern Android
      const scanRoots = [];
      if (rootPath) {
        scanRoots.push(
          `${rootPath}/Download`,
          `${rootPath}/Downloads`,
          `${rootPath}/Documents`,
          `${rootPath}/WhatsApp/Media`,
          `${rootPath}/Android/media/com.whatsapp/WhatsApp/Media`,
          `${rootPath}/Telegram`,
          `${rootPath}/Bluetooth`
        );
      }

      // Add direct system paths if they exist
      if (RNFS.DownloadDirectoryPath) scanRoots.push(RNFS.DownloadDirectoryPath);

      // Filter out duplicates and nulls
      const uniqueRoots = [...new Set(scanRoots.filter(Boolean))];

      for (const root of uniqueRoots) {
        if (await RNFS.exists(root)) {
          await walkDir(root);
        }
      }

      if (foundDocs.length > 0) setDocuments(foundDocs);
      if (foundAudio.length > 0) setAudio(foundAudio);
      if (foundApps.length > 0) setApps(foundApps);

    } catch (err) {
      console.log('Global scan error:', err);
    }
  };

  const pickDocument = async () => {
    try {
      const res = await pick({
        type: [types.allFiles],
        allowMultiSelection: true
      });
      
      const newDocs = await Promise.all(res.map(async (doc) => {
        let size = doc.size || 0;

        if (size === 0) {
          try {
            const stat = await RNFS.stat(doc.uri);
            size = stat.size;
          } catch (e) {
            console.log('Could not stat picked document:', doc.uri, e);
          }
        }

        return {
          id: doc.uri,
          uri: doc.uri,
          name: doc.name,
          size: size,
          type: 'document',
          mime: doc.type
        };
      }));

      addDocuments(newDocs);
      newDocs.forEach((d: any) => toggleItem(d));
    } catch (err) {
      if (isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED) {
        // user cancelled
      } else {
        console.log(err);
      }
    }
  };

  const toggleSelection = useCallback((item: any) => {
    toggleItem(item);
  }, [toggleItem]);

  const formatSize = useCallback((bytes: number) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const s = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
  }, []);

  const handleSend = useCallback(() => {
    if (selectedItems.length === 0) return;
    
    if (isConnected) {
      navigation.navigate('FileTransfer', { 
        role: 'sender',
        initialFiles: selectedItems,
        deviceName: 'Connected Device'
      });
    } else {
      navigation.navigate('Sharing', { items: selectedItems });
    }

    setTimeout(() => {
      clearSelection();
    }, 500);
  }, [selectedItems, isConnected, navigation, clearSelection]);

  const toggleDateSelection = useCallback((dateItems: any[]) => {
    const allSelected = dateItems.every(p => selectedItems.find(i => i.id === p.id));
    if (allSelected) {
      const idsToRemove = new Set(dateItems.map(p => p.id));
      setSelectedItems(selectedItems.filter(i => !idsToRemove.has(i.id)));
    } else {
      const newSelections = [...selectedItems];
      const selectedIds = new Set(selectedItems.map(i => i.id));
      dateItems.forEach(p => {
        if (!selectedIds.has(p.id)) {
          newSelections.push(p);
        }
      });
      setSelectedItems(newSelections);
    }
  }, [selectedItems, setSelectedItems]);

  const renderContent = () => {
    const commonProps = {
      selectedItems,
      toggleSelection,
      colors,
      typography,
      styles,
      onPreview: (item: any) => setPreviewItem(item),
    };

    switch (activeTab) {
      case 'photos':
        return <PhotosTab {...commonProps} photos={photos} toggleDateSelection={toggleDateSelection} />;
      case 'videos':
        return <VideosTab {...commonProps} videos={videos} toggleDateSelection={toggleDateSelection} formatSize={formatSize} />;
      case 'contacts':
        return <ContactsTab {...commonProps} contacts={contacts} toggleAllSelection={toggleDateSelection} />;
      case 'files':
        return (
          <FilesTab
            {...commonProps}
            documents={documents}
            audio={audio}
            apps={apps}
            fileCategory={fileCategory}
            setFileCategory={setFileCategory}
            pickDocument={pickDocument}
            formatSize={formatSize} 
          />
        );
      default:
        return null;
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* Header */}
      <View style={styles.headerWrapper}>
        <LinearGradient
          colors={colors.gradient}
          style={styles.headerGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
        <SafeAreaView>
          <View style={styles.headerContent}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconButton}>
              <Icon name="arrow-left" size={24} color="#FFF" />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { fontFamily: typography.fontFamily }]}>Send Files</Text>
            <View style={{ width: 40 }} />
          </View>

          <View style={styles.tabBar}>
            <TouchableOpacity onPress={() => setActiveTab('photos')} style={[styles.tabItem, activeTab === 'photos' && styles.activeTabItem]}>
              <Text style={[styles.tabText, activeTab === 'photos' ? { color: '#FFF' } : { color: 'rgba(255,255,255,0.7)' }]}>Photos</Text>
              {activeTab === 'photos' && <View style={styles.activeIndicator} />}
                </TouchableOpacity>
            <TouchableOpacity onPress={() => setActiveTab('videos')} style={[styles.tabItem, activeTab === 'videos' && styles.activeTabItem]}>
              <Text style={[styles.tabText, activeTab === 'videos' ? { color: '#FFF' } : { color: 'rgba(255,255,255,0.7)' }]}>Videos</Text>
              {activeTab === 'videos' && <View style={styles.activeIndicator} />}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setActiveTab('contacts')} style={[styles.tabItem, activeTab === 'contacts' && styles.activeTabItem]}>
              <Text style={[styles.tabText, activeTab === 'contacts' ? { color: '#FFF' } : { color: 'rgba(255,255,255,0.7)' }]}>Contacts</Text>
              {activeTab === 'contacts' && <View style={styles.activeIndicator} />}
                </TouchableOpacity>
            <TouchableOpacity onPress={() => setActiveTab('files')} style={[styles.tabItem, activeTab === 'files' && styles.activeTabItem]}>
              <Text style={[styles.tabText, activeTab === 'files' ? { color: '#FFF' } : { color: 'rgba(255,255,255,0.7)' }]}>Files</Text>
              {activeTab === 'files' && <View style={styles.activeIndicator} />}
                </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>

      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={{ marginTop: 10, color: colors.subtext }}>Loading Media...</Text>
        </View>
      ) : (
        <View style={styles.content}>
          {renderContent()}
        </View>
      )}

      {selectedItems.length > 0 && (
        <View style={[styles.footer, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
          <View style={styles.selectedInfo}>
            <Text style={[styles.selectedCount, { color: colors.text, fontFamily: typography.fontFamily }]}>
              {selectedItems.length} Selected
            </Text>
            <Text style={[styles.selectedSize, { color: colors.subtext, fontFamily: typography.fontFamily }]}>
              {formatSize(selectedItems.reduce((acc, i) => acc + i.size, 0))}
            </Text>
          </View>
          <TouchableOpacity onPress={handleSend}>
            <LinearGradient colors={colors.gradient} style={styles.sendBtn} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
              <Text style={[styles.sendBtnText, { fontFamily: typography.fontFamily }]}>Send</Text>
              <Icon name="send" size={20} color="#FFF" />
            </LinearGradient>
          </TouchableOpacity>
        </View>
      )}

      {/* Media Preview Modal */}
      <Modal
        visible={!!previewItem}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setPreviewItem(null)}
      >
        <TouchableOpacity
          style={styles.previewContainer}
          activeOpacity={1}
          onPress={() => setPreviewItem(null)}
        >
          <View style={styles.previewContent}>
            <Image
              source={{ uri: previewItem?.uri }}
              style={styles.previewImage}
              resizeMode="contain"
            />
            <TouchableOpacity
              onPress={() => setPreviewItem(null)}
              style={styles.closePreview}
            >
              <Icon name="close" size={30} color="#FFF" />
            </TouchableOpacity>

            <View style={styles.previewDetails}>
              <Text style={styles.previewName} numberOfLines={2}>{previewItem?.name}</Text>
              <Text style={styles.previewSize}>{formatSize(previewItem?.size)}</Text>
            </View>

            <TouchableOpacity
              style={styles.previewSelectBtn}
              onPress={() => {
                toggleSelection(previewItem);
                setPreviewItem(null);
              }}
            >
              <LinearGradient
                colors={colors.gradient}
                style={styles.previewSelectGradient}
              >
                <Icon
                  name={selectedItems.find(i => i.id === previewItem?.id) ? "check-circle" : "plus-circle"}
                  size={20}
                  color="#FFF"
                />
                <Text style={styles.previewSelectText}>
                  {selectedItems.find(i => i.id === previewItem?.id) ? "Selected" : "Select File"}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerWrapper: {
    backgroundColor: 'transparent',
    zIndex: 10,
    paddingBottom: 10
  },
  headerGradient: {
    ...StyleSheet.absoluteFillObject,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 50 : 20,
    paddingBottom: 15,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFF',
  },
  iconButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  tabBar: { flexDirection: 'row', paddingHorizontal: 10, marginTop: 10 },
  tabItem: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  activeTabItem: {},
  tabText: { fontSize: 13, fontWeight: '600' },
  activeIndicator: { width: 20, height: 3, backgroundColor: '#FFF', borderRadius: 2, marginTop: 4 },
  content: { flex: 1 },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  gridContent: { padding: 5, paddingBottom: 100 },
  gridItem: { width: width / 4 - 6, height: width / 4 - 6, margin: 3, borderRadius: 8, overflow: 'hidden' },
  gridImage: { width: '100%', height: '100%' },
  selectionOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-start', alignItems: 'flex-end', padding: 8 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#BBB',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)'
  },
  videoBadge: { position: 'absolute', bottom: 5, left: 5, flexDirection: 'row', alignItems: 'center' },
  durationText: { color: '#FFF', fontSize: 10, marginLeft: 3 },
  videoListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderBottomWidth: 0.5,
  },
  videoThumbContainer: {
    width: 100,
    height: 60,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  videoThumb: {
    width: '100%',
    height: '100%',
  },
  videoDurationBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
  },
  videoDurationText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '600',
  },
  videoInfo: {
    flex: 1,
    marginLeft: 15,
  },
  videoName: {
    fontSize: 14,
    fontWeight: '600',
  },
  videoSize: {
    fontSize: 12,
    marginTop: 4,
    opacity: 0.6,
  },
  listContent: { padding: 20, paddingBottom: 100 },
  pickDocBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 15, marginBottom: 15, borderRadius: 12, borderWidth: 1, borderColor: '#DDD', borderStyle: 'dashed' },
  pickDocText: { fontSize: 16, fontWeight: '600', marginLeft: 10 },
  categoryFilterRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 10,
    marginTop: 15,
  },
  categoryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 10,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  categoryBtnText: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 6,
  },
  dateSection: {
    marginBottom: 20,
  },
  dateHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 15,
    paddingVertical: 4,
    borderBottomWidth: 1,
    marginVertical: 8,
  },
  dateTitle: {
    fontSize: 15,
    fontWeight: '700',
    opacity: 0.8,
  },
  headerCheckbox: {
    padding: 4,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: '500',
  },
  listItem: { flexDirection: 'row', alignItems: 'center', padding: 8, marginBottom: 8, borderRadius: 16, borderBottomWidth: 1 },
  listIconBox: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 15 },
  listDetails: { flex: 1 },
  listName: { fontSize: 16, fontWeight: '600' },
  listSize: { fontSize: 12, marginTop: 2 },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', padding: 20, borderTopWidth: 1, elevation: 10 },
  selectedInfo: { flex: 1 },
  selectedCount: { fontSize: 16, fontWeight: '700' },
  selectedSize: { fontSize: 13 },
  sendBtn: { flexDirection: 'row', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 30, alignItems: 'center' },
  sendBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700', marginRight: 8 },
  previewContainer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewContent: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewImage: {
    width: '90%',
    height: '70%',
    borderRadius: 12,
  },
  closePreview: {
    position: 'absolute',
    top: 50,
    right: 20,
    padding: 10,
  },
  previewDetails: {
    position: 'absolute',
    bottom: 120,
    left: 20,
    right: 20,
  },
  previewName: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  previewSize: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 4,
  },
  previewSelectBtn: {
    position: 'absolute',
    bottom: 50,
    width: '60%',
  },
  previewSelectGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 30,
    gap: 10,
  },
  previewSelectText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
});

export default SendScreen;
