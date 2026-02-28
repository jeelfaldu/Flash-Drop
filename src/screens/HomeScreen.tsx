import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions, StatusBar, Animated, ScrollView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';
import { useTheme } from '../theme/ThemeContext';
import { useConnectionStore } from '../store';
import { requestConnectPermissions } from '../utils/permissionHelper';

const { width } = Dimensions.get('window');

const HomeScreen = ({ navigation }: any) => {
  const { colors, isDark, toggleTheme, typography, layout } = useTheme();
  const { isConnected, ssid, resetConnection } = useConnectionStore();

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const boltScale = useRef(new Animated.Value(1)).current;
  const boltRotate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    requestConnectPermissions().catch(err => console.error(err));
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, friction: 8, useNativeDriver: true }),
    ]).start();

    // ⚡ Looping bolt animation: pulse scale + subtle rock
    Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(boltScale, { toValue: 1.25, duration: 700, useNativeDriver: true }),
          Animated.timing(boltRotate, { toValue: 1, duration: 700, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(boltScale, { toValue: 0.95, duration: 500, useNativeDriver: true }),
          Animated.timing(boltRotate, { toValue: -1, duration: 500, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(boltScale, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(boltRotate, { toValue: 0, duration: 400, useNativeDriver: true }),
        ]),
        Animated.delay(1800), // pause between pulses
      ])
    ).start();
  }, []);


  const DashboardCard = ({ title, subtitle, icon, color, onPress, size = 'large' }: any) => {
    // Width calculation: (Useable Width - Gap) / 2
    // Useable Width = Window Width - Horizontal Padding (24 * 2) = 48
    // Gap = 16
    const cardWidth = size === 'large' ? (width - 48 - 16) / 2 : (width - 48);
    const height = size === 'large' ? 160 : 80;

    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={onPress}
        style={[
          styles.dashboardCard,
          {
            width: cardWidth,
            height: height,
            backgroundColor: isDark ? colors.surface : colors.surface,
            borderColor: isDark ? colors.border : '#F0F0F0',
            borderWidth: 1,
            ...layout.shadow.medium
          }
        ]}
      >
        <View style={[styles.cardIconCtx, { backgroundColor: color + '15' }]}>
          <Icon name={icon} size={size === 'large' ? 32 : 24} color={color} />
        </View>
        <View style={styles.cardTextCtx}>
          <Text style={[styles.cardTitle, { color: colors.text, fontFamily: typography.fontFamily, fontSize: 17 }]}>{title}</Text>
          <Text style={[styles.cardSubtitle, { color: colors.subtext, fontFamily: typography.fontFamily }]}>{subtitle}</Text>
        </View>

        {/* Decorative corner */}
        <View style={[styles.cornerDeco, { backgroundColor: color, opacity: 0.08 }]} />
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" />
      <View style={styles.headerWrapper}>
        <LinearGradient
          colors={colors.gradient}
          style={styles.headerGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
        <SafeAreaView>
          <View style={styles.headerContent}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {/* ⚡ Animated Lightning Bolt */}
              <Animated.View
                style={{
                  transform: [
                    { scale: boltScale },
                    {
                      rotate: boltRotate.interpolate({
                        inputRange: [-1, 0, 1],
                        outputRange: ['-12deg', '0deg', '12deg'],
                      }),
                    },
                  ],
                }}
              >
                <View style={styles.boltContainer}>
                  <Text style={styles.boltEmoji}>⚡</Text>
                </View>
              </Animated.View>
              <View>
                <Text style={[styles.headerTitle, { fontFamily: typography.fontFamily }]}>FlashDrop</Text>
                <Text style={[styles.headerSubtitle, { fontFamily: typography.fontFamily }]}>Fastest File Transfer</Text>
              </View>
            </View>
            <TouchableOpacity onPress={toggleTheme} style={styles.iconButton}>
              <Icon name={isDark ? "weather-sunny" : "weather-night"} size={20} color="#FFF" />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* Connection Pill */}
        {isConnected ? (
          <Animated.View style={[styles.statusBanner, { backgroundColor: '#E8F5E9', borderColor: '#C8E6C9', borderWidth: 1, opacity: fadeAnim }]}>
            <View style={styles.statusContent}>
              <Icon name="wifi-check" size={24} color="#2E7D32" />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={styles.statusTitle}>Connected to {ssid}</Text>
                <Text style={styles.statusSub}>Tap to disconnect</Text>
              </View>
              <TouchableOpacity onPress={resetConnection} style={styles.disconnectBtn}>
                <Icon name="close" size={20} color="#2E7D32" />
              </TouchableOpacity>
            </View>
          </Animated.View>
        ) : (
          null
        )}

        {/* Main Grid */}
        <Animated.View style={[styles.gridContainer, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <View style={styles.row}>
            <DashboardCard
              title="Send"
              subtitle="Share Files"
              icon="upload"
              color={colors.primary}
              onPress={() => navigation.navigate('Send')}
            />
            <DashboardCard
              title="Receive"
              subtitle="Get Files"
              icon="download"
              color={colors.secondary}
              onPress={() => navigation.navigate('Receive')}
            />
          </View>

          <View style={styles.sectionLabel}>
            <Text style={[styles.label, { color: colors.subtext, fontFamily: typography.fontFamily }]}>QUICK CONNECT</Text>
            <View style={[styles.line, { backgroundColor: colors.border }]} />
          </View>

          <View style={[styles.quickActionCard, { backgroundColor: isDark ? colors.surface : colors.surface, borderColor: isDark ? colors.border : '#F0F0F0', ...layout.shadow.medium }]}>
            <TouchableOpacity style={styles.quickActionItem} onPress={() => navigation.navigate('Sharing', { items: [], mode: 'pairing' })}>
              <View style={[styles.quickActionIcon, { backgroundColor: isDark ? '#4A148C' : '#F3E5F5' }]}>
                <Icon name="qrcode" size={28} color={isDark ? '#CE93D8' : '#9C27B0'} />
              </View>
              <Text style={[styles.quickActionText, { color: colors.text }]}>Show QR</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.quickActionItem} onPress={() => navigation.navigate('Receive', { mode: 'connect' })}>
              <View style={[styles.quickActionIcon, { backgroundColor: isDark ? '#004D40' : '#E0F2F1' }]}>
                <Icon name="qrcode-scan" size={28} color={isDark ? '#80CBC4' : '#009688'} />
              </View>
              <Text style={[styles.quickActionText, { color: colors.text }]}>Scan QR</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.quickActionItem} onPress={() => navigation.navigate('PCConnection')}>
              <View style={[styles.quickActionIcon, { backgroundColor: isDark ? '#0D47A1' : '#E3F2FD' }]}>
                <Icon name="monitor-share" size={28} color={isDark ? '#90CAF9' : '#1976D2'} />
              </View>
              <Text style={[styles.quickActionText, { color: colors.text }]}>PC Share</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.listContainer}>
            <TouchableOpacity
              style={[styles.listItem, { backgroundColor: isDark ? colors.surface : '#FFF' }]}
              onPress={() => navigation.navigate('History')}
            >
              <View style={[styles.listIcon, { backgroundColor: '#E0E0E0' }]}>
                <Icon name="history" size={22} color="#616161" />
              </View>
              <View style={{ flex: 1, paddingHorizontal: 12 }}>
                <Text style={[styles.listTitle, { color: colors.text }]}>Transfer History</Text>
                <Text style={{ fontSize: 12, color: colors.subtext }}>View past activity</Text>
              </View>
              <Icon name="chevron-right" size={20} color={colors.subtext} />
            </TouchableOpacity>
          </View>

        </Animated.View>

      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerWrapper: {
    backgroundColor: 'transparent',
    zIndex: 10,
    paddingBottom: 20
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
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'android' ? 50 : 20,
    paddingBottom: 15,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFF',
    letterSpacing: -0.5
  },
  headerSubtitle: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.7)',
  },
  iconButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  boltContainer: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  boltEmoji: {
    fontSize: 22,
  },
  scrollContent: {
    paddingBottom: 40,
    paddingHorizontal: 24
  },
  statusBanner: {
    borderRadius: 16,
    padding: 20,
    marginBottom: 32,
  },
  statusContent: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  statusTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1B5E20'
  },
  statusSub: {
    fontSize: 12,
    color: '#388E3C'
  },
  disconnectBtn: {
    padding: 8,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center'
  },
  welcomeText: {
    fontSize: 18,
    fontWeight: '700'
  },
  gridContainer: {
    gap: 16,
    marginTop: 24
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  dashboardCard: {
    borderRadius: 24,
    padding: 20,
    justifyContent: 'space-between',
    position: 'relative',
    overflow: 'hidden'
  },
  cardIconCtx: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center'
  },
  cardTextCtx: {

  },
  cardTitle: {
    fontWeight: '700',
    marginBottom: 4
  },
  cardSubtitle: {
    fontSize: 12,
  },
  cornerDeco: {
    position: 'absolute',
    right: -20,
    top: -20,
    width: 80,
    height: 80,
    borderRadius: 40
  },
  quickActionCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 20,
    paddingHorizontal: 24,
    borderRadius: 24,
    borderWidth: 1,
  },
  quickActionItem: {
    alignItems: 'center',
    gap: 8,
  },
  quickActionIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  quickActionText: {
    fontSize: 13,
    fontWeight: '600',
  },
  sectionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    marginVertical: 8
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginRight: 12
  },
  line: {
    flex: 1,
    height: 1
  },
  listContainer: {
    marginTop: 24
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)'
  },
  listIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  listTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#E3F2FD',
    borderRadius: 6
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#1976D2'
  }
});

export default HomeScreen;
