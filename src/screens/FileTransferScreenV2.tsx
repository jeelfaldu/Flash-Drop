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
import { InterstitialAd, AdEventType, TestIds, BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import { DisplayAds, ProdIDs } from '../utils/Constant';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const { width } = Dimensions.get('window');

const interstitialId = __DEV__ ? TestIds.INTERSTITIAL : ProdIDs.INTERSTITIAL;
const interstitial = InterstitialAd.createForAdRequest(interstitialId, {
  requestNonPersonalizedAdsOnly: false,
});

const FileTransferScreenV2 = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { colors, typography, isDark } = useTheme();
  const toast = useToast();

  const [p2pStatus, setP2pStatus] = useState<string>('Initializing V2...');
  const [transferSpeed, setTransferSpeed] = useState<string>('');
  const [allDone, setAllDone] = useState(false);
  const speedStatsRef = useRef({ lastTime: Date.now(), lastBytes: 0, currentFilename: '' });
  
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
  // IP of the receiver (saved so "Send More" can reuse the same P2P link)
  const peerIp = params.ip || WiFiDirectTransferServiceV2.lastReceiverIp || '192.168.49.1';

  useEffect(() => {
    setTransferRole(role, deviceName);
    setTransferring(true);

    // If returning from a "Send More" round-trip, the service finalized flag
    // was already reset by SharingScreenV2 → nothing extra to do here.
    
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
    if (!DisplayAds) return;
    const unsubscribe = interstitial.addAdEventListener(AdEventType.LOADED, () => {
      interstitial.show();
    });
    if (interstitial.loaded) interstitial.show();
    else interstitial.load();
    return () => unsubscribe();
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
        const now = Date.now();
        const currentBytes = (status.percent / 100) * (status.total || 0);

        const r = speedStatsRef.current;
        if (r.currentFilename !== status.name) {
          r.currentFilename = status.name;
          r.lastBytes = currentBytes;
          r.lastTime = now;
        } else {
          const timeDiff = now - r.lastTime;
          if (timeDiff >= 1000) {
            const bytesDiff = currentBytes - r.lastBytes;
            // Prevent negative speeds on weird anomalies
            if (bytesDiff >= 0) {
              const speedBps = (bytesDiff / timeDiff) * 1000;
              setTransferSpeed(formatSpeed(speedBps));
            }
            r.lastTime = now;
            r.lastBytes = currentBytes;
          }
        }

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

      if (status.type === 'client_connected') {
        // New batch incoming from sender — reset UI so new files show up fresh
        if (role === 'receiver') {
          setAllDone(false);
          setP2pStatus('📥 Receiving new batch...');
          setFiles({});
        }
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

  const formatSpeed = (bps: number) => {
    if (bps === 0) return '0 B/s';
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(bps) / Math.log(k));
    return parseFloat((bps / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Detect when ALL files have completed
  useEffect(() => {
    const list = Object.values(files);
    if (list.length > 0 && list.every(f => f?.status === 'completed' || f?.status === 'error')) {
      setAllDone(true);
      HapticUtil.success();
    } else {
      setAllDone(false);
    }
  }, [files]);

  const handleSendMore = () => {
    // Navigate to SendScreen keeping the P2P connection alive.
    // SendScreen's handleSend will navigate to SharingV2 with reuseP2pIp,
    // which skips discovery and goes straight to finalizeSender.
    (navigation as any).navigate('Send', {
      v2: true,
      keepConnection: true,
      reuseP2pIp: peerIp,
    });
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
        <LinearGradient colors={colors.gradient} style={styles.headerGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1.2 }} />
        <SafeAreaView>
          <View style={styles.headerContent}>
            <TouchableOpacity onPress={handleCancel} style={styles.iconButton}>
              <Icon name="arrow-left" size={24} color="#FFF" />
            </TouchableOpacity>
            <View style={{ alignItems: 'center' }}>
              <Text style={[styles.headerTitle, { fontFamily: typography.fontFamily }]}>Live Transfer</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={[styles.statusChip, { flexShrink: 1, maxWidth: 120 }]}>
                  <Text style={[styles.statusChipText, { fontFamily: typography.fontFamily }]} numberOfLines={1}>{p2pStatus}</Text>
                </View>
                {!!transferSpeed && !allDone && (
                  <View style={[styles.statusChip, { backgroundColor: isDark ? 'rgba(0,209,255,0.2)' : '#E3F2FD' }]}>
                    <Text style={[styles.statusChipText, { color: isDark ? '#00D1FF' : '#1976D2', fontFamily: typography.fontFamily }]}>⚡ {transferSpeed}</Text>
                  </View>
                )}
              </View>
            </View>
            {/* Balancing width for absolute centering */}
            <View style={{ width: 44 }} />
          </View>
        </SafeAreaView>
      </View>

      {DisplayAds && (
        <View style={styles.adContainerTop}>
          <BannerAd unitId={ProdIDs.ADAPTIVE_BANNER} size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER} />
        </View>
      )}

      <FlatList
        data={fileList}
        keyExtractor={(item, index) => item?.id || index.toString()}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={[styles.fileCard, { backgroundColor: isDark ? colors.surface : '#FFFFFF', borderColor: isDark ? 'rgba(255,255,255,0.05)' : '#F4F4F4' }]}>
            <View style={[styles.fileIconWrapper, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : colors.primary + '15' }]}>
              <Icon name="file-document" size={28} color={colors.primary} />
            </View>
            <View style={{ flex: 1, marginLeft: 16 }}>
              <Text style={[styles.fileName, { color: colors.text, fontFamily: typography.fontFamily }]} numberOfLines={1}>{item.name}</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                <Text style={{ color: colors.subtext, fontSize: 13, fontWeight: '500' }}>{formatSize(item.size)}</Text>
                <Text style={{ color: item.status === 'error' ? colors.error : colors.primary, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' }}>{item.status}</Text>
              </View>
              {item.status !== 'pending' && item.status !== 'completed' && item.status !== 'error' && (
                <View style={[styles.progressBg, { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : '#F0F0F0' }]}>
                  <View style={[styles.progressFill, { width: `${(item.progress || 0) * 100}%`, backgroundColor: colors.primary }]} />
                </View>
              )}
            </View>
            {item.status === 'completed' && (
               <View style={[styles.successIconWrap, { backgroundColor: colors.success }]}>
                 <Icon name="check" size={16} color="#FFF" />
               </View>
            )}
          </View>
        )}
        ListEmptyComponent={<FileCardSkeleton isDark={isDark} />}
      />

      {DisplayAds && (
        <View style={styles.adContainer}>
          <BannerAd unitId={ProdIDs.ADAPTIVE_BANNER} size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER} />
        </View>
      )}

      {/* ── Send More / Done Bar ─────────────────────────────────────── */}
      {allDone && (
        <View style={[styles.doneBar, { backgroundColor: isDark ? colors.surface : '#FFF', borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : '#F0F0F0' }]}>
          {role === 'sender' ? (
            <>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={[styles.doneTitle, { color: colors.text, fontFamily: typography.fontFamily }]}>All Files Sent!</Text>
                <Text style={[styles.doneSubtitle, { color: colors.subtext, fontFamily: typography.fontFamily }]}>Secure connection is still active.</Text>
              </View>
              <TouchableOpacity
                style={[styles.sendMoreBtn, { backgroundColor: colors.primary }]}
                onPress={handleSendMore}
                activeOpacity={0.85}
              >
                <Icon name="plus" size={20} color="#FFF" style={{ marginRight: 4 }} />
                <Text style={[styles.sendMoreText, { fontFamily: typography.fontFamily }]}>Send More</Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={styles.receiverDoneWrap}>
               <View style={[styles.successIconWrapLarge, { backgroundColor: colors.success + '15' }]}>
                 <Icon name="check-decagram" size={32} color={colors.success} />
               </View>
               <View style={{ flex: 1, marginLeft: 16 }}>
                 <Text style={[styles.doneTitle, { color: colors.text, fontFamily: typography.fontFamily }]}>Files Received</Text>
                 <Text style={[styles.doneSubtitle, { color: colors.subtext, fontFamily: typography.fontFamily }]}>Standing by for more items...</Text>
               </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerWrapper: { paddingBottom: 25, borderBottomLeftRadius: 36, borderBottomRightRadius: 36, overflow: 'hidden' },
  headerGradient: { ...StyleSheet.absoluteFillObject },
  headerContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: Platform.OS === 'android' ? 56 : 24 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#FFF', letterSpacing: -0.3 },
  statusChip: { paddingHorizontal: 12, paddingVertical: 4, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 20, marginTop: 6 },
  statusChipText: { color: '#FFF', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  iconButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: 20, paddingBottom: 110 },
  fileCard: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 24, marginBottom: 16, borderWidth: 1, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6 },
  fileIconWrapper: { width: 50, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  fileName: { fontSize: 16, fontWeight: '800' },
  progressBg: { height: 6, borderRadius: 3, marginTop: 10, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  successIconWrap: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginLeft: 10 },
  adContainer: { position: 'absolute', bottom: 0, width: '100%', alignItems: 'center', backgroundColor: 'transparent' },
  adContainerTop: { width: '100%', alignItems: 'center', marginTop: 10 },
  doneBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 20,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
    borderTopWidth: 1,
    elevation: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
  },
  doneTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  doneSubtitle: { fontSize: 13, marginTop: 2, opacity: 0.7, fontWeight: '500' },
  sendMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 30,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
  sendMoreText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
  receiverDoneWrap: { flexDirection: 'row', alignItems: 'center', width: '100%' },
  successIconWrapLarge: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
});

export default FileTransferScreenV2;
