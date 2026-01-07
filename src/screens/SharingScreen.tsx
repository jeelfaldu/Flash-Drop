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
  Platform
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';
import QRCode from 'react-native-qrcode-svg';
import WifiP2PManager from '../utils/WifiP2PManager';
import TransferServer from '../utils/TransferServer';

import WifiManager from 'react-native-wifi-reborn';
import { Linking } from 'react-native';
import DeviceInfo from 'react-native-device-info';

const { width } = Dimensions.get('window');

const SharingScreen = ({ route, navigation }: any) => {
    const { items } = route.params;
    const [status, setStatus] = useState('initializing');
  const [activeTab, setActiveTab] = useState('nearby'); // 'nearby' | 'qr'
    const [qrData, setQrData] = useState<string | null>(null);
    const [groupInfo, setGroupInfo] = useState<any>(null);

  // Radar Animations
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    setupHotspot();
    return () => {
      TransferServer.stop();
      WifiP2PManager.removeGroup();
    };
  }, []);

  useEffect(() => {
    if (activeTab === 'nearby') {
      startRadarAnimations();
    }
  }, [activeTab]);

  const startRadarAnimations = () => {
    // Stop existing animations first to prevent stacking
    pulseAnim.stopAnimation();
    rotateAnim.stopAnimation();
    pulseAnim.setValue(0);
    rotateAnim.setValue(0);

    // Pulse animation
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

    // Rotation animation
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
                setGroupInfo(info);
          setQrData(JSON.stringify({ ssid: info.ssid, pass: info.pass, ip: info.ownerIp }));
          startServer();
        } else {
          setStatus('error');
          Alert.alert("Error", "Failed to get Hotspot info.");
        }
      } else {
        // iOS Support: Manual Hotspot or Local Network
        setStatus('getting_info');
        const ip = await DeviceInfo.getIpAddress();

        if (ip && ip !== '0.0.0.0') {
          setGroupInfo({ ssid: 'Local Network', pass: '', ownerIp: ip });
          setQrData(JSON.stringify({ ssid: null, pass: null, ip: ip }));
          startServer();
        } else {
          setStatus('error');
          Alert.alert(
            "Connection Required",
            "Please connect to Wi-Fi or turn on Personal Hotspot to share files.",
            [{ text: "OK", onPress: () => navigation.goBack() }]
          );
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

  const renderHeader = () => (
    <LinearGradient colors={['#7C4DFF', '#6200EA']} style={styles.header}>
      <View style={styles.headerContent}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Icon name="arrow-left" size={26} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Sender</Text>
        <TouchableOpacity style={styles.helpBtn}>
          <Icon name="help-circle-outline" size={26} color="#FFF" />
        </TouchableOpacity>
      </View>
    </LinearGradient>
  );

  const renderRadar = () => (
    <View style={styles.radarWrapper}>
      <View style={styles.instructionsContainer}>
        <View style={styles.dot} />
        <Text style={styles.instructionsText}>Make sure your friend is in receiving state.</Text>
      </View>

      <View style={styles.radarContainer}>
        {/* Background Circles */}
        <View style={[styles.circle, { width: 280, height: 280, opacity: 0.1 }]} />
        <View style={[styles.circle, { width: 200, height: 200, opacity: 0.2 }]} />
        <View style={[styles.circle, { width: 120, height: 120, opacity: 0.3 }]} />

        {/* Pulsing Circles */}
        {[0, 1, 2].map((i) => (
          <Animated.View
            key={i}
            style={[
              styles.pulseCircle,
              {
                opacity: pulseAnim.interpolate({
                  inputRange: [0, 0.5, 1],
                  outputRange: [0.4, 0.2, 0],
                }),
                transform: [{
                  scale: pulseAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.5, 2.5 + i * 0.5],
                  })
                }]
              }
            ]}
          />
        ))}

        {/* Rotating Sweep */}
        <Animated.View style={[styles.sweep, { transform: [{ rotate: rotation }] }]}>
          <LinearGradient
            colors={['rgba(98, 0, 234, 0.3)', 'transparent']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.sweepGradient}
          />
        </Animated.View>

        {/* Center Device */}
        <View style={styles.centerDeviceWrapper}>
          <View style={styles.centerCircle}>
            <Icon name="cellphone" size={32} color="#FFF" />
            <View style={styles.arrowUpBadge}>
              <Icon name="arrow-up" size={10} color="#6200EA" />
            </View>
          </View>
        </View>

        {/* Mock Discovered Device (Mi 8 Lite as per image) */}
        <View style={[styles.discoveredDevice, { top: 60, left: 40 }]}>
          <View style={styles.deviceIconBox}>
            <Icon name="cellphone" size={24} color="#FFF" />
            <View style={styles.arrowDownBadge}>
              <Icon name="arrow-down" size={8} color="#2196F3" />
            </View>
          </View>
          <Text style={styles.deviceName}>Mi 8 Lite</Text>
        </View>
      </View>

      <Text style={styles.waitingText}>Waiting for receiver to connect</Text>
    </View>
  );

  const renderQRContent = () => (
    <View style={styles.qrWrapper}>
      <View style={styles.qrCard}>
        {qrData ? (
          <>
            <QRCode
              value={qrData}
              size={220}
              color="#6200EA"
              backgroundColor="white"
            />
            <Text style={styles.qrHint}>Ask the receiver to scan this QR code to join your hotspot</Text>
            {groupInfo && (
              <View style={styles.manualInfo}>
                <Text style={styles.manualTitle}>Manual Connection</Text>
                <Text style={styles.manualText}>SSID: {groupInfo.ssid}</Text>
                <Text style={styles.manualText}>Pass: {groupInfo.pass}</Text>
              </View>
            )}
          </>
        ) : (
            <ActivityIndicator size="large" color="#6200EA" />
        )}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      {renderHeader()}

      <View style={styles.contentContainer}>
        <View style={styles.mainCard}>
          {activeTab === 'nearby' ? renderRadar() : renderQRContent()}
        </View>

        <View style={styles.bottomButtonsWrapper}>
          <View style={styles.tabsContainer}>
            <TouchableOpacity
              style={styles.tabItem}
              onPress={() => setActiveTab('nearby')}
            >
              {activeTab === 'nearby' ? (
                <LinearGradient
                  colors={['#7C4DFF', '#6200EA']}
                  style={styles.activeTabGradient}
                >
                  <Icon name="radar" size={20} color="#FFF" />
                  <Text style={styles.activeTabText}>Nearby</Text>
                </LinearGradient>
              ) : (
                <View style={styles.inactiveTab}>
                  <Icon name="radar" size={20} color="#8E8E93" />
                  <Text style={styles.inactiveTabText}>Nearby</Text>
                </View>
              )}
            </TouchableOpacity>

            <Text style={styles.orText}>OR</Text>

            <TouchableOpacity
              style={styles.tabItem}
              onPress={() => setActiveTab('qr')}
            >
              {activeTab === 'qr' ? (
                <LinearGradient
                  colors={['#7C4DFF', '#6200EA']}
                  style={styles.activeTabGradient}
                >
                  <Icon name="qrcode-scan" size={20} color="#FFF" />
                  <Text style={styles.activeTabText}>QR Code</Text>
                </LinearGradient>
              ) : (
                <View style={styles.inactiveTab}>
                  <Icon name="qrcode-scan" size={20} color="#8E8E93" />
                  <Text style={styles.inactiveTabText}>QR Code</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
                </View>
      </View>
    </View>
    );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F0F2F5' },
  header: { height: 100, paddingTop: StatusBar.currentHeight || 20, paddingHorizontal: 15, justifyContent: 'center' },
  headerContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { padding: 5 },
  headerTitle: { color: '#FFF', fontSize: 20, fontWeight: 'bold' },
  helpBtn: { padding: 5 },

  contentContainer: { flex: 1, padding: 15, paddingBottom: 30 },
  mainCard: {
    flex: 1,
    backgroundColor: '#FFF',
    borderRadius: 25,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    overflow: 'hidden'
  },

  radarWrapper: { flex: 1, alignItems: 'center', paddingTop: 30 },
  instructionsContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8F9FA', paddingHorizontal: 15, paddingVertical: 10, borderRadius: 20 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#DDD', marginRight: 10 },
  instructionsText: { color: '#8E8E93', fontSize: 13 },

  radarContainer: { width: 300, height: 300, justifyContent: 'center', alignItems: 'center', marginVertical: 40 },
  circle: { position: 'absolute', borderRadius: 150, borderWidth: 1, borderColor: '#6200EA' },
  pulseCircle: { position: 'absolute', width: 100, height: 100, borderRadius: 50, borderWidth: 1, borderColor: '#6200EA', backgroundColor: 'rgba(98, 0, 234, 0.1)' },

  sweep: { position: 'absolute', width: 300, height: 300, borderRadius: 150, overflow: 'hidden' },
  sweepGradient: { width: 150, height: 300, position: 'absolute', left: 150 },

  centerDeviceWrapper: { zIndex: 10 },
  centerCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#9575CD', alignItems: 'center', justifyContent: 'center', elevation: 4 },
  arrowUpBadge: { position: 'absolute', top: 15, right: 15, width: 18, height: 18, borderRadius: 9, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center' },

  discoveredDevice: { position: 'absolute', alignItems: 'center' },
  deviceIconBox: { width: 48, height: 48, borderRadius: 10, backgroundColor: '#2196F3', alignItems: 'center', justifyContent: 'center', elevation: 3 },
  arrowDownBadge: { position: 'absolute', top: 5, right: 5, width: 14, height: 14, borderRadius: 7, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center' },
  deviceName: { fontSize: 11, color: '#333', marginTop: 8, fontWeight: '500' },

  waitingText: { fontSize: 16, color: '#333', fontWeight: '500' },

  qrWrapper: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  qrCard: { alignItems: 'center' },
  qrHint: { marginTop: 25, color: '#666', textAlign: 'center', fontSize: 14, lineHeight: 20 },
  manualInfo: { marginTop: 20, width: '100%', padding: 15, backgroundColor: '#F5F5F7', borderRadius: 15 },
  manualTitle: { fontWeight: 'bold', color: '#6200EA', marginBottom: 8 },
  manualText: { color: '#444', fontSize: 13, marginVertical: 2 },

  bottomButtonsWrapper: { marginTop: 20 },
  tabsContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10 },
  tabItem: { flex: 1 },
  activeTabGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 30, elevation: 4 },
  activeTabText: { color: '#FFF', fontWeight: 'bold', marginLeft: 8, fontSize: 15 },
  inactiveTab: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 30, backgroundColor: '#F0F0F5' },
  inactiveTabText: { color: '#8E8E93', fontWeight: 'bold', marginLeft: 8, fontSize: 15 },
  orText: { marginHorizontal: 15, color: '#8E8E93', fontWeight: 'bold', fontSize: 12 },
});

export default SharingScreen;
