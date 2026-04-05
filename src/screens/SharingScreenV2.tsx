import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  BackHandler,
  ActivityIndicator,
  StatusBar,
  Dimensions,
  Platform,
  FlatList,
  Linking,
} from 'react-native';
import { Camera, useCameraDevice, useCodeScanner } from 'react-native-vision-camera';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';
import WiFiDirectTransferServiceV2, { DirectTransferStatusV2 } from '../utils/WiFiDirectTransferServiceV2';
import DeviceInfo from 'react-native-device-info';
import { useTheme } from '../theme/ThemeContext';
import { useConnectionStore, useTransferStore } from '../store';
import RadarPulse from '../components/RadarPulse';
import HapticUtil from '../utils/HapticUtil';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import { DisplayAds, ProdIDs } from '../utils/Constant';

const { width } = Dimensions.get('window');

const SharingScreenV2 = ({ route, navigation }: any) => {
  const { items = [], reuseP2pIp } = route.params || {};
  const { colors, typography, layout, isDark } = useTheme();
  
  const [mode, setMode] = useState<'radar' | 'qr'>('radar');
  const [hasPermission, setHasPermission] = useState(false);
  const [devices, setDevices] = useState<any[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'searching' | 'connecting' | 'error'>('searching');
  const [connectionLog, setConnectionLog] = useState('');
  const [showRetry, setShowRetry] = useState(false);

  const device = useCameraDevice('back');
  const isFinalizing = useRef(false);

  useEffect(() => {
    const init = async () => {
       if (Platform.OS !== 'android') return;

       if (reuseP2pIp) {
         // ── REUSE MODE: P2P group is alive, just reset + resend ────────────
         console.log('[SHARING SCREEN V2] Reuse mode — skipping stop/discovery, sending directly to', reuseP2pIp);
         WiFiDirectTransferServiceV2.resetForNextBatch();
         startV2SenderReuse(reuseP2pIp);
       } else {
         // Only do a full soft-stop if no group is currently alive
         if (!WiFiDirectTransferServiceV2.isP2PGroupAlive()) {
           await WiFiDirectTransferServiceV2.stop();
         }
         startV2Sender();
         const status = await Camera.requestCameraPermission();
         setHasPermission(status === 'granted');
       }
    };
    init();

    let retryTimer: any;
    if (!reuseP2pIp && mode === 'radar') {
      retryTimer = setTimeout(() => {
        setShowRetry(true);
      }, 15000);
    }

    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      handleManualGoBack();
      return true;
    });

    return () => {
      backHandler.remove();
      if (retryTimer) clearTimeout(retryTimer);
      // Notice: No automatic stop() here to prevent accidental disconnections on screen replacement.
    };
  }, [mode, reuseP2pIp]);

  const handleRetry = async () => {
    setShowRetry(false);
    setDevices([]);
    setConnectionStatus('searching');
    await WiFiDirectTransferServiceV2.stop();
    startV2Sender();
    // Restart timer
    setTimeout(() => {
      if (devices.length === 0) setShowRetry(true);
    }, 15000);
  };

  const handleManualGoBack = () => {
      // Soft stop only — does not destroy the P2P group
      WiFiDirectTransferServiceV2.stop();
      navigation.goBack();
  };

  const startV2Sender = () => {
    WiFiDirectTransferServiceV2.onStatus = (status: DirectTransferStatusV2) => {
      console.log('[SHARING SCREEN V2] Event:', status.type);

      if (status.type === 'p2p') {
        if (status.status.type === 'peers_found') setDevices(status.status.devices);
        if (status.status.type === 'connected' && status.status.ip && !isFinalizing.current) {
            isFinalizing.current = true;
            WiFiDirectTransferServiceV2.finalizeSender(status.status.ip, items);
        }
        if (status.status.type === 'error') {
            setConnectionStatus('error');
            setConnectionLog(status.status.message || 'P2P setup failed');
        }
      } else if (status.type === 'error') {
        Alert.alert('Transfer Error', status.message);
        setConnectionStatus('error');
      } else if (status.type === 'ready') {
        isFinalizing.current = true; // MUST set this before replace so unmount doesn't kill the connection
        HapticUtil.success();
        navigation.replace('FileTransferV2', {
          role: 'sender',
          deviceName: 'Receiver V2',
          initialFiles: items,
          ip: status.ip
        });
      }
    };

    WiFiDirectTransferServiceV2.startSender(items, (peers) => {
        setDevices(peers);
    });
  };

  /**
   * Reuse mode: P2P group is already alive. Skip discovery, go straight to
   * finalizeSender with the known receiver IP.
   */
  const startV2SenderReuse = (existingIp: string) => {
    setConnectionStatus('connecting');
    setConnectionLog(`Resending to receiver...`);
    isFinalizing.current = true;

    WiFiDirectTransferServiceV2.onStatus = (status: DirectTransferStatusV2) => {
      console.log('[SHARING SCREEN V2 REUSE] Event:', status.type);
      if (status.type === 'error') {
        Alert.alert('Transfer Error', status.message);
        setConnectionStatus('error');
        setConnectionLog(status.message);
        isFinalizing.current = false;
      } else if (status.type === 'ready') {
        HapticUtil.success();
        navigation.replace('FileTransferV2', {
          role: 'sender',
          deviceName: 'Receiver V2',
          initialFiles: items,
          ip: existingIp,
          reuseConnection: true,
        });
      }
    };

    WiFiDirectTransferServiceV2.finalizeSender(existingIp, items);
  };


  const connectToDevice = (deviceAddress: string) => {
     setConnectionStatus('connecting');
     setConnectionLog(`Linking to device...`);
     HapticUtil.light();
     WiFiDirectTransferServiceV2.connectToSpecificDevice(deviceAddress);
  };


  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
      if (isFinalizing.current || connectionStatus === 'connecting') return;
      if (codes.length > 0 && codes[0].value) {
        try {
          const qr = JSON.parse(codes[0].value);
          if (qr.v2 && qr.ip) {
            HapticUtil.light();
            setConnectionStatus('connecting');
            setConnectionLog(`P2P V2: Connecting to ${qr.name || 'Device'}...`);
            if (qr.address) {
                WiFiDirectTransferServiceV2.connectToSpecificDevice(qr.address);
            } else if (qr.ip) {
                WiFiDirectTransferServiceV2.finalizeSender(qr.ip, items);
            }
          }
        } catch (e) { }
      }
    },
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <View style={styles.headerWrapper}>
        <LinearGradient colors={colors.gradient} style={styles.headerGradient} />
        <SafeAreaView>
          <View style={styles.headerContent}>
            <TouchableOpacity onPress={handleManualGoBack} style={styles.iconButton}>
              <Icon name="arrow-left" size={24} color="#FFF" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Send</Text>
            <TouchableOpacity onPress={() => setMode(mode === 'radar' ? 'qr' : 'radar')} style={styles.iconButton}>
              <Icon name={mode === 'radar' ? 'qrcode-scan' : 'radar'} size={24} color="#FFF" />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>

      <View style={styles.contentContainer}>
        {mode === 'radar' ? (
          <View style={[styles.mainCard, { backgroundColor: colors.surface, ...layout.shadow.medium }]}>
            <View style={styles.radarWrapper}>
              <RadarPulse size={width * 0.65} color="#FF9F43" icon="send-outline" numRings={4} />
              <Text style={styles.radarHint}>Searching for Receivers...</Text>
            </View>

            <View style={styles.deviceListHeader}>
                <Text style={styles.deviceListTitle}>Nearby Receivers ({devices.length})</Text>
                {connectionStatus === 'searching' && <ActivityIndicator size="small" color="#FF9F43" />}
            </View>

            <FlatList
              data={devices}
              keyExtractor={(item) => item.deviceAddress}
              contentContainerStyle={{ padding: 15 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.deviceCard, { borderColor: colors.border }]}
                  onPress={() => connectToDevice(item.deviceAddress)}
                >
                  <View style={styles.deviceIconCircle}>
                    <Icon name="cellphone" size={24} color="#FF9F43" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.deviceName, { color: colors.text }]}>{item.deviceName}</Text>
                    <Text style={{ color: colors.subtext, fontSize: 12 }}>Ready for V2</Text>
                  </View>
                  <Icon name="chevron-right" size={20} color={colors.subtext} />
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={{ alignItems: 'center', marginTop: 40 }}>
                  {!showRetry ? (
                    <>
                      <Text style={{ color: colors.subtext, fontWeight: '600' }}>Looking for peers...</Text>
                      <Text style={{ color: colors.subtext, fontSize: 12, marginTop: 4, opacity: 0.6 }}>Ensure the receiver is on the Receive screen.</Text>
                    </>
                  ) : (
                    <View style={{ alignItems: 'center' }}>
                      <Text style={{ color: colors.subtext, marginBottom: 15, textAlign: 'center' }}>Taking longer than usual...{'\n'}Make sure the receiver device is waiting.</Text>
                      <TouchableOpacity 
                        style={[styles.retryBtn, { backgroundColor: colors.primary }]}
                        onPress={handleRetry}
                        activeOpacity={0.8}
                      >
                        <Icon name="refresh" size={20} color="#FFF" style={{ marginRight: 8 }} />
                        <Text style={{ color: '#FFF', fontWeight: '800' }}>Refresh Search</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              }
            />
          </View>
        ) : (
          <View style={[styles.mainCard, { backgroundColor: colors.surface }]}>
             <View style={styles.scannerWrapper}>
                {hasPermission && device ? (
                   <View style={styles.cameraFrame}>
                      <Camera style={StyleSheet.absoluteFill} device={device} isActive={mode === 'qr'} codeScanner={codeScanner} />
                      <View style={styles.scanLine} />
                   </View>
                ) : (
                   <View style={{ alignItems: 'center', paddingHorizontal: 20, marginVertical: 35 }}>
                     <Icon name="camera-off" size={48} color={colors.subtext} style={{ marginBottom: 15 }} />
                     <Text style={{ color: colors.text, fontSize: 18, textAlign: 'center', fontWeight: '800' }}>Camera Access Required</Text>
                     <Text style={{ color: colors.subtext, fontSize: 14, textAlign: 'center', marginTop: 8, marginBottom: 24, lineHeight: 20 }}>
                       Permission to use the camera is required to scan QR codes and pair devices.
                     </Text>
                     <TouchableOpacity 
                       style={{ backgroundColor: colors.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 30, elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4 }}
                       onPress={async () => {
                          const status = await Camera.requestCameraPermission();
                          if (status === 'granted') setHasPermission(true);
                          else {
                             if (Platform.OS === 'android') {
                               Linking.openSettings();
                             } else {
                               Linking.openURL('app-settings:');
                             }
                          }
                       }}
                       activeOpacity={0.8}
                     >
                       <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 15 }}>Grant Permission</Text>
                     </TouchableOpacity>
                   </View>
                )}
                <View style={{ marginTop: 35, alignItems: 'center' }}>
                  <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800' }}>Scan Receiver QR</Text>
                  <Text style={{ color: colors.subtext, fontSize: 14, textAlign: 'center', marginTop: 10, paddingHorizontal: 30, lineHeight: 20 }}>
                    Point your camera at the QR code displayed on the receiving device to pair instantly.
                  </Text>
                </View>
             </View>
          </View>
        )}
      </View>

      {connectionStatus === 'connecting' && (
        <View style={styles.overlay}>
           <View style={{ backgroundColor: 'rgba(30, 30, 30, 0.95)', padding: 30, borderRadius: 24, alignItems: 'center', maxWidth: width * 0.8 }}>
             <ActivityIndicator size="large" color="#FF9F43" />
             <Text style={{ color: '#FFF', marginTop: 20, fontSize: 16, fontWeight: '700', textAlign: 'center', lineHeight: 24 }}>{connectionLog}</Text>
           </View>
        </View>
      )}

      {DisplayAds && (
        <View style={styles.adContainer}>
          <BannerAd unitId={ProdIDs.ADAPTIVE_BANNER} size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER} />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerWrapper: { height: 110, backgroundColor: 'transparent', zIndex: 10 },
  headerGradient: { ...StyleSheet.absoluteFillObject, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  headerContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 50, paddingBottom: 15 },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#FFF' },
  iconButton: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center', borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)' },
  contentContainer: { flex: 1, padding: 20 },
  mainCard: { flex: 1, borderRadius: 24, overflow: 'hidden' },
  radarWrapper: { paddingVertical: 40, alignItems: 'center' },
  radarHint: { marginTop: 20, fontSize: 18, fontWeight: '700' },
  deviceListHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  deviceListTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', opacity: 0.6 },
  deviceCard: { flexDirection: 'row', alignItems: 'center', padding: 15, borderRadius: 16, borderWidth: 1, marginBottom: 10 },
  deviceIconCircle: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginRight: 15, backgroundColor: 'rgba(255,159,67,0.1)' },
  deviceName: { fontSize: 16, fontWeight: '700' },
  scannerWrapper: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  cameraFrame: { width: 250, height: 250, borderRadius: 24, overflow: 'hidden', backgroundColor: '#000', borderWidth: 2, borderColor: '#FF9F43' },
  scanLine: { position: 'absolute', top: '50%', left: 20, right: 20, height: 2, backgroundColor: '#FF9F43' },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center', zIndex: 1000 },
  adContainer: { position: 'absolute', bottom: 0, width: '100%', alignItems: 'center', backgroundColor: 'transparent' },
  retryBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 25, elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4 }
});

export default SharingScreenV2;
