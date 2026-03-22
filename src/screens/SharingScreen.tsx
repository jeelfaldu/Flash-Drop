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
  Animated,
  StatusBar,
  Dimensions,
  Platform,
  Linking
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';
import QRCode from 'react-native-qrcode-svg';
import WiFiDirectTransferService, { DirectTransferStatus } from '../utils/Wifidirecttransferservice';
import TransferServer from '../utils/TransferServer';
import WifiManager from 'react-native-wifi-reborn';
import DeviceInfo from 'react-native-device-info';
import { useTheme } from '../theme/ThemeContext';
import { useConnectionStore, useTransferStore } from '../store';
import RadarPulse from '../components/RadarPulse';
import HapticUtil from '../utils/HapticUtil';

const { width } = Dimensions.get('window');

const SharingScreen = ({ route, navigation }: any) => {
  const { items = [], mode } = route.params || {};
  const { colors, typography, layout, spacing, isDark } = useTheme();
  const isRedirected = useRef(false);

  // Zustand stores
  const {
    ssid,
    ipAddress,
    setConnectionDetails,
    setConnected
  } = useConnectionStore();
  const { setRole, setTransferring } = useTransferStore();

  // Local UI state
    const [status, setStatus] = useState('initializing');
  const [setupError, setSetupError] = useState<string>('');

    const [qrData, setQrData] = useState<string>(''); 
    const [groupInfo, setGroupInfo] = useState<any>(null);
    const groupInfoRef = useRef<any>(null);

  useEffect(() => {
    isRedirected.current = false;
    
    // Initial cleanup before setup
    const init = async () => {
      await WiFiDirectTransferService.stop();
      setupHotspot();
    };
    init();

    const onBackPress = () => {
      WiFiDirectTransferService.stop();
      if (navigation.canGoBack()) navigation.goBack();
      else (navigation as any).navigate('Home');
      return true;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', onBackPress);

    return () => {
      backHandler.remove();
      // If we are leaving without redirection, stop the service
      if (!isRedirected.current) {
        WiFiDirectTransferService.stop();
      }
    };
  }, []);

  // Handle items being added dynamically (e.g. via Share Intent)
  useEffect(() => {
    if (items && items.length > 0 && status === 'ready') {
      TransferServer.updateFiles(items);
    }
  }, [items, status]);

    const setupHotspot = async () => {
      try {
        setStatus('checking_connection');
        setSetupError('');
        setConnected(false);

        if (Platform.OS === 'android') {
          const isWifiEnabled = await WifiManager.isEnabled();
          if (!isWifiEnabled) {
            Alert.alert(
              "Wi-Fi Required",
              "Sharing requires Wi-Fi to be enabled.",
              [
                { text: "Cancel", onPress: () => navigation.goBack(), style: "cancel" },
                { text: "Open Settings", onPress: () => Linking.sendIntent('android.settings.WIFI_SETTINGS') }
              ]
            );
            setStatus('error');
            return;
          }

          // Generate secret key
          const secretKey = Math.random().toString(36).substring(2, 10);

          WiFiDirectTransferService.onStatus = (s: DirectTransferStatus) => {
            console.log('[SharingScreen] Incoming Status:', s.type);

            if (s.type === 'p2p') {
              const statusType = s.status?.type;
              if (statusType === 'discovering' || statusType === 'connecting') {
                setStatus('creating_hotspot');
              } else if (statusType === 'connected' && s.status.isGroupOwner) {
                // Secondary check for client joined
                handleClientJoined('Receiver', secretKey);
              } else if (statusType === 'group_created') {
                // We got the real SSID/Pass!
                const info = s.status as any;
                if (info.networkName) {
                  const newInfo = { ssid: info.networkName, pass: info.passphrase };
                  setGroupInfo(newInfo);
                  groupInfoRef.current = newInfo;
                }
              } else if (statusType === 'error') {
                setStatus('error');
                setSetupError(s.status.message || 'Wi-Fi Direct error');
              }
            }

            if (s.type === 'ready') {
              setConnected(true);
              setConnectionDetails({ type: 'wifi-direct', ssid: 'Direct-FlashDrop', ip: s.ip });
              
              // Build data for QR code - adding SSID/Pass as fallback
              const gInfo = groupInfoRef.current;
              const qrBase = {
                ip: s.ip,
                key: secretKey,
                // Do not enforce p2p-only connection! If Android supports connecting via 
                // Wi-Fi hotspot API directly to this group, we want the receiver to do that.
                // It's the only reliable fallback for Xiaomi/Redmi devices.
                p2p: !gInfo?.ssid, 
                name: DeviceInfo.getDeviceNameSync(),
                // Add these for more reliable connecting
                ssid: gInfo?.ssid || 'Direct-FlashDrop',
                pass: gInfo?.pass
              };
              
              setQrData(JSON.stringify(qrBase));
              setStatus('ready');
              HapticUtil.success();
            }


            if (s.type === 'server' && s.status.type === 'client_connected') {
              console.log(`[SharingScreen] Server detected TCP client: ${s.status.clientAddress}`);
              handleClientJoined(s.status.clientAddress || 'Receiver', secretKey);
            }

            if (s.type === 'error') {
              console.error(`[SharingScreen] DirectTransfer Error:`, s.message);
              setStatus('error');
              setSetupError(s.message || 'Failed to start Wi-Fi Direct');
            }
          };

          console.log(`[SharingScreen] Initializing startSender() for Wi-Fi Direct`);
          await WiFiDirectTransferService.startSender(items, secretKey);
          console.log(`[SharingScreen] startSender() Promise resolved`);
        } else {
          // iOS / Local Network Fallback
          setStatus('getting_info');
          const ip = await DeviceInfo.getIpAddress();
          if (ip && ip !== '0.0.0.0' && ip !== '127.0.0.1') {
            const secretKey = Math.random().toString(36).substring(2, 10);
            setConnected(true);
            setConnectionDetails({ type: 'hotspot', ssid: 'Local Network', ip: ip });
            setQrData(JSON.stringify({ ssid: null, pass: null, ip: ip, key: secretKey }));

            TransferServer.start(8888, items, (serverStatus) => {
              if (serverStatus.type === 'client_connected') {
                handleClientJoined(serverStatus.clientAddress || 'Receiver', secretKey);
              }
            }, secretKey);
            setStatus('ready');
            HapticUtil.success();
          } else {
            setStatus('error');
            setSetupError("Wi-Fi IP not found. Please connect to a network.");
          }
        }
      } catch (e: any) {
        console.error('[SharingScreen] Setup Error:', e);
        setStatus('error');
        setSetupError(e.message || "Failed to initialize sharing.");
      }
    };

    const handleClientJoined = (deviceName: string, secretKey: string) => {
      console.log(`[SharingScreen] handleClientJoined triggered for device: ${deviceName}`);
      if (!isRedirected.current) {
        isRedirected.current = true;
        HapticUtil.celebrate();
        console.log('[SharingScreen] Client joined securely, redirecting to FileTransfer...');
        
        setTimeout(() => {
          (navigation as any).navigate('FileTransfer', {
            role: 'sender',
            deviceName: deviceName,
            initialFiles: items,
            secretKey
          });
          console.log(`[SharingScreen] Navigation dispatch complete`);
        }, 150);
      } else {
        console.log(`[SharingScreen] Already redirected, skipping secondary handleClientJoined calls`);
      }
    };

  return (
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
              onPress={() => {
                // Cleanup if user backs out before connecting
                WiFiDirectTransferService.stop();
                navigation.goBack();
              }}
              style={styles.iconButton}
            >
              <Icon name="arrow-left" size={24} color="#FFF" />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { fontFamily: typography.fontFamily }]}>
              {mode === 'pairing' ? 'Pair Device' : 'Sender'}
            </Text>
            <TouchableOpacity style={styles.iconButton}>
              <Icon name="help-circle-outline" size={24} color="#FFF" />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>

      <View style={styles.contentContainer}>
        <View style={[styles.mainCard, { backgroundColor: colors.surface, ...layout.shadow.medium }]}>
          {status === 'ready' ? (
            <View style={styles.qrRoot}>
              <View style={styles.discoverableWrapper}>
                <Text style={[styles.discoverableLabel, { color: colors.subtext }]}>Discoverable as</Text>
                <Text style={[styles.deviceName, { color: colors.text }]}>{DeviceInfo.getDeviceNameSync()}</Text>
              </View>

              <View style={styles.qrRadarWrapper}>
                <RadarPulse size={width * 0.75} color={colors.primary} numRings={3} />
                <View style={[styles.qrContainer, { backgroundColor: '#FFF', ...layout.shadow.medium }]}>
                  {qrData ? (
                    <QRCode value={qrData} size={width * 0.45} color={colors.primary} backgroundColor="white" />
                  ) : (
                    <ActivityIndicator size="large" color={colors.primary} />
                  )}
                </View>
              </View>

              <View style={styles.instructionsWrapper}>
                <Icon name="qrcode-scan" size={24} color={colors.primary} />
                <Text style={[styles.instructionText, { color: colors.text }]}>
                  Receiver can scan this QR or find your device in nearby search.
                </Text>
              </View>

              {groupInfo && groupInfo.ssid && (
                <View style={[styles.manualInfo, { backgroundColor: colors.background + '80' }]}>
                  <Text style={[styles.manualTitle, { color: colors.text }]}>Manual Hotspot info</Text>
                  <Text style={[styles.manualText, { color: colors.primary }]}>SSID: {groupInfo.ssid} | Pass: {groupInfo.pass}</Text>
                </View>
              )}
            </View>
          ) : status === 'error' ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
              <Icon name="alert-circle-outline" size={60} color={colors.error} />
              <Text style={{ marginTop: 15, color: colors.text, fontSize: 18, fontWeight: '700', fontFamily: typography.fontFamily }}>Setup Failed</Text>
                <Text style={{ marginTop: 8, color: colors.subtext, textAlign: 'center', marginBottom: 24, paddingHorizontal: 20, fontFamily: typography.fontFamily }}>
                  {setupError || "Could not create a hotspot. Please check permissions and try again."}
              </Text>
              <TouchableOpacity
                style={{ backgroundColor: colors.primary, paddingHorizontal: 32, paddingVertical: 12, borderRadius: 12 }}
                onPress={setupHotspot}
              >
                <Text style={{ color: '#FFF', fontWeight: '700' }}>Retry Setup</Text>
              </TouchableOpacity>
            </View>
          ) : (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={{ marginTop: 15, color: colors.subtext, fontFamily: typography.fontFamily }}>
                    {status === 'checking_connection' ? 'Checking network services...' :
                      status === 'creating_hotspot' ? 'Creating Wi-Fi Direct Group...' :
                        status === 'getting_info' ? 'Gathering connection details...' :
                          'Preparing transfer session...'}
                </Text>
                  <TouchableOpacity
                    style={{ marginTop: 30, padding: 10 }}
                    onPress={() => navigation.goBack()}
                  >
                    <Text style={{ color: colors.error, fontWeight: '600' }}>Cancel</Text>
                  </TouchableOpacity>
              </View>
          )}
        </View>
      </View>
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
    padding: 20,
    paddingBottom: 30
  },
  mainCard: {
    flex: 1,
    borderRadius: 24,
    overflow: 'hidden',
    padding: 20,
  },
  qrRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  discoverableWrapper: {
    alignItems: 'center',
    marginTop: 10,
  },
  discoverableLabel: {
    fontSize: 14,
    fontWeight: '600',
    opacity: 0.7,
  },
  deviceName: {
    fontSize: 20,
    fontWeight: '800',
    marginTop: 4,
  },
  qrRadarWrapper: {
    height: width * 0.8,
    width: width * 0.8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrContainer: {
    padding: 15,
    borderRadius: 24,
    backgroundColor: '#FFF',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
  },
  instructionsWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.03)',
    padding: 15,
    borderRadius: 16,
    gap: 12,
    marginVertical: 10,
  },
  instructionText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  manualInfo: {
    width: '100%',
    padding: 15,
    borderRadius: 16,
    marginTop: 10,
  },
  manualTitle: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    opacity: 0.5,
    marginBottom: 4,
  },
  manualText: {
    fontSize: 14,
    fontWeight: '600',
  },
});

export default SharingScreen;
