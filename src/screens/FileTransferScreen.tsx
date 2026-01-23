import React, { useState, useEffect } from 'react';
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
  Image
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';
import DeviceInfo from 'react-native-device-info';
import { useNavigation, useRoute } from '@react-navigation/native';
import TransferServer from '../utils/TransferServer';
import TransferClient, { TransferStatus } from '../utils/TransferClient';
import NotificationService from '../utils/NotificationService';
import { useTheme } from '../theme/ThemeContext';
import { useTransferStore } from '../store';

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
    const { role, deviceName, initialFiles } = route.params as any; // role: 'sender' | 'receiver'

  // Zustand store
  const { setRole: setTransferRole, setTransferring } = useTransferStore();

    const [files, setFiles] = useState<Record<string, FileItem>>({});
    const [stats, setStats] = useState({
        totalSize: 0,
        transferredSize: 0,
        leftData: '0GB',
        freeSpace: '0GB',
      overallProgress: 0,
      transferSpeed: '0 KB/s',
      lastUpdateTime: Date.now(),
      lastTransferredSize: 0
    });

  // Update Zustand store with role
  useEffect(() => {
    setTransferRole(role, deviceName);
    setTransferring(true);

    return () => {
      setTransferring(false);
    };
  }, [role, deviceName]);

    useEffect(() => {
        // Initialize files from navigation params if available
      if (initialFiles && Array.isArray(initialFiles)) {
        setFiles(prev => {
          const updated = { ...prev };
          initialFiles.forEach((f: any) => {
            const size = typeof f.rawSize === 'number' ? f.rawSize : (f.size || 0);
            if (!updated[f.name]) {
              updated[f.name] = {
                name: f.name,
                size: size,
                progress: 0,
                status: 'pending',
                type: f.type
              };
            }
          });

          // Recalculate total size from all files
          const allFiles = Object.values(updated);
          const grandTotal = allFiles.reduce((acc, f) => acc + f.size, 0);
          setStats(s => ({ ...s, totalSize: grandTotal }));

          return updated;
        });
        }

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
                } else if (status.files) {
                    // Update metadata
                    setFiles(prev => {
                        const updated = { ...prev };
                      (status.files as any[]).forEach((f: any) => {
                            if (!updated[f.name]) {
                                updated[f.name] = {
                                    name: f.name,
                                    size: f.size,
                                    progress: 0,
                                    status: 'pending',
                                    type: f.type
                                };
                            }
                        });
                        return updated;
                    });
                }
          };
        }

        return () => {
            if (role === 'sender') {
                TransferServer.statusCallback = undefined;
            } else {
              TransferClient.onStatus = undefined;
            }
        };
    }, []);

    const updateFileProgress = (name: string, percent: number, currentSize: number) => {
        setFiles(prev => {
            const updated = { ...prev };
            if (updated[name]) {
                updated[name] = {
                    ...updated[name],
                    progress: percent / 100,
                    status: percent === 100 ? 'completed' : 'transferring'
                };
            } else {
                // New file found during transfer (metadata update)
                updated[name] = {
                    name,
                    size: 0, // We might not know the exact size yet if it's dynamic
                    progress: percent / 100,
                    status: 'transferring'
                };
            }
            
            // Calculate overall progress
            const allFiles = Object.values(updated);
            const totalTransferred = allFiles.reduce((acc, f) => acc + (f.size * f.progress), 0);
            const totalSize = allFiles.reduce((acc, f) => acc + f.size, 0);
            
          setStats(prev => {
            const now = Date.now();
            const timeDiff = (now - prev.lastUpdateTime) / 1000; // seconds
            const bytesDiff = totalTransferred - prev.lastTransferredSize;

            let speed = '0 KB/s';
            if (timeDiff > 0 && bytesDiff > 0) {
              const bytesPerSecond = bytesDiff / timeDiff;
              if (bytesPerSecond > 1024 * 1024) {
                speed = (bytesPerSecond / (1024 * 1024)).toFixed(2) + ' MB/s';
              } else {
                speed = (bytesPerSecond / 1024).toFixed(2) + ' KB/s';
              }
            }

            const progress = totalSize > 0 ? totalTransferred / totalSize : 0;

            // Show notification (throttled to approx once per second)
            if (now - prev.lastUpdateTime > 1000 || progress === 1) {
              if (progress === 1) {
                NotificationService.displayCompleteNotification(name, true);
              } else {
                NotificationService.displayTransferNotification(name, progress, role === 'sender');
              }
            }

            return {
              ...prev,
              transferredSize: totalTransferred,
              totalSize: totalSize,
              overallProgress: progress,
              leftData: formatSize(totalSize - totalTransferred),
              transferSpeed: speed,
              lastUpdateTime: now,
              lastTransferredSize: totalTransferred
            };
          });

            return updated;
        });
    };

    const updateSpaceStats = async () => {
        try {
            const free = await DeviceInfo.getFreeDiskStorage();
            setStats(prev => ({
                ...prev,
                freeSpace: formatSize(free)
            }));
        } catch (e) {}
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

    const handleDisconnect = () => {
        if (role === 'sender') {
            TransferServer.stop();
        } else {
            TransferClient.stop();
        }
        (navigation as any).navigate('Home');
    };

  const renderItem = ({ item }: { item: FileItem }) => {
    const isImage = item.type?.includes('image');
    const isVideo = item.type?.includes('video');
    const showThumbnail = (isImage || isVideo) && (item as any).uri;

    return (
      <View style={[styles.fileCard]}>
        {showThumbnail ? (
          <View style={[styles.thumbnailContainer, { backgroundColor: colors.border }]}>
            <Image
              source={{ uri: (item as any).uri }}
              style={styles.thumbnail}
              resizeMode="cover"
            />
            {isVideo && (
              <View style={styles.playIconOverlay}>
                <Icon name="play-circle" size={24} color="#FFF" />
              </View>
            )}
          </View>
        ) : (
            <View style={[styles.iconContainer, { backgroundColor: getIconColor(item.type) + '20' }]}>
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
              <Icon name="check-circle" size={20} color={colors.success} />
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
  };

    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
            
        <View style={styles.headerWrapper}>
          <LinearGradient
            colors={colors.gradient}
            style={styles.headerGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          />
          <SafeAreaView>
            <View style={styles.headerContent}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.headerTitle, { fontFamily: typography.fontFamily }]}>
                  {role === 'sender' ? 'Sending...' : 'Receiving...'}
                </Text>
                <Text style={[styles.headerSubtitle, { color: 'rgba(255,255,255,0.7)', fontFamily: typography.fontFamily }]}>
                  {role === 'sender' ? 'To' : 'From'} {deviceName || 'Device'}
                </Text>
              </View>
              {stats.transferSpeed !== '0 KB/s' && (
                <View style={styles.speedBadge}>
                  <Icon name="speedometer" size={14} color={colors.primary} />
                  <Text style={[styles.speedText, { color: colors.primary, fontFamily: typography.fontFamily }]}>
                    {stats.transferSpeed}
                  </Text>
                </View>
              )}
            </View>
          </SafeAreaView>
        </View>

            <View style={styles.content}>
          <View style={[styles.listCard, { backgroundColor: colors.surface, ...layout.shadow.medium }]}>
                    <FlatList
                        data={Object.values(files)}
                        renderItem={renderItem}
                        keyExtractor={item => item.name}
                        contentContainerStyle={styles.listContent}
                        showsVerticalScrollIndicator={false}
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
                <View style={[styles.statDot, { backgroundColor: colors.warning }]} />
                <Text style={[styles.statLabel, { color: colors.subtext, fontFamily: typography.fontFamily }]}>
                  Free Space: <Text style={{ color: colors.text, fontWeight: '700' }}>{stats.freeSpace}</Text>
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
              <TouchableOpacity
                style={[styles.disconnectBtn, { backgroundColor: colors.error + '15' }]}
                onPress={handleDisconnect}
              >
                <Text style={[styles.disconnectText, { color: colors.error, fontFamily: typography.fontFamily }]}>Disconnect</Text>
              </TouchableOpacity>

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
          </View>
        </View>
      </View>
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
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'android' ? 50 : 20,
    paddingBottom: 15,
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
  playIconOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', alignItems: 'center' },
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
});

export default FileTransferScreen;
