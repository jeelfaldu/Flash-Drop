import React, { useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, StatusBar, TouchableOpacity, SafeAreaView, Platform, Alert, Image } from 'react-native';
import FastImage from 'react-native-fast-image';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import RNFS from 'react-native-fs';
import { useTheme } from '../theme/ThemeContext';
import { useHistoryStore } from '../store';
import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';

const adUnitId = __DEV__ ? TestIds.ADAPTIVE_BANNER : 'ca-app-pub-3940256099942544/6300978111';

const HistoryScreen = ({ navigation }: any) => {
  const { colors, typography, spacing, layout, isDark } = useTheme();
  const { activeTab, setActiveTab, filteredHistory, loadHistory, clearAll } = useHistoryStore();

  useEffect(() => {
    loadHistory();
  }, []);

  const handleClear = () => {
    Alert.alert(
      "Clear History",
      "Are you sure you want to delete all transfer history?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear All",
          style: "destructive",
          onPress: () => clearAll(),
        }
      ]
    );
  };




  const getIcon = (type: string) => {
    const t = type?.toLowerCase() || '';
    if (t.includes('image')) return 'image';
    if (t.includes('video')) return 'movie-play';
    if (t.includes('audio')) return 'music';
    if (t.includes('application') || t.includes('apk')) return 'android';
    return 'file-document';
  };

  const getIconColor = (type: string) => {
    const t = type?.toLowerCase() || '';
    if (t.includes('image')) return colors.primary;
    if (t.includes('video')) return '#FF5252';
    if (t.includes('audio')) return '#00B0FF';
    if (t.includes('application') || t.includes('apk')) return '#69F0AE';
    return '#FFB300'; // amber for generic files — matches warm palette
  };

  const getRelativeDate = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return new Date(timestamp).toLocaleDateString();
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const s = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
  };

  const renderItem = ({ item }: { item: ReturnType<typeof filteredHistory>[number] }) => (
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
          backgroundColor: getIconColor(item.type) + '18'
        }
      ]}>
        {item.type?.toLowerCase().includes('image') && item.role === 'received' && item.fileName ? (
          <FastImage
            style={styles.imagePreview}
            source={{
              uri: Platform.OS === 'android'
                ? `file://${RNFS.ExternalDirectoryPath}/FlashDrop/${item.fileName}`
                : `file://${RNFS.DocumentDirectoryPath}/FlashDrop/${item.fileName}`,
              priority: FastImage.priority.normal,
            }}
            resizeMode={FastImage.resizeMode.cover}
          />
        ) : (
            <Icon
              name={getIcon(item.type)}
              size={24}
              color={getIconColor(item.type)}
            />
        )}
      </View>
      <View style={styles.details}>
        <Text style={[styles.fileName, { color: colors.text, fontFamily: typography.fontFamily }]} numberOfLines={1}>
          {item.fileName}
        </Text>
        <Text style={[styles.subText, { color: colors.subtext, fontFamily: typography.fontFamily }]}>
          {formatSize(item.fileSize)} • {getRelativeDate(item.timestamp)}
        </Text>
      </View>
      <View style={[
        styles.statusBadge,
        {
          backgroundColor: item.role === 'sent'
            ? colors.success + '18'
            : colors.primary + '18'
        }
      ]}>
        <Icon
          name={item.role === 'sent' ? 'arrow-up' : 'arrow-down'}
          size={12}
          color={item.role === 'sent' ? colors.success : colors.primary}
        />
        <Text style={[
          styles.statusText,
          {
            color: item.role === 'sent' ? colors.success : colors.primary,
            textTransform: 'capitalize'
          }
        ]}>
          {item.role}
        </Text>
      </View>
    </View>
  );

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
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconButton}>
              <Icon name="arrow-left" size={24} color="#FFF" />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { fontFamily: typography.fontFamily }]}>Transfer History</Text>
            <TouchableOpacity onPress={handleClear} style={styles.iconButton}>
              <Icon name="trash-can-outline" size={24} color="#FFF" />
            </TouchableOpacity>
          </View>

          <View style={styles.tabBar}>
            {[
              { id: 'all', label: 'All', icon: 'history' },
              { id: 'sent', label: 'Sent', icon: 'arrow-up-bold-circle' },
              { id: 'received', label: 'Received', icon: 'arrow-down-bold-circle' },
            ].map(tab => (
              <TouchableOpacity
                key={tab.id}
                onPress={() => setActiveTab(tab.id as any)}
                style={[styles.tabItem, activeTab === tab.id && styles.activeTabItem]}
              >
                <Icon
                  name={tab.icon}
                  size={18}
                  color={activeTab === tab.id ? '#FFF' : 'rgba(255,255,255,0.6)'}
                />
                <Text style={[
                  styles.tabText,
                  activeTab === tab.id ? { color: '#FFF' } : { color: 'rgba(255,255,255,0.6)' }
                ]}>
                  {tab.label}
                </Text>
                {activeTab === tab.id && <View style={styles.tabIndicator} />}
              </TouchableOpacity>
            ))}
          </View>
        </SafeAreaView>
      </View>

      <View style={styles.content}>
        <View style={{ alignItems: 'center', marginVertical: 10 }}>
          <BannerAd
            unitId={adUnitId}
            size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
            requestOptions={{
              requestNonPersonalizedAdsOnly: false,
            }}
          />
        </View>
        <FlatList
          data={filteredHistory()}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={[styles.emptyIconBox, { backgroundColor: colors.border }]}>
                <Icon name="history" size={64} color={colors.subtext} />
              </View>
              <Text style={[styles.emptyText, { color: colors.text, fontFamily: typography.fontFamily }]}>
                {activeTab === 'all' ? 'No History Yet' : `No ${activeTab} files`}
              </Text>
              <Text style={{ color: colors.subtext, marginTop: 8, textAlign: 'center' }}>
                Files you shared or received will appear here.
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
    height: 160,
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
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 15,
    marginTop: 5,
  },
  tabItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginRight: 10,
  },
  activeTabItem: {
    // Styling handled via opacity and indicators
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    left: 16,
    right: 16,
    height: 3,
    backgroundColor: '#FFF',
    borderRadius: 2,
  },
  content: {
    flex: 1,
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
    marginRight: 16,
    overflow: 'hidden',
  },
  imagePreview: {
    width: '100%',
    height: '100%',
    borderRadius: 14,
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
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 4,
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 80,
    paddingHorizontal: 40,
  },
  emptyIconBox: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    opacity: 0.5,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  }
});

export default HistoryScreen;
