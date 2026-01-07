import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Alert, ActivityIndicator, ScrollView } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';
import QRCode from 'react-native-qrcode-svg';
import WifiP2PManager from '../utils/WifiP2PManager';
import TransferServer from '../utils/TransferServer';

const SharingScreen = ({ route, navigation }: any) => {
    const { items } = route.params;
    const [status, setStatus] = useState('initializing');
    const [qrData, setQrData] = useState<string | null>(null);
    const [groupInfo, setGroupInfo] = useState<any>(null);

    useEffect(() => {
        setupHotspot();
        return () => {
            TransferServer.stop();
            WifiP2PManager.removeGroup();
        };
    }, []);

    const setupHotspot = async () => {
        try {
            setStatus('checking_connection');
            const { getConnectionInfo } = require('react-native-wifi-p2p');
            const conn = await getConnectionInfo();
            
            if (conn.groupFormed) {
                console.log("Group already formed, proceeding...");
            } else {
                setStatus('creating_hotspot');
                await WifiP2PManager.createGroup();
            }
            
            setStatus('getting_info');
            const info = await WifiP2PManager.getGroupInfoWithRetry();
            
            if (info) {
                setGroupInfo(info);
                const qr = JSON.stringify({
                    ssid: info.ssid,
                    pass: info.pass,
                    ip: info.ownerIp
                });
                setQrData(qr);
                
                // Start Server
                TransferServer.start(8888, items);
                setStatus('ready');
            } else {
                setStatus('error');
                Alert.alert("Error", "Failed to get Hotspot info.");
            }
        } catch (e) {
            console.log(e);
            setStatus('error');
            Alert.alert("Error", "Hotspot creation failed.");
        }
    };

    const renderStatus = () => {
        switch (status) {
            case 'initializing':
            case 'creating_hotspot':
                return "Initializing Hotspot...";
            case 'getting_info':
                return "Finalizing Settings...";
            case 'ready':
                return "Ready to Receive";
            case 'error':
                return "Hotspot Error";
            default:
                return "Sharing...";
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()}>
                    <Icon name="close" size={28} color="#333" />
                </TouchableOpacity>
                <Text style={styles.title}>Send Files</Text>
                <View style={{ width: 28 }} />
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                <View style={styles.card}>
                    <Text style={styles.statusLabel}>{renderStatus()}</Text>
                    
                    {status === 'ready' && qrData ? (
                        <View style={styles.qrContainer}>
                            <QRCode
                                value={qrData}
                                size={200}
                                color="#6200EA"
                                backgroundColor="white"
                            />
                            <Text style={styles.qrHint}>Ask the receiver to scan this QR code</Text>
                        </View>
                    ) : (
                        <View style={styles.loadingContainer}>
                            <ActivityIndicator size="large" color="#6200EA" />
                        </View>
                    )}

                    {groupInfo && (
                        <View style={styles.infoBox}>
                            <Text style={styles.infoTitle}>Connect Manually:</Text>
                            <Text style={styles.infoText}>SSID: {groupInfo.ssid}</Text>
                            <Text style={styles.infoText}>Password: {groupInfo.pass}</Text>
                        </View>
                    )}
                </View>

                <View style={styles.selectionCard}>
                    <Text style={styles.selectionTitle}>Sharing {items.length} items</Text>
                    <Text style={styles.selectionSub}>{items.map((i: any) => i.name).join(', ')}</Text>
                </View>
            </ScrollView>

            <TouchableOpacity style={styles.stopBtn} onPress={() => navigation.goBack()}>
                <Text style={styles.stopBtnText}>Cancel Sharing</Text>
            </TouchableOpacity>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F8F9FA' },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20 },
    title: { fontSize: 20, fontWeight: 'bold', color: '#1A1A1A' },
    content: { padding: 20 },
    card: { backgroundColor: '#FFF', borderRadius: 24, padding: 25, alignItems: 'center', elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 8 },
    statusLabel: { fontSize: 18, fontWeight: 'bold', color: '#6200EA', marginBottom: 20 },
    qrContainer: { padding: 20, backgroundColor: '#FFF', borderRadius: 16, alignItems: 'center' },
    qrHint: { marginTop: 15, fontSize: 14, color: '#666', textAlign: 'center' },
    loadingContainer: { height: 200, justifyContent: 'center' },
    infoBox: { marginTop: 20, width: '100%', padding: 15, backgroundColor: '#F3E5F5', borderRadius: 12 },
    infoTitle: { fontWeight: 'bold', color: '#6200EA', marginBottom: 5 },
    infoText: { color: '#333', fontSize: 13 },
    selectionCard: { marginTop: 20, padding: 20, backgroundColor: '#FFF', borderRadius: 20 },
    selectionTitle: { fontWeight: 'bold', color: '#333' },
    selectionSub: { color: '#888', fontSize: 12, marginTop: 5 },
    stopBtn: { margin: 20, backgroundColor: '#FF3B30', padding: 18, borderRadius: 15, alignItems: 'center' },
    stopBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 }
});

export default SharingScreen;
