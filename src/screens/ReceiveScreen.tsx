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
  Easing,
  BackHandler,
  Linking,
} from 'react-native';
import { Camera, useCameraDevice, useCodeScanner } from 'react-native-vision-camera';
import WifiManager from 'react-native-wifi-reborn';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';
import DeviceInfo from 'react-native-device-info';
import WiFiDirectTransferService, { DirectTransferStatus } from '../utils/Wifidirecttransferservice';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../theme/ThemeContext';
import { useConnectionStore, useUIStore } from '../store';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import RadarPulse from '../components/RadarPulse';
import HapticUtil from '../utils/HapticUtil';

const { width } = Dimensions.get('window');

interface TransferringFile {
    name: string;
    size: number;
    progress: number;
    status: 'pending' | 'downloading' | 'completed' | 'error';
}

const ReceiveScreen = ({ route }: any) => {
  const navigation = useNavigation();
  const isConnectMode = route?.params?.mode === 'connect';
  const { colors, typography, layout, spacing, isDark } = useTheme();
  const { bottom } = useSafeAreaInsets();

  // Zustand stores
  const {
    isConnected,
    ipAddress,
    ssid,
    setConnected,
    setConnectionDetails
  } = useConnectionStore();

  // Local state (UI-specific, not persisted)

  const [mode, setMode] = useState<'radar' | 'qr'>('radar');
  const [hasPermission, setHasPermission] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<string>('idle'); 
  const [connectionLog, setConnectionLog] = useState('');
  const [devices, setDevices] = useState<any[]>([]);
  
  const device = useCameraDevice('back');
  const scanLineAnim = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const isFinalizing = useRef(false);


  useEffect(() => {
    if (isConnected && ipAddress) {
      (navigation as any).replace('FileTransfer', {
        role: 'receiver',
        deviceName: ssid || 'Sender',
        initialFiles: []
      });
      return;
    }

    (async () => {
      // Warm up P2P receiver immediately in radar mode
      if (Platform.OS === 'android') {
        startDirectConnection();
      }

      const status = await Camera.requestCameraPermission();
      setHasPermission(status === 'granted');

      DeviceInfo.getIpAddress().then((ip) => {
        setConnectionDetails({ type: null, ip });
      });
    })();
  }, []);

  useEffect(() => {
    if (mode === 'qr') {
      startQRAnimation();
    }

    const onBackPress = () => {
      WiFiDirectTransferService.stop();
      if (navigation.canGoBack()) navigation.goBack();
      else (navigation as any).navigate('Home');
      return true;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => backHandler.remove();
  }, [mode]);

  const startQRAnimation = () => {
    scanLineAnim.setValue(0);
    Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineAnim, { toValue: 200, duration: 2500, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(scanLineAnim, { toValue: 0, duration: 2500, easing: Easing.linear, useNativeDriver: true })
      ])
    ).start();
  };

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
      if (connectionStatus === 'connecting' || connectionStatus === 'connected') return;
      if (codes.length > 0 && codes[0].value) {
        HapticUtil.light();
        try {
          const qr = JSON.parse(codes[0].value);
          if (qr.p2p || (qr.ssid && qr.ssid.startsWith('Direct-'))) {
            // Force a manual connection to the device address if provided in QR
            if (qr.address) {
              setConnectionStatus('connecting');
              WiFiDirectTransferService.connectToSpecificDevice(qr.address, getDownloadDir(), qr.key);
            } else {
              // Fallback to general direct connection attempt
              startDirectConnection(qr.key, qr.name || 'Sender');
            }
          } else {
            connectToHotspot(qr.ssid, qr.pass, qr.ip, qr.key);
          }
        } catch (e) { }
      }
    },
  });

  const getDownloadDir = () => {
    return Platform.OS === 'android'
      ? `${ReactNativeBlobUtil.fs.dirs.DownloadDir}/FlashDrop`
      : `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/FlashDrop`;
  };


  const setupP2PListeners = (secretKey?: string, deviceName: string = 'Sender') => {
    WiFiDirectTransferService.onStatus = (status: DirectTransferStatus) => {
      console.log('[ReceiveScreen] Status:', status.type);
      
      if (status.type === 'p2p') {
        const type = status.status?.type;
        console.log(`[ReceiveScreen] Processing P2P state: ${type}`);
        
        if (type === 'discovering' || type === 'peers_found') {
          if (type === 'peers_found') {
             setDevices(status.status.devices);
          }
          setConnectionLog('Scanning for nearby devices...');
        } else if (type === 'connecting') {
          console.log(`[ReceiveScreen] UI Status -> UI Connecting to ${deviceName}`);
          setConnectionStatus('connecting');
          setConnectionLog(`Establishing link to ${deviceName}...`);
        } else if (type === 'connected') {
           console.log(`[ReceiveScreen] UI Status -> P2P Link Established. Negotiating tunnel for data...`);
           setConnectionStatus('connecting');
           setConnectionLog('P2P Link established. Negotiating tunnel...');
           // Once P2P link is up, finalize the data transfer server/client
           if (status.status.type === 'connected' && status.status.ip && !isFinalizing.current) {
             console.log('[ReceiveScreen] P2P connected, finalizing receiver with IP:', status.status.ip);
             isFinalizing.current = true;
             WiFiDirectTransferService.finalizeReceiver(status.status.ip, getDownloadDir(), secretKey);
           }
        }


      }

      if (status.type === 'ready') {
        console.log(`[ReceiveScreen] Received READY event. Preparing navigation to FileTransfer...`);
        setConnected(true);
        setConnectionStatus('connected');
        setConnectionDetails({ type: 'wifi-direct', ssid: 'Direct-FlashDrop', ip: status.ip });
        HapticUtil.success();
        console.log(`[ReceiveScreen] Navigation triggered to FileTransfer (role: receiver, IP: ${status.ip})`);
        
        setTimeout(() => {
          (navigation as any).navigate('FileTransfer', { 
              role: 'receiver', 
              deviceName: deviceName || 'Sender', 
              initialFiles: [], 
              secretKey 
          });
        }, 150);
      }


      if (status.type === 'error') {
        setConnectionStatus('error');
        setConnectionLog(status.message || 'P2P setup failed');
        isFinalizing.current = false; // Allow retry
        HapticUtil.medium(); 
      }

      if (status.type === 'client' && status.status.type === 'log') {
        setConnectionLog(status.status.message || '');
      }

    };
  };

  const startDirectConnection = async (secretKey?: string, deviceName: string = 'Sender') => {
    setConnectionStatus('idle');
    setupP2PListeners(secretKey, deviceName);
    
    // Note: Calling removeGroup() here on initialization causes a fatal native crash 
    // on Android (NullPointerException) if the Wi-Fi Direct channel isn't fully ready.
    // We let WiFiDirectManager handle group cleanup internally instead.

    const downloadDir = Platform.OS === 'android'
      ? `${ReactNativeBlobUtil.fs.dirs.DownloadDir}/FlashDrop`
      : `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/FlashDrop`;

    await WiFiDirectTransferService.startReceiver(downloadDir, (peers) => {
      setDevices(peers);
    }, secretKey);
  };

  const connectToDevice = async (device: any) => {
    console.log(`[ReceiveScreen] User initiated manual connection to: ${device.deviceName} (${device.deviceAddress})`);
    setConnectionStatus('connecting');
    setConnectionLog(`Connecting to ${device.deviceName}...`);
    HapticUtil.light();
    
    await WiFiDirectTransferService.connectToSpecificDevice(device.deviceAddress, getDownloadDir());
    console.log(`[ReceiveScreen] connectToSpecificDevice execution finished for ${device.deviceName}`);
  };


  const connectToHotspot = async (ssid: string, password?: string, ip?: string, secretKey?: string) => {
    setConnectionStatus('connecting');
    setConnectionLog('Connecting to Hotspot...');
    HapticUtil.light();

    try {
      await WifiManager.connectToProtectedSSID(ssid, password || '', false, false);
      setConnectionLog('Wi-Fi connected. Fetching network IP...');
      
      // Wait for network to stabilize
      for(let i=0; i<5; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const currentIp = await DeviceInfo.getIpAddress();
        if (currentIp && currentIp !== '0.0.0.0') {
           if (ip) {
              setConnected(true);
              setConnectionDetails({ type: 'hotspot', ssid, ip });
              HapticUtil.success();
              setTimeout(() => {
                 (navigation as any).navigate('FileTransfer', { role: 'receiver', deviceName: ssid, initialFiles: [], secretKey });
              }, 150);
              return;
           }
        }
      }
      setConnectionStatus('error');
      setConnectionLog('Failed to get IP address from hotspot.');
    } catch (e) {
      setConnectionStatus('error');
      setConnectionLog('Could not connect to the Wi-Fi network.');
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} translucent backgroundColor="transparent" />

      {/* Header */}
      <View style={styles.headerWrapper}>
        <LinearGradient colors={colors.gradient} style={styles.headerGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
        <SafeAreaView>
          <View style={styles.headerContent}>
            <TouchableOpacity
              onPress={() => {
                WiFiDirectTransferService.stop();
                if (navigation.canGoBack()) navigation.goBack();
                else (navigation as any).navigate('Home');
              }}
              style={styles.iconButton}
            >
              <Icon name="arrow-left" size={24} color="#FFF" />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { fontFamily: typography.fontFamily }]}>
              {isConnectMode ? 'Connect' : 'Receive'}
            </Text>
            <TouchableOpacity style={styles.iconButton} onPress={() => setMode(mode === 'radar' ? 'qr' : 'radar')}>
              <Icon name={mode === 'radar' ? 'qrcode-scan' : 'radar'} size={24} color="#FFF" />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>

      <View style={styles.contentContainer}>
        {mode === 'radar' ? (
          <View style={[styles.mainCard, { backgroundColor: colors.surface, ...layout.shadow.medium }]}>
            <View style={styles.radarWrapper}>
              <RadarPulse size={width * 0.65} color={colors.primary} icon="access-point" numRings={4} />
              <Text style={[styles.radarHint, { color: colors.text }]}>Searching for Senders...</Text>
              <Text style={[styles.radarSubHint, { color: colors.subtext }]}>Ask the sender to open their Sharing Screen</Text>
            </View>

            <View style={styles.deviceListHeader}>
              <Text style={[styles.deviceListTitle, { color: colors.text }]}>Nearby Devices ({devices.length})</Text>
              <ActivityIndicator size="small" color={colors.primary} style={{ opacity: devices.length === 0 ? 1 : 0.5 }} />
            </View>

            <FlatList
              data={devices}
              keyExtractor={(item) => item.deviceAddress}
              contentContainerStyle={[styles.deviceListContent, { paddingBottom: Math.max(bottom, 40) }]}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.deviceCard, { backgroundColor: colors.background, borderColor: colors.border }]}
                  onPress={() => connectToDevice(item)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.deviceIconCircle, { backgroundColor: colors.primary + '15' }]}>
                    <Icon name="cellphone" size={24} color={colors.primary} />
                  </View>
                  <View style={styles.deviceInfo}>
                    <Text style={[styles.deviceName, { color: colors.text }]}>{item.deviceName}</Text>
                    <Text style={[styles.deviceStatus, { color: colors.subtext }]}>Found nearby</Text>
                  </View>
                  <Icon name="chevron-right" size={20} color={colors.subtext} />
                </TouchableOpacity>
              )}
              ListEmptyComponent={() => (
                <View style={styles.emptyContainer}>
                  <Text style={[styles.emptyText, { color: colors.subtext }]}>No devices found yet.</Text>
                  <TouchableOpacity style={[styles.qrSwitchLink]} onPress={() => setMode('qr')}>
                    <Text style={{ color: colors.primary, fontWeight: '600' }}>Scan QR instead?</Text>
                  </TouchableOpacity>
                </View>
              )}
            />
          </View>
        ) : (
            <View style={[styles.mainCard, { backgroundColor: colors.surface, ...layout.shadow.medium }]}>
            <View style={styles.scannerWrapper}>
                {hasPermission && device ? (
                <View style={[styles.cameraFrame, { borderColor: colors.primary }]}>
                    <Camera style={StyleSheet.absoluteFill} device={device} isActive={connectionStatus === 'idle' && mode === 'qr'} codeScanner={codeScanner} />
                    <Animated.View style={[styles.scanLine, { transform: [{ translateY: scanLineAnim }], backgroundColor: colors.primary }]} />
                    <View style={styles.cornerTL} /><View style={styles.cornerTR} /><View style={styles.cornerBL} /><View style={styles.cornerBR} />
                </View>
                ) : !hasPermission ? (
                  <View style={styles.permissionDeniedBox}>
                    <View style={[styles.permissionIconBox, { backgroundColor: colors.error + '15' }]}>
                      <Icon name="camera-off" size={40} color={colors.error} />
                    </View>
                    <Text style={[styles.permissionTitle, { color: colors.text }]}>Camera Access Required</Text>
                    <Text style={[styles.permissionSub, { color: colors.subtext }]}>To scan the sender's QR code, FlashDrop needs camera access.</Text>
                    <TouchableOpacity style={[styles.permissionBtn, { backgroundColor: colors.primary }]} onPress={() => Linking.openSettings()}>
                      <Icon name="cog" size={18} color="#FFF" /><Text style={styles.permissionBtnText}>Open Settings</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <ActivityIndicator size="large" color={colors.primary} />
                )}
                <Text style={[styles.hintText, { color: colors.text }]}>Scan sender's QR code</Text>
                <TouchableOpacity style={styles.qrSwitchLink} onPress={() => setMode('radar')}>
                  <Text style={{ color: colors.primary, fontWeight: '600' }}>Back to nearby search</Text>
                </TouchableOpacity>
              </View>
            </View>
        )}
      </View>

      {connectionStatus === 'connecting' && (
        <View style={styles.loadingOverlay}>
          <View style={[styles.loadingCard, { backgroundColor: colors.surface, ...layout.shadow.medium }]}>
            <RadarPulse size={160} color={colors.primary} icon="link-variant" numRings={3} />
            <Text style={[styles.loadingTitle, { color: colors.text }]}>Connecting...</Text>
            <Text style={[styles.loadingLog, { color: colors.subtext }]}>{connectionLog}</Text>
            <TouchableOpacity
              style={[styles.cancelBtn, { backgroundColor: colors.border }]}
              onPress={() => { WiFiDirectTransferService.stop(); setConnectionStatus('idle'); }}
            >
              <Text style={{ color: colors.text, fontWeight: '600' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {connectionStatus === 'error' && (
        <View style={styles.loadingOverlay}>
          <View style={[styles.loadingCard, { backgroundColor: colors.surface, ...layout.shadow.medium }]}>
            <Icon name="close-circle-outline" size={48} color={colors.error} />
            <Text style={[styles.loadingTitle, { color: colors.text }]}>Connection Failed</Text>
            <Text style={[styles.loadingLog, { color: colors.subtext }]}>{connectionLog || 'Something went wrong.'}</Text>
            <TouchableOpacity style={{ backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 30 }} onPress={() => setConnectionStatus('idle')}>
              <Text style={{ color: '#FFF', fontWeight: '700' }}>Try Again</Text>
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
  radarWrapper: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  radarHint: {
    marginTop: 20,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  radarSubHint: {
    marginTop: 8,
    fontSize: 14,
    textAlign: 'center',
    opacity: 0.7,
  },
  deviceListHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  deviceListTitle: {
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    opacity: 0.6,
  },
  deviceListContent: {
    padding: 15,
    paddingBottom: 40,
  },
  deviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 10,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 5 },
      android: { elevation: 2 }
    })
  },
  deviceIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 15,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: 16,
    fontWeight: '700',
  },
  deviceStatus: {
    fontSize: 12,
    marginTop: 2,
    opacity: 0.6,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 15,
  },
  qrSwitchLink: {
    padding: 10,
    marginTop: 10,
  },
  scannerWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
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
  permissionDeniedBox: {
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 12,
  },
  permissionIconBox: {
    width: 80,
    height: 80,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  permissionTitle: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  permissionSub: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    opacity: 0.8,
  },
  permissionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 30,
    marginTop: 8,
  },
  permissionBtnText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 1000,
  },
  loadingCard: {
    padding: 30,
    borderRadius: 24,
    alignItems: 'center',
    width: '85%',
  },
  loadingTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginTop: 20,
  },
  loadingLog: {
    fontSize: 14,
    marginTop: 10,
    textAlign: 'center',
    marginBottom: 30,
    opacity: 0.8,
  },
  cancelBtn: {
    paddingVertical: 12,
    paddingHorizontal: 40,
    borderRadius: 12,
  },
});

export default ReceiveScreen;
