import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Alert, TouchableOpacity, ScrollView, ActivityIndicator, FlatList, Platform } from 'react-native';
import { Camera, useCameraDevice, useCodeScanner } from 'react-native-vision-camera';
import WifiManager from 'react-native-wifi-reborn';
import TransferClient, { TransferStatus } from '../utils/TransferClient';
import WifiP2PManager from '../utils/WifiP2PManager';
import { requestConnectPermissions } from '../utils/permissionHelper';
import RNFS from 'react-native-fs';

interface TransferringFile {
    name: string;
    size: number;
    progress: number;
    status: 'pending' | 'downloading' | 'completed' | 'error';
}

const ReceiveScreen = () => {
  const [hasPermission, setHasPermission] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [wifiList, setWifiList] = useState<any[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<string>('idle'); 
  const [transferringFiles, setTransferringFiles] = useState<Record<string, TransferringFile>>({});
  
  const device = useCameraDevice('back');
  
  useEffect(() => {
    (async () => {
      const status = await Camera.requestCameraPermission();
      setHasPermission(status === 'granted');
      
      const connectPerm = await requestConnectPermissions();
      if (!connectPerm) {
          Alert.alert("Permission", "Nearby/Location permission is required to scan for hotspots.");
      }

      try {
        const wifiEnabled = await WifiManager.isEnabled();
        if (!wifiEnabled) {
            Alert.alert("Wi-Fi Required", "Enabled Wi-Fi to scan for Sender.");
            await WifiManager.setEnabled(true);
        }
      } catch(e) { console.log(e); }

      startWifiScan();
    })();
    
    const interval = setInterval(startWifiScan, 10000);
    return () => {
        clearInterval(interval);
        TransferClient.stop();
    };
  }, []);

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

  const addLog = (msg: string) => {
    setLogs(prev => [msg, ...prev.slice(0, 50)]);
  };

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
        if (connectionStatus === 'connected' || connectionStatus === 'connecting') return;
        if (codes.length > 0 && codes[0].value) {
            handleConnection(codes[0].value, 'qr');
            setIsScanning(false);
        }
    },
  });

  const handleWifiPress = (network: any) => {
      Alert.prompt(
          `Connect to ${network.SSID}`,
          "Enter Hotspot Password",
          [
              { text: "Cancel", style: "cancel" },
              { text: "Connect", onPress: (password) => connectToHotspot(network.SSID, password) }
          ],
          "plain-text"
      );
  };
  
  const connectToHotspot = async (ssid: string, password?: string) => {
      setConnectionStatus('connecting');
      addLog(`Connecting to ${ssid}...`);
      
      try {
          await WifiP2PManager.connectToSSID(ssid, password);
          addLog(`Joined Wi-Fi. Stabilizing...`);
          await new Promise(r => setTimeout(r, 2500)); 
          connectToTransferServer();
      } catch (e: any) {
          addLog("Connection Failed: " + (e.message || e));
          setConnectionStatus('error');
      }
  };
  
  const connectToTransferServer = () => { 
      addLog(`Locating Sender...`);
      const downloadDir = RNFS.DownloadDirectoryPath + '/FlashDrop';
          
      TransferClient.start(8888, downloadDir, (status: TransferStatus) => {
             if (status.type === 'log' && status.message) {
                 addLog(status.message);
             }
             if (status.type === 'connection' && status.connected) {
                 setConnectionStatus('connected');
             }
             if (status.type === 'progress' && status.fileProgress) {
                 const { name, percent } = status.fileProgress;
                 setTransferringFiles(prev => ({
                     ...prev,
                     [name]: {
                         ...prev[name],
                         name,
                         progress: percent / 100,
                         status: percent === 100 ? 'completed' : 'downloading'
                     }
                 }));
             }
             if (status.files) {
                 setTransferringFiles(prev => {
                     const next = { ...prev };
                     status.files?.forEach(f => {
                         if (!next[f.name]) {
                             next[f.name] = { name: f.name, size: f.size, progress: 0, status: 'pending' };
                         }
                     });
                     return next;
                 });
             }
      });
  };

  const handleConnection = async (data: string, type: 'qr') => {
      if (type === 'qr') {
          try {
              const qr = JSON.parse(data);
              connectToHotspot(qr.ssid, qr.pass);
          } catch(e) {
              Alert.alert("Error", "Invalid QR");
          }
      }
  };

  const renderFileItem = ({ item }: { item: TransferringFile }) => (
      <View style={styles.fileCard}>
          <View style={styles.fileInfo}>
              <Text style={styles.fileName} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.fileStatus}>
                  {item.status === 'completed' ? '✅ Done' : 
                   item.status === 'downloading' ? `Downloading ${Math.round(item.progress * 100)}%` : 
                   'Pending'}
              </Text>
          </View>
          <View style={styles.progressBarBg}>
             <View style={[styles.progressBarFill, { width: `${item.progress * 100}%` }]} />
          </View>
      </View>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Receive Files</Text>
      
      {isScanning && hasPermission && device ? (
         <View style={styles.scannerContainer}>
            <Camera
              style={StyleSheet.absoluteFill}
              device={device}
              isActive={true}
              codeScanner={codeScanner}
            />
            <TouchableOpacity style={styles.closeButton} onPress={() => setIsScanning(false)}>
              <Text style={styles.buttonText}>Close Scanner</Text>
            </TouchableOpacity>
         </View>
      ) : connectionStatus === 'connected' ? (
          <View style={{flex: 1}}>
              <Text style={styles.subHeader}>Transfer Progress</Text>
              <FlatList
                data={Object.values(transferringFiles).reverse()}
                keyExtractor={(item) => item.name}
                renderItem={renderFileItem}
                ListEmptyComponent={<Text style={{textAlign: 'center', marginTop: 20}}>Waiting for files...</Text>}
              />
          </View>
      ) : (
         <View style={{flex:1}}>
            <View style={styles.topControls}>
                <TouchableOpacity style={styles.scanButton} onPress={() => setIsScanning(true)}>
                  <Text style={styles.buttonText}>Scan QR Code</Text>
                </TouchableOpacity>
            </View>

            <Text style={styles.subHeader}>Available Hotspots</Text>
            {wifiList.length === 0 ? (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color="#4CD964" />
                    <Text style={{marginTop: 10, color: '#666'}}>Scanning for Sender...</Text>
                </View>
            ) : (
                <FlatList
                    data={wifiList}
                    keyExtractor={(item) => item.BSSID || item.SSID}
                    renderItem={({ item }) => (
                        <TouchableOpacity style={styles.peerItem} onPress={() => handleWifiPress(item)}>
                            <View>
                                <Text style={styles.peerName}>{item.SSID}</Text>
                                <Text style={styles.peerAddress}>Signal: {item.level}dBm</Text>
                            </View>
                        </TouchableOpacity>
                    )}
                />
            )}
         </View>
      )}

      <ScrollView style={styles.logContainer}>
        {logs.map((log, index) => (
          <Text key={index} style={styles.logText}>{log}</Text>
        ))}
      </ScrollView>
      
      <View style={styles.statusFooter}>
          <Text style={styles.statusText}>Status: {connectionStatus.toUpperCase()}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#f0f0f5' },
  header: { fontSize: 28, fontWeight: 'bold', marginBottom: 20, color: '#1a1a1a' },
  subHeader: { fontSize: 18, fontWeight: '600', marginTop: 10, marginBottom: 15, color: '#333' },
  scannerContainer: { flex: 1, borderRadius: 15, overflow: 'hidden', backgroundColor: 'black' },
  scanButton: { backgroundColor: '#4CD964', padding: 15, borderRadius: 12, alignItems: 'center', marginBottom: 10 },
  buttonText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  closeButton: { position: 'absolute', bottom: 30, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.7)', padding: 15, borderRadius: 25 },
  peerItem: { padding: 18, backgroundColor: 'white', borderRadius: 12, marginBottom: 12, elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4 },
  peerName: { fontSize: 17, fontWeight: 'bold', color: '#333' },
  peerAddress: { fontSize: 13, color: '#888', marginTop: 4 },
  logContainer: { maxHeight: 100, marginTop: 15, backgroundColor: '#fff', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#ddd' },
  logText: { fontSize: 11, color: '#666', marginBottom: 2 },
  statusFooter: { marginTop: 12, padding: 10, backgroundColor: '#fff', borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#ddd' },
  statusText: { fontWeight: 'bold', color: '#4CD964' },
  topControls: { marginBottom: 10 },
  loadingContainer: { padding: 40, alignItems: 'center' },
  fileCard: { backgroundColor: 'white', padding: 15, borderRadius: 12, marginBottom: 12, elevation: 2 },
  fileInfo: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  fileName: { fontWeight: 'bold', color: '#333', flex: 1, marginRight: 10 },
  fileStatus: { fontSize: 12, color: '#666' },
  progressBarBg: { height: 8, backgroundColor: '#e0e0e0', borderRadius: 4, overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: '#4CD964' }
});

export default ReceiveScreen;
