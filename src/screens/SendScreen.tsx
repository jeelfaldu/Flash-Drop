import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  FlatList,
  Platform,
  Dimensions,
  ActivityIndicator,
  StatusBar,
  SafeAreaView,
  Modal
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';
import { useTheme } from '../theme/ThemeContext';
import { useTransferStore, useMediaStore, useUIStore, useConnectionStore } from '../store';
import TransferServer from '../utils/TransferServer';

import { PhotosTab } from '../components/send/PhotosTab';
import { VideosTab } from '../components/send/VideosTab';
import { ContactsTab } from '../components/send/ContactsTab';
import { FilesTab } from '../components/send/FilesTab';

const { width } = Dimensions.get('window');

const SendScreen = ({ navigation, route }: any) => {
  const { colors, typography, layout, spacing, isDark } = useTheme();

  // Zustand stores
  const { selectedItems, toggleItem, clearSelection, setSelectedItems, setFiles, setTransferStats } = useTransferStore();
  const { isConnected } = useConnectionStore();
  const {
    photos,
    videos,
    documents,
    audio,
    contacts,
    apps,
    isLoading,
    checkPermissionsAndLoad,
    pickAndAddDocument,
  } = useMediaStore();
  const { activeTab, setActiveTab } = useUIStore();
  const [fileCategory, setFileCategory] = useState<'audio' | 'docs' | 'apps' | 'browser'>('browser');
  const [previewItem, setPreviewItem] = useState<any>(null);

  // On mount: permissions + media load handled entirely by the store
  useEffect(() => {
    checkPermissionsAndLoad();
  }, []);

  // pickDocument: store handles fetching, we just toggle the picked docs into selection
  const pickDocument = useCallback(async () => {
    const newDocs = await pickAndAddDocument();
    newDocs.forEach((d: any) => toggleItem(d));
  }, [pickAndAddDocument, toggleItem]);

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
      // If already connected, update server list directly
      TransferServer.updateFiles(selectedItems);

      if (route.params?.keepConnection) {
        // Manually update store and go back to existing FileTransfer screen
        setFiles((prev: any) => {
          const updated = { ...prev };
          selectedItems.forEach((f: any) => {
            // Use filename as key to avoid duplicates
            if (!updated[f.name]) {
              updated[f.name] = {
                name: f.name,
                size: f.size,
                progress: 0,
                status: 'pending',
                type: f.type || 'file', // Ensure type exists
                uri: f.uri // Ensure uri exists for thumbnail
              };
            }
          });
          return updated;
        });

        const addedSize = selectedItems.reduce((acc, item) => acc + item.size, 0);
        setTransferStats((prev: any) => ({
          ...prev,
          totalSize: (prev.totalSize || 0) + addedSize
        }));

        navigation.goBack();
      } else {
        navigation.navigate('FileTransfer', {
          role: 'sender',
          initialFiles: selectedItems,
          deviceName: 'Connected Device'
        });
      }
    } else {
      navigation.navigate('Sharing', { items: selectedItems });
    }

    setTimeout(() => {
      clearSelection();
    }, 500);
  }, [selectedItems, isConnected, navigation, clearSelection, setFiles, setTransferStats, route.params]);

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
      <StatusBar barStyle="light-content" />

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
