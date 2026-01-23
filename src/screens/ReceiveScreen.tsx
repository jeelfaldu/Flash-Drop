import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  Platform,
  SafeAreaView,
  StatusBar,
  Dimensions,
  Animated,
  Easing
} from 'react-native';
import { Camera, useCameraDevice, useCodeScanner } from 'react-native-vision-camera';
import WifiManager from 'react-native-wifi-reborn';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';
import DeviceInfo from 'react-native-device-info';
import TransferClient, { TransferStatus } from '../utils/TransferClient';
import WifiP2PManager from '../utils/WifiP2PManager';
import RNFS from 'react-native-fs';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../theme/ThemeContext';
import { useConnectionStore, useUIStore } from '../store';

const { width } = Dimensions.get('window');

interface TransferringFile {
    name: string;
    size: number;
    progress: number;
    status: 'pending' | 'downloading' | 'completed' | 'error';
}

const ReceiveScreen = () => {
  const navigation = useNavigation();
  const { colors, typography, layout, spacing } = useTheme();

  // Zustand stores
  const {
    isConnected,
    ipAddress,
    ssid,
    setConnected,
    setConnectionDetails
  } = useConnectionStore();

  // Local state (UI-specific, not persisted)
  const [activeTab, setActiveTab] = useState<'nearby' | 'qr'>('qr');
  const [hasPermission, setHasPermission] = useState(false);
  const [wifiList, setWifiList] = useState<any[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<string>('idle'); 
  const [transferringFiles, setTransferringFiles] = useState<Record<string, TransferringFile>>({});
  const [localIp, setLocalIp] = useState('');
  const [connectionLog, setConnectionLog] = useState('');
  
  const device = useCameraDevice('back');
  const scanLineAnim = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isConnected && ipAddress) {
      (navigation as any).navigate('FileTransfer', {
        role: 'receiver',
        deviceName: ssid || 'Sender',
        initialFiles: []
      });
      return;
    }

    (async () => {
      const status = await Camera.requestCameraPermission();
      setHasPermission(status === 'granted');
      DeviceInfo.getIpAddress().then((ip) => {
        setLocalIp(ip);
        setConnectionDetails({ type: null, ip });
      });
      startWifiScan();
    })();
    // Cleanup handled explicitly via disconnect or app close
    return () => { };
  }, []);

  useEffect(() => {
    if (activeTab === 'qr') startQRAnimation();
    else startRadarAnimations();
  }, [activeTab]);

  const startWifiScan = async () => {
    try {
      const list = await WifiManager.reScanAndLoadWifiList();
      if (Array.isArray(list)) setWifiList(list.sort((a, b) => b.level - a.level));
    } catch (e) { }
  };

  const startQRAnimation = () => {
    scanLineAnim.setValue(0);
    Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineAnim, { toValue: 200, duration: 2500, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(scanLineAnim, { toValue: 0, duration: 2500, easing: Easing.linear, useNativeDriver: true })
      ])
    ).start();
  };

  const startRadarAnimations = () => {
    rotateAnim.setValue(0);
    Animated.loop(
      Animated.timing(rotateAnim, { toValue: 1, duration: 4000, easing: Easing.linear, useNativeDriver: true })
    ).start();
  };

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
      if (connectionStatus !== 'idle') return;
        if (codes.length > 0 && codes[0].value) {
          try {
            const qr = JSON.parse(codes[0].value);
            connectToHotspot(qr.ssid, qr.pass, qr.ip);
          } catch (e) { }
        }
    },
  });

  const connectToHotspot = async (ssid: string, password?: string, ip?: string) => {
    setConnectionStatus('connecting');
    setConnectionLog('Connecting to Hotspot...');
    try {
        if (ssid) {
          await WifiP2PManager.connectToSSID(ssid, password);
          setConnectionLog('Wi-Fi connected. Fetching network IP...');
          await new Promise(r => setTimeout(r, 4000));

          // Update Zustand store
          setConnectionDetails({ type: 'hotspot', ssid, ip: ip || '' });
        }
      DeviceInfo.getIpAddress().then((newIp) => {
        setLocalIp(newIp);
        setConnectionDetails({ type: 'hotspot', ssid, ip: newIp });
      });
        connectToTransferServer(ssid, ip);
    } catch (e) {
        setConnectionStatus('error');
      Alert.alert("Error", "Connection failed. Please connect manually in Settings.");
    }
  };

  const connectToTransferServer = (ssid?: string, ip?: string) => {
    // Use ExternalDirectoryPath (Android/data/com.package/files) to avoid Scoped Storage issues on Android 11+
    const downloadDir = Platform.OS === 'android'
      ? `${RNFS.ExternalDirectoryPath}/FlashDrop`
      : `${RNFS.DocumentDirectoryPath}/FlashDrop`;

    TransferClient.onStatus = (status: TransferStatus) => {
      if (status.type === 'log') setConnectionLog(status.message || '');
      if (status.type === 'connection' && status.connected) {
        setConnected(true);
        setConnectionStatus('connected');
        (navigation as any).navigate('FileTransfer', { role: 'receiver', deviceName: ssid || 'Sender', initialFiles: [] });
      }
    };
    TransferClient.start(8888, downloadDir, ip);
  };

  const rotation = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* Header */}
      <View style={styles.headerWrapper}>
        <LinearGradient
          colors={colors.gradient}
          style={styles.headerGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
        <SafeAreaView>
          <View style={styles.headerContent}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconButton}>
              <Icon name="arrow-left" size={24} color="#FFF" />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { fontFamily: typography.fontFamily }]}>Receive Files</Text>
            <View style={{ width: 40 }} />
          </View>
        </SafeAreaView>
      </View>

      <View style={styles.contentContainer}>
        <View style={[styles.mainCard, { backgroundColor: colors.surface, ...layout.shadow.medium }]}>
          {activeTab === 'qr' ? (
            <View style={styles.scannerWrapper}>
              {hasPermission && device ? (
                <View style={[styles.cameraFrame, { borderColor: colors.primary }]}>
                  <Camera
                    style={StyleSheet.absoluteFill}
                    device={device}
                    isActive={connectionStatus === 'idle'}
                    codeScanner={codeScanner}
                  />
                  <Animated.View
                    style={[
                      styles.scanLine,
                      {
                        transform: [{ translateY: scanLineAnim }],
                        backgroundColor: colors.primary
                      }
                    ]}
                  />
                  <View style={styles.cornerTL} />
                  <View style={styles.cornerTR} />
                  <View style={styles.cornerBL} />
                  <View style={styles.cornerBR} />
                </View>
              ) : <ActivityIndicator size="large" color={colors.primary} />}
              <Text style={[styles.hintText, { color: colors.text, fontFamily: typography.fontFamily }]}>
                Scan sender's QR code
              </Text>
            </View>
          ) : (
            <View style={styles.radarWrapper}>
                <View style={styles.radarContainer}>
                  <View style={[styles.radarCircle, { borderColor: colors.primary, width: 280, height: 280, opacity: 0.1 }]} />
                  <View style={[styles.radarCircle, { borderColor: colors.primary, width: 200, height: 200, opacity: 0.2 }]} />
                  <View style={[styles.radarCircle, { borderColor: colors.primary, width: 120, height: 120, opacity: 0.3 }]} />
                  <Animated.View
                    style={[
                      styles.sweep,
                      { transform: [{ rotate: rotation }] }
                    ]}
                  >
                    <LinearGradient
                      colors={[colors.primary + '66', 'transparent']}
                      start={{ x: 0, y: 0.5 }}
                      end={{ x: 1, y: 0.5 }}
                      style={styles.sweepGradient}
                    />
                  </Animated.View>
                </View>

                <Text style={[styles.hintText, { color: colors.text, fontFamily: typography.fontFamily, marginBottom: 10 }]}>
                  Nearby Networks
                </Text>

                <FlatList 
                  data={wifiList}
                  keyExtractor={(item, index) => index.toString()}
                  style={{ width: '100%', paddingHorizontal: 20 }}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[styles.wifiItem, { borderBottomColor: colors.border }]}
                      onPress={() => connectToHotspot(item.SSID)}
                    >
                      <View style={[styles.wifiIconBox, { backgroundColor: colors.background }]}>
                        <Icon name="wifi" size={20} color={colors.primary} />
                      </View>
                      <Text style={[styles.wifiText, { color: colors.text, fontFamily: typography.fontFamily }]}>
                        {item.SSID}
                      </Text>
                      <Icon name="chevron-right" size={20} color={colors.subtext} />
                      </TouchableOpacity>
                    )}
                />
              </View>
          )}
        </View>

        <View style={[styles.tabsContainer, { backgroundColor: colors.surface, padding: 4, borderRadius: 20 }]}>
          <TouchableOpacity
            style={[
              styles.tab,
              activeTab === 'qr' && { backgroundColor: colors.primary }
            ]}
            onPress={() => setActiveTab('qr')}
          >
            <Icon name="qrcode-scan" size={20} color={activeTab === 'qr' ? '#FFF' : colors.subtext} />
            <Text style={[
              styles.tabText,
              {
                color: activeTab === 'qr' ? '#FFF' : colors.subtext,
                fontFamily: typography.fontFamily
              }
            ]}>QR Scan</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.tab,
              activeTab === 'nearby' && { backgroundColor: colors.primary }
            ]}
            onPress={() => setActiveTab('nearby')}
          >
            <Icon name="radar" size={20} color={activeTab === 'nearby' ? '#FFF' : colors.subtext} />
            <Text style={[
              styles.tabText,
              {
                color: activeTab === 'nearby' ? '#FFF' : colors.subtext,
                fontFamily: typography.fontFamily
              }
            ]}>Nearby</Text>
          </TouchableOpacity>
        </View>
      </View>

      {connectionStatus === 'connecting' && (
        <View style={styles.loadingOverlay}>
          <View style={[styles.loadingCard, { backgroundColor: colors.surface }]}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingTitle, { color: colors.text }]}>Connecting</Text>
            <Text style={[styles.loadingLog, { color: colors.subtext }]}>{connectionLog}</Text>
            <TouchableOpacity style={[styles.cancelBtn, { backgroundColor: colors.border }]} onPress={() => { TransferClient.stop(); setConnectionStatus('idle'); }}>
              <Text style={{ color: colors.text }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerWrapper: {
    height: 110,
    backgroundColor: 'transparent',
    zIndex: 10,
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
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFF',
  },
  iconButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  contentContainer: {
    flex: 1,
    padding: 20
  },
  mainCard: {
    flex: 1,
    borderRadius: 24,
    overflow: 'hidden',
    marginBottom: 20,
  },
  scannerWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  cameraFrame: {
    width: 250,
    height: 250,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 1,
    position: 'relative',
  },
  scanLine: {
    position: 'absolute',
    top: 20,
    left: 20,
    right: 20,
    height: 3,
    borderRadius: 1.5,
    shadowColor: '#FFF',
    shadowOpacity: 0.8,
    shadowRadius: 5,
    elevation: 5
  },
  cornerTL: { position: 'absolute', top: 15, left: 15, width: 30, height: 30, borderTopWidth: 4, borderLeftWidth: 4, borderColor: '#FFF', borderTopLeftRadius: 10 },
  cornerTR: { position: 'absolute', top: 15, right: 15, width: 30, height: 30, borderTopWidth: 4, borderRightWidth: 4, borderColor: '#FFF', borderTopRightRadius: 10 },
  cornerBL: { position: 'absolute', bottom: 15, left: 15, width: 30, height: 30, borderBottomWidth: 4, borderLeftWidth: 4, borderColor: '#FFF', borderBottomLeftRadius: 10 },
  cornerBR: { position: 'absolute', bottom: 15, right: 15, width: 30, height: 30, borderBottomWidth: 4, borderRightWidth: 4, borderColor: '#FFF', borderBottomRightRadius: 10 },
  hintText: {
    marginTop: 24,
    fontSize: 16,
    fontWeight: '600'
  },
  radarWrapper: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 30
  },
  radarContainer: {
    width: 300,
    height: 300,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20
  },
  radarCircle: {
    position: 'absolute',
    borderRadius: 150,
    borderWidth: 1,
  },
  sweep: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    overflow: 'hidden',
  },
  sweepGradient: {
    width: 150,
    height: 300,
    position: 'absolute',
    left: 150,
  },
  wifiItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  wifiIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16
  },
  wifiText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500'
  },
  tabsContainer: {
    flexDirection: 'row',
    elevation: 5
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 16,
  },
  tabText: {
    marginLeft: 8,
    fontWeight: '600'
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20
  },
  loadingCard: {
    padding: 30,
    borderRadius: 24,
    alignItems: 'center',
    width: '80%'
  },
  loadingTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 16
  },
  loadingLog: {
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
    marginBottom: 20
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 12,
  }
});

export default ReceiveScreen;
