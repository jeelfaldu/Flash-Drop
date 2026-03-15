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
import { BannerAd, BannerAdSize, TestIds, InterstitialAd, AdEventType } from 'react-native-google-mobile-ads';
import { DisplayAds, ProdIDs } from '../utils/Constant';

const adUnitId = __DEV__ ? TestIds.ADAPTIVE_BANNER : ProdIDs.ADAPTIVE_BANNER;
const interstitialId = __DEV__ ? TestIds.INTERSTITIAL : ProdIDs.INTERSTITIAL;

const interstitial = InterstitialAd.createForAdRequest(interstitialId, {
  requestNonPersonalizedAdsOnly: true,
});

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
  const [isClientConnected, setIsClientConnected] = useState(false);
  const progressAnims = useRef<Record<string, Animated.Value>>({}).current;
  const scrollViewRef = useRef<ScrollView>(null);

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
      // Client connected
      if (status.type === 'client_connected') {
        setIsClientConnected(true);
      }

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
          const updated = exists
            ? prev.map(t => t.id === id ? { ...t, percent, transferred: sent, total } : t)
            : [...prev, { id, name, percent, transferred: sent, total, direction: 'upload' as const, done: false, timestamp: Date.now() }];

          // Auto-complete when progress hits 100%
          if (percent >= 100) {
            const doneItem = updated.find(t => t.id === id);
            if (doneItem) {
              setRecentTransfers(r => {
                const filtered = r.filter(rt => rt.id !== id);
                return [{ ...doneItem, done: true, percent: 100, timestamp: doneItem.timestamp }, ...filtered].slice(0, 50);
              });
              return updated.filter(t => t.id !== id);
            }
          }
          return updated;
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
            setRecentTransfers(r => {
              const justDoneIds = justDone.map(t => t.id);
              const filtered = r.filter(rt => !justDoneIds.includes(rt.id));
              return [
                ...justDone.map(t => ({ ...t, timestamp: t.timestamp })),
                ...filtered,
              ].slice(0, 50);
            });
          }
          return stillActive;
        });
      }
    };

    const unsubscribe = interstitial.addAdEventListener(AdEventType.LOADED, () => {
      // Ad loaded
    });

    interstitial.load();

    // ── Handle physical/gesture back to show ad ──
    const unsubBeforeRemove = navigation.addListener('beforeRemove', (e: any) => {
      // If we've already handled the ad or ads are disabled, just proceed
      if (!DisplayAds || !interstitial.loaded) {
        return;
      }

      // 1. Prevent the immediate back action
      e.preventDefault();

      // 2. Show the ad
      const unsubClosed = interstitial.addAdEventListener(AdEventType.CLOSED, () => {
        unsubClosed();
        // 3. Once closed, re-trigger back which will now be allowed by the first "if"
        navigation.dispatch(e.data.action);
      });
      interstitial.show();
    });

    return () => {
      stopServer();
      reset();
      unsubscribe();
      unsubBeforeRemove();
    };
  }, [navigation]);

  // Auto-scroll to bottom whenever transfers change
  useEffect(() => {
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
  }, [activeTransfers, recentTransfers]);

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
    if (DisplayAds) {
      if (interstitial.loaded) {
        const unsubClosed = interstitial.addAdEventListener(AdEventType.CLOSED, () => {
          unsubClosed();
          navigation.goBack();
        });
        interstitial.show();
      } else {
        // Fallback if not loaded, just go back
        navigation.goBack();
        return;
      }
    } else {
      navigation.goBack();
    }
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
            timestamp: Date.now(),
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
        ref={scrollViewRef}
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

          {/* ── Animated Icon Area – hidden when client connects ── */}
          {!isClientConnected && (
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
          )}

          {/* ── Chat-style Transfer Feed ── */}
          <View style={{ paddingTop: 10, paddingBottom: 20 }}>
            {[
              ...recentTransfers.map(t => ({ ...t, bubbleType: 'recent' })),
              ...activeTransfers.map(t => ({ ...t, bubbleType: 'active' })),
              ...sharedFiles
                .filter(sf => {
                  const isActive = activeTransfers.some(t => (t.name === sf.name || t.name.includes(sf.name)) && t.direction === 'download');
                  const isDone = recentTransfers.some(t => (t.name === sf.name || t.name.includes(sf.name)) && t.direction === 'download');
                  return !isActive && !isDone;
                })
                .map((sf, index) => ({
                  id: `pending_${sf.name}_${index}`,
                  name: sf.name,
                  percent: 0,
                  transferred: 0,
                  total: sf.size,
                  direction: 'download' as const,
                  done: false,
                  timestamp: sf.timestamp || Date.now(),
                  bubbleType: 'pending'
                }))
            ]
              .sort((a, b) => a.timestamp - b.timestamp)
              .map((item, index) => {
                const isPCtoPhone = item.direction === 'upload';
                const accentColor = isPCtoPhone ? colors.primary : colors.secondary;

              if (item.bubbleType === 'recent') {
                const bubbleBg = isPCtoPhone
                  ? (isDark ? '#1A2A1A' : '#F0FFF4')
                  : (isDark ? '#1A1A2A' : '#F5F0FF');
                return (
                  <View
                    key={`recent_${item.id}_${item.timestamp}_${index}`}
                    style={[
                      styles.chatBubbleWrapper,
                      isPCtoPhone ? { alignSelf: 'flex-start', alignItems: 'flex-start' } : { alignSelf: 'flex-end', alignItems: 'flex-end' },
                    ]}
                  >
                    <Text style={[styles.chatBubbleLabel, { color: accentColor, fontFamily: typography.fontFamily }]}>
                      {isPCtoPhone ? '🖥  PC' : '📱 Phone'}
                    </Text>
                    <View style={[styles.chatBubbleDone, { backgroundColor: bubbleBg, borderColor: colors.success + '30' }]}>
                      <View style={styles.chatBubbleTop}>
                        <View style={[styles.chatFileIcon, { backgroundColor: colors.success + '20' }]}>
                          <Icon name="file-check" size={16} color={colors.success} />
                        </View>
                        <Text
                          style={[styles.chatFileName, { color: colors.text, fontFamily: typography.fontFamily }]}
                          numberOfLines={1}
                        >
                          {item.name}
                        </Text>
                        <Icon name="check-circle" size={16} color={colors.success} style={{ marginLeft: 4 }} />
                      </View>
                      <Text style={[styles.chatSizeText, { color: colors.subtext, fontFamily: typography.fontFamily, marginTop: 4 }]}>
                        {formatSize(item.total)} · Done
                      </Text>
                    </View>
                  </View>
                );
              }

              if (item.bubbleType === 'active') {
                const anim = getOrCreateAnim(item.id);
                const bubbleBg = isPCtoPhone
                  ? (isDark ? colors.primary + '22' : colors.primary + '14')
                  : (isDark ? colors.secondary + '22' : colors.secondary + '14');
                return (
                  <View
                    key={`active_${item.id}_${index}`}
                    style={[
                      styles.chatBubbleWrapper,
                      isPCtoPhone ? { alignSelf: 'flex-start', alignItems: 'flex-start' } : { alignSelf: 'flex-end', alignItems: 'flex-end' },
                    ]}
                  >
                    {/* Direction label */}
                    <Text style={[styles.chatBubbleLabel, { color: accentColor, fontFamily: typography.fontFamily }]}>
                      {isPCtoPhone ? '🖥  PC' : '📱 Phone'}
                    </Text>
                    <View style={[styles.chatBubble, { backgroundColor: bubbleBg, borderColor: accentColor + '30' }]}>
                      {/* File icon + name row */}
                      <View style={styles.chatBubbleTop}>
                        <View style={[styles.chatFileIcon, { backgroundColor: accentColor + '20' }]}>
                          <Icon name="file" size={16} color={accentColor} />
                        </View>
                        <Text
                          style={[styles.chatFileName, { color: colors.text, fontFamily: typography.fontFamily }]}
                          numberOfLines={1}
                        >
                          {item.name}
                        </Text>
                        <Text style={[styles.chatPercent, { color: accentColor, fontFamily: typography.fontFamily }]}>
                          {item.percent}%
                        </Text>
                      </View>
                      {/* Progress bar */}
                      <View style={[styles.chatBarBg, { backgroundColor: isDark ? '#2A2A2A' : '#DCDCDC' }]}>
                        <Animated.View
                          style={[
                            styles.chatBarFill,
                            {
                              backgroundColor: accentColor,
                              width: anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                            },
                          ]}
                        />
                      </View>
                      {/* Size info */}
                      <Text style={[styles.chatSizeText, { color: colors.subtext, fontFamily: typography.fontFamily }]}>
                        {formatSize(item.transferred)} / {formatSize(item.total)}
                      </Text>
                    </View>
                  </View>
                );
              }

              if (item.bubbleType === 'pending') {
                const bubbleBg = isDark ? colors.secondary + '22' : colors.secondary + '14';
                return (
                  <View key={`pending_${item.id}_${index}`} style={[styles.chatBubbleWrapper, { alignSelf: 'flex-end', alignItems: 'flex-end' }]}>
                    <Text style={[styles.chatBubbleLabel, { color: colors.secondary, fontFamily: typography.fontFamily }]}>
                      📱 Phone
                    </Text>
                    <View style={[styles.chatBubble, { backgroundColor: bubbleBg, borderColor: colors.secondary + '30' }]}>
                      <View style={styles.chatBubbleTop}>
                        <View style={[styles.chatFileIcon, { backgroundColor: colors.secondary + '20' }]}>
                          <Icon name="clock-outline" size={16} color={colors.secondary} />
                        </View>
                        <Text style={[styles.chatFileName, { color: colors.text, fontFamily: typography.fontFamily }]} numberOfLines={1}>
                          {item.name}
                        </Text>
                        <Icon name="check" size={16} color={colors.secondary} style={{ marginLeft: 4 }} />
                      </View>
                      <Text style={[styles.chatSizeText, { color: colors.subtext, fontFamily: typography.fontFamily, marginTop: 4 }]}>
                        {formatSize(item.total)} · Sent
                      </Text>
                    </View>
                  </View>
                );
              }

              return null;
            })}
          </View>


          {/* ── Status: Starting spinner (only before ready) ── */}
          {!isServerRunning && (
            <View
              style={[
                styles.statusCard,
                { backgroundColor: colors.surface, borderColor: colors.border, ...layout.shadow.medium },
              ]}
            >
              <View style={styles.statusRow}>
                <View style={[styles.statusIndicator, { backgroundColor: colors.border }]}>
                  <Icon name="loading" size={22} color={colors.subtext} />
                </View>
                <View style={{ flex: 1, marginLeft: 14 }}>
                  <Text style={[styles.statusTitle, { color: colors.text, fontFamily: typography.fontFamily }]}>
                    Starting Server...
                  </Text>
                  <Text style={[styles.statusSub, { color: colors.subtext, fontFamily: typography.fontFamily }]}>
                    Please wait a moment...
                  </Text>
                </View>
              </View>
            </View>
          )}

          {/* ── Compact URL pill (server ready) ── */}
          {isServerRunning && serverUrl && !isClientConnected && (
            <View style={[styles.urlPill, { backgroundColor: colors.surface, borderColor: colors.primary + '30', ...layout.shadow.light }]}>
              <View style={[styles.urlPillDot, { backgroundColor: colors.success }]} />
              <Icon name="web" size={16} color={colors.primary} style={{ marginRight: 8 }} />
              <Text
                selectable
                style={[styles.urlPillText, { color: colors.primary, fontFamily: typography.fontFamily }]}
                numberOfLines={1}
              >
                {serverUrl}
              </Text>
              <TouchableOpacity
                onPress={handleShare}
                style={[styles.urlPillShare, { backgroundColor: colors.primary + '15' }]}
                activeOpacity={0.7}
              >
                <Icon name="share-variant" size={16} color={colors.primary} />
              </TouchableOpacity>
            </View>
          )}

          {/* ── How it works – hidden when client connects ── */}
          {!isClientConnected && (
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
          )}



        </Animated.View>
      </ScrollView>

      {/* ── Fixed Bottom Banner Ad ── */}
      {DisplayAds && (
        <View style={{ alignItems: 'center', backgroundColor: colors.surface, paddingVertical: 4 }}>
          <BannerAd
            unitId={adUnitId}
            size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
            requestOptions={{
              requestNonPersonalizedAdsOnly: true,
            }}
          />
        </View>
      )}

      {/* ── Fixed Bottom Actions Row ── */}
      <SafeAreaView style={{ backgroundColor: colors.surface }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border }}>
          {isServerRunning && (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: colors.primary, flex: 1, marginRight: 10 }]}
              onPress={handleSelectFiles}
              activeOpacity={0.85}
            >
              <Icon name="send" size={18} color="#FFF" style={{ paddingLeft: 4 }} />
              <Text style={[styles.actionBtnText, { fontFamily: typography.fontFamily }]}>
                Send Files
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
      </SafeAreaView>
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

  // ── Chat-style transfer card ──
  chatCard: {
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    marginBottom: 16,
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  chatHeaderIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatHeaderTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
  },
  chatActiveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chatActiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFF',
  },
  chatActiveBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFF',
  },
  chatLegend: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 14,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.2)',
  },
  chatLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chatLegendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  chatLegendText: {
    fontSize: 11,
    fontWeight: '500',
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
  chatDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginVertical: 10,
    alignItems: 'center',
    paddingTop: 6,
  },
  chatDividerText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
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

  // Compact URL pill (replaces status card once server is ready)
  urlPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    marginBottom: 14,
    gap: 4,
  },
  urlPillDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  urlPillText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
  },
  urlPillShare: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
});

export default PCConnectionScreen;
