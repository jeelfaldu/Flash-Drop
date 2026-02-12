import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  ActivityIndicator,
  Animated,
  Easing,
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
    const { items } = route.params;
  const { colors, typography, layout, spacing } = useTheme();

  // Zustand stores
  const {
    ssid,
    ipAddress,
    password,
    setConnectionDetails,
    setConnected
  } = useConnectionStore();
  const { setRole, setTransferring } = useTransferStore();

  // Local UI state
  const [status, setStatus] = useState('initializing');
  const [activeTab, setActiveTab] = useState('qr');

  // Derived state
  const qrData = (ssid && ipAddress) ? JSON.stringify({
    ssid: ssid === 'Local Network' ? null : ssid,
    pass: ssid === 'Local Network' ? null : password,
    ip: ipAddress
  }) : '';

  const pulseAnim = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    setRole('sender');
    setTransferring(false);
    setupHotspot();
    // Only stop server/group if we didn't actually connect
    return () => {
      // If we are navigating away but not connected, cleanup.
      // But if we are connected, keep it alive for FileTransferScreen.
    };
  }, []);

  useEffect(() => {
    if (activeTab === 'nearby') {
      startRadarAnimations();
    }
  }, [activeTab]);

  const startRadarAnimations = () => {
    pulseAnim.stopAnimation();
    rotateAnim.stopAnimation();
    pulseAnim.setValue(0);
    rotateAnim.setValue(0);

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 3000,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        })
      ])
    ).start();

    Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 4000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();
  };

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
            setConnected(true);
            setConnectionDetails({
              type: 'wifi-direct',
              ssid: info.ssid,
              ip: info.ownerIp,
              password: info.pass
            });
            startServer();
          } else {
            setStatus('error');
            Alert.alert("Error", "Failed to get Hotspot info.");
          }
        } else {
          setStatus('getting_info');
          const ip = await DeviceInfo.getIpAddress();
          if (ip && ip !== '0.0.0.0' && ip !== '127.0.0.1') {
            setConnected(true);
            setConnectionDetails({
              type: 'hotspot',
              ssid: 'Local Network',
              ip: ip,
              password: ''
            });
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
        navigation.navigate('FileTransfer', {
          role: 'sender',
          deviceName: serverStatus.clientAddress,
          initialFiles: items
        });
      }
    });
    setStatus('ready');
  };

  const rotation = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

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
            <Text style={[styles.headerTitle, { fontFamily: typography.fontFamily }]}>Sender</Text>
            <TouchableOpacity style={styles.iconButton}>
              <Icon name="help-circle-outline" size={24} color="#FFF" />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>

      <View style={styles.contentContainer}>
        <View style={[styles.mainCard, { backgroundColor: colors.surface, ...layout.shadow.medium }]}>
          {status === 'ready' ? (
            activeTab === 'nearby' ? (
              <View style={styles.radarWrapper}>
                <View style={[styles.instructionsContainer, { backgroundColor: colors.background }]}>
                  <View style={[styles.dot, { backgroundColor: colors.accent }]} />
                  <Text style={[styles.instructionsText, { color: colors.subtext, fontFamily: typography.fontFamily }]}>
                    Waiting for receiver...
                  </Text>
                </View>

                <View style={styles.radarContainer}>
                  <View style={[styles.circle, { borderColor: colors.primary, width: 280, height: 280, opacity: 0.1 }]} />
                  <View style={[styles.circle, { borderColor: colors.primary, width: 200, height: 200, opacity: 0.2 }]} />
                  <View style={[styles.circle, { borderColor: colors.primary, width: 120, height: 120, opacity: 0.3 }]} />

                  {[0, 1].map((i) => (
                    <Animated.View key={i} style={[styles.pulseCircle, {
                      borderColor: colors.primary,
                      backgroundColor: colors.primary + '15',
                      opacity: pulseAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.4, 0.2, 0] }),
                      transform: [{ scale: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 2.5] }) }]
                    }]} />
                  ))}

                  <Animated.View style={[styles.sweep, { transform: [{ rotate: rotation }] }]}>
                    <LinearGradient
                      colors={[colors.primary + '66', 'transparent']}
                      start={{ x: 0, y: 0.5 }}
                      end={{ x: 1, y: 0.5 }}
                      style={styles.sweepGradient}
                    />
                  </Animated.View>

                  <View style={styles.centerDeviceWrapper}>
                    <View style={[styles.centerCircle, { backgroundColor: colors.primary }]}>
                      <Icon name="cellphone" size={32} color="#FFF" />
                    </View>
                  </View>
                </View>

                {ipAddress && (
                  <Text style={[styles.diagnosticsText, { color: colors.subtext, fontFamily: typography.fontFamily }]}>
                    Server IP: {ipAddress}
                  </Text>
                )}
              </View>
            ) : (
              <View style={styles.qrWrapper}>
                <View style={styles.qrCard}>
                  {qrData ? (
                    <>
                        <View style={{ padding: 20, backgroundColor: '#FFF', borderRadius: 20, ...layout.shadow.light }}>
                          <QRCode value={qrData} size={200} color={colors.primary} backgroundColor="white" />
                        </View>
                        <Text style={[styles.qrHint, { color: colors.subtext, fontFamily: typography.fontFamily }]}>
                          Ask the receiver to scan this QR code
                        </Text>
                        {ssid && (
                          <View style={[styles.manualInfo, { backgroundColor: colors.background }]}>
                            <Text style={[styles.manualTitle, { color: colors.text, fontFamily: typography.fontFamily }]}>Manual Connection</Text>
                            <Text style={[styles.manualText, { color: colors.primary, fontFamily: typography.fontFamily }]}>SSID: {ssid}</Text>
                            <Text style={[styles.manualText, { color: colors.primary, fontFamily: typography.fontFamily }]}>Pass: {password}</Text>
                          </View>
                        )}
                      </>
                    ) : (
                      <ActivityIndicator size="large" color={colors.primary} />
                    )}
                  </View>
                </View>
              )
          ) : (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={{ marginTop: 15, color: colors.subtext, fontFamily: typography.fontFamily }}>
                  Setting up hotspot...
                </Text>
              </View>
          )}
        </View>

        <View style={[styles.tabsContainer, { backgroundColor: colors.surface, padding: 4, borderRadius: 20 }]}>
          <TouchableOpacity
            style={[
              styles.tabItem,
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
            ]}>Radar</Text>
            </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.tabItem,
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
            ]}>QR Code</Text>
            </TouchableOpacity>
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
  radarWrapper: { flex: 1, alignItems: 'center', paddingTop: 20 },
  instructionsContainer: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, marginBottom: 20 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  instructionsText: { fontSize: 13 },
  radarContainer: { width: 300, height: 300, justifyContent: 'center', alignItems: 'center', marginVertical: 10 },
  circle: { position: 'absolute', borderRadius: 150, borderWidth: 1 },
  pulseCircle: { position: 'absolute', width: 100, height: 100, borderRadius: 50, borderWidth: 1 },
  sweep: { position: 'absolute', width: 300, height: 300, borderRadius: 150, overflow: 'hidden' },
  sweepGradient: { width: 150, height: 300, position: 'absolute', left: 150 },
  centerDeviceWrapper: { zIndex: 10 },
  centerCircle: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', elevation: 4 },
  qrWrapper: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  qrCard: { alignItems: 'center' },
  qrHint: { textAlign: 'center', marginTop: 24, lineHeight: 20, paddingHorizontal: 20, fontSize: 16, fontWeight: '500' },
  manualInfo: { marginTop: 30, padding: 20, borderRadius: 16, width: '100%', alignItems: 'center' },
  manualTitle: { fontWeight: '700', marginBottom: 12, fontSize: 16 },
  manualText: { fontSize: 14, fontWeight: '600', marginVertical: 2 },
  tabsContainer: { flexDirection: 'row', elevation: 5 },
  tabItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 16 },
  tabText: { fontWeight: '600', marginLeft: 8 },
  diagnosticsText: { fontSize: 12, marginTop: 10 },
});

export default SharingScreen;
