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
  
  const device = useCameraDevice('back');

  // Animations
  const scanLineAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    (async () => {
      const status = await Camera.requestCameraPermission();
      setHasPermission(status === 'granted');
      
      const connectPerm = await requestConnectPermissions();
      if (!connectPerm) {
          Alert.alert("Permission", "Nearby/Location permission is required to scan for hotspots.");
      }

      updateStorageInfo();
      startWifiScan();
    })();
    
    const interval = setInterval(startWifiScan, 10000);
    return () => {
        clearInterval(interval);
        TransferClient.stop();
    };
  }, []);

  useEffect(() => {
    if (activeTab === 'qr') {
      startQRAnimation();
    } else {
      startRadarAnimations();
    }
  }, [activeTab]);

  const updateStorageInfo = async () => {
    try {
      const total = await DeviceInfo.getTotalDiskCapacity();
      const free = await DeviceInfo.getFreeDiskStorage();
      const used = total - free;
      const totalGB = (total / (1024 * 1024 * 1024)).toFixed(2);
      const freeGB = (free / (1024 * 1024 * 1024)).toFixed(2);
      const usedGB = (used / (1024 * 1024 * 1024)).toFixed(2);
      setStorageInfo({
        free: freeGB + 'GB',
        total: totalGB + 'GB',
        percent: used / total
      });
    } catch (e) {
      console.log("Storage error:", e);
    }
  };

  const startQRAnimation = () => {
    scanLineAnim.setValue(0);
    Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineAnim, {
          toValue: 200,
          duration: 2500,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(scanLineAnim, {
          toValue: 0,
          duration: 2500,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      ])
    ).start();
  };

  const startRadarAnimations = () => {
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

  const startWifiScan = async () => {
      try {
          const result = await WifiManager.reScanAndLoadWifiList();
          let list = result;
          if (typeof result === 'string') {
              try { list = JSON.parse(result); } catch(e) { list = []; }
          }
          if (!Array.isArray(list)) return;

          const sorted = list.sort((a: any, b: any) => b.level - a.level);
          setWifiList(sorted);
      } catch (e) {
          console.log("Wifi Scan Error", e);
      }
  };

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
        if (connectionStatus === 'connected' || connectionStatus === 'connecting') return;
        if (codes.length > 0 && codes[0].value) {
          handleConnection(codes[0].value, 'qr');
        }
    },
  });

  const handleConnection = async (data: string, type: 'qr') => {
    if (type === 'qr') {
      try {
        const qr = JSON.parse(data);
        connectToHotspot(qr.ssid, qr.pass, qr.ip);
      } catch (e) {
        Alert.alert("Error", "Invalid QR");
      }
    }
  };

  const connectToHotspot = async (ssid: string, password?: string, ip?: string) => {
    setConnectionStatus('connecting');
      try {
        if (ssid) {
          await WifiP2PManager.connectToSSID(ssid, password);
          await new Promise(r => setTimeout(r, 2500)); 
        }
        connectToTransferServer(ssid, ip);
      } catch (e: any) {
        setConnectionStatus('error');
        Alert.alert("Connection Error", e.message || "Failed to connect to sender");
      }
  };
  
  const connectToTransferServer = (ssid?: string, ip?: string) => {
    const downloadDir = Platform.OS === 'android'
      ? RNFS.DownloadDirectoryPath + '/FlashDrop'
      : RNFS.DocumentDirectoryPath + '/FlashDrop';

    TransferClient.onStatus = (status: TransferStatus) => {
      if (status.type === 'connection' && status.connected) {
        setConnectionStatus('connected');
        (navigation as any).navigate('FileTransfer', {
          role: 'receiver',
          deviceName: ssid || 'Sender',
          initialFiles: []
        });
      }
    };
    TransferClient.start(8888, downloadDir, ip);
  };

  const renderHeader = () => (
    <LinearGradient colors={['#7C4DFF', '#6200EA']} style={styles.header}>
      <View style={styles.headerContent}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Icon name="arrow-left" size={26} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Receiver</Text>
        <TouchableOpacity style={styles.helpBtn}>
          <Icon name="help-circle-outline" size={26} color="#FFF" />
        </TouchableOpacity>
      </View>
    </LinearGradient>
  );

  const renderScanner = () => (
    <View style={styles.scannerWrapper}>
      <View style={styles.instructionsContainer}>
        <View style={styles.dot} />
        <Text style={styles.instructionsText}>Make sure your friend is in sending state.</Text>
      </View>

      <View style={styles.scannerBoxContainer}>
        {hasPermission && device ? (
          <View style={styles.cameraFrame}>
            <Camera
              style={StyleSheet.absoluteFill}
              device={device}
              isActive={activeTab === 'qr'}
              codeScanner={codeScanner}
            />

            {/* Frame UI */}
            <View style={styles.frameCornerTopLeft} />
            <View style={styles.frameCornerTopRight} />
            <View style={styles.frameCornerBottomLeft} />
            <View style={styles.frameCornerBottomRight} />

            <Animated.View
              style={[
                styles.scanLine,
                { transform: [{ translateY: scanLineAnim }] }
              ]}
            />
          </View>
        ) : (
          <View style={styles.noCamera}>
            <Icon name="camera-off" size={48} color="#CCC" />
            <Text style={{ color: '#999', marginTop: 10 }}>Camera not available</Text>
          </View>
        )}
      </View>

      <Text style={styles.hintText}>Connect by scanning QR code</Text>
    </View>
  );

  const rotation = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const renderRadar = () => (
    <View style={styles.radarWrapper}>
      <View style={styles.instructionsContainer}>
        <View style={styles.dot} />
        <Text style={styles.instructionsText}>Scanning for nearby senders...</Text>
      </View>

      <View style={styles.radarInner}>
        {/* Background Circles */}
        <View style={[styles.circle, { width: 260, height: 260, opacity: 0.1 }]} />
        <View style={[styles.circle, { width: 180, height: 180, opacity: 0.2 }]} />
        <View style={[styles.circle, { width: 100, height: 100, opacity: 0.3 }]} />

        {/* Pulsing Circles */}
        {[0, 1].map((i) => (
          <Animated.View
            key={i}
            style={[
              styles.pulseCircle,
              {
                opacity: pulseAnim.interpolate({
                  inputRange: [0, 0.5, 1],
                  outputRange: [0.3, 0.1, 0],
                }),
                transform: [{
                  scale: pulseAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.5, 2.5],
                  })
                }]
              }
            ]}
          />
        ))}

        {/* Rotating Sweep */}
        <Animated.View style={[styles.sweep, { transform: [{ rotate: rotation }] }]}>
          <LinearGradient
            colors={['rgba(98, 0, 234, 0.2)', 'transparent']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.sweepGradient}
          />
        </Animated.View>

        <View style={styles.centerDevice}>
          <Icon name="cellphone" size={32} color="#FFF" />
        </View>

        {Platform.OS === 'ios' && wifiList.length === 0 && (
          <View style={{ position: 'absolute', bottom: -40, width: '100%', alignItems: 'center' }}>
            <Text style={{ color: '#8E8E93', fontSize: 12, textAlign: 'center' }}>
              iOS hotspot discovery is limited.{"\n"}Try using QR Code for faster connection.
            </Text>
          </View>
        )}

        {/* Discovered Senders */}
        {wifiList.slice(0, 3).map((wifi, idx) => (
          <TouchableOpacity
            key={idx}
            style={[styles.discoveredDevice, {
              top: 20 + (idx * 60),
              left: idx % 2 === 0 ? 30 : 200
            }]}
            onPress={() => connectToHotspot(wifi.SSID)}
          >
            <View style={styles.deviceIcon}>
              <Icon name="cellphone" size={20} color="#FFF" />
            </View>
            <Text style={styles.deviceName} numberOfLines={1}>{wifi.SSID}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.hintText}>Tap on a device to connect</Text>
    </View>
  );

  const renderTransferProgress = () => (
    <View style={styles.transferWrapper}>
      <Text style={styles.transferTitle}>Receiving Files</Text>
      <FlatList
        data={Object.values(transferringFiles).reverse()}
        keyExtractor={(item) => item.name}
        renderItem={({ item }) => (
          <View style={styles.fileCard}>
            <View style={styles.fileInfo}>
              <Text style={styles.fileName} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.fileStatus}>
                {item.status === 'completed' ? 'Success' : `${Math.round(item.progress * 100)}%`}
              </Text>
            </View>
            <View style={styles.progressBarBg}>
              <LinearGradient
                colors={['#7C4DFF', '#6200EA']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={[styles.progressBarFill, { width: `${item.progress * 100}%` }]}
              />
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyTransfer}>
            <ActivityIndicator size="large" color="#6200EA" />
            <Text style={styles.emptyText}>Waiting for sender to start...</Text>
          </View>
        }
      />
      </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      {renderHeader()}
      
      <View style={styles.contentContainer}>
        <View style={styles.mainCard}>
          {connectionStatus === 'connected' ? (
            renderTransferProgress()
          ) : activeTab === 'qr' ? (
            renderScanner()
          ) : (
            renderRadar()
          )}
        </View>

        {connectionStatus !== 'connected' && (
          <View style={styles.tabsContainer}>
            <TouchableOpacity
              style={styles.tabItem}
              onPress={() => setActiveTab('nearby')}
            >
              <View style={[styles.tabContent, activeTab === 'nearby' && styles.tabActive]}>
                <Icon name="radar" size={20} color={activeTab === 'nearby' ? '#6200EA' : '#8E8E93'} />
                <Text style={[styles.tabText, activeTab === 'nearby' && styles.tabTextActive]}>Nearby</Text>
              </View>
            </TouchableOpacity>

            <Text style={styles.orText}>OR</Text>

            <TouchableOpacity
              style={styles.tabItem}
              onPress={() => setActiveTab('qr')}
            >
              <LinearGradient
                colors={activeTab === 'qr' ? ['#7C4DFF', '#6200EA'] : ['#F0F0F5', '#F0F0F5']}
                style={styles.tabGradient}
              >
                <Icon name="qrcode-scan" size={20} color={activeTab === 'qr' ? '#FFF' : '#8E8E93'} />
                <Text style={[styles.tabText, activeTab === 'qr' ? styles.tabTextWhite : styles.tabTextActive]}>QR Code</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}

        {connectionStatus !== 'connected' && (
          <View style={styles.storageFooter}>
            <View style={styles.storageHeader}>
              <Text style={styles.storageTitle}>Internal Storage</Text>
              <Text style={styles.storageStats}>
                <Text style={{ color: '#7C4DFF' }}>{storageInfo.free}</Text> / {storageInfo.total}
              </Text>
            </View>
            <View style={styles.storageBarBg}>
              <LinearGradient
                colors={['#7C4DFF', '#6200EA']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={[styles.storageBarFill, { width: `${storageInfo.percent * 100}%` }]}
              />
            </View>
          </View>
        )}
      </View>

      {connectionStatus === 'connecting' && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#FFF" />
          <Text style={{ color: '#FFF', marginTop: 15, fontWeight: 'bold' }}>Connecting to Sender...</Text>
        </View>
      )}
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

  contentContainer: { flex: 1, padding: 15, paddingBottom: 20 },
  mainCard: {
    flex: 1,
    backgroundColor: '#FFF',
    borderRadius: 25,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    overflow: 'hidden',
    marginBottom: 20
  },

  scannerWrapper: { flex: 1, alignItems: 'center', paddingTop: 25 },
  instructionsContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8F9FA', paddingHorizontal: 15, paddingVertical: 10, borderRadius: 20, marginBottom: 30 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#DDD', marginRight: 10 },
  instructionsText: { color: '#8E8E93', fontSize: 13 },

  scannerBoxContainer: { width: 240, height: 240, marginBottom: 30 },
  cameraFrame: { flex: 1, borderRadius: 30, overflow: 'hidden', backgroundColor: '#000' },
  noCamera: { flex: 1, backgroundColor: '#F0F0F5', borderRadius: 30, alignItems: 'center', justifyContent: 'center' },

  scanLine: { position: 'absolute', top: 20, left: 10, right: 10, height: 3, backgroundColor: '#FF3B30', borderRadius: 2, shadowColor: '#FF3B30', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 5 },

  frameCornerTopLeft: { position: 'absolute', top: 0, left: 0, width: 40, height: 40, borderTopWidth: 4, borderLeftWidth: 4, borderColor: '#555', borderTopLeftRadius: 20 },
  frameCornerTopRight: { position: 'absolute', top: 0, right: 0, width: 40, height: 40, borderTopWidth: 4, borderRightWidth: 4, borderColor: '#555', borderTopRightRadius: 20 },
  frameCornerBottomLeft: { position: 'absolute', bottom: 0, left: 0, width: 40, height: 40, borderBottomWidth: 4, borderLeftWidth: 4, borderColor: '#555', borderBottomLeftRadius: 20 },
  frameCornerBottomRight: { position: 'absolute', bottom: 0, right: 0, width: 40, height: 40, borderBottomWidth: 4, borderRightWidth: 4, borderColor: '#555', borderBottomRightRadius: 20 },

  hintText: { fontSize: 16, color: '#333', fontWeight: '500' },

  radarWrapper: { flex: 1, alignItems: 'center', paddingTop: 25 },
  radarInner: { width: 300, height: 300, justifyContent: 'center', alignItems: 'center', marginVertical: 30 },
  circle: { position: 'absolute', borderRadius: 150, borderWidth: 1, borderColor: '#6200EA' },
  pulseCircle: { position: 'absolute', width: 100, height: 100, borderRadius: 50, borderWidth: 1, borderColor: '#6200EA', backgroundColor: 'rgba(98, 0, 234, 0.1)' },
  sweep: { position: 'absolute', width: 260, height: 260, borderRadius: 130, overflow: 'hidden' },
  sweepGradient: { width: 130, height: 260, position: 'absolute', left: 130 },
  centerDevice: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#9575CD', alignItems: 'center', justifyContent: 'center', elevation: 4, zIndex: 10 },

  discoveredDevice: { position: 'absolute', alignItems: 'center', zIndex: 20 },
  deviceIcon: { width: 40, height: 40, borderRadius: 8, backgroundColor: '#2196F3', alignItems: 'center', justifyContent: 'center', elevation: 3 },
  deviceName: { fontSize: 10, color: '#333', marginTop: 5, fontWeight: 'bold', width: 60, textAlign: 'center' },

  tabsContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, marginBottom: 25 },
  tabItem: { flex: 1 },
  tabContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 30, backgroundColor: '#F8F9FA' },
  tabActive: { backgroundColor: '#F3E5F5' },
  tabGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 30, elevation: 2 },
  tabText: { fontWeight: 'bold', marginLeft: 8, fontSize: 14, color: '#8E8E93' },
  tabTextActive: { color: '#6200EA' },
  tabTextWhite: { color: '#FFF' },
  orText: { marginHorizontal: 15, color: '#8E8E93', fontWeight: 'bold', fontSize: 12 },

  storageFooter: { paddingHorizontal: 10 },
  storageHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  storageTitle: { fontSize: 15, fontWeight: 'bold', color: '#1A1A1A' },
  storageStats: { fontSize: 13, color: '#8E8E93' },
  storageBarBg: { height: 6, backgroundColor: '#E0E0E0', borderRadius: 3, overflow: 'hidden' },
  storageBarFill: { height: '100%', borderRadius: 3 },

  transferWrapper: { flex: 1, padding: 20 },
  transferTitle: { fontSize: 18, fontWeight: 'bold', color: '#333', marginBottom: 20 },
  fileCard: { backgroundColor: '#F8F9FA', padding: 15, borderRadius: 15, marginBottom: 12 },
  fileInfo: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  fileName: { fontWeight: 'bold', color: '#333', flex: 1, marginRight: 10 },
  fileStatus: { fontSize: 12, color: '#6200EA', fontWeight: 'bold' },
  progressBarBg: { height: 6, backgroundColor: '#E0E0E0', borderRadius: 3, overflow: 'hidden' },
  progressBarFill: { height: '100%', borderRadius: 3 },
  emptyTransfer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { marginTop: 15, color: '#8E8E93', fontSize: 15 },

  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' }
});

export default ReceiveScreen;
