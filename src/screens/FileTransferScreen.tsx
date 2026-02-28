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
            if (role === 'sender') TransferServer.stop();
            else TransferClient.stop();
            resetTransfer();
            setTransferring(false); // Ensure state is reset
            (navigation as any).navigate('Home');
          }
        }
      ]
    );
    return true;
  };

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
      TransferServer.statusCallback = (status) => {
        if (status.type === 'progress' && status.fileProgress) {
          updateFileProgress(status.fileProgress.name, status.fileProgress.percent, status.fileProgress.sent);
        }
      };
    } else {
      // Receiver: Hook into TransferClient which is already started in ReceiveScreen
      TransferClient.onStatus = (status: TransferStatus) => {
        if (status.type === 'progress' && status.fileProgress) {
          updateFileProgress(status.fileProgress.name, status.fileProgress.percent, status.fileProgress.received);
        }

        if (status.files) {
        // Update metadata
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
      };
    }

    return () => {
      // Deliberately NOT clearing statusCallback/onStatus here
      // so progress, notifications, and the GlobalTransferOverlay
      // continue updating even if the user navigates to the Home screen.
    };
  }, [role, deviceName]); // Re-subscribe if role or device name unexpectedly changes

  const updateFileProgress = (name: string, percent: number, currentSize: number) => {
    setFiles((prev) => {
      const updated = { ...prev };
      if (updated[name]) {
        updated[name] = {
          ...updated[name],
          progress: percent / 100,
          status: percent === 100 ? ('completed' as const) : (role === 'sender' ? 'uploading' as const : 'downloading' as const)
        };
      } else {
        updated[name] = {
          id: name,
          uri: '',
          name,
          size: 0,
          progress: percent / 100,
          type: 'file',
          status: role === 'sender' ? ('uploading' as const) : ('downloading' as const)
        };
      }

      // Calculate overall progress using the latest updated files
      const allFiles = Object.values(updated) as FileItem[];
      const totalTransferred = allFiles.reduce((acc: number, f: FileItem) => acc + ((f.size || 0) * (typeof f.progress === 'number' ? f.progress : 0)), 0);
      const totalSize = allFiles.reduce((acc: number, f: FileItem) => acc + (f.size || 0), 0);

      setStats((prevStat: any) => {
        const now = Date.now();
        const timeDiff = (now - prevStat.lastUpdateTime) / 1000;
        const bytesDiff = totalTransferred - prevStat.lastTransferredSize;

        let speed = '0 KB/s';
        if (timeDiff > 0 && bytesDiff >= 0) {
          const bytesPerSecond = bytesDiff / timeDiff;
          if (bytesPerSecond > 1024 * 1024) {
            speed = (bytesPerSecond / (1024 * 1024)).toFixed(2) + ' MB/s';
          } else {
            speed = (bytesPerSecond / 1024).toFixed(2) + ' KB/s';
          }
        }

        const progress = totalSize > 0 ? totalTransferred / totalSize : 0;

        if (now - prevStat.lastUpdateTime > 1000 || progress === 1) {
          if (progress === 1) {
            NotificationService.displayCompleteNotification(name, true);
            // ── Haptic celebrate on full completion ──────────────────────
            HapticUtil.celebrate();
            triggerCelebration();
          } else {
            if (percent === 100) HapticUtil.success(); // per-file complete
            NotificationService.displayTransferNotification(name, progress, role === 'sender');
          }
        }

        let eta = '--:--';
        const remainingBytes = totalSize - totalTransferred;
        if (bytesDiff > 0 && timeDiff > 0 && remainingBytes > 0) {
          const bytesPerSecond = bytesDiff / timeDiff;
          const secondsLeft = Math.floor(remainingBytes / bytesPerSecond);
          if (secondsLeft < 3600) {
            const mins = Math.floor(secondsLeft / 60);
            const secs = secondsLeft % 60;
            eta = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
          } else {
            eta = '> 1h';
          }
        }

        return {
          ...prevStat,
          transferredSize: totalTransferred,
          totalSize: totalSize,
          overallProgress: progress,
          leftData: formatSize(Math.max(0, totalSize - totalTransferred)),
          transferSpeed: speed,
          eta: eta,
          lastUpdateTime: now,
          lastTransferredSize: totalTransferred
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
            if (role === 'sender') {
              TransferServer.stop();
            } else {
              TransferClient.stop();
            }
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
            if (role === 'sender') {
              TransferServer.stop();
            } else {
              TransferClient.stop();
            }
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
        ? `${RNFS.ExternalDirectoryPath}/FlashDrop/${item.name}`
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
      ? `${RNFS.ExternalDirectoryPath}/FlashDrop`
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
              <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', borderRadius: 12 }]}>
                <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 13 }}>
                  {Math.round(item.progress * 100)}%
                </Text>
              </View>
            )}
          </View>
        ) : (
            <View style={[styles.iconContainer, { backgroundColor: getIconColor(item.type) + '15', borderWidth: 1, borderColor: getIconColor(item.type) + '30' }]}>
              <Icon name={getIconForType(item.type)} size={28} color={getIconColor(item.type)} />
            </View>
        )}
        <View style={styles.fileDetails}>
          <View style={styles.fileHeader}>
            <Text style={[styles.fileName, { color: colors.text, fontFamily: typography.fontFamily }]} numberOfLines={1}>
              {item.name}
              <Text style={[styles.fileSize, { color: colors.subtext }]}> ({formatSize(item.size)})</Text>
            </Text>
            {item.status === 'completed' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icon name="check-circle" size={20} color={colors.success} />
                {role === 'receiver' && (
                  <TouchableOpacity onPress={() => handleOpenFile(item)}>
                    <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>OPEN</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
                item.status === 'transferring' ? (
                  <Text style={{ fontSize: 12, color: colors.primary, fontWeight: 'bold' }}>
                    {Math.round(item.progress * 100)}%
                  </Text>
                ) : (
                  <Icon name="clock-outline" size={20} color={colors.subtext} />
                )
            )}
          </View>
          <View style={[styles.progressContainer, { backgroundColor: colors.border }]}>
            <View style={styles.progressBarBg}>
              <LinearGradient
                colors={colors.gradient}
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
          <SafeAreaView>
            <View style={styles.headerContent}>
              <TouchableOpacity
                onPress={handleBack}
                style={styles.iconButton}
              >
                <Icon name="arrow-left" size={24} color="#FFF" />
              </TouchableOpacity>

              <View style={{ flex: 1, marginLeft: 16 }}>
                <Text style={[styles.headerTitle, { fontFamily: typography.fontFamily }]}>
                  {role === 'sender' ? 'Sending...' : 'Receiving...'}
                </Text>
                <Text style={[styles.headerSubtitle, { color: 'rgba(255,255,255,0.7)', fontFamily: typography.fontFamily }]}>
                  {role === 'sender' ? 'To' : 'From'} {deviceName || 'Device'}
                </Text>
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
                <View style={[styles.completedBanner, { backgroundColor: colors.success + '12', borderBottomColor: colors.success + '25' }]}>
                  <View style={[styles.completedDot, { backgroundColor: colors.success }]} />
                  <Text style={[styles.completedBannerText, { color: colors.success, fontFamily: typography.fontFamily }]}>
                    {done.length} of {all.length} completed
                  </Text>
                  <Text style={[styles.completedBannerSize, { color: colors.success + 'CC', fontFamily: typography.fontFamily }]}>
                    • {formatSize(doneBytes)}
                  </Text>
                  <Icon name="check-circle" size={16} color={colors.success} style={{ marginLeft: 'auto' }} />
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

          <View style={styles.footer}>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <View style={[styles.statDot, { backgroundColor: colors.accent }]} />
                <Text style={[styles.statLabel, { color: colors.subtext, fontFamily: typography.fontFamily }]}>
                  Remaining: <Text style={{ color: colors.text, fontWeight: '700' }}>{stats.leftData}</Text>
                </Text>
              </View>
              <View style={styles.statItem}>
                <View style={[styles.statDot, { backgroundColor: colors.primary }]} />
                <Text style={[styles.statLabel, { color: colors.subtext, fontFamily: typography.fontFamily }]}>
                  ETA: <Text style={{ color: colors.text, fontWeight: '700' }}>{stats.eta}</Text>
                </Text>
              </View>
            </View>

            <View style={[styles.overallProgressBarBg, { backgroundColor: colors.border }]}>
              <LinearGradient
                colors={colors.gradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.overallProgressBarFill, { width: `${stats.overallProgress * 100}%` }]}
              />
            </View>

            <View style={styles.actionButtons}>
              {Object.values(files).some(f => f.status === 'uploading' || f.status === 'downloading' || f.status === 'pending') && (
                <TouchableOpacity
                  style={[styles.cancelBtnBatch, { backgroundColor: colors.warning + '15' }]}
                  onPress={handleCancel}
                >
                  <Icon name="close-circle-outline" size={20} color={colors.warning} />
                  <Text style={[styles.cancelText, { color: colors.warning, fontFamily: typography.fontFamily }]}>Cancel</Text>
                </TouchableOpacity>
              )}

              {Object.values(files).some(f => f.status === 'error') && (
                <TouchableOpacity
                  style={[styles.retryBtn, { backgroundColor: colors.primary + '15' }]}
                  onPress={handleRetry}
                >
                  <Icon name="refresh" size={20} color={colors.primary} />
                  <Text style={[styles.retryText, { color: colors.primary, fontFamily: typography.fontFamily }]}>Retry Failed</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[styles.sendMoreBtn, { borderColor: colors.primary }]}
                onPress={() => (navigation as any).navigate('Send', {
                  keepConnection: true,
                  currentRole: role,
                  peerDevice: deviceName
                })}
              >
                <Icon name="plus" size={20} color={colors.primary} />
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
    height: 130,
    backgroundColor: 'transparent',
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
  iconButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFF',
  },
  headerSubtitle: {
    fontSize: 14,
    marginTop: 4,
  },
  speedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20
  },
  speedText: {
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 6
  },
  // Connection quality badge (replaces speedBadge)
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
    backgroundColor: 'rgba(0,0,0,0.55)',
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
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 12,
  },
  celebrationText: {
    color: '#FFF',
    fontSize: 28,
    fontWeight: '800',
    marginTop: 24,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    marginTop: -30
  },
  listCard: {
    flex: 1,
    borderRadius: 24,
    padding: 5
  },
  listContent: { padding: 15 },
  fileCard: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  thumbnailContainer: { width: 50, height: 50, borderRadius: 12, overflow: 'hidden' },
  thumbnail: { width: '100%', height: '100%' },
  playIconOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  playIconBg: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 2, // optical center for play icon
  },
  iconContainer: { width: 50, height: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  fileDetails: { flex: 1, marginLeft: 16 },
  fileHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  fileName: { fontSize: 16, fontWeight: '600', flex: 1, marginRight: 10 },
  fileSize: { fontSize: 12, fontWeight: 'normal' },
  progressContainer: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressBarBg: { flex: 1 },
  progressBarFill: { height: '100%', borderRadius: 3 },
  footer: { paddingVertical: 24 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16, paddingHorizontal: 10 },
  statItem: { flexDirection: 'row', alignItems: 'center' },
  statDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  statLabel: { fontSize: 13 },
  overallProgressBarBg: { height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 24 },
  overallProgressBarFill: { height: '100%', borderRadius: 4 },
  actionButtons: { flexDirection: 'row', gap: 16 },
  disconnectBtn: {
    flex: 1,
    height: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center'
  },
  disconnectText: { fontSize: 16, fontWeight: '700' },
  sendMoreBtn: {
    flex: 1,
    height: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: 8
  },
  sendMoreText: { fontSize: 16, fontWeight: '700' },
  cancelBtnBatch: {
    flex: 1,
    height: 50,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8
  },
  cancelText: { fontSize: 16, fontWeight: '700' },
  retryBtn: {
    flex: 1,
    height: 50,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8
  },
  retryText: { fontSize: 16, fontWeight: '700' },
  disconnectFullBtn: {
    height: 50,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    borderWidth: 1.5,
    borderRadius: 16,
    marginTop: 16,
    gap: 8
  },

  // Completed summary banner
  completedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 6,
  },
  completedDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  completedBannerText: {
    fontSize: 13,
    fontWeight: '700',
  },
  completedBannerSize: {
    fontSize: 12,
    fontWeight: '500',
  },
});

export default FileTransferScreen;
