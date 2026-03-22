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
  Image,
  Alert,
  Linking,
  BackHandler,
  Animated,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';
import DeviceInfo from 'react-native-device-info';
import { useNavigation, useRoute } from '@react-navigation/native';
import TransferServer from '../utils/TransferServer';
import TransferClient, { TransferStatus } from '../utils/TransferClient';
import NotificationService from '../utils/NotificationService';
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
    Array.from({ length: 6 }, () => ({
      y: new Animated.Value(0),
      x: new Animated.Value(0),
      rotate: new Animated.Value(0),
      opacity: new Animated.Value(1),
    }))
  ).current;
  // Fix: store auto-hide timeout ref so it can be cleared on unmount (memory leak prevention)
  const celebrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Prevent celebration from firing multiple times for same batch
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
      // Auto-run in background: just navigate back without asking
      if (navigation.canGoBack()) navigation.goBack();
      else (navigation as any).navigate('Home');
      return true;
    }

    // If not transferring but connected/in session
    Alert.alert(
      "Transfer Complete",
      "Return to Home screen?",
      [
        { text: "Cancel", style: "cancel", onPress: () => { } },
        {
          text: "Exit",
          style: "destructive",
          onPress: () => {
            // Xender-style: stop both on any role
            TransferServer.stop();
            TransferClient.stop();
            WiFiDirectTransferService.stop();
            resetTransfer();
            setTransferring(false); // Ensure state is reset
            (navigation as any).navigate('Home');
          }
        }
      ]
    );
    return true;
  };

  // Preload and show interstitial ad on mount (transfer start)
  useEffect(() => {
    const showAdOnStart = async () => {
      if (!DisplayAds) return;

      const unsubscribe = interstitial.addAdEventListener(AdEventType.LOADED, () => {
        console.log('Interstitial Ad loaded, showing for transfer start');
        interstitial.show();
      });

      // If already loaded, show it
      if (interstitial.loaded) {
        interstitial.show();
      } else {
        interstitial.load();
      }

      return unsubscribe;
    };

    let unsub: (() => void) | undefined;
    showAdOnStart().then(u => unsub = u);

    return () => {
      if (unsub) unsub();
    };
  }, []);

  // Update Zustand store with role
  useEffect(() => {
    setTransferRole(role, deviceName);
    setTransferring(true);

    const backHandler = BackHandler.addEventListener('hardwareBackPress', handleBack);

    return () => {
      // Avoid calling setTransferring(false) here, it breaks navigation flow when pushing a new screen
      backHandler.remove();
      // Cleanup celebration timer to prevent memory leak
      if (celebrationTimerRef.current) clearTimeout(celebrationTimerRef.current);
    };
  }, [role, deviceName]); // Avoid tracking isTransferring here to prevent cyclic updates

  // Reset celebration guard whenever a new transfer batch starts
  useEffect(() => {
    didCelebrate.current = false;
  }, [initialFiles]);

  useEffect(() => {
    // Update files list when initialFiles changes (Send More)
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
              direction: 'sent' // ── Added for Chat UI ──
            };
            added = true;
          }
        });

        if (added) {
          const allFiles = Object.values(updated) as FileItem[];
          const grandTotal = allFiles.reduce((acc: number, f: FileItem) => acc + (f.size || 0), 0);
          setStats((s: any) => ({ ...s, totalSize: grandTotal }));
        }
        return updated;
      });
    }
  }, [initialFiles]); // Only run when new initialFiles are passed via navigation

  // ── Unified Transfer Integration (Wi-Fi Direct + Standard) ───────
  useEffect(() => {
    const saveDir = Platform.OS === 'android'
      ? `${ReactNativeBlobUtil.fs.dirs.DownloadDir}/FlashDrop`
      : `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/FlashDrop`;

    const handleServerStatus = (status: any) => {
      // Periodic intense logs only if it's not spamming progress (reduce spam)
      if (status.type !== 'progress' && status.type !== 'upload_progress') {
        console.log(`[FileTransferScreen] SERVER Event:`, status.type, status);
      }
      const fp = status.fileProgress;
      if ((status.type === 'progress' || status.type === 'upload_progress' || status.type === 'complete') && fp) {
        updateFileProgress(fp.name, fp.percent, fp.sent, fp.total, fp.speed, fp.etaSecs);
      }
    };

    const handleClientStatus = (status: any) => {
      if (status.type !== 'progress') {
        console.log(`[FileTransferScreen] CLIENT Event:`, status.type, status.message || status);
      }
      if ((status.type === 'progress' || status.type === 'complete') && status.fileProgress) {
        const fp = status.fileProgress;
        updateFileProgress(fp.name, fp.percent, fp.received, fp.total, fp.speed, fp.etaSecs);
      }
      if (status.files) {
        setFiles((prev) => {
          const updated = { ...prev };
          let added = false;
          (status.files as any[]).forEach((f: any) => {
            if (!updated[f.name]) {
              updated[f.name] = { 
                id: f.name, 
                uri: '', 
                name: f.name, 
                size: f.size || 0, 
                progress: 0, 
                status: 'pending' as const, 
                type: f.type,
                direction: 'received' // ── Added for Chat UI ──
              };
              added = true;
            }
          });
          if (added) {
            const allFiles = Object.values(updated) as FileItem[];
            const grandTotal = allFiles.reduce((acc: number, f: FileItem) => acc + (f.size || 0), 0);
            setStats((s: any) => ({ ...s, totalSize: grandTotal }));
          }
          return updated;
        });
      }
    };

    if (useWifiDirect && Platform.OS === 'android') {
      // ── Use Wi-Fi Direct Service ──
      WiFiDirectTransferService.onStatus = (status: DirectTransferStatus) => {
        if (status.type !== 'client' && status.type !== 'server') {
          console.log(`[FileTransferScreen] DIRECT TRANSFER STATUS:`, status.type);
        }
        
        if (status.type === 'p2p') {
          const s = status.status;
          if (s.type === 'discovering') setP2pStatus('🔍 ' + s.message);
          if (s.type === 'peers_found') { setP2pDevices(s.devices); setP2pStatus(`📡 ${s.devices.length} found`); }
          if (s.type === 'connecting') setP2pStatus('🔗 ' + s.message);
          if (s.type === 'connected') { setP2pStatus(`✅ Connected P2P`); HapticUtil.success(); }
          if (s.type === 'group_created') setP2pStatus(`📡 Hotspot Ready`);
          if (s.type === 'error') setP2pStatus('❌ ' + s.message);
        }
        if (status.type === 'server') handleServerStatus(status.status);
        if (status.type === 'client') handleClientStatus(status.status);
        if (status.type === 'ready') setP2pStatus(`🚀 Active — ${status.ip}`);
      };

      // Only start if NOT already running
      if (!WiFiDirectTransferService.isRunning()) {
        if (role === 'sender') {
          WiFiDirectTransferService.startSender(initialFiles).catch(console.error);
        } else {
          WiFiDirectTransferService.startReceiver(saveDir, (devices) => setP2pDevices(devices)).catch(console.error);
        }
      } else {
        // Already running, just ensure files are synced for sender
        if (role === 'sender') WiFiDirectTransferService.addFiles(initialFiles);
        // Emit a fake "ready" to update local p2pStatus
        setP2pStatus(role === 'sender' ? '🚀 Active Sender' : '🚀 Active Receiver');
      }
    } else {
      // ── Standard Wi-Fi / Fallback ──
      updateSpaceStats();
      TransferServer.statusCallback = handleServerStatus;
      TransferClient.onStatus = handleClientStatus;

      if (role === 'sender') {
        TransferServer.start(8888, initialFiles, handleServerStatus);
      } else {
        const ip = params.ip;
        if (ip) {
          TransferClient.start(8888, saveDir, ip);
        }
      }
    }

    return () => {
      // Don't call stop() here. 
      // Xender/ShareIt allow you to browse while transferring.
      // Explicit Stop is handled in handleBack / handleDisconnect.
      WiFiDirectTransferService.onStatus = undefined;
      TransferServer.statusCallback = undefined;
      TransferClient.onStatus = undefined;
    };
  }, [role, useWifiDirect, initialFiles]);


  // ── Stats update from rolling-average speed provided by TransferClient ─────
  const updateStatsFromClientSpeed = (speedBps: number, etaSecs: number, name: string, percent: number) => {
    setStats((prevStat: any) => {
      const speed = speedBps > 1024 * 1024
        ? (speedBps / (1024 * 1024)).toFixed(2) + ' MB/s'
        : speedBps > 0
          ? (speedBps / 1024).toFixed(2) + ' KB/s'
          : prevStat.transferSpeed || '0 KB/s';

      let eta = '--:--';
      if (etaSecs > 0 && etaSecs < 3600) {
        const mins = Math.floor(etaSecs / 60);
        const secs = etaSecs % 60;
        eta = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
      } else if (etaSecs >= 3600) {
        eta = '> 1h';
      }

      return { ...prevStat, transferSpeed: speed, eta };
    });
  };

  const updateFileProgress = (name: string, percent: number, currentSize: number, fileTotal?: number, speedBps?: number, etaSecs?: number) => {
    setFiles((prev) => {
      const updated = { ...prev };
      if (updated[name]) {
        updated[name] = {
          ...updated[name],
          // Update size if we now know it (e.g. entry was created by progress before files list arrived)
          size: (updated[name].size || 0) > 0 ? updated[name].size : (fileTotal || 0),
          progress: percent / 100,
          status: percent === 100 ? ('completed' as const) : (role === 'sender' ? 'uploading' as const : 'downloading' as const)
        };
      } else {
        updated[name] = {
          id: name,
          uri: '',
          name,
          size: fileTotal || 0,
          progress: percent / 100,
          type: 'file',
          direction: role === 'sender' ? 'sent' : 'received', // ── Fallback direction logic ──
          status: role === 'sender' ? ('uploading' as const) : ('downloading' as const)
        };
      }

      // Calculate overall progress
      const allFiles = Object.values(updated) as FileItem[];
      const totalTransferred = allFiles.reduce((acc: number, f: FileItem) =>
        acc + ((f.size || 0) * (typeof f.progress === 'number' ? f.progress : 0)), 0);
      const totalSize = allFiles.reduce((acc: number, f: FileItem) => acc + (f.size || 0), 0);
      const progress = totalSize > 0 ? totalTransferred / totalSize : 0;

      setStats((prevStat: any) => {
        const now = Date.now();

        // ── Speed: both sender and receiver now get speed/etaSecs from their respective engines ──
        // Sender → TransferServer.report() calculates wall-clock speed
        // Receiver → TransferClient progress callback calculates hybrid speed
        let speed = prevStat.transferSpeed || '0 KB/s';
        let eta = prevStat.eta || '--:--';

        if (speedBps !== undefined && speedBps > 0) {
          speed = speedBps > 1024 * 1024
            ? (speedBps / (1024 * 1024)).toFixed(2) + ' MB/s'
            : (speedBps / 1024).toFixed(2) + ' KB/s';

          if (etaSecs !== undefined && etaSecs > 0 && etaSecs < 86400) {
            if (etaSecs < 3600) {
              const mins = Math.floor(etaSecs / 60);
              const secs = Math.floor(etaSecs % 60);
              eta = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
            } else {
              eta = '> 1h';
            }
          } else if (percent >= 100) {
            eta = '0:00';
          }
        } else if (speedBps === 0) {
          // Engine says speed=0 (just started or stalled) — keep last known, no flicker
        }
        // speedBps undefined should no longer happen with unified approach

        // Notifications and celebrations — throttle to avoid spam
        if (now - prevStat.lastUpdateTime > 1500 || progress >= 1) {
          if (progress >= 1 && !didCelebrate.current) {
            didCelebrate.current = true;
            NotificationService.displayCompleteNotification(name, true);
            HapticUtil.celebrate();
            triggerCelebration();
          } else if (progress < 1) {
            if (percent === 100) HapticUtil.success();
            NotificationService.displayTransferNotification(name, progress, role === 'sender');
          }
        }

        return {
          ...prevStat,
          transferredSize: totalTransferred,
          totalSize,
          overallProgress: progress,
          leftData: formatSize(Math.max(0, totalSize - totalTransferred)),
          transferSpeed: speed,
          eta,
          lastUpdateTime: now,
          lastTransferredSize: totalTransferred,
        };
      });

      return updated;
    });
  };


  const triggerCelebration = () => {
    setShowCelebration(true);
    // Reset
    celebrationScale.setValue(0);
    celebrationOpacity.setValue(0);
    confettiAnims.forEach(a => { a.y.setValue(0); a.x.setValue(0); a.rotate.setValue(0); a.opacity.setValue(1); });

    // Spring in the checkmark
    Animated.parallel([
      Animated.spring(celebrationScale, { toValue: 1, tension: 60, friction: 7, useNativeDriver: true }),
      Animated.timing(celebrationOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
    ]).start();

    // Confetti burst
    const angles = [0, 60, 120, 180, 240, 300];
    confettiAnims.forEach((anim, i) => {
      const angle = (angles[i] * Math.PI) / 180;
      const dist = 80 + Math.random() * 40;
      Animated.sequence([
        Animated.delay(100),
        Animated.parallel([
          Animated.timing(anim.y, { toValue: -Math.sin(angle) * dist, duration: 700, useNativeDriver: true }),
          Animated.timing(anim.x, { toValue: Math.cos(angle) * dist, duration: 700, useNativeDriver: true }),
          Animated.timing(anim.rotate, { toValue: 3, duration: 700, useNativeDriver: true }),
          Animated.sequence([
            Animated.delay(400),
            Animated.timing(anim.opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
          ]),
        ]),
      ]).start();
    });

    // Auto-hide after 2.5s — stored in ref so it can be cleared on unmount
    celebrationTimerRef.current = setTimeout(() => {
      Animated.timing(celebrationOpacity, { toValue: 0, duration: 400, useNativeDriver: true }).start(() => {
        setShowCelebration(false);
      });
    }, 2500);
  };

  const updateSpaceStats = async () => {
    try {
      const free = await DeviceInfo.getFreeDiskStorage();
      setStats((prev: any) => ({
        ...prev,
        freeSpace: formatSize(free)
      }));
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
    if (type.includes('image')) return 'image';
    if (type.includes('video')) return 'movie-play';
    if (type.includes('audio')) return 'music';
    return 'file-document';
  };

  const getIconColor = (type?: string) => {
    if (!type) return colors.subtext;
    if (type.includes('image')) return colors.primary;
    if (type.includes('video')) return colors.error;
    if (type.includes('audio')) return colors.secondary;
    return colors.success;
  };

  const handleCancel = () => {
    Alert.alert(
      "Cancel Transfer",
      "Are you sure you want to stop the current transfer?",
      [
        { text: "No", style: "cancel" },
        {
          text: "Yes, Stop",
          style: "destructive",
          onPress: () => {
            // ── Xender-style: both devices run Server + Client, stop both ──
            TransferServer.stop();
            TransferClient.stop();
            setTransferring(false);
            navigation.goBack();
          }
        }
      ]
    );
  };

  const handleRetry = () => {
    // ── Reset error statuses back to pending ──
    const updated = { ...files };
    Object.keys(updated).forEach(key => {
      if (updated[key].status === 'error') {
        updated[key] = { ...updated[key], status: 'pending', progress: 0 };
        // Clear from downloaded set so TransferClient retries it
        // (partial file on disk will be resumed via HTTP Range)
        if (role === 'receiver') {
          TransferClient.clearFailedFile(updated[key].name, updated[key].size);
        }
      }
    });
    setFiles(updated);
    Alert.alert('♻️ Retrying', 'Resuming failed transfers from where they stopped...');
  };

  const handleDisconnect = () => {
    Alert.alert(
      "Exit",
      "Are you sure you want to disconnect and go home?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Exit",
          style: "destructive",
          onPress: () => {
            // ── Xender-style: stop both server and client on both devices ──
            TransferServer.stop();
            TransferClient.stop();
            // Reset full transfer state so stale data doesn't leak into next session
            resetTransfer();
            (navigation as any).navigate('Home');
          }
        }
      ]
    );
  };

  const handleOpenFile = async (item: FileItem) => {
    if (role === 'receiver' && item.status === 'completed') {
      const path = Platform.OS === 'android'
        ? `${ReactNativeBlobUtil.fs.dirs.DownloadDir}/FlashDrop/${item.name}`
        : `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/FlashDrop/${item.name}`;

      try {
        const exists = await ReactNativeBlobUtil.fs.exists(path);
        if (exists) {
          const fileUrl = Platform.OS === 'android' ? `file://${path}` : path;
          Linking.openURL(fileUrl).catch(() => {
            Alert.alert("File Saved", `Saved to: ${path}`);
          });
        }
      } catch (e) {
        Alert.alert("Error", "Could not access file");
      }
    }
  };

  // ── Helpers ──────────────────────────────────────────────────────

  /**
   * Build a displayable URI for an image file.
   * - Sender: already has the original URI (content:// or file://)
   * - Receiver: file is saved to saveDir — construct file:// path
   */
  const getDisplayUri = (item: FileItem): string | null => {
    if (!(item.type?.includes('image') || item.type?.includes('video'))) return null;
    const rawUri = (item as any).uri;
    if (rawUri) {
      // Sender side — original URI
      if (rawUri.startsWith('content://') || rawUri.startsWith('file://') || rawUri.startsWith('ph://')) {
        return rawUri;
      }
      return `file://${rawUri}`;
    }
    // Receiver side — reconstruct path from save directory
    const saveDir = Platform.OS === 'android'
      ? `${ReactNativeBlobUtil.fs.dirs.DownloadDir}/FlashDrop`
      : `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/FlashDrop`;
    if (item.status === 'completed') {
      return `file://${saveDir}/${item.name}`;
    }
    return null;
  };

  // ── Connection Quality Bars component (derived from transferSpeed stat) ───
  const ConnectionQualityBars = React.memo(() => {
    const speed = stats.transferSpeed ?? '0 KB/s';

    // Parse MB/s value
    let mbps = 0;
    if (speed.includes('MB/s')) {
      mbps = parseFloat(speed);
    } else if (speed.includes('KB/s')) {
      mbps = parseFloat(speed) / 1024;
    }

    // Determine tier: 0–4 lit bars
    const isTransferred = stats.transferredSize > 0 && stats.transferredSize < stats.totalSize;
    const bars = mbps === 0 ? (isTransferred ? 0 : 1) : mbps < 1 ? 1 : mbps < 5 ? 2 : mbps < 15 ? 3 : 4;
    const barColor = mbps === 0 ? (isTransferred ? '#FF6B6B' : 'rgba(255,255,255,0.25)')
      : mbps < 1 ? '#FFC048'   // orange: slow-ish
        : mbps < 5 ? '#00D1FF'   // light blue: good
          : mbps < 15 ? '#4ADE80'  // green: fast
            : '#7C4DFF';           // purple: ultra fast (P2P)

    const barHeights = [10, 16, 22, 28];

    return (
      <View style={[styles.connQualityBadge, { backgroundColor: isDark ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.2)', borderColor: 'rgba(255,255,255,0.25)' }]}>
        <View style={{ flex: 1 }}>
            <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '900', letterSpacing: 0.1 }}>
                {mbps === 0 ? 'READY' : speed}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 9, fontWeight: '800', marginTop: -2 }}>
                {mbps === 0 ? 'STANDING BY' : 'TRANSFER SPEED'}
            </Text>
        </View>
        <View style={styles.barsRow}>
          {barHeights.map((h, i) => (
            <View
              key={i}
              style={[styles.signalBar, { height: h, backgroundColor: i < bars ? barColor : 'rgba(255,255,255,0.15)' }]}
            />
          ))}
        </View>
      </View>
    );
  });

  const FileCardItem = React.memo(({ item }: { item: FileItem }) => {
    const isCompleted = item.status === 'completed';
    const isError = item.status === 'error';
    const isPending = item.status === 'pending';
    const isActive = item.status === 'uploading' || item.status === 'downloading';

    const isMe = role === 'sender';
    const accentColor = isMe ? colors.primary : colors.secondary;
    const labelText = isMe ? '📱 You' : `📱 ${deviceName || 'Device'}`;
    const alignStyle = isMe ? { alignSelf: 'flex-end' as const, alignItems: 'flex-end' as const } : { alignSelf: 'flex-start' as const, alignItems: 'flex-start' as const };
    
    if (isCompleted || isError) {
      const bubbleBg = isMe
          ? (isDark ? '#1A2A1A' : '#F0FFF4')
          : (isDark ? '#1A1A2A' : '#F5F0FF');
      return (
        <View style={[styles.chatBubbleWrapper, alignStyle]}>
          <Text style={[styles.chatBubbleLabel, { color: accentColor, fontFamily: typography.fontFamily }]}>
            {labelText}
          </Text>
          <View style={[styles.chatBubbleDone, { backgroundColor: bubbleBg, borderColor: isError ? colors.error + '30' : colors.success + '30' }]}>
             <View style={styles.chatBubbleTop}>
                <View style={[styles.chatFileIcon, { backgroundColor: isError ? colors.error + '20' : colors.success + '20' }]}>
                  <Icon name={isError ? "close-circle" : "file-check"} size={16} color={isError ? colors.error : colors.success} />
                </View>
                <Text style={[styles.chatFileName, { color: colors.text, fontFamily: typography.fontFamily }]} numberOfLines={1}>
                  {item.name}
                </Text>
                {isError ? (
                  <Icon name="alert-circle" size={16} color={colors.error} style={{ marginLeft: 4 }} />
                ) : (
                  <Icon name="check-circle" size={16} color={colors.success} style={{ marginLeft: 4 }} />
                )}
             </View>
             <Text style={[styles.chatSizeText, { color: colors.subtext, fontFamily: typography.fontFamily, marginTop: 4 }]}>
                {formatSize(item.size)} · {isError ? 'Failed' : 'Done'}
             </Text>
          </View>
        </View>
      );
    }

    if (isActive || isPending) {
        const bubbleBg = isMe
          ? (isDark ? colors.primary + '22' : colors.primary + '14')
          : (isDark ? colors.secondary + '22' : colors.secondary + '14');
        return (
          <View style={[styles.chatBubbleWrapper, alignStyle]}>
            <Text style={[styles.chatBubbleLabel, { color: accentColor, fontFamily: typography.fontFamily }]}>
              {labelText}
            </Text>
            <View style={[styles.chatBubble, { backgroundColor: bubbleBg, borderColor: accentColor + '30' }]}>
               <View style={styles.chatBubbleTop}>
                  <View style={[styles.chatFileIcon, { backgroundColor: accentColor + '20' }]}>
                    <Icon name={isPending ? "clock-outline" : "file"} size={16} color={accentColor} />
                  </View>
                  <Text style={[styles.chatFileName, { color: colors.text, fontFamily: typography.fontFamily }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {!isPending && (
                    <Text style={[styles.chatPercent, { color: accentColor, fontFamily: typography.fontFamily }]}>
                      {Math.round((item.progress || 0) * 100)}%
                    </Text>
                  )}
                  {isPending && (
                      <Icon name="dots-horizontal" size={16} color={accentColor} style={{ marginLeft: 4 }} />
                  )}
               </View>
               {!isPending && (
                 <View style={[styles.chatBarBg, { backgroundColor: isDark ? '#2A2A2A' : '#DCDCDC' }]}>
                   <View style={[styles.chatBarFill, { backgroundColor: accentColor, width: `${(item.progress || 0) * 100}%` as any }]} />
                 </View>
               )}
               <Text style={[styles.chatSizeText, { color: colors.subtext, fontFamily: typography.fontFamily }]}>
                  {isPending ? `${formatSize(item.size)} · Waiting...` : `${formatSize((item.progress || 0) * item.size)} / ${formatSize(item.size)}`}
               </Text>
            </View>
          </View>
        );
    }

    return null;
  }, (prevProps, nextProps) => {
    return prevProps.item.progress === nextProps.item.progress &&
      prevProps.item.status === nextProps.item.status;
  });

  const renderItem = ({ item }: { item: FileItem }) => <FileCardItem item={item} />;

  const sortedFiles = React.useMemo(() => {
    const vals = Object.values(files) as FileItem[];
    return [
      ...vals.filter(f => f.status !== 'completed'),
      ...vals.filter(f => f.status === 'completed')
    ];
  }, [files]);

  return (
    <View style={styles.container}>
        <StatusBar
          barStyle={'light-content'}
          translucent
          backgroundColor="transparent"
        />

        {/* ── Gradient Dashboard Header ── */}
        <View style={styles.headerWrapper}>
          <LinearGradient
            colors={colors.gradient}
            style={styles.headerGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          />
          <SafeAreaView>
            <View style={styles.headerContent}>
              <TouchableOpacity onPress={handleBack} style={styles.iconBtn}>
                <Icon name="arrow-left" size={22} color="#FFF" />
              </TouchableOpacity>
              
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={[styles.headerTitle, { fontFamily: typography.fontFamily }]}>
                   {role === 'sender' ? 'Sending files' : 'Receiving files'}
                </Text>
                <Text style={[styles.headerSub, { fontFamily: typography.fontFamily }]}>
                   {role === 'sender' ? 'To: ' : 'From: '} {deviceName || 'Device'}
                </Text>
              </View>

              <View style={styles.liveBadge}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>READY</Text>
              </View>
            </View>
          </SafeAreaView>
        </View>

        <View style={styles.dashboardInfoBar}>
          <View style={styles.peerInfoBox}>
            <Icon name="speedometer" size={14} color="#64748B" />
            <Text style={styles.peerNameText}>Transfer Rate</Text>
          </View>
          <View style={styles.speedBadgeBox}>
            <Text style={styles.speedBadgeText}>{stats.transferSpeed || 'STANDING BY'}</Text>
          </View>
        </View>

        <View style={styles.content}>
            <FlatList
              data={Object.values(files)}
              renderItem={renderItem}
              keyExtractor={item => item.name}
              contentContainerStyle={{ paddingTop: 10, paddingBottom: 20 }}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={() => (
                <View style={styles.dashedEmpty}>
                  <Icon name="wechat" size={36} color="#94A3B8" />
                  <Text style={styles.emptyText}>Waiting for files...</Text>
                </View>
              )}
            />
        </View>

          {/* ── Banner Ad — file list ke neeche, buttons ke upar ── */}
          {DisplayAds && (
            <View style={{ alignItems: 'center', backgroundColor: colors.surface, paddingVertical: 4 }}>
              <BannerAd
                unitId={__DEV__ ? TestIds.ADAPTIVE_BANNER : ProdIDs.ADAPTIVE_BANNER}
                size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
                requestOptions={{ requestNonPersonalizedAdsOnly: false }}
              />
            </View>
          )}

          <View style={{ backgroundColor: colors.surface }}>
            {/* Very slim generic progress bar only when transferring */}
            {Object.values(files).some(f => f.status === 'uploading' || f.status === 'downloading') && (
              <View style={[styles.overallBar, { backgroundColor: isDark ? '#2A2A2A' : '#E2E8F0' }]}>
                <Animated.View style={[styles.overallFill, { backgroundColor: colors.primary, width: `${(stats.overallProgress || 0) * 100}%` as any }]} />
              </View>
            )}

            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12, paddingBottom: Math.max(insets.bottom, 20), borderTopWidth: 1, borderTopColor: colors.border }}>
                
                {/* Left Button: Send More / Retry */}
                {Object.values(files).some(f => f.status === 'error') && !Object.values(files).some(f => f.status === 'uploading' || f.status === 'downloading') ? (
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: colors.primary, flex: 1, marginRight: 10 }]}
                    onPress={handleRetry}
                    activeOpacity={0.85}
                  >
                    <Icon name="refresh" size={18} color="#FFF" style={{ paddingLeft: 4 }} />
                    <Text style={[styles.actionBtnText, { fontFamily: typography.fontFamily }]}>
                      Retry Failed
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: colors.primary, flex: 1, marginRight: 10 }]}
                    onPress={() => (navigation as any).navigate('Send', { keepConnection: true, currentRole: role, peerDevice: deviceName })}
                    activeOpacity={0.85}
                  >
                    <Icon name="plus" size={18} color="#FFF" style={{ paddingLeft: 4 }} />
                    <Text style={[styles.actionBtnText, { fontFamily: typography.fontFamily }]}>
                      Send More
                    </Text>
                  </TouchableOpacity>
                )}

                {/* Right Button: Cancel / Disconnect */}
                {Object.values(files).some(f => f.status === 'uploading' || f.status === 'downloading' || f.status === 'pending') ? (
                  <TouchableOpacity
                    style={[
                      styles.actionBtn,
                      {
                        backgroundColor: isDark ? 'rgba(255,193,7,0.12)' : '#FFF8E1',
                        borderWidth: 1,
                        borderColor: colors.warning + '40',
                        flex: 1,
                      },
                    ]}
                    onPress={handleCancel}
                    activeOpacity={0.85}
                  >
                    <Icon name="close-circle-outline" size={20} color={colors.warning} />
                    <Text style={[styles.actionBtnText, { color: colors.warning, fontFamily: typography.fontFamily }]}>
                      Cancel
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[
                      styles.actionBtn,
                      {
                        backgroundColor: isDark ? 'rgba(255,71,87,0.12)' : '#FFEBEE',
                        borderWidth: 1,
                        borderColor: colors.error + '40',
                        flex: 1,
                      },
                    ]}
                    onPress={handleDisconnect}
                    activeOpacity={0.85}
                  >
                    <Icon name="power" size={20} color={colors.error} />
                    <Text style={[styles.actionBtnText, { color: colors.error, fontFamily: typography.fontFamily }]}>
                      Exit
                    </Text>
                  </TouchableOpacity>
                )}
            </View>
        </View>

      {/* ── #7 Celebration Overlay ─────────────────────────────── */}
      {showCelebration && (
        <Animated.View
          style={[
            StyleSheet.absoluteFillObject,
            styles.celebrationOverlay,
            { opacity: celebrationOpacity },
          ]}
          pointerEvents="none"
        >
          {confettiAnims.map((anim, i) => {
            const rot = anim.rotate.interpolate({ inputRange: [0, 3], outputRange: ['0deg', '1080deg'] });
            const emojis = ['🎉', '⭐', '💥', '🌟', '⚡', '🎈'];
            return (
              <Animated.Text
                key={i}
                style={[
                  styles.confettiEmoji,
                  { transform: [{ translateY: anim.y }, { translateX: anim.x }, { rotate: rot }], opacity: anim.opacity },
                ]}
              >
                {emojis[i]}
              </Animated.Text>
            );
          })}
          <Animated.View style={[styles.celebrationCircle, { backgroundColor: colors.success + 'EE', transform: [{ scale: celebrationScale }] }]}>
            <Icon name="check" size={72} color="#FFF" />
          </Animated.View>
          <Animated.Text style={[styles.celebrationText, { transform: [{ scale: celebrationScale }] }]}>
            All Done! 🎉
          </Animated.Text>
        </Animated.View>
      )}
      </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  // ── Header (PC Style) ──
  headerWrapper: {
    backgroundColor: 'transparent',
    zIndex: 10,
    paddingBottom: 20,
  },
  headerGradient: {
    ...StyleSheet.absoluteFillObject,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 50 : 20,
    paddingBottom: 18,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFF',
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.65)',
    marginTop: 1,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,200,100,0.22)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 5,
    borderWidth: 1,
    borderColor: 'rgba(0,255,120,0.3)',
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#00E676',
  },
  liveText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#00E676',
    letterSpacing: 1,
  },
  dashboardInfoBar: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
  },
  peerInfoBox: { flexDirection: 'row', alignItems: 'center' },
  peerNameText: { color: '#64748B', fontSize: 12, marginLeft: 6, fontWeight: '600' },
  speedBadgeBox: {
    backgroundColor: '#FFF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  speedBadgeText: { fontSize: 10, fontWeight: '700', color: '#1E293B' },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  chatBubbleWrapper: {
    width: '80%',
    marginBottom: 10,
  },
  chatBubbleLabel: {
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 3,
    letterSpacing: 0.3,
  },
  chatBubble: {
    borderRadius: 16,
    padding: 12,
    width: '100%',
    borderWidth: 1,
  },
  chatBubbleDone: {
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
  },
  chatBubbleTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    marginBottom: 8,
  },
  chatFileIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  chatFileName: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  chatPercent: {
    fontSize: 13,
    fontWeight: '800',
    minWidth: 38,
    textAlign: 'right',
  },
  chatBarBg: {
    height: 5,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 6,
  },
  chatBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  chatSizeText: {
    fontSize: 10,
    fontWeight: '500',
  },
  dashedEmpty: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#E2E8F0',
    borderRadius: 16,
    paddingVertical: 32,
    alignItems: 'center',
    backgroundColor: '#FAFAFA',
  },
  emptyHistory: { alignItems: 'center', paddingVertical: 20 },
  emptyText: { color: '#94A3B8', fontWeight: '500', marginTop: 8 },
  overallBar: {
    height: 3,
    width: '100%',
  },
  overallFill: {
    height: '100%',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 16,
  },
  actionBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFF',
  },
  retryText: { color: '#2563EB', fontSize: 13, fontWeight: '600' },
  connQualityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  barsRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 28 },
  signalBar: { width: 4, borderRadius: 2 },
  celebrationOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    zIndex: 999,
  },
  confettiEmoji: { position: 'absolute', fontSize: 32 },
  celebrationCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 16,
  },
  celebrationText: {
    color: '#FFF',
    fontSize: 28,
    fontWeight: '800',
    marginTop: 24,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
});

export default FileTransferScreen;