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
import RNFS from 'react-native-fs';
import { useTheme } from '../theme/ThemeContext';
import { useTransferStore } from '../store';
import { useToast } from '../components/Toast';
import HapticUtil from '../utils/HapticUtil';
import { FileCardSkeleton } from '../components/SkeletonLoader';
import { InterstitialAd, AdEventType, TestIds, BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import { DisplayAds, ProdIDs } from '../utils/Constant';

const interstitialId = __DEV__ ? TestIds.INTERSTITIAL : ProdIDs.INTERSTITIAL;
const interstitial = InterstitialAd.createForAdRequest(interstitialId, {
  requestNonPersonalizedAdsOnly: false,
});

const { width } = Dimensions.get('window');

interface FileItem {
  name: string;
  size: number;
  progress: number;
  status: 'pending' | 'transferring' | 'completed' | 'error';
  type?: string;
}

const FileTransferScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
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
              type: f.type
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

  useEffect(() => {
    updateSpaceStats();

    // Subscribe to progress updates
    if (role === 'sender') {
      // Sender: track outgoing files via own server
      TransferServer.statusCallback = (status) => {
        if (status.type === 'progress' && status.fileProgress) {
          updateFileProgress(
            status.fileProgress.name,
            status.fileProgress.percent,
            status.fileProgress.sent,
            status.fileProgress.total,
            status.fileProgress.speed,
            status.fileProgress.etaSecs,
          );
        }
      };
    } else {
      // Receiver: track downloads from sender
      TransferClient.onStatus = (status: TransferStatus) => {
        if (status.type === 'progress' && status.fileProgress) {
          updateFileProgress(
            status.fileProgress.name,
            status.fileProgress.percent,
            status.fileProgress.received,
            status.fileProgress.total,    // ← pass total so file size shows correctly
            status.fileProgress.speed,
            status.fileProgress.etaSecs
          );
        }

        if (status.files) {
          setFiles((prev) => {
            const updated = { ...prev };
            let added = false;
            (status.files as any[]).forEach((f: any) => {
              if (!updated[f.name]) {
                // File not in list yet — add it
                updated[f.name] = {
                  id: f.name,
                  uri: '',
                  name: f.name,
                  size: f.size || 0,
                  progress: 0,
                  status: 'pending' as const,
                  type: f.type
                };
                added = true;
              } else if (!updated[f.name].size && f.size) {
                // File was added via progress (size=0) — update its real size
                updated[f.name] = { ...updated[f.name], size: f.size };
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

      // ── Xender-style: Receiver also tracks uploads from own server ──
      // When sender downloads from receiver's server, show progress on receiver's screen
      TransferServer.statusCallback = (status) => {
        if (status.type === 'progress' && status.fileProgress) {
          const { name, percent, sent } = status.fileProgress;
          setFiles((prev) => {
            const updated = { ...prev };
            if (updated[name]) {
              updated[name] = {
                ...updated[name],
                progress: percent / 100,
                status: percent === 100 ? ('completed' as const) : ('uploading' as any),
              };
            }
            return updated;
          });
        }
      };
    }

    return () => {
      // Deliberately NOT clearing statusCallback/onStatus here
      // so progress, notifications, and the GlobalTransferOverlay
      // continue updating even if the user navigates to the Home screen.
    };
  }, [role, deviceName]); // Re-subscribe if role or device name unexpectedly changes

  // ── Xender-style: Sender listens for peer registration ──────────────────────────
  // When receiver registers, sender starts a reverse TransferClient
  // to poll receiver's server and download files receiver wants to send.
  useEffect(() => {
    if (role !== 'sender') return;

    const saveDir = Platform.OS === 'android'
      ? `${RNFS.DownloadDirectoryPath}/FlashDrop`
      : `${RNFS.DocumentDirectoryPath}/FlashDrop`;

    TransferServer.onPeerRegistered((peerIp, peerPort) => {
      console.log(`[FileTransfer] 🔄 Peer registered: ${peerIp}:${peerPort}. Starting reverse TransferClient...`);

      // Wire up reverse-direction progress: files coming FROM receiver TO sender
      TransferClient.onStatus = (status: TransferStatus) => {
        if (status.type === 'progress' && status.fileProgress) {
          // Receiver is sending us files — show in sender's file list
          const { name, percent, received, speed, etaSecs } = status.fileProgress;
          setFiles((prev) => {
            const updated = { ...prev };
            if (updated[name]) {
              updated[name] = {
                ...updated[name],
                progress: percent / 100,
                status: percent === 100 ? ('completed' as const) : ('downloading' as any),
              };
            }
            return updated;
          });
          // Also update stats for reverse direction
          if (speed !== undefined && etaSecs !== undefined) {
            updateStatsFromClientSpeed(speed, etaSecs, name, percent);
          }
        }

        if (status.files) {
          // New files available on receiver's server — add to list
          setFiles((prev) => {
            const updated = { ...prev };
            let added = false;
            (status.files as any[]).forEach((f: any) => {
              if (!updated[f.name]) {
                updated[f.name] = {
                  id: f.name,
                  uri: '',
                  name: f.name,
                  size: f.size,
                  progress: 0,
                  status: 'pending' as const,
                  type: f.type,
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

      // Start polling receiver's server for files they want to send
      TransferClient.start(peerPort, saveDir, peerIp);
    });

    // Cleanup: clear callback on unmount
    return () => {
      TransferServer.onPeerRegistered(undefined);
    };
  }, [role]); // eslint-disable-line react-hooks/exhaustive-deps

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
          size: fileTotal || 0,  // use known total, not 0
          progress: percent / 100,
          type: 'file',
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
        ? `${RNFS.DownloadDirectoryPath}/FlashDrop/${item.name}`
        : `${RNFS.DocumentDirectoryPath}/FlashDrop/${item.name}`;

      try {
        const exists = await RNFS.exists(path);
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
      ? `${RNFS.DownloadDirectoryPath}/FlashDrop`
      : `${RNFS.DocumentDirectoryPath}/FlashDrop`;
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
    const bars = mbps === 0 ? 0 : mbps < 1 ? 1 : mbps < 5 ? 2 : mbps < 20 ? 3 : 4;
    const barColor = mbps === 0 ? 'rgba(255,255,255,0.25)'
      : mbps < 1 ? '#FF6B6B'   // red: very slow
        : mbps < 5 ? '#FFC048'   // orange: moderate
          : mbps < 20 ? '#00D189'  // green: fast
            : '#00E5FF';             // cyan: Wi-Fi Direct speed

    const barHeights = [10, 16, 22, 28];

    return (
      <View style={[styles.connQualityBadge, { backgroundColor: isDark ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.2)', borderColor: 'rgba(255,255,255,0.35)' }]}>
        {/* Speed text */}
        <Text style={{ color: '#FFF', fontSize: 11, fontWeight: '700', letterSpacing: 0.3 }}>
          {speed === '0 KB/s' ? 'Connecting' : speed}
        </Text>
        {/* Signal bars */}
        <View style={styles.barsRow}>
          {barHeights.map((h, i) => {
            const isLit = i < bars;
            return (
              <View
                key={i}
                style={[
                  styles.signalBar,
                  {
                    height: h,
                    backgroundColor: isLit ? barColor : 'rgba(255,255,255,0.25)',
                  }
                ]}
              />
            );
          })}
        </View>
      </View>
    );
  });

  const FileCardItem = React.memo(({ item }: { item: FileItem }) => {
    const isImage = item.type?.includes('image');
    const isVideo = item.type?.includes('video');
    const displayUri = getDisplayUri(item);
    const showThumbnail = (isImage || isVideo) && !!displayUri;

    return (
      <View style={[styles.fileCard]}>
        {showThumbnail ? (
          <View style={[styles.thumbnailContainer, { backgroundColor: isDark ? colors.surface : '#F0F0F0' }]}>
            <Image
              source={{ uri: displayUri }}
              style={styles.thumbnail}
              resizeMode="cover"
            />
            {isVideo && (
              <View style={styles.playIconOverlay}>
                <View style={styles.playIconBg}>
                  <Icon name="play" size={14} color="#FFF" />
                </View>
              </View>
            )}
            {item.status === 'transferring' && (
              <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', borderRadius: 14 }]}>
                <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 13 }}>
                  {Math.round(item.progress * 100)}%
                </Text>
              </View>
            )}
          </View>
        ) : (
            <View style={[styles.iconContainer, {
              backgroundColor: getIconColor(item.type) + '18',
              borderWidth: 1.5,
              borderColor: getIconColor(item.type) + '35',
              shadowColor: getIconColor(item.type),
              shadowOpacity: item.status === 'transferring' ? 0.3 : 0,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 0 },
              elevation: item.status === 'transferring' ? 4 : 0,
            }]}>
              <Icon name={getIconForType(item.type)} size={26} color={getIconColor(item.type)} />
            </View>
        )}
        <View style={styles.fileDetails}>
          <View style={styles.fileHeader}>
            <View style={{ flex: 1, marginRight: 10 }}>
              <Text style={[styles.fileName, { color: item.status === 'completed' ? (colors.subtext) : colors.text, fontFamily: typography.fontFamily }]} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={[styles.fileSize, { color: colors.subtext }]}>{formatSize(item.size)}</Text>
            </View>
            {item.status === 'completed' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={[styles.statusCheckBadge, { backgroundColor: colors.success }]}>
                  <Icon name="check" size={12} color="#FFF" />
                </View>
                {role === 'receiver' && (
                  <TouchableOpacity onPress={() => handleOpenFile(item)} style={[styles.openBtn, { borderColor: colors.primary + '60', backgroundColor: colors.primary + '10' }]}>
                    <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }}>OPEN</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
                item.status === 'transferring' ? (
                  <Text style={{ fontSize: 13, color: colors.primary, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                    {Math.round(item.progress * 100)}%
                  </Text>
                ) : (
                    <View style={[styles.pendingBadge, { borderColor: colors.border, backgroundColor: colors.border + '60' }]}>
                      <Icon name="clock-outline" size={13} color={colors.subtext} />
                    </View>
                  )
            )}
          </View>
          <View style={[styles.progressContainer, { backgroundColor: colors.border + '80' }]}>
            <View style={styles.progressBarBg}>
              <LinearGradient
                colors={item.status === 'completed' ? [colors.success, colors.success + 'CC'] : colors.gradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.progressBarFill, { width: `${item.progress * 100}%` }]}
              />
            </View>
          </View>
        </View>
      </View>
    );
  }, (prevProps, nextProps) => {
    // Only re-render if progress or status changes to boost performance
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
    <>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <StatusBar
          barStyle={isDark ? 'light-content' : 'dark-content'}
          translucent
          backgroundColor="transparent"
        />

        <View style={styles.headerWrapper}>
          <LinearGradient
            colors={colors.gradient}
            style={styles.headerGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          />
          {/* Decorative glow circles */}
          <View style={styles.headerGlowTop} />
          <View style={styles.headerGlowBottom} />
          <SafeAreaView>
            <View style={styles.headerContent}>
              <TouchableOpacity
                onPress={handleBack}
                style={styles.iconButton}
              >
                <Icon name="arrow-left" size={22} color="#FFF" />
              </TouchableOpacity>

              <View style={{ flex: 1, marginLeft: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={[styles.headerTitle, { fontFamily: typography.fontFamily }]}>
                    {role === 'sender' ? 'Sending' : 'Receiving'}
                  </Text>
                  {/* Live pulse dot */}
                  <View style={styles.liveDot} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
                  <View style={styles.deviceBadge}>
                    <Icon name="cellphone" size={11} color="rgba(255,255,255,0.7)" />
                  </View>
                  <Text style={[styles.headerSubtitle, { color: 'rgba(255,255,255,0.7)', fontFamily: typography.fontFamily }]}>
                    {role === 'sender' ? 'To' : 'From'} {deviceName || 'Device'}
                  </Text>
                </View>
              </View>
              {/* —— Connection Quality: animated bars + speed text —— */}
              <ConnectionQualityBars />
            </View>
          </SafeAreaView>
        </View>

        <View style={styles.content}>
          <View style={[styles.listCard, { backgroundColor: colors.surface, ...layout.shadow.medium }]}>
            {/* ── Completed summary banner ── */}
            {(() => {
              const all = Object.values(files) as FileItem[];
              const done = all.filter(f => f.status === 'completed');
              if (done.length === 0) return null;
              const doneBytes = done.reduce((s, f) => s + f.size, 0);
              return (
                <View style={[styles.completedBanner, { backgroundColor: colors.success + '12', borderBottomColor: colors.success + '20' }]}>
                  <View style={[styles.completedDot, { backgroundColor: colors.success }]} />
                  <Text style={[styles.completedBannerText, { color: colors.success, fontFamily: typography.fontFamily }]}>
                    {done.length} of {all.length} completed
                  </Text>
                  <Text style={[styles.completedBannerSize, { color: colors.success + 'BB', fontFamily: typography.fontFamily }]}>
                    · {formatSize(doneBytes)}
                  </Text>
                  <View style={[styles.completedCheckBadge, { backgroundColor: colors.success }]}>
                    <Icon name="check" size={10} color="#FFF" />
                  </View>
                </View>
              );
            })()}
            <FlatList
              data={sortedFiles}
              renderItem={renderItem}
              keyExtractor={item => item.name}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={() => (
                <FileCardSkeleton count={4} isDark={isDark} />
              )}
            />
          </View>

          {/* ── Banner Ad — file list ke neeche, buttons ke upar ── */}
          {DisplayAds && (
            <View style={styles.bannerAdContainer}>
              <BannerAd
                unitId={__DEV__ ? TestIds.ADAPTIVE_BANNER : ProdIDs.ADAPTIVE_BANNER}
                size={BannerAdSize.ADAPTIVE_BANNER}
                requestOptions={{ requestNonPersonalizedAdsOnly: false }}
              />
            </View>
          )}

          <View style={styles.footer}>
            {/* Stats cards row */}
            <View style={styles.statsRow}>
              <View style={[styles.statCard, { backgroundColor: isDark ? colors.surface : colors.background, borderColor: colors.border }]}>
                <Icon name="clock-fast" size={14} color={colors.accent} style={{ marginBottom: 3 }} />
                <Text style={[styles.statCardValue, { color: colors.text, fontFamily: typography.fontFamily }]}>{stats.leftData}</Text>
                <Text style={[styles.statCardLabel, { color: colors.subtext, fontFamily: typography.fontFamily }]}>Remaining</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: isDark ? colors.surface : colors.background, borderColor: colors.border }]}>
                <Icon name="timer-outline" size={14} color={colors.primary} style={{ marginBottom: 3 }} />
                <Text style={[styles.statCardValue, { color: colors.text, fontFamily: typography.fontFamily }]}>{stats.eta}</Text>
                <Text style={[styles.statCardLabel, { color: colors.subtext, fontFamily: typography.fontFamily }]}>ETA</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: isDark ? colors.surface : colors.background, borderColor: colors.border }]}>
                <Icon name="harddisk" size={14} color={colors.secondary} style={{ marginBottom: 3 }} />
                <Text style={[styles.statCardValue, { color: colors.text, fontFamily: typography.fontFamily }]}>{stats.freeSpace || '—'}</Text>
                <Text style={[styles.statCardLabel, { color: colors.subtext, fontFamily: typography.fontFamily }]}>Free</Text>
              </View>
            </View>

            {/* Overall progress bar with percentage label */}
            <View style={{ marginBottom: 20 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                <Text style={[{ fontSize: 12, color: colors.subtext, fontFamily: typography.fontFamily }]}>Overall Progress</Text>
                <Text style={[{ fontSize: 12, fontWeight: '700', color: colors.text, fontFamily: typography.fontFamily }]}>
                  {Math.round((stats.overallProgress || 0) * 100)}%
                </Text>
              </View>
              <View style={[styles.overallProgressBarBg, { backgroundColor: colors.border }]}>
                <LinearGradient
                  colors={colors.gradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.overallProgressBarFill, { width: `${(stats.overallProgress || 0) * 100}%` }]}
                />
              </View>
            </View>

            <View style={styles.actionButtons}>
              {Object.values(files).some(f => f.status === 'uploading' || f.status === 'downloading' || f.status === 'pending') && (
                <TouchableOpacity
                  style={[styles.cancelBtnBatch, { backgroundColor: colors.warning + '18', borderWidth: 1.5, borderColor: colors.warning + '40' }]}
                  onPress={handleCancel}
                >
                  <Icon name="close-circle-outline" size={18} color={colors.warning} />
                  <Text style={[styles.cancelText, { color: colors.warning, fontFamily: typography.fontFamily }]}>Cancel</Text>
                </TouchableOpacity>
              )}

              {Object.values(files).some(f => f.status === 'error') && (
                <TouchableOpacity
                  style={[styles.retryBtn, { backgroundColor: colors.primary + '15', borderWidth: 1.5, borderColor: colors.primary + '40' }]}
                  onPress={handleRetry}
                >
                  <Icon name="refresh" size={18} color={colors.primary} />
                  <Text style={[styles.retryText, { color: colors.primary, fontFamily: typography.fontFamily }]}>Retry Failed</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[styles.sendMoreBtn, { borderColor: colors.primary + '60', backgroundColor: colors.primary + '10' }]}
                onPress={() => (navigation as any).navigate('Send', {
                  keepConnection: true,
                  currentRole: role,
                  peerDevice: deviceName
                })}
              >
                <Icon name="plus" size={18} color={colors.primary} />
                <Text style={[styles.sendMoreText, { color: colors.primary, fontFamily: typography.fontFamily }]}>Send More</Text>
              </TouchableOpacity>
            </View>

            {/* Disconnect & Exit — only shown when NOT actively transferring */}
            {!Object.values(files).some(f => f.status === 'uploading' || f.status === 'downloading') && (
              <TouchableOpacity
                style={[styles.disconnectFullBtn, { borderColor: colors.error }]}
                onPress={handleDisconnect}
              >
                <Icon name="power" size={20} color={colors.error} />
                <Text style={[styles.disconnectText, { color: colors.error, fontFamily: typography.fontFamily }]}>Disconnect & Exit</Text>
              </TouchableOpacity>
            )}
          </View>
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
    </>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerWrapper: {
    height: 145,
    backgroundColor: 'transparent',
  },
  headerGradient: {
    ...StyleSheet.absoluteFillObject,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  headerGlowTop: {
    position: 'absolute',
    top: -40,
    right: -30,
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  headerGlowBottom: {
    position: 'absolute',
    bottom: -20,
    left: -20,
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 52 : 22,
    paddingBottom: 16,
  },
  iconButton: {
    width: 38,
    height: 38,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFF',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 13,
    marginTop: 2,
    fontWeight: '500',
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#4ADE80',
    shadowColor: '#4ADE80',
    shadowOpacity: 0.8,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  deviceBadge: {
    width: 18,
    height: 18,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Connection quality badge
  connQualityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    height: 28,
  },
  signalBar: {
    width: 5,
    borderRadius: 3,
  },
  // Celebration overlay
  celebrationOverlay: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    zIndex: 999,
  },
  confettiEmoji: {
    position: 'absolute',
    fontSize: 32,
  },
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
  content: {
    flex: 1,
    paddingHorizontal: 16,
    marginTop: -28,
  },
  listCard: {
    flex: 1,
    borderRadius: 24,
    padding: 4,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.04)',
  },
  listContent: { paddingHorizontal: 14, paddingVertical: 10 },
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    paddingVertical: 2,
  },
  thumbnailContainer: {
    width: 52,
    height: 52,
    borderRadius: 14,
    overflow: 'hidden',
  },
  thumbnail: { width: '100%', height: '100%' },
  playIconOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  playIconBg: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 2,
  },
  iconContainer: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileDetails: { flex: 1, marginLeft: 14 },
  fileHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 9,
  },
  fileName: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  fileSize: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
  statusCheckBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  openBtn: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1.5,
  },
  pendingBadge: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  progressContainer: { height: 5, borderRadius: 4, overflow: 'hidden' },
  progressBarBg: { flex: 1 },
  progressBarFill: { height: '100%', borderRadius: 4 },
  footer: { paddingTop: 16, paddingBottom: 20 },
  // Stat cards row
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    borderWidth: 1,
  },
  statCardValue: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  statCardLabel: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  // Legacy stat items (kept for safety)
  statItem: { flexDirection: 'row', alignItems: 'center' },
  statDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  statLabel: { fontSize: 13 },
  overallProgressBarBg: { height: 7, borderRadius: 6, overflow: 'hidden', marginBottom: 20 },
  overallProgressBarFill: { height: '100%', borderRadius: 6 },
  actionButtons: { flexDirection: 'row', gap: 12 },
  disconnectBtn: {
    flex: 1,
    height: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disconnectText: { fontSize: 15, fontWeight: '700' },
  sendMoreBtn: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: 7,
  },
  sendMoreText: { fontSize: 15, fontWeight: '700' },
  cancelBtnBatch: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  cancelText: { fontSize: 15, fontWeight: '700' },
  retryBtn: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  retryText: { fontSize: 15, fontWeight: '700' },
  disconnectFullBtn: {
    height: 48,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    borderWidth: 1.5,
    borderRadius: 14,
    marginTop: 12,
    gap: 8,
  },
  // Completed summary banner
  completedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 7,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  completedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  completedBannerText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  completedBannerSize: {
    fontSize: 12,
    fontWeight: '500',
  },
  completedCheckBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 'auto' as any,
  },
  speedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  speedText: {
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 6,
  },
  bannerAdContainer: {
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 4,
    borderRadius: 12,
    overflow: 'hidden',
  },
});

export default FileTransferScreen;