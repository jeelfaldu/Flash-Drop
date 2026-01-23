import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, StatusBar, TouchableOpacity, SafeAreaView, Platform } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { getHistory, clearHistory, HistoryItem } from '../utils/HistoryService';
import { useTheme } from '../theme/ThemeContext';

const HistoryScreen = ({ navigation }: any) => {
  const { colors, typography, spacing, layout, isDark } = useTheme();
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
      return 'file-document';
    };

    const renderItem = ({ item }: { item: HistoryItem }) => (
      <View style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          ...layout.shadow.light
        }
      ]}>
        <View style={[
          styles.iconBox,
          {
            backgroundColor: item.role === 'sent' ? colors.success + '15' : colors.secondary + '15'
          }
        ]}>
                <Icon 
                    name={getIcon(item.type)} 
                    size={24} 
            color={item.role === 'sent' ? colors.success : colors.secondary} 
                />
            </View>
            <View style={styles.details}>
          <Text style={[styles.fileName, { color: colors.text, fontFamily: typography.fontFamily }]} numberOfLines={1}>
            {item.fileName}
          </Text>
          <Text style={[styles.subText, { color: colors.subtext, fontFamily: typography.fontFamily }]}>
                    {(item.fileSize / 1024 / 1024).toFixed(2)} MB • {new Date(item.timestamp).toLocaleDateString()}
                </Text>
            </View>
            <View style={styles.statusBox}>
                <Icon 
                    name={item.role === 'sent' ? 'arrow-up-circle' : 'arrow-down-circle'} 
                    size={20} 
            color={item.role === 'sent' ? colors.success : colors.secondary} 
                />
            </View>
        </View>
    );

    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
            
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
              <Text style={[styles.headerTitle, { fontFamily: typography.fontFamily }]}>History</Text>
              <TouchableOpacity onPress={handleClear} style={styles.iconButton}>
                <Icon name="trash-can-outline" size={24} color="#FFCDD2" />
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </View>

        <View style={styles.content}>
          <FlatList
            data={history}
            keyExtractor={item => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Icon name="history" size={64} color={colors.subtext} />
                <Text style={[styles.emptyText, { color: colors.subtext, fontFamily: typography.fontFamily }]}>
                  No History Yet
                </Text>
              </View>
            }
          />
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
  content: {
    flex: 1,
    marginTop: 10,
  },
  list: {
    padding: 20,
    paddingTop: 10,
  },
    card: { 
        flexDirection: 'row', 
        alignItems: 'center', 
      padding: 16,
      borderRadius: 20, 
        marginBottom: 12,
      borderWidth: 1,
    },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16
  },
    details: { flex: 1 },
  fileName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4
  },
  subText: {
    fontSize: 12,
    fontWeight: '400'
  },
    statusBox: { marginLeft: 10 },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 100,
    opacity: 0.7
  },
  emptyText: {
    marginTop: 16,
    fontSize: 16
  }
});

export default HistoryScreen;
