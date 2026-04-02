import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  FlatList,
  Dimensions,
  Platform,
  Alert,
  Animated,
  LayoutAnimation,
  UIManager,
  BackHandler,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';
import DeviceInfo from 'react-native-device-info';
import { useNavigation, useRoute } from '@react-navigation/native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import WiFiDirectTransferServiceV2 from '../utils/WiFiDirectTransferServiceV2';
import type { DirectTransferStatusV2 } from '../utils/WiFiDirectTransferServiceV2';
import { WifiP2pDevice } from '../utils/Wifidirectmanager';
import { useTheme } from '../theme/ThemeContext';
import { useTransferStore, FileItem } from '../store';
import { useToast } from '../components/Toast';
import HapticUtil from '../utils/HapticUtil';
import { FileCardSkeleton } from '../components/SkeletonLoader';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import { DisplayAds, ProdIDs } from '../utils/Constant';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const { width } = Dimensions.get('window');

const FileTransferScreenV2 = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { colors, typography, isDark } = useTheme();
  const toast = useToast();

  const [p2pStatus, setP2pStatus] = useState<string>('Initializing V2...');
  
  const {
    role: currentRole,
    deviceName: currentPeer,
    setRole: setTransferRole,
    setTransferring,
    currentFiles: files,
    setFiles,
    transferStats: stats,
    setTransferStats: setStats,
    resetTransfer,
  } = useTransferStore();

  const params = (route.params || {}) as any;
  const role = params.role || currentRole;
  const deviceName = params.deviceName || currentPeer;
  const initialFiles = params.initialFiles;

  useEffect(() => {
    setTransferRole(role, deviceName);
    setTransferring(true);
    
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      handleCancel();
      return true;
    });

    return () => {
      backHandler.remove();
      // NOTE: Do NOT call stop() here — it would kill a running P2P transfer.
      // stop() is only called explicitly via handleCancel() or on unmount from done state.
    };
  }, []);

  useEffect(() => {
    if (initialFiles && Array.isArray(initialFiles)) {
      const updated: Record<string, FileItem> = {};
      initialFiles.forEach((f: any) => {
        updated[f.name] = {
          id: f.name,
          uri: f.uri || '',
          name: f.name,
          size: f.size || 0,
          progress: 0,
          status: 'pending' as const,
          type: f.type,
          direction: 'sent'
        };
      });
      setFiles(updated);
      setStats({ totalSize: initialFiles.reduce((acc: number, f: any) => acc + (f.size || 0), 0) });
    }
  }, [initialFiles]);

  useEffect(() => {
    const saveDir = Platform.OS === 'android'
      ? `${ReactNativeBlobUtil.fs.dirs.DownloadDir}/FlashDrop`
      : `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/FlashDrop`;

    // Re-attach the onStatus handler so this screen can receive ongoing events.
    // IMPORTANT: For 'sender' role, we must NOT call startSender() again here —
    // SharingScreenV2 already called finalizeSender() and the P2P send is in progress.
    // Calling startSender() again would restart WiFi discovery and crash the transfer.
    WiFiDirectTransferServiceV2.onStatus = (status: DirectTransferStatusV2) => {
      if (status.type === 'p2p') {
        const s = status.status;
        if (s.type === 'discovering') setP2pStatus('🔍 ' + s.message);
        if (s.type === 'connected') { setP2pStatus(`✅ Connected P2P`); HapticUtil.success(); }
        if (s.type === 'group_created') setP2pStatus(`📡 Hotspot Ready`);
        if (s.type === 'error') setP2pStatus('❌ ' + s.message);
      }

      if (status.type === 'progress') {
        setFiles(prev => {
          const existing = prev[status.name] || {
            id: status.name,
            name: status.name,
            uri: '',
            size: status.total || 0,
            direction: role === 'sender' ? 'sent' : 'received'
          };
          return {
            ...prev,
            [status.name]: {
              ...existing,
              progress: status.percent / 100,
              status: role === 'sender' ? 'uploading' : 'downloading'
            }
          };
        });
      }

      if (status.type === 'complete') {
        setFiles(prev => {
          const existing = prev[status.name] || {
            id: status.name,
            name: status.name,
            uri: '',
            size: 0,
            direction: role === 'sender' ? 'sent' : 'received'
          };
          return {
            ...prev,
            [status.name]: {
              ...existing,
              progress: 1,
              status: 'completed'
            }
          };
        });
        HapticUtil.light();
      }

      if (status.type === 'ready') {
        setP2pStatus(`🚀 Native P2P — ${status.ip}`);
      }

      if (status.type === 'error') {
        toast.show({ message: status.message, type: 'error' });
      }
    };

    // Sender: transfer already started by SharingScreenV2 — just update UI status.
    if (role === 'sender') {
      setP2pStatus('🚀 Sending via Native P2P...');
      // Do NOT call startSender() or finalizeSender() here — already running!
    } else {
      // Receiver: ReceiveScreenV2 hands off here. We only call finalizeReceiver
      // if an explicit IP is passed (edge case). Normally ReceiveScreenV2 already
      // called startReceiver() and finalizeReceiver() is triggered by the handshake.
      const ip = params.ip;
      if (ip) {
        WiFiDirectTransferServiceV2.finalizeReceiver(ip, saveDir).catch(console.error);
      }
    }

    return () => {
      WiFiDirectTransferServiceV2.onStatus = undefined;
    };
  }, [role, params.ip]);

  const handleCancel = () => {
    Alert.alert("Cancel Transfer", "Stop native P2P transfer?", [
      { text: "No", style: "cancel" },
      {
        text: "Yes",
        onPress: () => {
          WiFiDirectTransferServiceV2.stop();
          resetTransfer();
          (navigation as any).navigate('Home');
        }
      }
    ]);
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const fileList = useMemo(() => {
    return Object.values(files).sort((a, b) => {
      const nameA = a?.name || '';
      const nameB = b?.name || '';
      return nameB.localeCompare(nameA);
    });
  }, [files]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <View style={styles.headerWrapper}>
        <LinearGradient colors={colors.gradient} style={styles.headerGradient} />
        <SafeAreaView>
          <View style={styles.headerContent}>
            <TouchableOpacity onPress={() => (navigation as any).navigate('Home')} style={styles.iconButton}>
              <Icon name="arrow-left" size={24} color="#FFF" />
            </TouchableOpacity>
            <View style={{ alignItems: 'center' }}>
              <Text style={styles.headerTitle}>Native P2P V2</Text>
              <View style={styles.statusChip}>
                <Text style={styles.statusChipText}>{p2pStatus}</Text>
              </View>
            </View>
            <TouchableOpacity onPress={handleCancel} style={styles.iconButton}>
              <Icon name="close" size={24} color="#FFF" />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>

      <FlatList
        data={fileList}
        keyExtractor={(item, index) => item?.id || index.toString()}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={[styles.fileCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Icon name="file" size={30} color={colors.primary} />
            <View style={{ flex: 1, marginLeft: 15 }}>
              <Text style={[styles.fileName, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
              <Text style={{ color: colors.subtext }}>{formatSize(item.size)} • {item.status}</Text>
              {item.status !== 'pending' && item.status !== 'completed' && (
                <View style={styles.progressBg}>
                  <View style={[styles.progressFill, { width: `${(item.progress || 0) * 100}%`, backgroundColor: colors.primary }]} />
                </View>
              )}
            </View>
            {item.status === 'completed' && <Icon name="check-circle" size={24} color={colors.success} />}
          </View>
        )}
        ListEmptyComponent={<FileCardSkeleton isDark={isDark} />}
      />

      {DisplayAds && (
        <View style={styles.adContainer}>
          <BannerAd unitId={ProdIDs.ADAPTIVE_BANNER} size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER} />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerWrapper: { paddingBottom: 25, borderBottomLeftRadius: 30, borderBottomRightRadius: 30, overflow: 'hidden' },
  headerGradient: { ...StyleSheet.absoluteFillObject },
  headerContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 40 },
  headerTitle: { fontSize: 20, fontWeight: '900', color: '#FFF' },
  statusChip: { paddingHorizontal: 12, paddingVertical: 4, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 20, marginTop: 5 },
  statusChipText: { color: '#FFF', fontSize: 10, fontWeight: '800' },
  iconButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: 20, paddingBottom: 100 },
  fileCard: { flexDirection: 'row', alignItems: 'center', padding: 15, borderRadius: 20, marginBottom: 12, borderWidth: 1 },
  fileName: { fontSize: 15, fontWeight: '700' },
  progressBg: { height: 4, backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: 2, marginTop: 8 },
  progressFill: { height: '100%', borderRadius: 2 },
  adContainer: { position: 'absolute', bottom: 0, width: '100%', alignItems: 'center' }
});

export default FileTransferScreenV2;
