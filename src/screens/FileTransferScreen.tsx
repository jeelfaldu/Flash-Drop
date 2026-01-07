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
import RNFS from 'react-native-fs';
import TransferServer from '../utils/TransferServer';
import TransferClient, { TransferStatus } from '../utils/TransferClient';
import NotificationService from '../utils/NotificationService';
import { useTheme } from '../theme/ThemeContext';

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
  const { theme, isDark } = useTheme();
    const { role, deviceName, initialFiles } = route.params as any; // role: 'sender' | 'receiver'

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

    useEffect(() => {
        // Initialize files from navigation params if available
        if (initialFiles) {
            const fileMap: Record<string, FileItem> = {};
            let total = 0;
            initialFiles.forEach((f: any) => {
                const size = typeof f.rawSize === 'number' ? f.rawSize : (f.size || 0);
                fileMap[f.name] = {
                    name: f.name,
                    size: size,
                    progress: 0,
                    status: 'pending',
                    type: f.type
                };
                total += size;
            });
            setFiles(fileMap);
            setStats(prev => ({ ...prev, totalSize: total }));
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
        if (!type) return '#8E8E93';
        if (type.includes('image')) return '#7C4DFF';
        if (type.includes('video')) return '#FF5252';
        if (type.includes('audio')) return '#2196F3';
        return '#4CAF50';
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
      <View style={styles.fileCard}>
        {showThumbnail ? (
          <View style={styles.thumbnailContainer}>
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
            <Text style={[styles.fileName, { color: theme.text }]} numberOfLines={1}>
              {item.type?.includes('image') ? 'Images' : item.type?.includes('video') ? 'Videos' : item.name}
              <Text style={[styles.fileSize, { color: theme.subtext }]}> ({formatSize(item.size)})</Text>
            </Text>
            {item.status === 'completed' ? (
              <Icon name="check" size={20} color={theme.primary} />
            ) : (
              <TouchableOpacity>
                <Icon name="close" size={20} color={theme.subtext} />
              </TouchableOpacity>
            )}
          </View>
          <View style={[styles.progressContainer, { backgroundColor: isDark ? '#333' : '#F0F0F5' }]}>
            <View style={styles.progressBarBg}>
              <LinearGradient
                colors={[theme.primary, theme.primaryDark]}
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
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
        <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />
            
            <View style={styles.header}>
          <Text style={[styles.headerTitle, { color: theme.text }]}>{role === 'sender' ? 'Sending' : 'Receiving'}</Text>
          <Text style={[styles.headerSubtitle, { color: theme.subtext }]}>
            {role === 'sender' ? 'to' : 'from'} {deviceName || 'FlashDrop Device'}
          </Text>
          {stats.transferSpeed !== '0 KB/s' && (
            <View style={[styles.speedContainer, { backgroundColor: isDark ? '#242424' : '#F3F4F9' }]}>
              <Icon name="speedometer" size={16} color={theme.primary} />
              <Text style={[styles.speedText, { color: theme.primary }]}>{stats.transferSpeed}</Text>
            </View>
          )}
            </View>

            <View style={styles.content}>
          <View style={[styles.listCard, { backgroundColor: theme.card }]}>
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
                <View style={[styles.statDot, { backgroundColor: theme.accent }]} />
                <Text style={[styles.statLabel, { color: theme.subtext }]}>Left Data : <Text style={[styles.statValue, { color: theme.text }]}>{stats.leftData}</Text></Text>
                        </View>
                        <View style={styles.statItem}>
                            <View style={[styles.statDot, { backgroundColor: '#FFE082' }]} />
                <Text style={[styles.statLabel, { color: theme.subtext }]}>Free Space : <Text style={[styles.statValue, { color: theme.text }]}>{stats.freeSpace}</Text></Text>
                        </View>
                    </View>

            <View style={[styles.overallProgressBarBg, { backgroundColor: isDark ? '#333' : '#E0E0E0' }]}>
                        <LinearGradient
                colors={[theme.primary, theme.primaryDark]}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 0 }}
                            style={[styles.overallProgressBarFill, { width: `${stats.overallProgress * 100}%` }]}
                        />
                    </View>

            <TouchableOpacity
              style={[styles.sendMoreBtn, { backgroundColor: theme.card, borderColor: theme.primary }]}
              onPress={() => (navigation as any).navigate('Send', {
                keepConnection: true,
                currentRole: role,
                peerDevice: deviceName
              })}
            >
              <Icon name="plus-circle" size={24} color={theme.primary} style={{ marginRight: 8 }} />
              <Text style={[styles.sendMoreText, { color: theme.primary }]}>Send More Files</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.disconnectBtn, { backgroundColor: isDark ? '#242424' : '#F3F4F9' }]}
              onPress={handleDisconnect}
            >
              <Text style={[styles.disconnectText, { color: theme.text }]}>Disconnect</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F8F9FB' },
    header: { alignItems: 'center', paddingVertical: 30 },
    headerTitle: { fontSize: 32, fontWeight: 'bold', color: '#333' },
    headerSubtitle: { fontSize: 14, color: '#8E8E93', marginTop: 5 },
  speedContainer: { flexDirection: 'row', alignItems: 'center', marginTop: 8, backgroundColor: '#F3F4F9', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 15 },
  speedText: { fontSize: 14, fontWeight: 'bold', color: '#7C4DFF', marginLeft: 6 },

    content: { flex: 1, paddingHorizontal: 20 },
    listCard: {
        flex: 1,
        backgroundColor: '#FFF',
        borderRadius: 25,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 15,
        padding: 5
    },
    listContent: { padding: 15 },

    fileCard: { flexDirection: 'row', alignItems: 'center', marginBottom: 25 },
  thumbnailContainer: { width: 56, height: 56, borderRadius: 12, overflow: 'hidden', backgroundColor: '#F0F0F5' },
  thumbnail: { width: '100%', height: '100%' },
  playIconOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', alignItems: 'center' },
    iconContainer: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
    fileDetails: { flex: 1, marginLeft: 15 },
    fileHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
    fileName: { fontSize: 18, fontWeight: 'bold', color: '#333', flex: 1 },
    fileSize: { fontSize: 13, fontWeight: 'normal', color: '#8E8E93' },
    
    progressContainer: { height: 4, backgroundColor: '#F0F0F5', borderRadius: 2, overflow: 'hidden' },
    progressBarBg: { flex: 1 },
    progressBarFill: { height: '100%', borderRadius: 2 },

    footer: { paddingVertical: 25 },
    statsRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 20 },
    statItem: { flexDirection: 'row', alignItems: 'center' },
    statDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
    statLabel: { fontSize: 14, color: '#8E8E93' },
    statValue: { color: '#333', fontWeight: 'bold' },

  overallProgressBarBg: { height: 6, backgroundColor: '#E0E0E0', borderRadius: 3, overflow: 'hidden', marginBottom: 20 },
    overallProgressBarFill: { height: '100%', borderRadius: 3 },

  sendMoreBtn: {
    backgroundColor: '#FFF',
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    marginBottom: 15,
    borderWidth: 2,
    borderColor: '#7C4DFF'
  },
  sendMoreText: { fontSize: 18, fontWeight: 'bold', color: '#7C4DFF' },

    disconnectBtn: {
        backgroundColor: '#F3F4F9',
        height: 60,
        borderRadius: 30,
        alignItems: 'center',
        justifyContent: 'center'
    },
    disconnectText: { fontSize: 18, fontWeight: 'bold', color: '#333' }
});

export default FileTransferScreen;
