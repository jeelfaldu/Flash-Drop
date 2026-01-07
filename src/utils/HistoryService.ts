import AsyncStorage from '@react-native-async-storage/async-storage';

export interface HistoryItem {
    id: string;
    fileName: string;
    fileSize: number;
    type: string; // 'image', 'video', 'app', 'other'
    timestamp: number;
    role: 'sent' | 'received';
    status: 'success' | 'failed';
}

const STORAGE_KEY = '@flashdrop_history';

export const saveHistoryItem = async (item: Omit<HistoryItem, 'id' | 'timestamp'>) => {
    try {
        const historyStr = await AsyncStorage.getItem(STORAGE_KEY);
        const history: HistoryItem[] = historyStr ? JSON.parse(historyStr) : [];
        
        const newItem: HistoryItem = {
            ...item,
            id: Date.now().toString(),
            timestamp: Date.now(),
        };
        
        const updatedHistory = [newItem, ...history];
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedHistory));
    } catch (e) {
        console.error("Failed to save history", e);
    }
};

export const getHistory = async (): Promise<HistoryItem[]> => {
    try {
        const historyStr = await AsyncStorage.getItem(STORAGE_KEY);
        return historyStr ? JSON.parse(historyStr) : [];
    } catch (e) {
        return [];
    }
};

export const clearHistory = async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
};
