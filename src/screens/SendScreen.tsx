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
  SafeAreaView
} from 'react-native';
import { CameraRoll } from "@react-native-camera-roll/camera-roll";
import RNFS from 'react-native-fs';
import DocumentPicker from 'react-native-document-picker';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';
import DeviceInfo from 'react-native-device-info';
import Contacts from 'react-native-contacts';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../theme/ThemeContext';
import { useTransferStore, useMediaStore, useUIStore, useConnectionStore } from '../store';

const { width } = Dimensions.get('window');

const SendScreen = ({ navigation, route }: any) => {
  const { colors, typography, layout, spacing, isDark } = useTheme();

  // Zustand stores
  const { selectedItems, toggleItem, clearSelection } = useTransferStore();
  const { isConnected, ipAddress } = useConnectionStore();
  const {
    photos,
    videos,
    documents,
    contacts,
    apps,
    isLoading,
    setPhotos,
    setVideos,
    setDocuments,
    setContacts,
    setApps,
    addDocuments,
    setLoading,
  } = useMediaStore();
  const { activeTab, permissionGranted, setActiveTab, setPermissionGranted } = useUIStore();

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
      const photos = await CameraRoll.getPhotos({
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
        photos.edges.map(async (e) => {
          const uri = e.node.image.uri;
          let size = e.node.image.fileSize || 0;
          let filePath = e.node.image.filepath || uri;

          // Try to get actual size if CameraRoll didn't provide it
          if (size === 0) {
            try {
              // RNFS.stat supports content:// URIs on Android in most cases
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
            size: size
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
            duration: e.node.image.playableDuration
          };
        })
      );

      setPhotos(photosWithSize);
      setVideos(videosWithSize);


      // Dummy apps for demo (Real app scanning requires native modules)
      setApps([
        { id: '1', name: 'Instagram', size: 45000000, icon: 'instagram', type: 'app', packageName: 'com.instagram.android' },
        { id: '2', name: 'WhatsApp', size: 35000000, icon: 'whatsapp', type: 'app', packageName: 'com.whatsapp' },
        { id: '3', name: 'Spotify', size: 85000000, icon: 'spotify', type: 'app', packageName: 'com.spotify.music' },
      ]);

    } catch (error) {
      console.log('Error loading media:', error);
      Alert.alert("Access Denied", "Cannot load media. Please allow access in Settings.");
    } finally {
      setLoading(false);
    }
  };

  const pickDocument = async () => {
    try {
      const res = await DocumentPicker.pick({
        type: [DocumentPicker.types.allFiles],
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
      if (!DocumentPicker.isCancel(err)) {
        console.log(err);
      }
    }
  };

  const toggleSelection = (item: any) => {
    toggleItem(item);
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const s = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
  };

  const handleSend = () => {
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
  };

  const renderPhotoItem = ({ item }: { item: any }) => {
    const isSelected = selectedItems.find(i => i.id === item.id);
    return (
      <TouchableOpacity onPress={() => toggleSelection(item)} style={styles.gridItem}>
        <Image source={{ uri: item.uri }} style={styles.gridImage} />
        <View style={[styles.selectionOverlay, isSelected && { backgroundColor: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)' }]}>
          <View style={[styles.checkbox, isSelected && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
            {isSelected && <Icon name="check" size={14} color="#FFF" />}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderVideoItem = ({ item }: { item: any }) => {
    const isSelected = selectedItems.find(i => i.id === item.id);
    return (
      <TouchableOpacity onPress={() => toggleSelection(item)} style={styles.gridItem}>
        <Image source={{ uri: item.uri }} style={styles.gridImage} />
        <View style={styles.videoBadge}>
          <Icon name="play-circle-outline" size={16} color="#FFF" />
          <Text style={styles.durationText}>{(item.duration / 60).toFixed(1)}m</Text>
        </View>
        <View style={[styles.selectionOverlay, isSelected && { backgroundColor: 'rgba(0,0,0,0.3)' }]}>
          <View style={[styles.checkbox, isSelected && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
            {isSelected && <Icon name="check" size={14} color="#FFF" />}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderFileItem = ({ item }: { item: any }) => {
    const isSelected = selectedItems.find(i => i.id === item.id);
    const getIcon = () => {
      if (item.type === 'app') return 'android';
      if (item.mime?.includes('pdf')) return 'file-pdf-box';
      return 'file-document-outline';
    };

    return (
      <TouchableOpacity 
        onPress={() => toggleSelection(item)} 
        style={[
          styles.listItem,
          {
            backgroundColor: colors.surface,
            borderBottomColor: colors.border
          }
        ]}
      >
        <View style={[styles.listIconBox, { backgroundColor: item.type === 'app' ? '#E8F5E9' : '#E3F2FD' }]}>
          <Icon
            name={item.icon || getIcon()}
            size={28}
            color={item.type === 'app' ? '#4CAF50' : '#2196F3'}
          />
        </View>
        <View style={styles.listDetails}>
          <Text style={[styles.listName, { color: colors.text, fontFamily: typography.fontFamily }]} numberOfLines={1}>{item.name}</Text>
          <Text style={[styles.listSize, { color: colors.subtext, fontFamily: typography.fontFamily }]}>{formatSize(item.size)}</Text>
        </View>
        <View style={[styles.checkbox, isSelected && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
          {isSelected && <Icon name="check" size={14} color="#FFF" />}
        </View>
      </TouchableOpacity>
    );
  };

  const renderContactItem = ({ item }: { item: any }) => {
    const isSelected = selectedItems.find(i => i.id === item.id);
    const initial = item.name.charAt(0).toUpperCase();

    return (
      <TouchableOpacity 
        onPress={() => toggleSelection(item)} 
        style={[
          styles.listItem,
          {
            backgroundColor: colors.surface,
            borderBottomColor: colors.border
          }
        ]}
      >
        <View style={[styles.listIconBox, { backgroundColor: '#F3E5F5' }]}>
          <Text style={{ fontSize: 20, fontWeight: '700', color: '#9C27B0' }}>{initial}</Text>
        </View>
        <View style={styles.listDetails}>
          <Text style={[styles.listName, { color: colors.text, fontFamily: typography.fontFamily }]} numberOfLines={1}>{item.name}</Text>
          <Text style={[styles.listSize, { color: colors.subtext, fontFamily: typography.fontFamily }]}>
            {item.phoneNumbers[0]?.number || 'No number'}
          </Text>
        </View>
        <View style={[styles.checkbox, isSelected && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
          {isSelected && <Icon name="check" size={14} color="#FFF" />}
        </View>
      </TouchableOpacity>
    );
  };

  const renderContent = () => {
    if (activeTab === 'photos') return (
      <FlatList
        key="photos"
        data={photos}
        numColumns={3}
        renderItem={renderPhotoItem}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.gridContent}
      />
    );
    if (activeTab === 'videos') return (
      <FlatList
        key="videos"
        data={videos}
        numColumns={3}
        renderItem={renderVideoItem}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.gridContent}
      />
    );
    if (activeTab === 'contacts') return (
      <FlatList
        key="contacts"
        data={contacts}
        renderItem={renderContactItem}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
      />
    );
    /* 
       Merge docs and apps for simpler list view, 
       or keep separate if needed. 
       Here we separate by tabs. 
    */
    if (activeTab === 'files') return (
      <View style={{ flex: 1 }}>
        <TouchableOpacity style={styles.pickDocBtn} onPress={pickDocument}>
          <Icon name="folder-plus" size={24} color={colors.primary} />
          <Text style={[styles.pickDocText, { color: colors.primary, fontFamily: typography.fontFamily }]}>Browse Documents</Text>
        </TouchableOpacity>
        <FlatList
          key="files"
          data={[...apps, ...documents]}
          renderItem={renderFileItem}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
        />
      </View>
    );
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
  gridItem: { width: width / 3 - 6, height: width / 3 - 6, margin: 3, borderRadius: 8, overflow: 'hidden' },
  gridImage: { width: '100%', height: '100%' },
  selectionOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-start', alignItems: 'flex-end', padding: 8 },
  checkbox: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#FFF', justifyContent: 'center', alignItems: 'center' },
  videoBadge: { position: 'absolute', bottom: 5, left: 5, flexDirection: 'row', alignItems: 'center' },
  durationText: { color: '#FFF', fontSize: 10, marginLeft: 3 },
  listContent: { padding: 20, paddingBottom: 100 },
  pickDocBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 15, marginBottom: 15, borderRadius: 12, borderWidth: 1, borderColor: '#DDD', borderStyle: 'dashed' },
  pickDocText: { fontSize: 16, fontWeight: '600', marginLeft: 10 },
  listItem: { flexDirection: 'row', alignItems: 'center', padding: 12, marginBottom: 10, borderRadius: 16, borderBottomWidth: 1 },
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
});

export default SendScreen;
