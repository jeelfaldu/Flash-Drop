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
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';
import QRCode from 'react-native-qrcode-svg';
import WiFiDirectTransferServiceV2, { DirectTransferStatusV2 } from '../utils/WiFiDirectTransferServiceV2';
import WiFiDirectP2PManager from '../utils/Wifidirectmanager';
import DeviceInfo from 'react-native-device-info';
import { useTheme } from '../theme/ThemeContext';
import { useConnectionStore, useTransferStore } from '../store';
import RadarPulse from '../components/RadarPulse';
import HapticUtil from '../utils/HapticUtil';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import { DisplayAds, ProdIDs } from '../utils/Constant';

const { width } = Dimensions.get('window');

const ReceiveScreenV2 = ({ navigation }: any) => {
  const { colors, typography, layout, isDark } = useTheme();
  
  const [status, setStatus] = useState('initializing');
  const [setupError, setSetupError] = useState<string>('');
  const [qrData, setQrData] = useState<string>('');
  
  const isRedirected = useRef(false);
  const { setConnectionDetails, setConnected } = useConnectionStore();
  const { setRole, setTransferring } = useTransferStore();

  useEffect(() => {
    isRedirected.current = false;
    const init = async () => {
       if (Platform.OS !== 'android') return;
       await WiFiDirectTransferServiceV2.stop();
       setupV2ReceiverHotspot();
    };
    init();

    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      handleManualGoBack();
      return true;
    });

    return () => {
      backHandler.remove();
      // Notice: No automatic stop() here.
    };
  }, []);

  const handleManualGoBack = () => {
      WiFiDirectTransferServiceV2.stop();
      navigation.goBack();
  };

  const setupV2ReceiverHotspot = async () => {
    try {
      setStatus('creating_hotspot_v2');
      setSetupError('');

      WiFiDirectTransferServiceV2.onStatus = (s: DirectTransferStatusV2) => {
        console.log('[RECEIVE SCREEN V2] Event:', s.type);
        if (s.type === 'p2p') {
          if (s.status.type === 'error') {
            setSetupError(s.status.message || 'P2P setup failed');
            setStatus('error');
          }
        }

        if (s.type === 'ready') {
            setConnected(true);
            setConnectionDetails({ type: 'wifi-direct', ssid: 'FlashDrop-V2', ip: s.ip });
            
            // Ensure we have the device address
            const checkAddress = async () => {
              for (let i = 0; i < 5; i++) {
                const addr = WiFiDirectP2PManager.getThisDeviceAddress();
                if (addr) {
                  const qrPayload = {
                    ip: s.ip,
                    v2: true,
                    name: DeviceInfo.getDeviceNameSync(),
                    address: addr
                  };
                  setQrData(JSON.stringify(qrPayload));
                  setStatus('ready');
                  HapticUtil.success();
                  return;
                }
                await new Promise(r => setTimeout(r, 800));
              }
              // Fallback
              setQrData(JSON.stringify({ ip: s.ip, v2: true, name: DeviceInfo.getDeviceNameSync() }));
              setStatus('ready');
            };
            checkAddress();
        }

        if (s.type === 'client_connected') {
            handleStartV2Transfer();
        }
      };

      const properSaveDir = Platform.OS === 'android'
        ? '/storage/emulated/0/Download/FlashDrop'
        : '';

      await WiFiDirectTransferServiceV2.startReceiver(properSaveDir);

    } catch (e: any) {
      console.error('[ReceiveScreenV2] Setup Error:', e);
      setStatus('error');
      setSetupError(e.message || "Failed to initialize receiver hotspot.");
    }
  };

  const handleStartV2Transfer = () => {
    console.log('[RECEIVE SCREEN] handleStartV2Transfer triggering...');
    if (!isRedirected.current) {
        isRedirected.current = true;
        setTransferring(true);
        setRole('receiver', 'Sender V2');
        navigation.replace('FileTransferV2', {
            role: 'receiver',
            deviceName: 'Sender V2',
            initialFiles: []
        });
    }
  };

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
            <Text style={styles.headerTitle}>Receive (Hotspot)</Text>
            <View style={{ width: 40 }} />
          </View>
        </SafeAreaView>
      </View>

      <View style={styles.contentContainer}>
        <View style={[styles.mainCard, { backgroundColor: colors.surface, ...layout.shadow.medium }]}>
          {status === 'ready' ? (
            <View style={styles.qrRoot}>
              <View style={styles.discoverableWrapper}>
                <Text style={[styles.discoverableLabel, { color: '#00D1FF' }]}>READY TO RECEIVE • V2</Text>
                <Text style={[styles.deviceName, { color: colors.text }]}>{DeviceInfo.getDeviceNameSync()}</Text>
              </View>

              <View style={styles.qrRadarWrapper}>
                <View style={styles.radarOverlay}>
                  <RadarPulse size={width * 0.75} color="#00D1FF" numRings={3} />
                </View>
                <View style={[styles.qrContainer, { backgroundColor: '#FFF' }]}>
                  <QRCode value={qrData} size={width * 0.45} color="#00D1FF" backgroundColor="white" />
                </View>
              </View>

              <View style={[styles.instructionsWrapper, { backgroundColor: '#00D1FF10' }]}>
                <Icon name="information-outline" size={24} color="#00D1FF" />
                <Text style={[styles.instructionText, { color: colors.text }]}>
                  Sender should scan this QR code to join your P2P hotspot.
                </Text>
              </View>

              <TouchableOpacity 
                style={[styles.doneBtn, { backgroundColor: '#00D1FF' }]}
                onPress={handleStartV2Transfer}
              >
                <Text style={styles.doneBtnText}>Waiting for sender...</Text>
                <ActivityIndicator size="small" color="#FFF" style={{ marginLeft: 10 }} />
              </TouchableOpacity>
            </View>
          ) : status === 'error' ? (
            <View style={styles.center}>
              <Icon name="alert-circle" size={60} color={colors.error} />
              <Text style={styles.errorText}>{setupError}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={setupV2ReceiverHotspot}>
                <Text style={{ color: '#FFF', fontWeight: '700' }}>Retry Setup</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.center}>
              <ActivityIndicator size="large" color="#00D1FF" />
              <Text style={{ marginTop: 15, color: colors.subtext }}>Creating P2P Hotspot...</Text>
            </View>
          )}
        </View>
      </View>

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
  mainCard: { flex: 1, borderRadius: 24, overflow: 'hidden', padding: 20 },
  qrRoot: { flex: 1, alignItems: 'center', justifyContent: 'space-between' },
  discoverableWrapper: { alignItems: 'center', marginTop: 10 },
  discoverableLabel: { fontSize: 13, fontWeight: '800', opacity: 0.7 },
  deviceName: { fontSize: 20, fontWeight: '800', marginTop: 4 },
  qrRadarWrapper: { height: width * 0.8, width: width * 0.8, alignItems: 'center', justifyContent: 'center', marginVertical: 10 },
  radarOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', zIndex: -1 },
  qrContainer: { padding: 15, borderRadius: 24, elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 10 },
  instructionsWrapper: { flexDirection: 'row', alignItems: 'center', padding: 15, borderRadius: 16, gap: 12, marginVertical: 20, width: '100%' },
  instructionText: { flex: 1, fontSize: 13, fontWeight: '500' },
  doneBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 30, marginTop: 20 },
  doneBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { marginTop: 15, color: '#FF4757', textAlign: 'center', fontWeight: '600' },
  retryBtn: { backgroundColor: '#FF4757', paddingHorizontal: 30, paddingVertical: 12, borderRadius: 12, marginTop: 20 },
  adContainer: { position: 'absolute', bottom: 0, width: '100%', alignItems: 'center', backgroundColor: 'transparent' }
});

export default ReceiveScreenV2;
