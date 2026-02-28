import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Dimensions,
  StatusBar,
  SafeAreaView,
  Share,
  Animated,
  ScrollView,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';
import { useTheme } from '../theme/ThemeContext';
import { generateServerUrl, startServer, stopServer } from '../utils/TransferServer';
import TransferServerInstance from '../utils/TransferServer';
import { pick, types, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import RNFS from 'react-native-fs';
import { usePCConnectionStore } from '../store';
import HapticUtil from '../utils/HapticUtil';

const { width } = Dimensions.get('window');

const PCConnectionScreen = ({ navigation }: any) => {
  const { colors, isDark, typography, layout } = useTheme();
  const { serverUrl, isServerRunning, sharedFiles, port, setServerUrl, setIsServerRunning, addFiles, reset } =
    usePCConnectionStore();

  // Unified transfers state (upload + download)
  type TransferItem = {
    id: string;
    name: string;
    percent: number;
    transferred: number;
    total: number;
    direction: 'upload' | 'download'; // upload = PC→Phone, download = Phone→PC
    done: boolean;
    timestamp: number;
  };
  const [activeTransfers, setActiveTransfers] = useState<TransferItem[]>([]);
  const [recentTransfers, setRecentTransfers] = useState<TransferItem[]>([]);
  const progressAnims = useRef<Record<string, Animated.Value>>({}).current;

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulse2Anim = useRef(new Animated.Value(1)).current;

  const getOrCreateAnim = (id: string) => {
    if (!progressAnims[id]) progressAnims[id] = new Animated.Value(0);
    return progressAnims[id];
  };

  const animateProgress = (id: string, toValue: number) => {
    Animated.timing(getOrCreateAnim(id), {
      toValue,
      duration: 200,
      useNativeDriver: false,
    }).start();
  };

  useEffect(() => {
    startPCServer();

    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, friction: 8, useNativeDriver: true }),
    ]).start();

    const startPulse = () => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.6, duration: 1400, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 1400, useNativeDriver: true }),
        ])
      ).start();
      Animated.loop(
        Animated.sequence([
          Animated.delay(700),
          Animated.timing(pulse2Anim, { toValue: 1.6, duration: 1400, useNativeDriver: true }),
          Animated.timing(pulse2Anim, { toValue: 1, duration: 1400, useNativeDriver: true }),
        ])
      ).start();
    };
    startPulse();

    // Subscribe to both upload and download progress
    TransferServerInstance.statusCallback = (status) => {
      // Phone → PC (download): type 'progress'
      if (status.type === 'progress' && status.fileProgress) {
        const { name, percent, sent, total } = status.fileProgress;
        const id = `dl_${name}`;
        animateProgress(id, percent / 100);
        setActiveTransfers(prev => {
          const exists = prev.find(t => t.id === id);
          if (exists) return prev.map(t => t.id === id ? { ...t, percent, transferred: sent, total } : t);
          return [...prev, { id, name, percent, transferred: sent, total, direction: 'download', done: false, timestamp: Date.now() }];
        });
      }

      // PC → Phone (upload): type 'upload_progress'
      if (status.type === 'upload_progress' && status.fileProgress) {
        const { name, percent, sent, total } = status.fileProgress;
        const id = `ul_${name}`;
        animateProgress(id, percent / 100);
        setActiveTransfers(prev => {
          const exists = prev.find(t => t.id === id);
          if (exists) return prev.map(t => t.id === id ? { ...t, percent, transferred: sent, total } : t);
          return [...prev, { id, name, percent, transferred: sent, total, direction: 'upload', done: false, timestamp: Date.now() }];
        });
      }

      // Transfer complete
      if (status.type === 'complete' && status.message) {
        HapticUtil.celebrate();
        // Extract filename from "Received filename.ext" message
        const receivedName = status.message.replace('Received ', '').trim();
        setActiveTransfers(prev => {
          // Match by name in id (ul_ prefix) or dl_ prefix
          const updatedDone = prev.map(t => {
            const matches = t.name === receivedName || t.name.includes(receivedName) || receivedName.includes(t.name);
            return matches ? { ...t, done: true, percent: 100 } : t;
          });
          const justDone = updatedDone.filter(t => t.done);
          const stillActive = updatedDone.filter(t => !t.done);
          if (justDone.length > 0) {
            setRecentTransfers(r => [
              ...justDone.map(t => ({ ...t, timestamp: Date.now() })),
              ...r,
            ].slice(0, 10));
          }
          return stillActive;
        });
      }
    };

    return () => {
      stopServer();
      reset();
    };
  }, []);

  const startPCServer = async () => {
    try {
      await startServer(port);
      const url = await generateServerUrl();
      if (url) {
        setServerUrl(url);
        setIsServerRunning(true);
      } else {
        Alert.alert('Error', 'Could not generate server URL. Ensure you are connected to Wi-Fi.');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to start PC connection server.');
    }
  };

  const handleStopServer = () => {
    stopServer();
    reset();
    navigation.goBack();
  };

  const handleSelectFiles = async () => {
    try {
      const res = await pick({ type: [types.allFiles], allowMultiSelection: true });
      const newFiles = await Promise.all(
        res.map(async (doc) => {
          let size = doc.size || 0;
          if (size === 0) {
            try {
              const stat = await RNFS.stat(doc.uri);
              size = stat.size;
            } catch (e) { }
          }
          return {
            name: doc.name ?? `File_${Date.now()}`,
            size,
            type: doc.type ?? 'application/octet-stream',
            uri: doc.uri,
          };
        })
      );
      addFiles(newFiles);
      TransferServerInstance.updateFiles(newFiles);
    } catch (err) {
      if (isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED) {
        // cancelled
      } else {
        Alert.alert('Error', 'Failed to pick files');
      }
    }
  };

  const handleShare = async () => {
    try {
      await Share.share({ message: serverUrl || "", title: 'FlashDrop PC URL' });
    } catch (e) {
      Alert.alert('Share', serverUrl || "");
    }
  };

  const formatSize = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar
        barStyle="light-content"
        translucent
        backgroundColor="transparent"
      />

      {/* ── Gradient Header ── */}
      <View style={styles.headerWrapper}>
        <LinearGradient
          colors={colors.gradient}
          style={styles.headerGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
        <SafeAreaView>
          <View style={styles.headerContent}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
              <Icon name="arrow-left" size={22} color="#FFF" />
            </TouchableOpacity>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={[styles.headerTitle, { fontFamily: typography.fontFamily }]}>
                Connect to PC
              </Text>
              <Text style={[styles.headerSub, { fontFamily: typography.fontFamily }]}>
                Share files via browser
              </Text>
            </View>
            {isServerRunning && (
              <View style={styles.liveBadge}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>LIVE</Text>
              </View>
            )}
          </View>
        </SafeAreaView>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

          {/* ── Animated Icon Area ── */}
          <View style={styles.iconArea}>
            {/* Pulse rings */}
            <Animated.View
              style={[
                styles.pulseRing,
                {
                  borderColor: colors.primary + '20',
                  transform: [{ scale: pulseAnim }],
                },
              ]}
            />
            <Animated.View
              style={[
                styles.pulseRing,
                styles.pulseRing2,
                {
                  borderColor: colors.primary + '12',
                  transform: [{ scale: pulse2Anim }],
                },
              ]}
            />
            <LinearGradient
              colors={[colors.primary + '30', colors.primary + '10']}
              style={styles.iconCircle}
            >
              <Icon name="monitor-share" size={56} color={colors.primary} />
            </LinearGradient>
          </View>


          {/* ── Active Transfers ── */}
          {activeTransfers.length > 0 && (
            <View style={[styles.uploadCard, { backgroundColor: colors.surface, borderColor: colors.primary + '30', ...layout.shadow.medium }]}>
              <View style={styles.transfersHeader}>
                <View style={[styles.uploadIconBox, { backgroundColor: colors.primary + '15' }]}>
                  <Icon name="transfer" size={20} color={colors.primary} />
                </View>
                <Text style={[styles.transfersTitle, { color: colors.text, fontFamily: typography.fontFamily }]}>
                  Active Transfers
                </Text>
                <View style={[styles.transfersBadge, { backgroundColor: colors.primary }]}>
                  <Text style={styles.transfersBadgeText}>{activeTransfers.length}</Text>
                </View>
              </View>

              {activeTransfers.map((t) => {
                const anim = getOrCreateAnim(t.id);
                const isUpload = t.direction === 'upload';
                const accentColor = isUpload ? colors.secondary : colors.primary;
                return (
                  <View key={t.id} style={[styles.transferRow, { borderTopColor: colors.border }]}>
                    <View style={[styles.directionBadge, { backgroundColor: accentColor + '18' }]}>
                      <Icon
                        name={isUpload ? 'arrow-down-bold' : 'arrow-up-bold'}
                        size={14}
                        color={accentColor}
                      />
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <View style={styles.transferTopRow}>
                        <Text
                          style={[styles.uploadFileName, { color: colors.text, fontFamily: typography.fontFamily, flex: 1 }]}
                          numberOfLines={1}
                        >
                          {t.name}
                        </Text>
                        <Text style={[styles.uploadPercent, { color: accentColor, fontFamily: typography.fontFamily, fontSize: 14 }]}>
                          {t.percent}%
                        </Text>
                      </View>
                      <View style={[styles.uploadBarBg, { backgroundColor: isDark ? '#2A2A2A' : '#EBEBEB', marginTop: 6 }]}>
                        <Animated.View
                          style={[
                            styles.uploadBarFill,
                            {
                              backgroundColor: accentColor,
                              width: anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                            },
                          ]}
                        />
                      </View>
                      <Text style={[styles.uploadSizeText, { color: colors.subtext, fontFamily: typography.fontFamily, marginTop: 4 }]}>
                        {isUpload ? 'PC → Phone' : 'Phone → PC'} • {formatSize(t.transferred)} / {formatSize(t.total)}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* ── Recent Transfers ── */}
          {recentTransfers.length > 0 && (
            <View style={[styles.uploadCard, { backgroundColor: colors.surface, borderColor: colors.border, ...layout.shadow.light }]}>
              <View style={[styles.transfersHeader, { marginBottom: 8 }]}>
                <View style={[styles.uploadIconBox, { backgroundColor: colors.success + '15' }]}>
                  <Icon name="history" size={20} color={colors.success} />
                </View>
                <Text style={[styles.transfersTitle, { color: colors.text, fontFamily: typography.fontFamily }]}>
                  Recent
                </Text>
              </View>
              {recentTransfers.slice(0, 5).map((t) => (
                <View key={`${t.id}_${t.timestamp}`} style={[styles.recentRow, { borderTopColor: colors.border }]}>
                  <Icon
                    name={t.direction === 'upload' ? 'arrow-down-circle' : 'arrow-up-circle'}
                    size={18}
                    color={t.direction === 'upload' ? colors.secondary : colors.primary}
                  />
                  <Text
                    style={[styles.recentName, { color: colors.text, fontFamily: typography.fontFamily }]}
                    numberOfLines={1}
                  >
                    {t.name}
                  </Text>
                  <Text style={[styles.recentSize, { color: colors.subtext, fontFamily: typography.fontFamily }]}>
                    {formatSize(t.total)}
                  </Text>
                  <Icon name="check-circle" size={16} color={colors.success} />
                </View>
              ))}
            </View>
          )}


          {/* ── Status Card ── */}
          <View
            style={[
              styles.statusCard,
              {
                backgroundColor: colors.surface,
                borderColor: isServerRunning
                  ? colors.success + '30'
                  : colors.border,
                ...layout.shadow.medium,
              },
            ]}
          >
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusIndicator,
                  {
                    backgroundColor: isServerRunning
                      ? colors.success + '18'
                      : colors.border,
                  },
                ]}
              >
                <Icon
                  name={isServerRunning ? 'check-circle' : 'loading'}
                  size={22}
                  color={isServerRunning ? colors.success : colors.subtext}
                />
              </View>
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text
                  style={[
                    styles.statusTitle,
                    { color: colors.text, fontFamily: typography.fontFamily },
                  ]}
                >
                  {isServerRunning ? 'Server Ready' : 'Starting Server...'}
                </Text>
                <Text
                  style={[
                    styles.statusSub,
                    { color: colors.subtext, fontFamily: typography.fontFamily },
                  ]}
                >
                  {isServerRunning
                    ? 'Open the URL on your PC browser'
                    : 'Please wait a moment...'}
                </Text>
              </View>
            </View>

            {/* URL Display */}
            {isServerRunning && serverUrl && (
              <View
                style={[
                  styles.urlBox,
                  { backgroundColor: isDark ? colors.background : '#F5F3FF' },
                ]}
              >
                <Icon name="web" size={18} color={colors.primary} style={{ marginRight: 10 }} />
                <Text
                  selectable
                  style={[
                    styles.urlText,
                    { color: colors.primary, fontFamily: typography.fontFamily, flex: 1 },
                  ]}
                  numberOfLines={1}
                >
                  {serverUrl}
                </Text>
                <TouchableOpacity
                  onPress={handleShare}
                  style={[styles.shareBtn, { backgroundColor: colors.primary + '18' }]}
                  activeOpacity={0.7}
                >
                  <Icon name="share-variant" size={18} color={colors.primary} />
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* ── How it works ── */}
          <View style={[styles.howCard, { backgroundColor: colors.surface, borderColor: colors.border, ...layout.shadow.light }]}>
            <Text style={[styles.howTitle, { color: colors.text, fontFamily: typography.fontFamily }]}>
              How it works
            </Text>
            {[
              { icon: 'wifi', color: '#00B0FF', step: '1', text: 'Make sure Phone & PC are on the same Wi-Fi network.' },
              { icon: 'monitor', color: colors.primary, step: '2', text: 'Open any browser on your PC and type the URL above.' },
              { icon: 'file-upload', color: colors.success, step: '3', text: 'Select files on PC and they will transfer instantly!' },
            ].map((item) => (
              <View key={item.step} style={styles.stepRow}>
                <View style={[styles.stepNumBox, { backgroundColor: item.color + '18' }]}>
                  <Icon name={item.icon} size={20} color={item.color} />
                </View>
                <Text style={[styles.stepText, { color: colors.subtext, fontFamily: typography.fontFamily }]}>
                  {item.text}
                </Text>
              </View>
            ))}
          </View>

          {/* ── Shared Files Badge ── */}
          {sharedFiles.length > 0 && (
            <View
              style={[
                styles.filesBadge,
                { backgroundColor: colors.primary + '12', borderColor: colors.primary + '30' },
              ]}
            >
              <Icon name="file-multiple" size={20} color={colors.primary} />
              <Text
                style={[
                  styles.filesBadgeText,
                  { color: colors.primary, fontFamily: typography.fontFamily },
                ]}
              >
                {sharedFiles.length} file{sharedFiles.length !== 1 ? 's' : ''} ready to serve
              </Text>
            </View>
          )}

          {/* ── Action Buttons ── */}
          <View style={styles.actionsRow}>
            {isServerRunning && (
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: colors.primary, flex: 1, marginRight: 10 }]}
                onPress={handleSelectFiles}
                activeOpacity={0.85}
              >
                <Icon name="file-plus" size={20} color="#FFF" />
                <Text style={[styles.actionBtnText, { fontFamily: typography.fontFamily }]}>
                  Add Files
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[
                styles.actionBtn,
                {
                  backgroundColor: isDark ? 'rgba(255,71,87,0.12)' : '#FFEBEE',
                  borderWidth: 1,
                  borderColor: colors.error + '40',
                  flex: isServerRunning ? undefined : 1,
                  paddingHorizontal: isServerRunning ? 20 : 24,
                },
              ]}
              onPress={handleStopServer}
              activeOpacity={0.85}
            >
              <Icon name="power" size={20} color={colors.error} />
              <Text style={[styles.actionBtnText, { color: colors.error, fontFamily: typography.fontFamily }]}>
                Stop
              </Text>
            </TouchableOpacity>
          </View>

        </Animated.View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },

  // Header
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

  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },

  // Icon area with pulse
  iconArea: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 180,
    marginTop: 16,
    marginBottom: 8,
  },
  pulseRing: {
    position: 'absolute',
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 1.5,
  },
  pulseRing2: {
    width: 160,
    height: 160,
    borderRadius: 80,
  },
  iconCircle: {
    width: 100,
    height: 100,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Status card
  statusCard: {
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    marginBottom: 16,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  statusIndicator: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 3,
  },
  statusSub: {
    fontSize: 13,
  },
  urlBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  urlText: {
    fontSize: 15,
    fontWeight: '700',
  },
  shareBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },

  // How-to card
  howCard: {
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    marginBottom: 16,
  },
  howTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 16,
    letterSpacing: 0.2,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 14,
    gap: 14,
  },
  stepNumBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepText: {
    fontSize: 13,
    lineHeight: 20,
    flex: 1,
    paddingTop: 10,
  },

  // Files badge
  filesBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  filesBadgeText: {
    fontSize: 14,
    fontWeight: '600',
  },

  // Actions
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    borderRadius: 20,
  },
  actionBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFF',
  },

  // Upload progress card
  uploadCard: {
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    marginBottom: 16,
  },
  uploadHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  uploadIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadFileName: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 3,
  },
  uploadStatus: {
    fontSize: 12,
    fontWeight: '500',
  },
  uploadPercent: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  uploadBarBg: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 8,
  },
  uploadBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  uploadSizeText: {
    fontSize: 11,
    fontWeight: '500',
    textAlign: 'right',
  },

  // Unified transfers
  transfersHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  transfersTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
  },
  transfersBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  transfersBadgeText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '800',
  },
  transferRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: 12,
    marginTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  directionBadge: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 2,
  },
  transferTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 10,
    marginTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  recentName: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  recentSize: {
    fontSize: 11,
    fontWeight: '500',
  },
});

export default PCConnectionScreen;
