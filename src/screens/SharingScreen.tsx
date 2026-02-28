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
import WifiP2PManager from '../utils/WifiP2PManager';
import TransferServer from '../utils/TransferServer';
import WifiManager from 'react-native-wifi-reborn';
import DeviceInfo from 'react-native-device-info';
import { useTheme } from '../theme/ThemeContext';
import { useConnectionStore, useTransferStore } from '../store';

const SharingScreen = ({ route, navigation }: any) => {
  const { items = [], mode } = route.params || {};
  const { colors, typography, layout, spacing, isDark } = useTheme();

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

    const [qrData, setQrData] = useState<string>(''); 
    const [groupInfo, setGroupInfo] = useState<any>(null);

  useEffect(() => {
    setupHotspot();

    const onBackPress = () => {
      // Cleanup if user backs out manually with hardware button
      TransferServer.stop();
      WifiP2PManager.removeGroup();
      if (navigation.canGoBack()) navigation.goBack();
      else (navigation as any).navigate('Home');
      return true;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', onBackPress);

    return () => {
      backHandler.remove();
      // Cleanup is explicitly handled by the Back/Cancel buttons
      // or by the FileTransfer screen once navigation completes.
    };
  }, []);

    const setupHotspot = async () => {
        try {
          setStatus('checking_connection');

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

            await WifiP2PManager.init();
            const conn = await WifiP2PManager.getConnectionInfo();

          if (!(conn && conn.groupFormed)) {
            setStatus('creating_hotspot');
            await WifiP2PManager.createGroup();
          }

          setStatus('getting_info');
          const info = await WifiP2PManager.getGroupInfoWithRetry();

          if (info) {
            setGroupInfo(info);
            setConnected(true);
            setConnectionDetails({ type: 'wifi-direct', ssid: info.ssid, ip: info.ownerIp });
            setQrData(JSON.stringify({ ssid: info.ssid, pass: info.pass, ip: info.ownerIp, mac: info.mac }));
            startServer();
          } else {
            setStatus('error');
            Alert.alert("Error", "Failed to get Hotspot info.");
          }
        } else {
          setStatus('getting_info');
          const ip = await DeviceInfo.getIpAddress();
          if (ip && ip !== '0.0.0.0' && ip !== '127.0.0.1') {
            setGroupInfo({ ssid: 'Local Network', pass: '', ownerIp: ip });
            setConnected(true);
            setConnectionDetails({ type: 'hotspot', ssid: 'Local Network', ip: ip });
            setQrData(JSON.stringify({ ssid: null, pass: null, ip: ip }));
            startServer();
          } else {
            setStatus('error');
            Alert.alert("Connection Required", "Please connect to Wi-Fi to share files.");
          }
        }
      } catch (e) {
        console.log(e);
        setStatus('error');
        Alert.alert("Error", "Initialization failed.");
      }
    };

  const startServer = () => {
    TransferServer.start(8888, items, (serverStatus) => {
      if (serverStatus.type === 'client_connected') {
        navigation.replace('FileTransfer', {
          role: 'sender',
          deviceName: serverStatus.clientAddress,
          initialFiles: items
        });
      }
    });
    setStatus('ready');
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
                TransferServer.stop();
                WifiP2PManager.removeGroup(); // Attempt to cleanup hotspot
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
              <View style={styles.qrWrapper}>
                <View style={styles.qrCard}>
                  {qrData ? (
                    <>
                        <View style={{ padding: 20, backgroundColor: '#FFF', borderRadius: 20, ...layout.shadow.light }}>
                          <QRCode value={qrData} size={200} color={colors.primary} backgroundColor="white" />
                        </View>
                        <Text style={[styles.qrHint, { color: colors.subtext, fontFamily: typography.fontFamily }]}>
                      {mode === 'pairing'
                        ? 'Scan this code on the other device to pair'
                        : 'Ask the receiver to scan this QR code'}
                        </Text>
                        {groupInfo && groupInfo.ssid && (
                          <View style={[styles.manualInfo, { backgroundColor: colors.background }]}>
                            <Text style={[styles.manualTitle, { color: colors.text, fontFamily: typography.fontFamily }]}>Manual Connection</Text>
                            <Text style={[styles.manualText, { color: colors.primary, fontFamily: typography.fontFamily }]}>SSID: {groupInfo.ssid}</Text>
                            <Text style={[styles.manualText, { color: colors.primary, fontFamily: typography.fontFamily }]}>Pass: {groupInfo.pass}</Text>
                          </View>
                        )}
                      </>
                    ) : (
                      <ActivityIndicator size="large" color={colors.primary} />
                    )}
                  </View>
            </View>
          ) : status === 'error' ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
              <Icon name="alert-circle-outline" size={60} color={colors.error} />
              <Text style={{ marginTop: 15, color: colors.text, fontSize: 18, fontWeight: '700', fontFamily: typography.fontFamily }}>Setup Failed</Text>
              <Text style={{ marginTop: 8, color: colors.subtext, textAlign: 'center', marginBottom: 24, fontFamily: typography.fontFamily }}>
                Could not create a hotspot. Please check permissions and try again.
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
    marginBottom: 20
  },
  qrWrapper: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  qrCard: { alignItems: 'center' },
  qrHint: { textAlign: 'center', marginTop: 24, lineHeight: 20, paddingHorizontal: 20, fontSize: 16, fontWeight: '500' },
  manualInfo: { marginTop: 30, padding: 20, borderRadius: 16, width: '100%', alignItems: 'center' },
  manualTitle: { fontWeight: '700', marginBottom: 12, fontSize: 16 },
  manualText: { fontSize: 14, fontWeight: '600', marginVertical: 2 },
  diagnosticsText: { fontSize: 12, marginTop: 10 },
});

export default SharingScreen;
