import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Dimensions,
  StatusBar,
  Image,
  SafeAreaView,
  ScrollView,
  Alert,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';
import DocumentPicker from 'react-native-document-picker';
import Contacts from 'react-native-contacts';
import { CameraRoll } from "@react-native-camera-roll/camera-roll";
import RNFS from 'react-native-fs';
import { requestConnectPermissions } from '../utils/permissionHelper';
import { ActivityIndicator, Linking } from 'react-native';
import WifiManager from 'react-native-wifi-reborn';
import WifiP2PManager from '../utils/WifiP2PManager';

const { width } = Dimensions.get('window');

const SendScreen = ({ navigation }: any) => {
  const [activeTab, setActiveTab] = useState('Videos');
  const [activeSubTab, setActiveSubTab] = useState('All');
  const [activeFileSubTab, setActiveFileSubTab] = useState('Documents');
  const [selectedFolderName, setSelectedFolderName] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Real Data States
  const [videos, setVideos] = useState<any[]>([]);
  const [images, setImages] = useState<any[]>([]);
  const [videoFolders, setVideoFolders] = useState<any[]>([]);
  const [imageFolders, setImageFolders] = useState<any[]>([]);
  const [filesList, setFilesList] = useState<any[]>([]);
  const [contactsList, setContactsList] = useState<any[]>([]);

  const tabs = ['Files', 'Images', 'Videos', 'Contacts'];

  useEffect(() => {
    loadAllData();
  }, []);

  const loadAllData = async () => {
    if (isLoading) return;
    setIsLoading(true);
    const hasPermission = await requestConnectPermissions();
    if (!hasPermission) {
      Alert.alert('Permission Denied', 'Please grant permissions to access your files.');
      setIsLoading(false);
      return;
    }

    try {
      await Promise.all([
        fetchVideos(),
        fetchImages(),
        fetchFiles(),
        fetchContacts()
      ]);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchVideos = async () => {
    try {
      let allVideos: any[] = [];
      let hasNextPage = true;
      let afterCursor: string | undefined = undefined;

      while (hasNextPage) {
        const result = await CameraRoll.getPhotos({
          first: 100,
          after: afterCursor,
          assetType: 'Videos',
          include: ['fileSize', 'filename', 'playableDuration'],
        });

        const formatted = result.edges.map(edge => {
          const uri = edge.node.image.uri;
          let group = String(edge.node.group_name || 'Others');
          const folderPath = uri.includes('/') ? uri.substring(0, uri.lastIndexOf('/')) : group;
          
          if (group === 'Others' || group === 'All' || group === 'Recent' || group === 'CameraRoll') {
            const parts = folderPath.split('/');
            const last = parts[parts.length - 1];
            if (last && last !== 'media' && last !== '0' && last !== 'emulated') group = last;
          }

          return {
            id: uri || Math.random().toString(),
            type: 'video',
            duration: formatDuration(edge.node.image.playableDuration || 0),
            thumbnail: uri,
            uri: uri,
            name: edge.node.image.filename || 'Video',
            rawSize: edge.node.image.fileSize || 0,
            group: group,
            folderPath: folderPath
          };
        });

        allVideos = [...allVideos, ...formatted];
        hasNextPage = result.page_info.has_next_page;
        afterCursor = result.page_info.end_cursor;
        if (allVideos.length > 5000) break;
      }

      setVideos(allVideos);
      setVideoFolders(groupItemsByFolder(allVideos));
    } catch (e) {
      console.log('Video Fetch Error:', e);
    }
  };

  const fetchImages = async () => {
    try {
      let allImages: any[] = [];
      let hasNextPage = true;
      let afterCursor: string | undefined = undefined;

      while (hasNextPage) {
        const result = await CameraRoll.getPhotos({
          first: 100,
          after: afterCursor,
          assetType: 'Photos',
          include: ['fileSize', 'filename'],
        });

        const formatted = result.edges.map(edge => {
          const uri = edge.node.image.uri;
          let group = String(edge.node.group_name || 'Others');
          const folderPath = uri.includes('/') ? uri.substring(0, uri.lastIndexOf('/')) : group;

          if (group === 'Others' || group === 'All' || group === 'Recent' || group === 'CameraRoll') {
            const parts = folderPath.split('/');
            const last = parts[parts.length - 1];
            if (last && last !== 'media' && last !== '0' && last !== 'emulated') group = last;
          }

          return {
            id: uri || Math.random().toString(),
            type: 'image',
            thumbnail: uri,
            uri: uri,
            name: edge.node.image.filename || 'Image',
            rawSize: edge.node.image.fileSize || 0,
            group: group,
            folderPath: folderPath
          };
        });

        allImages = [...allImages, ...formatted];
        hasNextPage = result.page_info.has_next_page;
        afterCursor = result.page_info.end_cursor;
        if (allImages.length > 5000) break;
      }

      setImages(allImages);
      setImageFolders(groupItemsByFolder(allImages));
    } catch (e) {
      console.log('Image Fetch Error:', e);
    }
  };

  const fetchFiles = async () => {
    try {
      const paths = [];
      if (Platform.OS === 'android') {
        const root = RNFS.ExternalStorageDirectoryPath;
        paths.push(root + '/Download');
        paths.push(root + '/Documents');
        paths.push(root + '/Bluetooth');
        paths.push(root + '/WhatsApp/Media/WhatsApp Documents');
        paths.push(root + '/Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Documents');
      } else {
        paths.push(RNFS.DocumentDirectoryPath);
      }

      const allFiles: any[] = [];
      for (const path of paths) {
        if (!path) continue;
        const exists = await RNFS.exists(path);
        if (!exists) continue;

        try {
          const result = await RNFS.readDir(path);
          const formatted = result
            .filter(item => item.isFile())
            .map(item => {
              const ext = item.name.split('.').pop()?.toLowerCase();
              return {
                id: item.path,
                name: item.name,
                extension: ext,
                size: (item.size / 1024 / 1024).toFixed(2) + ' MB',
                rawSize: item.size,
                date: item.mtime ? new Date(item.mtime).toLocaleDateString() : 'N/A',
                uri: 'file://' + item.path,
                type: getFileType(ext)
              };
            });
          allFiles.push(...formatted);
        } catch (dirError) {
          console.log(`Error reading ${path}:`, dirError);
        }
      }
      setFilesList(allFiles);
    } catch (e) {
      console.log('File Fetch Error:', e);
    }
  };

  const groupItemsByFolder = (items: any[]) => {
    const groups: { [key: string]: any } = {};
    items.forEach(item => {
      const groupId = item.folderPath || item.group || 'Others';
      const groupDisplayName = item.group || 'Others';
      
      if (!groups[groupId]) {
        groups[groupId] = {
          id: groupId,
          name: groupDisplayName,
          count: 0,
          thumbnail: item.thumbnail,
        };
      }
      groups[groupId].count++;
    });
    return Object.values(groups);
  };

  const getFileType = (ext?: string) => {
    if (!ext) return 'other';
    const docs = ['pdf', 'doc', 'docx', 'txt', 'xls', 'xlsx', 'ppt', 'pptx'];
    const zips = ['zip', 'rar', '7z', 'tar'];
    const apps = ['apk', 'apks'];
    
    if (docs.includes(ext)) return 'doc';
    if (zips.includes(ext)) return 'zip';
    if (apps.includes(ext)) return 'app';
    return 'other';
  };

  const fetchContacts = async () => {
    try {
      const contacts = await Contacts.getAll();
      const formattedContacts = contacts
        .filter(c => c.phoneNumbers && c.phoneNumbers.length > 0)
        .slice(0, 100)
        .map(c => ({
          id: c.recordID,
          name: `${c.givenName} ${c.familyName}`.trim() || 'No Name',
          number: c.phoneNumbers[0].number,
          color: getRandomColor()
        }));
      setContactsList(formattedContacts);
    } catch (e) {
      console.log('Contacts Fetch Error:', e);
    }
  };

  const formatDuration = (seconds: number) => {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec < 10 ? '0' : ''}${sec}`;
  };

  const getRandomColor = () => {
    const colors = ['#FFD700', '#FF8C00', '#FF4500', '#00CED1', '#6495ED', '#9370DB'];
    return colors[Math.floor(Math.random() * colors.length)];
  };

  const selectFromFileManager = async () => {
    try {
      const res = await DocumentPicker.pick({
        allowMultiSelection: true,
        type: [DocumentPicker.types.allFiles],
      });
      
      const newItems = res.map(item => ({
          id: item.uri,
          name: item.name || 'Unknown',
          uri: item.uri,
          size: item.size || 0,
      }));
      
      // Add these to selected items
      setSelectedItems(prev => [...prev, ...newItems]);
      Alert.alert('Added', `${res.length} files added to selection`);
    } catch (err) {
      if (!DocumentPicker.isCancel(err)) {
        console.log('Picker Error:', err);
      }
    }
  };

  const toggleSelection = (item: any) => {
    if (!item || !item.id) return;
    setSelectedItems(prev => {
        const exists = prev.find(i => i.id === item.id);
        if (exists) {
            return prev.filter((i) => i.id !== item.id);
        } else {
            return [...prev, item];
        }
    });
  };

  const toggleSelectAll = () => {
    let currentList: any[] = [];
    if (activeTab === 'Videos') {
       currentList = selectedFolderName ? videos.filter(v => v.group === selectedFolderName) : videos;
    } else if (activeTab === 'Images') {
       currentList = selectedFolderName ? images.filter(i => i.group === selectedFolderName) : images;
    } else if (activeTab === 'Files') {
        currentList = filesList.filter(f => {
            if (activeFileSubTab === 'Documents') return f.type === 'doc';
            if (activeFileSubTab === 'Zip') return f.type === 'zip';
            if (activeFileSubTab === 'Apps') return f.type === 'app';
            return f.type === 'other';
        });
    } else if (activeTab === 'Contacts') {
        currentList = contactsList;
    }

    if (currentList.length === 0) return;

    const allInCurrentSelected = currentList.every(item => selectedItems.find(i => i.id === item.id));

    if (allInCurrentSelected) {
        setSelectedItems(prev => prev.filter(p => !currentList.find(c => c.id === p.id)));
    } else {
        setSelectedItems(prev => {
            const missing = currentList.filter(c => !prev.find(p => p.id === c.id));
            return [...prev, ...missing];
        });
    }
  };

  const isAllSelected = () => {
    let currentList: any[] = [];
    if (activeTab === 'Videos') {
       currentList = selectedFolderName ? videos.filter(v => v.group === selectedFolderName) : videos;
    } else if (activeTab === 'Images') {
       currentList = selectedFolderName ? images.filter(i => i.group === selectedFolderName) : images;
    } else if (activeTab === 'Files') {
        currentList = filesList.filter(f => {
            if (activeFileSubTab === 'Documents') return f.type === 'doc';
            if (activeFileSubTab === 'Zip') return f.type === 'zip';
            if (activeFileSubTab === 'Apps') return f.type === 'app';
            return f.type === 'other';
        });
    } else if (activeTab === 'Contacts') {
        currentList = contactsList;
    }
    
    if (currentList.length === 0) return false;
    return currentList.every(item => selectedItems.find(i => i.id === item.id));
  };

  const calculateTotalSize = () => {
    if (!selectedItems || selectedItems.length === 0) return '0 MB';
    
    const totalBytes = selectedItems.reduce((acc, item) => {
      const bytes = typeof item.rawSize === 'number' ? item.rawSize : 0;
      return acc + bytes;
    }, 0);
    
    if (totalBytes === 0) return '0 MB';
    if (totalBytes < 1024) return totalBytes + ' B';
    if (totalBytes < 1024 * 1024) return (totalBytes / 1024).toFixed(2) + ' KB';
    if (totalBytes < 1024 * 1024 * 1024) return (totalBytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (totalBytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };

  const handleSend = async () => {
    if (selectedItems.length === 0) {
      Alert.alert('No Items Selected', 'Please select some files to send.');
      return;
    }
    
    // Check connection
    try {
      if (Platform.OS === 'android') {
        const isWifiEnabled = await WifiManager.isEnabled();
        if (!isWifiEnabled) {
          Alert.alert(
            "Wi-Fi Required",
            "Sharing requires Wi-Fi to be enabled. Please turn on Wi-Fi from settings.",
            [
              { text: "Cancel", style: "cancel" },
              { text: "Open Settings", onPress: () => Linking.sendIntent('android.settings.WIFI_SETTINGS') }
            ]
          );
          return;
        }
      }

      // Just navigate to Sharing screen which handles server start and further checks
      navigation.navigate('Sharing', { items: selectedItems });
    } catch(e) {
      console.log("Send check error:", e);
        navigation.navigate('Sharing', { items: selectedItems });
    }
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <LinearGradient colors={['#7C4DFF', '#6200EA']} style={styles.headerGradient}>
        <SafeAreaView>
          <View style={styles.headerTop}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
              <Icon name="arrow-left" size={26} color="#FFF" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Send</Text>
            <TouchableOpacity style={styles.fileManagerBtn} onPress={selectFromFileManager}>
              <Text style={styles.fileManagerText}>Choose from file manager</Text>
            </TouchableOpacity>
          </View>
          
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll}>
            {tabs.map((tab) => (
              <TouchableOpacity
                key={tab}
                onPress={() => setActiveTab(tab)}
                style={styles.tabButton}
              >
                <Text style={[styles.tabText, activeTab === tab && styles.activeTabText]}>{tab}</Text>
                {activeTab === tab && <View style={styles.activeIndicator} />}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </SafeAreaView>
      </LinearGradient>
    </View>
  );

  const renderVideoItem = ({ item }: { item: any }) => {
    const isSelected = selectedItems.find(i => i.id === item.id);
    return (
      <TouchableOpacity
        style={styles.mediaItem}
        onPress={() => toggleSelection(item)}
        activeOpacity={0.8}
      >
        <Image source={{ uri: item.thumbnail }} style={styles.mediaThumb} />
        <View style={styles.durationBadge}>
          <Icon name="play-circle-outline" size={12} color="#FFF" />
          <Text style={styles.durationText}>{item.duration}</Text>
        </View>
        <View style={[styles.checkbox, isSelected && styles.checkboxActive]}>
          {isSelected && <Icon name="check" size={12} color="#FFF" />}
        </View>
      </TouchableOpacity>
    );
  };

  const renderImageItem = ({ item }: { item: any }) => {
    const isSelected = selectedItems.find(i => i.id === item.id);
    return (
      <TouchableOpacity
        style={styles.mediaItem}
        onPress={() => toggleSelection(item)}
        activeOpacity={0.8}
      >
        <Image source={{ uri: item.thumbnail }} style={styles.mediaThumb} />
        <View style={[styles.checkbox, isSelected && styles.checkboxActive]}>
          {isSelected && <Icon name="check" size={12} color="#FFF" />}
        </View>
      </TouchableOpacity>
    );
  };

  const renderFileItem = ({ item }: { item: any }) => {
    const isSelected = selectedItems.find(i => i.id === item.id);
    return (
      <TouchableOpacity
        style={styles.fileItem}
        onPress={() => toggleSelection(item)}
        activeOpacity={0.8}
      >
        <View style={styles.fileIconContainer}>
          <Icon name="file-document-outline" size={32} color="#673AB7" />
        </View>
        <View style={styles.fileInfo}>
          <Text style={styles.fileName}>{item.name}</Text>
          <Text style={styles.fileDetails}>{item.size} • {item.date}</Text>
        </View>
        <View style={[styles.checkbox, isSelected && styles.checkboxActive]}>
          {isSelected && <Icon name="check" size={12} color="#FFF" />}
        </View>
      </TouchableOpacity>
    );
  };

  const renderContactItem = ({ item }: { item: any }) => {
    const isSelected = selectedItems.find(i => i.id === item.id);
    return (
      <TouchableOpacity
        style={styles.contactItem}
        onPress={() => toggleSelection(item)}
        activeOpacity={0.8}
      >
        <View style={[styles.contactAvatar, { backgroundColor: item.color || '#673AB7' }]}>
          <Icon name="account" size={30} color="#FFF" />
        </View>
        <View style={styles.contactInfo}>
          <Text style={styles.contactName}>{item.name}</Text>
          <Text style={styles.contactNumber}>{item.number}</Text>
        </View>
        <View style={[styles.checkbox, isSelected && styles.checkboxActive]}>
          {isSelected && <Icon name="check" size={12} color="#FFF" />}
        </View>
      </TouchableOpacity>
    );
  };

  const renderFolderItem = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={styles.folderItem}
      onPress={() => {
          setSelectedFolderName(item.id); // Store ID (folderPath) instead of name
          setActiveSubTab('All');
      }}
      activeOpacity={0.8}
    >
      <View style={styles.folderThumbContainer}>
        <Image source={{ uri: item.thumbnail }} style={styles.folderThumb} />
        <View style={styles.folderOverlay}>
            <Icon name="folder" size={24} color="#FFF" />
        </View>
      </View>
      <View style={styles.folderInfo}>
        <Text style={styles.folderName} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.folderCount}>{item.count} items</Text>
      </View>
      <Icon name="chevron-right" size={20} color="#CCC" />
    </TouchableOpacity>
  );

  const renderContent = () => {
    switch (activeTab) {
      case 'Videos': {
        const filtered = selectedFolderName ? videos.filter(v => v.folderPath === selectedFolderName) : videos;
        const folderName = selectedFolderName ? (videoFolders.find(f => f.id === selectedFolderName)?.name || 'Folder') : '';
        return (
          <View style={styles.contentContainer}>
             <View style={styles.subTabWrapper}>
                <View style={styles.subTabContainer}>
                    <TouchableOpacity style={activeSubTab === 'All' ? styles.subTabButtonActive : styles.subTabButton} onPress={() => { setActiveSubTab('All'); setSelectedFolderName(null); }}>
                        <Text style={activeSubTab === 'All' ? styles.subTabTextActive : styles.subTabText}>All</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={activeSubTab === 'Folders' ? styles.subTabButtonActive : styles.subTabButton} onPress={() => setActiveSubTab('Folders')}>
                        <Text style={activeSubTab === 'Folders' ? styles.subTabTextActive : styles.subTabText}>Folders</Text>
                    </TouchableOpacity>
                </View>
             </View>
             <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{activeSubTab === 'All' ? (selectedFolderName ? `${folderName} (${filtered.length})` : `Videos (${videos.length})`) : `Folders (${videoFolders.length})`}</Text>
                <TouchableOpacity style={[styles.selectAllCircle, isAllSelected() && { backgroundColor: '#6200EA' }]} onPress={toggleSelectAll}>
                    {isAllSelected() && <Icon name="check" size={12} color="#FFF" />}
                </TouchableOpacity>
             </View>
             <FlatList key={activeSubTab} data={activeSubTab === 'All' ? filtered : videoFolders} renderItem={activeSubTab === 'All' ? renderVideoItem : renderFolderItem} keyExtractor={(item) => item.id} numColumns={activeSubTab === 'All' ? 3 : 1} contentContainerStyle={activeSubTab === 'All' ? styles.gridContainer : styles.listContainer} />
          </View>
        );
      }
      case 'Images': {
        const filtered = selectedFolderName ? images.filter(i => i.folderPath === selectedFolderName) : images;
        const folderName = selectedFolderName ? (imageFolders.find(f => f.id === selectedFolderName)?.name || 'Folder') : '';
        return (
          <View style={styles.contentContainer}>
            <View style={styles.subTabWrapper}>
                <View style={styles.subTabContainer}>
                    <TouchableOpacity style={activeSubTab === 'All' ? styles.subTabButtonActive : styles.subTabButton} onPress={() => { setActiveSubTab('All'); setSelectedFolderName(null); }}>
                        <Text style={activeSubTab === 'All' ? styles.subTabTextActive : styles.subTabText}>All</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={activeSubTab === 'Folders' ? styles.subTabButtonActive : styles.subTabButton} onPress={() => setActiveSubTab('Folders')}>
                        <Text style={activeSubTab === 'Folders' ? styles.subTabTextActive : styles.subTabText}>Folders</Text>
                    </TouchableOpacity>
                </View>
             </View>
            <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{activeSubTab === 'All' ? (selectedFolderName ? `${folderName} (${filtered.length})` : `Images (${images.length})`) : `Folders (${imageFolders.length})`}</Text>
                <TouchableOpacity style={[styles.selectAllCircle, isAllSelected() && { backgroundColor: '#6200EA' }]} onPress={toggleSelectAll}>
                    {isAllSelected() && <Icon name="check" size={12} color="#FFF" />}
                </TouchableOpacity>
            </View>
            <FlatList key={activeSubTab} data={activeSubTab === 'All' ? filtered : imageFolders} renderItem={activeSubTab === 'All' ? renderImageItem : renderFolderItem} keyExtractor={(item) => item.id} numColumns={activeSubTab === 'All' ? 3 : 1} contentContainerStyle={activeSubTab === 'All' ? styles.gridContainer : styles.listContainer} />
          </View>
        );
      }
      case 'Files': {
        const filteredFiles = filesList.filter(f => {
          if (activeFileSubTab === 'Documents') return f.type === 'doc';
          if (activeFileSubTab === 'Zip') return f.type === 'zip';
          if (activeFileSubTab === 'Apps') return f.type === 'app';
          return f.type === 'other';
        });
        return (
          <View style={styles.contentContainer}>
            <View style={styles.subTabWrapper}>
                <View style={[styles.subTabContainer, { width: '90%' }]}>
                    {['Documents', 'Zip', 'Apps', 'Other'].map(sub => (
                      <TouchableOpacity key={sub} style={activeFileSubTab === sub ? styles.subTabButtonActive : styles.subTabButton} onPress={() => setActiveFileSubTab(sub)}>
                        <Text style={activeFileSubTab === sub ? styles.subTabTextActive : styles.subTabText}>{sub}</Text>
                      </TouchableOpacity>
                    ))}
                </View>
             </View>
            <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{activeFileSubTab} ({filteredFiles.length})</Text>
                <TouchableOpacity style={[styles.selectAllCircle, isAllSelected() && { backgroundColor: '#6200EA' }]} onPress={toggleSelectAll}>
                    {isAllSelected() && <Icon name="check" size={12} color="#FFF" />}
                </TouchableOpacity>
            </View>
            {filteredFiles.length === 0 ? (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
                 <Icon name="file-search-outline" size={80} color="#EEE" />
                 <Text style={{ color: '#999', marginTop: 15, fontSize: 16 }}>No {activeFileSubTab.toLowerCase()} found</Text>
                 <Text style={{ color: '#CCC', marginTop: 5, textAlign: 'center' }}>Check your Download or Documents folder</Text>
              </View>
            ) : (
              <FlatList data={filteredFiles} renderItem={renderFileItem} keyExtractor={(item) => item.id} contentContainerStyle={styles.listContainer} />
            )}
          </View>
        );
      }
      case 'Contacts':
        return (
          <View style={styles.contentContainer}>
             <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>All Contacts ({contactsList.length})</Text>
                <TouchableOpacity style={[styles.selectAllCircle, isAllSelected() && { backgroundColor: '#6200EA' }]} onPress={toggleSelectAll}>
                    {isAllSelected() && <Icon name="check" size={12} color="#FFF" />}
                </TouchableOpacity>
             </View>
             <FlatList data={contactsList} renderItem={renderContactItem} keyExtractor={(item) => item.id} contentContainerStyle={styles.listContainer} />
          </View>
        );
      default:
        return null;
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      {renderHeader()}
      
      {isLoading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color="#6200EA" />
          <Text style={{ marginTop: 10, color: '#666' }}>Fetching real data...</Text>
        </View>
      ) : renderContent()}

      {/* Footer */}
      <View style={styles.footer}>
        <View style={styles.footerStats}>
          <View style={styles.statItem}>
             <View style={[styles.statDot, { backgroundColor: '#81D4FA' }]} />
             <Text style={styles.statText}>Size: {calculateTotalSize()}</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.sendButton} onPress={handleSend}>
          <Text style={styles.sendButtonText}>Send</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF' },
  header: { elevation: 8, shadowColor: '#6200EA', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
  headerGradient: { paddingTop:  StatusBar.currentHeight || 20, paddingBottom: 10 },
  headerTop: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, height: 50 },
  iconBtn: { padding: 5 },
  headerTitle: { color: '#FFF', fontSize: 22, fontWeight: 'bold', marginLeft: 10, flex: 1 },
  fileManagerBtn: { paddingVertical: 6, paddingHorizontal: 12 },
  fileManagerText: { color: '#FFF', fontSize: 13, opacity: 0.9, fontWeight: '500' },
  
  tabScroll: { marginTop: 15, paddingHorizontal: 5 },
  tabButton: { paddingHorizontal: 18, paddingVertical: 8, alignItems: 'center' },
  tabText: { color: 'rgba(255,255,255,0.6)', fontSize: 15, fontWeight: '600', letterSpacing: 0.5 },
  activeTabText: { color: '#FFF' },
  activeIndicator: { width: 22, height: 3, backgroundColor: '#FFF', borderRadius: 2, marginTop: 6 },

  contentContainer: { flex: 1, backgroundColor: '#FFF' },
  subTabWrapper: { alignItems: 'center', marginVertical: 15 },
  subTabContainer: { flexDirection: 'row', backgroundColor: '#F5F5F7', borderRadius: 25, padding: 4, width: '70%' },
  subTabButton: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 22 },
  subTabButtonActive: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 22, backgroundColor: '#FFF', elevation: 2, shadowColor: '#000', shadowOffset: { width:0, height:1 }, shadowOpacity: 0.1, shadowRadius: 2 },
  subTabText: { color: '#8E8E93', fontWeight: 'bold', fontSize: 14 },
  subTabTextActive: { color: '#6200EA', fontWeight: 'bold', fontSize: 14 },

  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 15 },
  sectionTitle: { fontSize: 15, color: '#333', fontWeight: 'bold' },
  selectAllCircle: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: '#DDD', alignItems: 'center', justifyContent: 'center' },

  gridContainer: { paddingHorizontal: 10, paddingBottom: 20 },
  mediaItem: { width: (width - 40) / 3, height: (width - 40) / 3, margin: 5, borderRadius: 12, overflow: 'hidden', elevation: 2, shadowColor: '#000', shadowOffset: { width:0, height:2 }, shadowOpacity: 0.1, shadowRadius: 2 },
  mediaThumb: { width: '100%', height: '100%' },
  durationBadge: { position: 'absolute', bottom: 6, left: 6, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 10 },
  durationText: { color: '#FFF', fontSize: 9, marginLeft: 2, fontWeight: 'bold' },
  checkbox: { position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: '#FFF', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.2)' },
  checkboxActive: { backgroundColor: '#6200EA', borderColor: '#6200EA' },

  listContainer: { paddingHorizontal: 20, paddingBottom: 20 },
  fileItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', padding: 15, borderRadius: 15, marginBottom: 12, elevation: 1, shadowColor: '#000', shadowOffset: { width:0, height:1 }, shadowOpacity: 0.1, shadowRadius: 2, borderWidth: 1, borderColor: '#F0F0F0' },
  fileIconContainer: { width: 52, height: 52, borderRadius: 12, backgroundColor: '#F3E5F5', alignItems: 'center', justifyContent: 'center' },
  fileInfo: { flex: 1, marginLeft: 15 },
  fileName: { fontSize: 15, color: '#333', fontWeight: 'bold' },
  fileDetails: { fontSize: 12, color: '#999', marginTop: 4 },

  contactItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', padding: 15, borderRadius: 15, marginBottom: 12, elevation: 1, shadowColor: '#000', shadowOffset: { width:0, height:1 }, shadowOpacity: 0.1, shadowRadius: 2, borderWidth: 1, borderColor: '#F0F0F0' },
  contactAvatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  contactInfo: { flex: 1, marginLeft: 15 },
  contactName: { fontSize: 16, color: '#333', fontWeight: 'bold' },
  contactNumber: { fontSize: 13, color: '#999', marginTop: 2 },

  folderItem: { flexDirection: 'row', alignItems: 'center', padding: 10, marginHorizontal: 15, marginBottom: 12, backgroundColor: '#FFF', borderRadius: 15, elevation: 1, shadowColor: '#000', shadowOffset: { width:0, height:1 }, shadowOpacity: 0.1, shadowRadius: 2 },
  folderThumbContainer: { width: 60, height: 60, borderRadius: 12, overflow: 'hidden' },
  folderThumb: { width: '100%', height: '100%' },
  folderOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.3)', alignItems: 'center', justifyContent: 'center' },
  folderInfo: { flex: 1, marginLeft: 15 },
  folderName: { fontSize: 16, color: '#333', fontWeight: 'bold' },
  folderCount: { fontSize: 13, color: '#8E8E93', marginTop: 4 },

  footer: { backgroundColor: '#FFF', padding: 20, borderTopLeftRadius: 35, borderTopRightRadius: 35, elevation: 25, shadowColor: '#000', shadowOffset: { width: 0, height: -10 }, shadowOpacity: 0.15, shadowRadius: 15 },
  footerStats: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginBottom: 18 },
  statItem: { flexDirection: 'row', alignItems: 'center' },
  statDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  statText: { fontSize: 13, color: '#666', fontWeight: 'bold' },
  statDivider: { width: 1, height: 15, backgroundColor: '#EEE', marginHorizontal: 20 },
  sendButton: { backgroundColor: '#6200EA', borderRadius: 30, paddingVertical: 18, alignItems: 'center', justifyContent: 'center', elevation: 4 },
  sendButtonText: { color: '#FFF', fontSize: 18, fontWeight: 'bold', letterSpacing: 1 },
});

export default SendScreen;

