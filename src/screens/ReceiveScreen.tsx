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
  Linking
} from 'react-native';
import { Camera, useCameraDevice, useCodeScanner } from 'react-native-vision-camera';
import WifiManager from 'react-native-wifi-reborn';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';
import DeviceInfo from 'react-native-device-info';
import TransferClient, { TransferStatus } from '../utils/TransferClient';
import WifiP2PManager from '../utils/WifiP2PManager';
import { requestConnectPermissions } from '../utils/permissionHelper';
import RNFS from 'react-native-fs';
import { useNavigation } from '@react-navigation/native';

const { width } = Dimensions.get('window');

interface TransferringFile {
    name: string;
    size: number;
    progress: number;
    status: 'pending' | 'downloading' | 'completed' | 'error';
}

const ReceiveScreen = () => {
  const navigation = useNavigation();
  const [activeTab, setActiveTab] = useState<'nearby' | 'qr'>('qr');
  const [hasPermission, setHasPermission] = useState(false);
  const [wifiList, setWifiList] = useState<any[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<string>('idle'); 
  const [transferringFiles, setTransferringFiles] = useState<Record<string, TransferringFile>>({});
  const [storageInfo, setStorageInfo] = useState({ free: '0GB', total: '0GB', percent: 0 });
  const [localIp, setLocalIp] = useState('');
  const [connectionLog, setConnectionLog] = useState('');
  
  const device = useCameraDevice('back');
  const scanLineAnim = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    (async () => {
      const status = await Camera.requestCameraPermission();
      setHasPermission(status === 'granted');
      DeviceInfo.getIpAddress().then(setLocalIp);
      updateStorageInfo();
      startWifiScan();
    })();
    return () => TransferClient.stop();
  }, []);

  useEffect(() => {
    if (activeTab === 'qr') startQRAnimation();
    else startRadarAnimations();
  }, [activeTab]);

  const updateStorageInfo = async () => {
    try {
      const total = await DeviceInfo.getTotalDiskCapacity();
      const free = await DeviceInfo.getFreeDiskStorage();
      setStorageInfo({
        free: (free / (1024 * 1024 * 1024)).toFixed(1) + 'GB',
        total: (total / (1024 * 1024 * 1024)).toFixed(1) + 'GB',
        percent: (total - free) / total
      });
    } catch (e) { }
  };

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
        }
      DeviceInfo.getIpAddress().then(setLocalIp);
        connectToTransferServer(ssid, ip);
    } catch (e) {
        setConnectionStatus('error');
      Alert.alert("Error", "Connection failed. Please connect manually in Settings.");
    }
  };

  const connectToTransferServer = (ssid?: string, ip?: string) => {
    const downloadDir = Platform.OS === 'android' ? RNFS.DownloadDirectoryPath + '/FlashDrop' : RNFS.DocumentDirectoryPath + '/FlashDrop';

    TransferClient.onStatus = (status: TransferStatus) => {
      if (status.type === 'log') setConnectionLog(status.message || '');
      if (status.type === 'connection' && status.connected) {
        setConnectionStatus('connected');
        (navigation as any).navigate('FileTransfer', { role: 'receiver', deviceName: ssid || 'Sender', initialFiles: [] });
      }
    };
    TransferClient.start(8888, downloadDir, ip);
  };

  const renderHeader = () => (
    <LinearGradient colors={['#7C4DFF', '#6200EA']} style={styles.header}>
      <View style={styles.headerContent}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Icon name="arrow-left" size={26} color="#FFF" /></TouchableOpacity>
        <Text style={styles.headerTitle}>Receive Files</Text>
        <View style={{ width: 26 }} />
      </View>
    </LinearGradient>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      {renderHeader()}

      <View style={styles.contentContainer}>
        <View style={styles.mainCard}>
          {activeTab === 'qr' ? (
            <View style={styles.scannerWrapper}>
              {hasPermission && device ? (
                <View style={styles.cameraFrame}>
                  <Camera style={StyleSheet.absoluteFill} device={device} isActive={connectionStatus === 'idle'} codeScanner={codeScanner} />
                  <Animated.View style={[styles.scanLine, { transform: [{ translateY: scanLineAnim }] }]} />
                </View>
              ) : <ActivityIndicator size="large" />}
              <Text style={styles.hintText}>Scan Sender's QR Code</Text>
            </View>
          ) : (
            <View style={styles.radarWrapper}>
                <Text style={styles.hintText}>Searching for senders...</Text>
                <FlatList 
                  data={wifiList}
                  keyExtractor={(item, index) => index.toString()}
                  renderItem={({ item }) => (
                      <TouchableOpacity style={styles.wifiItem} onPress={() => connectToHotspot(item.SSID)}>
                        <Icon name="wifi" size={20} color="#6200EA" />
                        <Text style={styles.wifiText}>{item.SSID}</Text>
                      </TouchableOpacity>
                    )}
                />
              </View>
          )}
        </View>

        <View style={styles.tabsContainer}>
          <TouchableOpacity style={[styles.tab, activeTab === 'qr' && styles.activeTab]} onPress={() => setActiveTab('qr')}>
            <Icon name="qrcode-scan" size={20} color={activeTab === 'qr' ? '#FFF' : '#8E8E93'} />
            <Text style={[styles.tabText, activeTab === 'qr' && { color: '#FFF' }]}>QR Scan</Text>
            </TouchableOpacity>
          <TouchableOpacity style={[styles.tab, activeTab === 'nearby' && styles.activeTab]} onPress={() => setActiveTab('nearby')}>
            <Icon name="radar" size={20} color={activeTab === 'nearby' ? '#FFF' : '#8E8E93'} />
            <Text style={[styles.tabText, activeTab === 'nearby' && { color: '#FFF' }]}>Nearby</Text>
            </TouchableOpacity>
        </View>
      </View>

      {connectionStatus === 'connecting' && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#FFF" />
          <Text style={styles.loadingTitle}>Connecting to Sender</Text>
          <Text style={styles.loadingLog}>{connectionLog}</Text>
          <Text style={styles.ipInfo}>Your IP: {localIp || 'Checking...'}</Text>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => { TransferClient.stop(); setConnectionStatus('idle'); }}>
            <Text style={{ color: '#FFF' }}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F0F2F5' },
  header: { height: 100, paddingTop: 40, paddingHorizontal: 15 },
  headerContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
  contentContainer: { flex: 1, padding: 15 },
  mainCard: { flex: 1, backgroundColor: '#FFF', borderRadius: 25, elevation: 5, overflow: 'hidden', padding: 20 },
  scannerWrapper: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cameraFrame: { width: 240, height: 240, borderRadius: 20, overflow: 'hidden', backgroundColor: '#000' },
  scanLine: { position: 'absolute', top: 20, left: 10, right: 10, height: 2, backgroundColor: '#FF3B30' },
  hintText: { marginTop: 20, fontSize: 15, color: '#333', fontWeight: 'bold' },
  radarWrapper: { flex: 1 },
  wifiItem: { flexDirection: 'row', alignItems: 'center', padding: 15, borderBottomWidth: 1, borderBottomColor: '#EEE' },
  wifiText: { marginLeft: 15, fontSize: 14, color: '#333' },
  tabsContainer: { flexDirection: 'row', marginTop: 20, gap: 10 },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 15, borderRadius: 15, backgroundColor: '#E0E0E0' },
  activeTab: { backgroundColor: '#6200EA' },
  tabText: { marginLeft: 10, fontWeight: 'bold', color: '#8E8E93' },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  loadingTitle: { color: '#FFF', fontSize: 18, fontWeight: 'bold', marginTop: 20 },
  loadingLog: { color: 'rgba(255,255,255,0.7)', fontSize: 13, marginTop: 10, textAlign: 'center' },
  ipInfo: { color: '#AAA', fontSize: 11, marginTop: 15 },
  cancelBtn: { marginTop: 30, padding: 12, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.2)' }
});

export default ReceiveScreen;
