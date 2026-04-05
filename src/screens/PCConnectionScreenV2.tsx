/**
 * PCConnectionScreenV2.tsx
 *
 * V2 PC Sharing — Modern redesign of PCConnectionScreen.
 * Features:
 *   • Starts a local HTTP server (port 8080) for file sharing via browser
 *   • Shows a scannable QR code + copyable URL
 *   • Chat-style transfer feed (upload + download)
 *   • File picker to share files to browser
 *   • Interstitial ad on exit
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Alert,
  Dimensions,
  StatusBar,
  SafeAreaView,
  Share,
  Animated,
  ScrollView,
  ActivityIndicator,
  Clipboard,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';
import WifiManager from 'react-native-wifi-reborn';
import { pick, types, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import RNFS from 'react-native-fs';
import { useTheme } from '../theme/ThemeContext';
import TransferServerV2, { ServerStatusV2 } from '../utils/TransferServerV2';
import { usePCConnectionStore } from '../store';
import HapticUtil from '../utils/HapticUtil';
import { BannerAd, BannerAdSize, TestIds, InterstitialAd, AdEventType } from 'react-native-google-mobile-ads';
import { DisplayAds, ProdIDs } from '../utils/Constant';

const { width } = Dimensions.get('window');

const PC_PORT = 8080;
const adUnitId = __DEV__ ? TestIds.ADAPTIVE_BANNER : ProdIDs.ADAPTIVE_BANNER;
const interstitialId = __DEV__ ? TestIds.INTERSTITIAL : ProdIDs.INTERSTITIAL;
const interstitial = InterstitialAd.createForAdRequest(interstitialId, {
  requestNonPersonalizedAdsOnly: true,
});

type TransferItem = {
  id: string;
  name: string;
  percent: number;
  transferred: number;
  total: number;
  direction: 'upload' | 'download';
  done: boolean;
  timestamp: number;
};

const PCConnectionScreenV2 = ({ navigation }: any) => {
  const { colors, isDark, typography, layout } = useTheme();
  const { serverUrl, isServerRunning, sharedFiles, setServerUrl, setIsServerRunning, addFiles, reset } =
    usePCConnectionStore();

  const [isClientConnected, setIsClientConnected] = useState(false);
  const [activeTransfers, setActiveTransfers] = useState<TransferItem[]>([]);
  const [recentTransfers, setRecentTransfers] = useState<TransferItem[]>([]);
  const [copied, setCopied] = useState(false);

  const progressAnims = useRef<Record<string, Animated.Value>>({}).current;
  const scrollViewRef = useRef<ScrollView>(null);
  const currentIpRef = useRef<string>('');

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const getOrCreateAnim = (id: string) => {
    if (!progressAnims[id]) progressAnims[id] = new Animated.Value(0);
    return progressAnims[id];
  };

  const animateProgress = (id: string, toValue: number) => {
    Animated.timing(getOrCreateAnim(id), { toValue, duration: 200, useNativeDriver: false }).start();
  };

  useEffect(() => {
    startPCServerV2();

    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, friction: 8, useNativeDriver: true }),
    ]).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.5, duration: 1600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1600, useNativeDriver: true }),
      ])
    ).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.5, duration: 1600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1600, useNativeDriver: true }),
      ])
    ).start();

    TransferServerV2.onStatus = (status: ServerStatusV2) => {
      if (status.type === 'listening') { 
        const displayUrl = `http://${currentIpRef.current || '192.168.1.100'}:${PC_PORT}`;
        setServerUrl(displayUrl); 
        setIsServerRunning(true); 
      }
      if (status.type === 'error') Alert.alert('Server Error', status.message || 'Failed to start server');
      if (status.type === 'client_connected') {
        setIsClientConnected((prev: boolean) => {
          if (!prev) HapticUtil.success();
          return true;
        });
      }
      
      if (status.type === 'download_progress' && status.fileProgress) {
        const { name, percent, sent, total } = status.fileProgress;
        const id = `dl_${name}`;
        animateProgress(id, percent / 100);
        setActiveTransfers(prev => {
          const exists = prev.find(t => t.id === id);
          if (exists) return prev.map(t => t.id === id ? { ...t, percent, transferred: sent, total } : t);
          return [...prev, { id, name, percent, transferred: sent, total, direction: 'download', done: false, timestamp: Date.now() }];
        });
      }

      if (status.type === 'upload_progress' && status.fileProgress) {
        const { name, percent, sent, total } = status.fileProgress;
        const id = `ul_${name}`;
        animateProgress(id, percent / 100);
        setActiveTransfers(prev => {
          const exists = prev.find(t => t.id === id);
          const updated = exists
            ? prev.map(t => t.id === id ? { ...t, percent, transferred: sent, total } : t)
            : [...prev, { id, name, percent, transferred: sent, total, direction: 'upload' as const, done: false, timestamp: Date.now() }];
          
          if (percent >= 100) {
             const doneItem = updated.find(t => t.id === id);
             if (doneItem) {
               setRecentTransfers(r => [{...doneItem, done: true, percent: 100}, ...r.filter(rt => rt.id !== id)].slice(0, 50));
               return updated.filter(t => t.id !== id);
             }
          }
          return updated;
        });
      }

      if (status.type === 'complete' && status.message) {
        HapticUtil.celebrate();
      }
    };

    interstitial.load();
    const unsubBeforeRemove = navigation.addListener('beforeRemove', (e: any) => {
      if (!DisplayAds || !interstitial.loaded) return;
      e.preventDefault();
      const unsubClosed = interstitial.addAdEventListener(AdEventType.CLOSED, () => {
        unsubClosed();
        navigation.dispatch(e.data.action);
      });
      interstitial.show();
    });

    return () => {
      TransferServerV2.stop();
      reset();
      unsubBeforeRemove();
    };
  }, [navigation]);

  useEffect(() => {
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
  }, [activeTransfers, recentTransfers]);

  const startPCServerV2 = async () => {
    try {
      let ip = '';
      try { ip = await WifiManager.getIP(); } catch (_) {}
      if (!ip || ip === '0.0.0.0') ip = '192.168.1.100';
      currentIpRef.current = ip;
      TransferServerV2.start(PC_PORT, []);
    } catch (e: any) {
      Alert.alert('Error', 'Failed to start server: ' + e.message);
    }
  };

  const handleStopServer = () => {
    TransferServerV2.stop();
    reset();
    if (DisplayAds && interstitial.loaded) {
      const unsubClosed = interstitial.addAdEventListener(AdEventType.CLOSED, () => { unsubClosed(); navigation.goBack(); });
      interstitial.show();
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
          if (size === 0) { try { const stat = await RNFS.stat(doc.uri); size = stat.size; } catch (_) {} }
          return { name: doc.name ?? `File_${Date.now()}`, size, type: doc.type ?? 'application/octet-stream', uri: doc.uri, timestamp: Date.now() };
        })
      );
      addFiles(newFiles);
      TransferServerV2.updateFiles(newFiles);
      HapticUtil.success();
    } catch (err) {
      if (isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED) return;
      Alert.alert('Error', 'Failed to pick files');
    }
  };

  const handleShare = async () => {
    try { await Share.share({ message: serverUrl || '', title: 'FlashDrop PC URL' }); }
    catch (_) { Alert.alert('Share', serverUrl || ''); }
  };

  const handleCopy = () => {
    if (serverUrl) { Clipboard.setString(serverUrl); setCopied(true); HapticUtil.light(); setTimeout(() => setCopied(false), 2000); }
  };

  const formatSize = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024; const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const hasActivity = activeTransfers.length > 0 || recentTransfers.length > 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* Header */}
      <View style={styles.headerWrapper}>
        <LinearGradient colors={colors.gradient} style={styles.headerGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
        <SafeAreaView>
          <View style={styles.headerContent}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
              <Icon name="arrow-left" size={22} color="#FFF" />
            </TouchableOpacity>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={styles.headerTitle}>PC Sharing</Text>
              <Text style={styles.headerSub}>Transfer via browser • same WiFi</Text>
            </View>
            {isServerRunning && (
              <View style={styles.liveBadge}>
                <Animated.View style={[styles.liveDot, { transform: [{ scale: pulseAnim }] }]} />
                <Text style={styles.liveText}>LIVE</Text>
              </View>
            )}
          </View>
        </SafeAreaView>
      </View>

      <ScrollView ref={scrollViewRef} style={{ flex: 1 }} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

          {/* URL Card */}
          {!isClientConnected && (
            isServerRunning && serverUrl ? (
              <View style={[styles.qrCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={[styles.urlBlock, { backgroundColor: colors.primary + '0D', borderColor: colors.primary + '20' }]}>
                  <Icon name="web" size={24} color={colors.primary} />
                  <Text style={[styles.urlText, { color: colors.text, fontSize: 18 }]} selectable numberOfLines={2}>{serverUrl}</Text>
                </View>

                <View style={styles.urlActions}>
                  <TouchableOpacity onPress={handleCopy} style={[styles.urlActionBtn, { backgroundColor: copied ? colors.success + '18' : colors.primary + '14', borderColor: copied ? colors.success + '35' : colors.primary + '28' }]} activeOpacity={0.8}>
                    <Icon name={copied ? 'check' : 'content-copy'} size={16} color={copied ? colors.success : colors.primary} />
                    <Text style={[styles.urlActionText, { color: copied ? colors.success : colors.primary }]}>{copied ? 'Copied!' : 'Copy'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleShare} style={[styles.urlActionBtn, { backgroundColor: colors.secondary + '14', borderColor: colors.secondary + '28' }]} activeOpacity={0.8}>
                    <Icon name="share-variant" size={16} color={colors.secondary} />
                    <Text style={[styles.urlActionText, { color: colors.secondary }]}>Share</Text>
                  </TouchableOpacity>
                </View>

                <View style={[styles.instructionBox, { backgroundColor: colors.primary + '0A', borderColor: colors.primary + '1A' }]}>
                  <Icon name="information-outline" size={16} color={colors.primary} />
                  <Text style={[styles.instructionText, { color: colors.subtext }]}>
                    Open this URL in any browser on your PC.{'  '}
                    <Text style={{ fontWeight: '700', color: colors.text }}>Same WiFi required.</Text>
                  </Text>
                </View>
              </View>
            ) : (
              <View style={[styles.loadingCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={[styles.loadingText, { color: colors.subtext }]}>Starting server...</Text>
              </View>
            )
          )}

          {/* Shared files badge */}
          {sharedFiles.length > 0 && (
            <View style={[styles.filesBadge, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={[styles.filesIconBox, { backgroundColor: colors.primary + '18' }]}>
                <Icon name="file-multiple" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.filesBadgeTitle, { color: colors.text }]}>{sharedFiles.length} file{sharedFiles.length > 1 ? 's' : ''} ready to download</Text>
                <Text style={[styles.filesBadgeSub, { color: colors.subtext }]}>Browser can download from the URL above</Text>
              </View>
              <Icon name="check-circle" size={20} color={colors.success} />
            </View>
          )}

          {/* Connected banner */}
          {isClientConnected && (
            <View style={[styles.connectedBanner, { backgroundColor: colors.success + '18', borderColor: colors.success + '30' }]}>
              <Icon name="desktop-mac-dashboard" size={22} color={colors.success} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.connectedTitle, { color: colors.success }]}>PC Connected!</Text>
                <Text style={[styles.connectedSub, { color: colors.subtext }]}>Transfers will appear below</Text>
              </View>
              <View style={[styles.connectedDot, { backgroundColor: colors.success }]} />
            </View>
          )}

          {/* How it works */}
          {!isClientConnected && (
            <View style={[styles.howCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.howTitle, { color: colors.text }]}>How it works</Text>
              {[
                { icon: 'wifi', color: '#00B0FF', text: 'Connect your PC to the same WiFi as this phone.' },
                { icon: 'nfc-search-variant', color: colors.primary, text: 'Type the URL provided above in any browser.' },
                { icon: 'swap-horizontal', color: colors.success, text: 'Upload from PC or download files you shared from phone!' },
              ].map((item, i) => (
                <View key={i} style={styles.stepRow}>
                  <View style={[styles.stepIconBox, { backgroundColor: item.color + '18' }]}>
                    <Icon name={item.icon} size={20} color={item.color} />
                  </View>
                  <Text style={[styles.stepText, { color: colors.subtext }]}>{item.text}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Transfer Feed */}
          {hasActivity && (
            <View style={[styles.transfersCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.transfersHeader}>
                <Icon name="swap-horizontal-bold" size={18} color={colors.primary} />
                <Text style={[styles.transfersTitle, { color: colors.text }]}>Transfers</Text>
                <View style={[styles.transfersBadge, { backgroundColor: colors.primary }]}>
                  <Text style={styles.transfersBadgeText}>{activeTransfers.length + recentTransfers.length}</Text>
                </View>
              </View>

              {[
                ...recentTransfers.map(t => ({ ...t, bubbleType: 'recent' as const })),
                ...activeTransfers.map(t => ({ ...t, bubbleType: 'active' as const })),
              ]
                .sort((a, b) => a.timestamp - b.timestamp)
                .map((item, index) => {
                  const isPCtoPhone = item.direction === 'upload';
                  const accent = isPCtoPhone ? colors.primary : colors.secondary;
                  if (item.bubbleType === 'recent') {
                    return (
                      <View key={`r_${index}`} style={[styles.bubbleWrapper, { alignSelf: isPCtoPhone ? 'flex-start' : 'flex-end' }]}>
                        <Text style={[styles.bubbleLabel, { color: accent }]}>{isPCtoPhone ? '🖥  PC → Phone' : '📱 Phone → PC'}</Text>
                        <View style={[styles.bubbleDone, { backgroundColor: isDark ? (isPCtoPhone ? '#1A2A1A' : '#1A1A2A') : (isPCtoPhone ? '#F0FFF4' : '#F5F0FF'), borderColor: colors.success + '30' }]}>
                          <View style={styles.bubbleTop}>
                            <View style={[styles.bubbleIcon, { backgroundColor: colors.success + '20' }]}><Icon name="file-check" size={13} color={colors.success} /></View>
                            <Text style={[styles.bubbleFileName, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
                            <Icon name="check-circle" size={14} color={colors.success} />
                          </View>
                          <Text style={[styles.bubbleSize, { color: colors.subtext }]}>{formatSize(item.total)} · Done ✓</Text>
                        </View>
                      </View>
                    );
                  }
                  const anim = getOrCreateAnim(item.id);
                  return (
                    <View key={`a_${index}`} style={[styles.bubbleWrapper, { alignSelf: isPCtoPhone ? 'flex-start' : 'flex-end' }]}>
                      <Text style={[styles.bubbleLabel, { color: accent }]}>{isPCtoPhone ? '🖥  PC → Phone' : '📱 Phone → PC'}</Text>
                      <View style={[styles.bubble, { backgroundColor: isDark ? accent + '22' : accent + '14', borderColor: accent + '30' }]}>
                        <View style={styles.bubbleTop}>
                          <View style={[styles.bubbleIcon, { backgroundColor: accent + '20' }]}><Icon name="file" size={13} color={accent} /></View>
                          <Text style={[styles.bubbleFileName, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
                          <Text style={[styles.bubblePercent, { color: accent }]}>{item.percent}%</Text>
                        </View>
                        <View style={[styles.progressBg, { backgroundColor: isDark ? '#2A2A2A' : '#DCDCDC' }]}>
                          <Animated.View style={[styles.progressFill, { backgroundColor: accent, width: anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
                        </View>
                        <Text style={[styles.bubbleSize, { color: colors.subtext }]}>{formatSize(item.transferred)} / {formatSize(item.total)}</Text>
                      </View>
                    </View>
                  );
                })}
            </View>
          )}

          {/* Pending shared files list */}
          {sharedFiles.length > 0 && (
            <View style={[styles.pendingCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.pendingTitle, { color: colors.subtext }]}>FILES AVAILABLE VIA BROWSER</Text>
              {sharedFiles.map((f, i) => (
                <View key={i} style={[styles.pendingRow, { borderTopColor: colors.border }]}>
                  <View style={[styles.pendingIcon, { backgroundColor: colors.secondary + '18' }]}>
                    <Icon name="file-arrow-left-right-outline" size={15} color={colors.secondary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.pendingName, { color: colors.text }]} numberOfLines={1}>{f.name}</Text>
                    <Text style={[styles.pendingSize, { color: colors.subtext }]}>{formatSize(f.size)}</Text>
                  </View>
                  <Icon name="download-outline" size={15} color={colors.subtext} />
                </View>
              ))}
            </View>
          )}

        </Animated.View>
      </ScrollView>

      {DisplayAds && (
        <View style={{ alignItems: 'center', backgroundColor: colors.surface, paddingVertical: 4 }}>
          <BannerAd unitId={adUnitId} size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER} requestOptions={{ requestNonPersonalizedAdsOnly: true }} />
        </View>
      )}

      <SafeAreaView style={{ backgroundColor: colors.surface }}>
        <View style={[styles.bottomBar, { borderTopColor: colors.border }]}>
          {isServerRunning && (
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.primary, flex: 1, marginRight: 10 }]} onPress={handleSelectFiles} activeOpacity={0.85}>
              <Icon name="file-upload" size={18} color="#FFF" />
              <Text style={styles.actionBtnText}>Send Files</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: isDark ? 'rgba(255,71,87,0.12)' : '#FFEBEE', borderWidth: 1, borderColor: colors.error + '40', paddingHorizontal: 20 }]}
            onPress={handleStopServer}
            activeOpacity={0.85}
          >
            <Icon name="power" size={20} color={colors.error} />
            <Text style={[styles.actionBtnText, { color: colors.error }]}>Stop</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerWrapper: { backgroundColor: 'transparent', zIndex: 10, paddingBottom: 20 },
  headerGradient: { ...StyleSheet.absoluteFillObject, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  headerContent: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: Platform.OS === 'android' ? 50 : 20, paddingBottom: 18 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#FFF', letterSpacing: -0.3 },
  headerSub: { fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 1 },
  liveBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,200,100,0.18)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, gap: 6, borderWidth: 1, borderColor: 'rgba(0,255,120,0.25)' },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#00E676' },
  liveText: { fontSize: 11, fontWeight: '800', color: '#00E676', letterSpacing: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 40 },
  qrCard: { borderRadius: 24, padding: 20, borderWidth: 1, marginBottom: 14 },
  urlBlock: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 20, borderRadius: 16, marginBottom: 18, borderWidth: 1 },
  urlText: { flex: 1, fontWeight: '700', lineHeight: 22 },
  urlActions: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  urlActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, borderRadius: 14, borderWidth: 1 },
  urlActionText: { fontSize: 14, fontWeight: '700' },
  instructionBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 12, borderWidth: 1 },
  instructionText: { flex: 1, fontSize: 12, lineHeight: 17 },
  loadingCard: { borderRadius: 24, padding: 40, borderWidth: 1, alignItems: 'center', marginBottom: 14 },
  loadingText: { marginTop: 16, fontSize: 14, fontWeight: '500' },
  filesBadge: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, padding: 14, borderWidth: 1, marginBottom: 14 },
  filesIconBox: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  filesBadgeTitle: { fontSize: 14, fontWeight: '700' },
  filesBadgeSub: { fontSize: 11, marginTop: 2 },
  connectedBanner: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, padding: 14, borderWidth: 1, marginBottom: 14 },
  connectedTitle: { fontSize: 14, fontWeight: '800' },
  connectedSub: { fontSize: 11, marginTop: 2 },
  connectedDot: { width: 10, height: 10, borderRadius: 5 },
  howCard: { borderRadius: 20, padding: 18, borderWidth: 1, marginBottom: 14 },
  howTitle: { fontSize: 14, fontWeight: '700', marginBottom: 14 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  stepIconBox: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  stepText: { flex: 1, fontSize: 12, lineHeight: 18, paddingTop: 9 },
  transfersCard: { borderRadius: 20, padding: 16, borderWidth: 1, marginBottom: 14 },
  transfersHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  transfersTitle: { flex: 1, fontSize: 15, fontWeight: '700' },
  transfersBadge: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  transfersBadgeText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  bubbleWrapper: { width: '82%', marginBottom: 10 },
  bubbleLabel: { fontSize: 10, fontWeight: '700', marginBottom: 3, letterSpacing: 0.3 },
  bubble: { borderRadius: 16, padding: 12, borderWidth: 1 },
  bubbleDone: { borderRadius: 16, padding: 12, borderWidth: 1 },
  bubbleTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 7 },
  bubbleIcon: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  bubbleFileName: { flex: 1, fontSize: 12, fontWeight: '600' },
  bubblePercent: { fontSize: 12, fontWeight: '800', minWidth: 36, textAlign: 'right' },
  progressBg: { height: 4, borderRadius: 2, overflow: 'hidden', marginBottom: 5 },
  progressFill: { height: '100%', borderRadius: 2 },
  bubbleSize: { fontSize: 10, fontWeight: '500' },
  pendingCard: { borderRadius: 20, padding: 16, borderWidth: 1, marginBottom: 14 },
  pendingTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 10 },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  pendingIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  pendingName: { fontSize: 13, fontWeight: '600' },
  pendingSize: { fontSize: 11, marginTop: 2 },
  bottomBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 18 },
  actionBtnText: { fontSize: 15, fontWeight: '700', color: '#FFF' },
});

export default PCConnectionScreenV2;
