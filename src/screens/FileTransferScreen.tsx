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
import TransferServer from '../utils/TransferServer';
import TransferClient from '../utils/TransferClient';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import WiFiDirectTransferService from '../utils/Wifidirecttransferservice';
import type { DirectTransferStatus } from '../utils/Wifidirecttransferservice';
import { WifiP2pDevice } from '../utils/Wifidirectmanager';
import { useTheme } from '../theme/ThemeContext';
import { useTransferStore, FileItem } from '../store';
import { useToast } from '../components/Toast';
import HapticUtil from '../utils/HapticUtil';
import { FileCardSkeleton } from '../components/SkeletonLoader';
import { InterstitialAd, AdEventType, TestIds, BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import { DisplayAds, ProdIDs } from '../utils/Constant';
import CircularProgress from '../components/CircularProgress';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const interstitialId = __DEV__ ? TestIds.INTERSTITIAL : ProdIDs.INTERSTITIAL;
const interstitial = InterstitialAd.createForAdRequest(interstitialId, {
  requestNonPersonalizedAdsOnly: false,
});


// ── Component Constants ───────────────────────────────
const { width } = Dimensions.get('window');


const FileTransferScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const { colors, typography, layout, spacing, isDark } = useTheme();
  const toast = useToast();

  // ── Celebration animation state ───────────────────────────────────
  const [showCelebration, setShowCelebration] = useState(false);
  const celebrationScale = useRef(new Animated.Value(0)).current;
  const celebrationOpacity = useRef(new Animated.Value(0)).current;
  const confettiAnims = useRef(
    Array.from({ length: 12 }, () => ({
      y: new Animated.Value(0),
      x: new Animated.Value(0),
      rotate: new Animated.Value(0),
      opacity: new Animated.Value(1),
    }))
  ).current;
  const celebrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didCelebrate = useRef(false);

  // ── P2P States ────────────────────────────────────────────────────
  const [p2pDevices, setP2pDevices] = useState<WifiP2pDevice[]>([]);
  const [p2pStatus, setP2pStatus] = useState<string>('');
  const [useWifiDirect, setUseWifiDirect] = useState(true);

  // Zustand store
  const {
    role: currentRole,
    deviceName: currentPeer,
    isTransferring,
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

  const handleBack = () => {
    const isCurrentlyTransferring = useTransferStore.getState().isTransferring;
    if (isCurrentlyTransferring) {
      if (navigation.canGoBack()) navigation.goBack();
      else (navigation as any).navigate('Home');
      return true;
    }
    resetTransfer();
    setTransferring(false);
    (navigation as any).navigate('Home');

    // Alert.alert(
    //   "Transfer Session",
    //   "Return to Home screen?",
    //   [
    //     { text: "Cancel", style: "cancel" },
    //     {
    //       text: "Exit",
    //       style: "destructive",
    //       onPress: () => {
    //         TransferServer.stop();
    //         TransferClient.stop();
    //         WiFiDirectTransferService.stop();
    //         resetTransfer();
    //         setTransferring(false);
    //         (navigation as any).navigate('Home');
    //       }
    //     }
    //   ]
    // );
    return true;
  };

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
    setTransferRole(role, deviceName);
    setTransferring(true);
    const backHandler = BackHandler.addEventListener('hardwareBackPress', handleBack);
    return () => {
      backHandler.remove();
      if (celebrationTimerRef.current) clearTimeout(celebrationTimerRef.current);
    };
  }, [role, deviceName]);

  useEffect(() => {
    didCelebrate.current = false;
  }, [initialFiles]);

  useEffect(() => {
    if (initialFiles && Array.isArray(initialFiles)) {
      setFiles((prev) => {
        const updated = { ...prev };
        let added = false;
        initialFiles.forEach((f: any) => {
          if (!updated[f.name]) {
            const size = typeof f.rawSize === 'number' ? f.rawSize : (f.size || 0);
            updated[f.name] = {
              id: f.name,
              uri: f.uri || '',
              name: f.name,
              size: size,
              progress: 0,
              status: 'pending' as const,
              type: f.type,
              direction: 'sent'
            };
            added = true;
          }
        });
        if (added) {
          const allFiles = Object.values(updated) as FileItem[];
          const grandTotal = allFiles.reduce((acc: number, f: FileItem) => acc + (f.size || 0), 0);
          setStats({ totalSize: grandTotal });
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        }
        return updated;
      });
    }
  }, [initialFiles]);

  useEffect(() => {
    const saveDir = Platform.OS === 'android'
      ? `${ReactNativeBlobUtil.fs.dirs.DownloadDir}/FlashDrop`
      : `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/FlashDrop`;

    const handleStatus = (status: any) => {
      if (status.type === 'complete' && stats.overallProgress >= 0.99 && !didCelebrate.current) {
        didCelebrate.current = true;
        triggerCelebration();
      }
    };

    if (useWifiDirect && Platform.OS === 'android') {
      WiFiDirectTransferService.onStatus = (status: DirectTransferStatus) => {
        if (status.type === 'p2p') {
          const s = status.status;
          if (s.type === 'discovering') setP2pStatus('🔍 ' + s.message);
          if (s.type === 'peers_found') { setP2pDevices(s.devices); setP2pStatus(`📡 ${s.devices.length} found`); }
          if (s.type === 'connecting') setP2pStatus('🔗 ' + s.message);
          if (s.type === 'connected') { setP2pStatus(`✅ Connected P2P`); HapticUtil.success(); }
          if (s.type === 'group_created') setP2pStatus(`📡 Hotspot Ready`);
          if (s.type === 'error') setP2pStatus('❌ ' + s.message);
        }
        if (status.type === 'server') handleStatus(status.status);
        if (status.type === 'client') handleStatus(status.status);
        if (status.type === 'ready') setP2pStatus(`🚀 Active — ${status.ip}`);
      };

      if (!WiFiDirectTransferService.isRunning()) {
        if (role === 'sender') {
          WiFiDirectTransferService.startSender(initialFiles).catch(console.error);
        } else {
          WiFiDirectTransferService.startReceiver(saveDir, (devices) => setP2pDevices(devices)).catch(console.error);
        }
      } else {
        if (role === 'sender') WiFiDirectTransferService.addFiles(initialFiles);
        setP2pStatus(role === 'sender' ? '🚀 Active Sender' : '🚀 Active Receiver');
      }
    } else {
      updateSpaceStats();
      TransferServer.addStatusListener(handleStatus);
      TransferClient.addStatusListener(handleStatus);

      if (role === 'sender') {
        TransferServer.start(8888, initialFiles);
      } else {
        const ip = params.ip;
        if (ip) TransferClient.start(8888, saveDir, ip);
      }
    }

    return () => {
      WiFiDirectTransferService.onStatus = undefined;
      TransferServer.removeStatusListener(handleStatus);
      TransferClient.removeStatusListener(handleStatus);
    };
  }, [role, useWifiDirect, deviceName, stats.overallProgress]);

  const triggerCelebration = () => {
    HapticUtil.success();
    setShowCelebration(true);
    celebrationScale.setValue(0);
    celebrationOpacity.setValue(0);
    confettiAnims.forEach(a => { a.y.setValue(0); a.x.setValue(0); a.rotate.setValue(0); a.opacity.setValue(1); });

    Animated.parallel([
      Animated.spring(celebrationScale, { toValue: 1, tension: 60, friction: 7, useNativeDriver: true }),
      Animated.timing(celebrationOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
    ]).start();

    confettiAnims.forEach((anim, i) => {
      const angle = (Math.random() * 360 * Math.PI) / 180;
      const dist = 100 + Math.random() * 100;
      Animated.sequence([
        Animated.delay(Math.random() * 200),
        Animated.parallel([
          Animated.timing(anim.y, { toValue: -Math.sin(angle) * dist, duration: 1000, useNativeDriver: true }),
          Animated.timing(anim.x, { toValue: Math.cos(angle) * dist, duration: 1000, useNativeDriver: true }),
          Animated.timing(anim.rotate, { toValue: 1, duration: 1000, useNativeDriver: true }),
          Animated.sequence([
            Animated.delay(600),
            Animated.timing(anim.opacity, { toValue: 0, duration: 400, useNativeDriver: true }),
          ]),
        ]),
      ]).start();
    });

    celebrationTimerRef.current = setTimeout(() => {
      Animated.timing(celebrationOpacity, { toValue: 0, duration: 400, useNativeDriver: true }).start(() => {
        setShowCelebration(false);
      });
    }, 3500);
  };

  const updateSpaceStats = async () => {
    try {
      const free = await DeviceInfo.getFreeDiskStorage();
      setStats({ freeSpace: formatSize(free) });
    } catch (e) { }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getIconForType = (type?: string) => {
    if (!type) return 'file-outline';
    const t = type.toLowerCase();
    if (t.includes('image')) return 'image-outline';
    if (t.includes('video')) return 'play-circle-outline';
    if (t.includes('audio')) return 'music-note-outline';
    if (t.includes('pdf')) return 'file-pdf-box';
    if (t.includes('zip') || t.includes('archive')) return 'zip-box-outline';
    return 'file-document-outline';
  };

  const getIconColor = (type?: string) => {
    if (!type) return colors.subtext;
    const t = type.toLowerCase();
    if (t.includes('image')) return '#00D1FF';
    if (t.includes('video')) return '#FF4757';
    if (t.includes('audio')) return '#FF9F43';
    if (t.includes('pdf')) return '#FF6B6B';
    return colors.primary;
  };

  const handleDisconnectAction = () => {
    TransferServer.stop();
    TransferClient.stop();
    WiFiDirectTransferService.stop();
    resetTransfer();
    (navigation as any).navigate('Home');
  };

  const handleCancel = () => {
    HapticUtil.medium();
    Alert.alert(
      "Cancel Transfer",
      "Are you sure you want to stop the current transfer?",
      [
        { text: "No", style: "cancel" },
        {
          text: "Yes, Stop",
          style: "destructive",
          onPress: () => {
            TransferServer.stop();
            TransferClient.stop();
            setTransferring(false);
            navigation.goBack();
          }
        }
      ]
    );
  };

  const ConnectionQualityBars = React.memo(() => {
    const speed = stats.transferSpeed ?? '0 KB/s';
    let mbps = 0;
    if (speed.includes('MB/s')) mbps = parseFloat(speed);
    else if (speed.includes('KB/s')) mbps = parseFloat(speed) / 1024;

    const isTransferred = stats.transferredSize > 0 && stats.transferredSize < stats.totalSize;
    const barColor = mbps === 0 ? (isTransferred ? '#FF6B6B' : 'rgba(255,255,255,0.4)')
      : mbps < 1 ? '#FFC048' : mbps < 5 ? colors.secondary : mbps < 15 ? colors.success : colors.primary;

    return (
      <View style={{ flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        {/* <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: barColor }} /> */}
        <Text style={{ color: isDark ? '#FFF' : colors.text, fontSize: 13, fontWeight: '800' }}>
          {(mbps === 0 && !isTransferred) ? 'READY' : speed}
        </Text>
        <Text style={[styles.statLabel, { color: colors.subtext, fontSize: 9 }]}>SPEED</Text>

      </View>
    );
  });

  const FileCardItem = ({ item, ETA }: { item: FileItem, ETA: string }) => {
    const isCompleted = item.status === 'completed';
    const isPending = item.status === 'pending';
    const progress = item.progress || 0;

    return (
      <View style={[styles.fileCard, { backgroundColor: isDark ? colors.surface : '#FFF', borderColor: colors.border }]}>
        <View style={[styles.fileIconBox, { backgroundColor: getIconColor(item.type) + '15' }]}>
          <Icon name={getIconForType(item.type)} size={26} color={getIconColor(item.type)} />
        </View>
        <View style={styles.fileInfo}>
          <Text style={[styles.fileName, { color: colors.text, fontFamily: typography.fontFamily }]} numberOfLines={1}>{item.name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={[styles.chatSizeText, { color: colors.subtext, fontFamily: typography.fontFamily }]}>
              {isPending ? formatSize(item.size) : `${formatSize(progress * item.size)} / ${formatSize(item.size)}`}
            </Text>
            {isPending && (
              <View style={[styles.pendingLabel, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F1F5F9' }]}>
                <Text style={styles.pendingText}>PENDING</Text>
              </View>
            )}
          </View>
          {!isCompleted && !isPending && (
            <View style={styles.progressBarBg}>
              <Animated.View style={[styles.progressBarFill, { width: `${progress * 100}%`, backgroundColor: colors.primary }]} />
            </View>
          )}
        </View>
        <View style={styles.fileStatusBox}>
          {isCompleted ? (
            <View style={[styles.statusBadge, { backgroundColor: colors.success + '15' }]}>
              <Icon name="check" size={18} color={colors.success} />
            </View>
          ) : (
              !isPending && <View style={{ flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 13 }}>{Math.floor(progress * 100)}%</Text>
                <Text style={{ color: colors.subtext, fontWeight: '800', fontSize: 11 }}>{ETA}</Text>
              </View>
          )}
        </View>
      </View>
    );
  };

  const fileList = useMemo(() => {
    return Object.values(files)
      .filter(f => f.context === 'p2p' || !f.context) // 🛡️ Hide PC transfers
      .sort((a, b) => {
        const getPriority = (status?: string) => {
          if (status === 'uploading' || status === 'downloading') return 0;
          if (status === 'pending') return 1;
          if (status === 'completed') return 2;
          return 3; // errors etc
        };

        const prioA = getPriority(a.status);
        const prioB = getPriority(b.status);

        if (prioA !== prioB) return prioA - prioB;
        return b.name.localeCompare(a.name);
      });
  }, [files]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* ── Immersive Header ────────────────────────────────────────── */}
      <View style={styles.headerWrapper}>
        <LinearGradient colors={colors.gradient} style={styles.headerGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
        <SafeAreaView>
          <View style={styles.headerContent}>
            <TouchableOpacity onPress={handleBack} style={styles.iconButton}>
              <Icon name="arrow-left" size={24} color="#FFF" />
            </TouchableOpacity>

            <View style={styles.headerCentral}>
              <View style={styles.headerTitleRow}>
                <Text style={[styles.headerTitle, { fontFamily: typography.fontFamily }]}>
                  {role}
                </Text>
                <View style={styles.pulsingDot} />
              </View>
            </View>

            <TouchableOpacity onPress={handleCancel} style={styles.iconButton}>
              <Icon name="close" size={24} color="#FFF" />
            </TouchableOpacity>
          </View>

          <View style={styles.headerBottomInfo}>
            <Text style={styles.peerNameText} numberOfLines={1}>{deviceName || 'Searching for peer...'}</Text>
            <View style={styles.statusChip}>
              <Text style={styles.statusChipText}>{p2pStatus || 'Initializing'}</Text>
            </View>
          </View>
        </SafeAreaView>
      </View>

      {/* ── Stats Glass Dashboard ────────────────────────────────────── */}
      <View style={[styles.dashboardContainer, { backgroundColor: isDark ? colors.surface : '#FFF', paddingVertical: 12, marginTop: -20 }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 20 }}>
          <View>
            <Text style={[styles.statValue, { color: colors.text, fontSize: 14 }]}>{stats.leftData || '0B'}</Text>
            <Text style={[styles.statLabel, { color: colors.subtext, fontSize: 9 }]}>LEFT</Text>
          </View>

          <View>
            <Text style={[styles.statValue, { color: colors.text, fontSize: 14 }]}>{Math.floor(stats.overallProgress * 100)}%</Text>
            <Text style={[styles.statLabel, { color: colors.subtext, fontSize: 9 }]}>DONE</Text>
          </View>
          <ConnectionQualityBars />
        </View>
      </View>

      {DisplayAds && (
        <View style={styles.adContainer}>
          <BannerAd unitId={ProdIDs.ADAPTIVE_BANNER} size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER} />
        </View>
      )}

      <FlatList
        data={fileList}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => <FileCardItem item={item} ETA={stats.eta} />}
        initialNumToRender={10}
        ListEmptyComponent={
          <View style={{ marginTop: 40, alignItems: 'center' }}>
            <FileCardSkeleton isDark={isDark} />
            <Text style={{ marginTop: 24, fontSize: 16, fontWeight: '600', color: colors.subtext }}>Preparing secure tunnel...</Text>
          </View>
        }
      />

      {DisplayAds && (
        <View style={styles.adContainer}>
          <BannerAd unitId={ProdIDs.ADAPTIVE_BANNER} size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER} />
        </View>
      )}

      {showCelebration && (
        <View style={styles.celebrationOverlay} pointerEvents="none">
          <Animated.View style={[styles.checkmarkCircle, { transform: [{ scale: celebrationScale }], opacity: celebrationOpacity }]}>
            <Icon name="check-all" size={50} color={colors.success} />
          </Animated.View>
          {confettiAnims.map((anim, i) => (
            <Animated.View
              key={i}
              style={[
                styles.confetti,
                {
                  transform: [
                    { translateY: anim.y },
                    { translateX: anim.x },
                    { rotate: anim.rotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '720deg'] }) }
                  ],
                  opacity: anim.opacity,
                  backgroundColor: ['#FFC048', '#FF6B6B', '#4ADE80', '#00D1FF', '#7C4DFF', '#FF9F43'][i % 6]
                }
              ]}
            />
          ))}
        </View>
      )}


    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerWrapper: {
    paddingBottom: 40,
    borderBottomLeftRadius: 40,
    borderBottomRightRadius: 40,
    overflow: 'hidden'
  },
  headerGradient: { ...StyleSheet.absoluteFillObject },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 50 : 20
  },
  headerCentral: {
    alignItems: 'center',
    gap: 8
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  headerTitle: { fontSize: 20, fontWeight: '900', color: '#FFF', letterSpacing: 1, textTransform: 'capitalize' },
  pulsingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#4ADE80'
  },
  headerBottomInfo: {
    alignItems: 'center',
    marginTop: 15,
    paddingHorizontal: 40
  },
  peerNameText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8
  },
  statusChip: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)'
  },
  statusChipText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '800'
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  dashboardContainer: {
    marginHorizontal: 20,
    marginTop: -30,
    borderRadius: 30,
    padding: 20,
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)'
  },
  statsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  statBox: { flex: 1, alignItems: 'center' },
  statIconCtx: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8
  },
  statValue: { fontSize: 16, fontWeight: '800', marginBottom: 2 },
  statLabel: { fontSize: 10, fontWeight: '700', opacity: 0.6, letterSpacing: 0.5 },
  listContent: { padding: 20, paddingBottom: 120 },
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 24,
    marginBottom: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2
  },
  fileIconBox: { width: 50, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  fileInfo: { flex: 1, marginLeft: 16 },
  fileName: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  chatSizeText: { fontSize: 12, opacity: 0.8 },
  pendingLabel: {
    marginLeft: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4
  },
  pendingText: {
    fontSize: 8,
    fontWeight: '900',
    color: '#94A3B8'
  },
  progressBarBg: { height: 6, backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: 3, marginTop: 10, overflow: 'hidden' },
  progressBarFill: { height: '100%', borderRadius: 3 },
  fileStatusBox: { marginLeft: 12, alignItems: 'center', justifyContent: 'center' },
  statusBadge: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  celebrationOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  checkmarkCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#FFF',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 15 },
    shadowOpacity: 0.3,
    shadowRadius: 20
  },
  confetti: { position: 'absolute', width: 10, height: 10, borderRadius: 2 },
  adContainer: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    alignItems: 'center',
    backgroundColor: 'transparent'
  }
});

export default FileTransferScreen;