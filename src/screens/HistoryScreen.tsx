import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, StatusBar, TouchableOpacity } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { getHistory, clearHistory, HistoryItem } from '../utils/HistoryService';

const HistoryScreen = ({ navigation }: any) => {
    const [history, setHistory] = useState<HistoryItem[]>([]);

    useEffect(() => {
        loadHistory();
    }, []);

    const loadHistory = async () => {
        const data = await getHistory();
        setHistory(data);
    };

    const handleClear = async () => {
        await clearHistory();
        loadHistory();
    };

    const getIcon = (type: string) => {
        if (type.includes('image')) return 'image';
        if (type.includes('video')) return 'video';
        if (type.includes('application')) return 'android';
        return 'file';
    };

    const renderItem = ({ item }: { item: HistoryItem }) => (
        <View style={styles.card}>
            <View style={[styles.iconBox, { backgroundColor: item.role === 'sent' ? 'rgba(76, 217, 100, 0.1)' : 'rgba(0, 209, 255, 0.1)' }]}>
                <Icon 
                    name={getIcon(item.type)} 
                    size={24} 
                    color={item.role === 'sent' ? '#4CD964' : '#00D1FF'} 
                />
            </View>
            <View style={styles.details}>
                <Text style={styles.fileName} numberOfLines={1}>{item.fileName}</Text>
                <Text style={styles.subText}>
                    {(item.fileSize / 1024 / 1024).toFixed(2)} MB • {new Date(item.timestamp).toLocaleDateString()}
                </Text>
            </View>
            <View style={styles.statusBox}>
                <Icon 
                    name={item.role === 'sent' ? 'arrow-up-circle' : 'arrow-down-circle'} 
                    size={20} 
                    color={item.role === 'sent' ? '#4CD964' : '#00D1FF'} 
                />
            </View>
        </View>
    );

    return (
        <View style={styles.container}>
            <LinearGradient colors={['#1F1F1F', '#000']} style={StyleSheet.absoluteFillObject} />
            <StatusBar barStyle="light-content" />
            
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <Icon name="arrow-left" size={28} color="#FFF" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>History</Text>
                <TouchableOpacity onPress={handleClear} style={styles.clearBtn}>
                    <Icon name="trash-can-outline" size={24} color="#FF3B30" />
                </TouchableOpacity>
            </View>

            <FlatList
                data={history}
                keyExtractor={item => item.id}
                renderItem={renderItem}
                contentContainerStyle={styles.list}
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <Icon name="history" size={60} color="#333" />
                        <Text style={styles.emptyText}>No History Yet</Text>
                    </View>
                }
            />
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#000' },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, paddingTop: 50 },
    headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#FFF' },
    backBtn: { padding: 5 },
    clearBtn: { padding: 5 },
    list: { padding: 20 },
    card: { 
        flexDirection: 'row', 
        alignItems: 'center', 
        backgroundColor: '#1E1E1E', 
        padding: 15, 
        borderRadius: 16, 
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#333'
    },
    iconBox: { width: 50, height: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 15 },
    details: { flex: 1 },
    fileName: { color: '#FFF', fontSize: 16, fontWeight: '600', marginBottom: 4 },
    subText: { color: '#888', fontSize: 12 },
    statusBox: { marginLeft: 10 },
    emptyContainer: { alignItems: 'center', marginTop: 100 },
    emptyText: { color: '#555', marginTop: 10, fontSize: 16 }
});

export default HistoryScreen;
