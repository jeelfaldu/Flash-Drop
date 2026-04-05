import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions, StatusBar, Animated, ScrollView, Platform, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';
import { useTheme } from '../theme/ThemeContext';
import { useConnectionStore, useTransferStore } from '../store';
import CircularProgress from '../components/CircularProgress';
import { requestConnectPermissions } from '../utils/permissionHelper';
import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';
import { DisplayAds, ProdIDs } from '../utils/Constant';
import HapticUtil from '../utils/HapticUtil';
import WifiManager from 'react-native-wifi-reborn';
import WiFiDirectTransferServiceV2 from '../utils/WiFiDirectTransferServiceV2';

const adUnitId = __DEV__ ? TestIds.ADAPTIVE_BANNER : ProdIDs.ADAPTIVE_BANNER;

const { width } = Dimensions.get('window');

const HomeScreen = ({ navigation }: any) => {
  const { colors, isDark, toggleTheme, typography, layout } = useTheme();
  const { isConnected, ssid, resetConnection } = useConnectionStore();
  const { resetTransfer, isTransferring, transferStats, currentFiles } = useTransferStore();
  
  const fileCount = Object.keys(currentFiles).length;
  const overallProgress = (transferStats?.overallProgress || 0) * 100;

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const boltScale = useRef(new Animated.Value(1)).current;
  const boltRotate = useRef(new Animated.Value(0)).current;

  const [wifiEnabled, setWifiEnabled] = React.useState(true);

  useEffect(() => {
    const checkWifi = async () => {
      try {
        if (Platform.OS === 'android') {
          const enabled = await WifiManager.isEnabled();
          setWifiEnabled(enabled);
        }
      } catch (e) {
        console.log('WiFi check error:', e);
      }
    };

    checkWifi();
    const unsubscribe = navigation.addListener('focus', checkWifi);
    
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


  const DashboardCard = ({ title, subtitle, icon, color, onPress, isPrimary = false }: any) => {
    const cardWidth = (width - 48 - 16) / 2;
    const height = 180;

    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => {
          HapticUtil.light();
          if (onPress) onPress();
        }}
        style={[
          styles.dashboardCard,
          {
            width: cardWidth,
            height: height,
            backgroundColor: isPrimary ? color : (isDark ? colors.surface : '#FFFFFF'),
            borderColor: isPrimary ? color : (isDark ? colors.border : '#F0F0F0'),
            borderWidth: 1,
            ...layout.shadow.medium,
            shadowColor: isPrimary ? color : '#000',
            shadowOpacity: isPrimary ? 0.3 : 0.1,
          }
        ]}
      >
        {isPrimary && (
          <LinearGradient
            colors={[color, color + 'DF']}
            style={StyleSheet.absoluteFillObject}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          />
        )}
        <View style={styles.cardHeaderRow}>
          <View style={[styles.cardIconCtx, { 
            backgroundColor: isPrimary ? 'rgba(255,255,255,0.25)' : color + '15',
          }]}>
            <Icon name={icon} size={30} color={isPrimary ? '#FFF' : color} />
          </View>
          <Icon name="arrow-top-right" size={24} color={isPrimary ? 'rgba(255,255,255,0.5)' : colors.subtext} style={{ opacity: 0.5 }} />
        </View>

        <View style={styles.cardTextCtx}>
          <Text style={[styles.cardTitle, { 
            color: isPrimary ? '#FFF' : colors.text, 
            fontFamily: typography.fontFamily, 
          }]}>{title}</Text>
          <Text style={[styles.cardSubtitle, { 
            color: isPrimary ? 'rgba(255,255,255,0.85)' : colors.subtext, 
            fontFamily: typography.fontFamily 
          }]}>{subtitle}</Text>
        </View>

        {/* Decorative huge icon in background */}
        <Icon 
          name={icon} 
          size={110} 
          color={isPrimary ? '#FFF' : color} 
          style={[styles.bgHugeIcon, { opacity: isPrimary ? 0.15 : 0.04 }]} 
        />
      </TouchableOpacity>
    );
  };


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
          end={{ x: 1, y: 1.2 }}
        />
        <SafeAreaView>
          <View style={styles.headerContent}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
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
                <LinearGradient
                  colors={['rgba(255,255,255,0.3)', 'rgba(255,255,255,0.1)']}
                  style={styles.boltContainer}
                >
                  <Text style={styles.boltEmoji}>⚡</Text>
                </LinearGradient>
              </Animated.View>
              <View>
                <Text style={[styles.headerTitle, { fontFamily: typography.fontFamily }]}>FlashDrop</Text>
                <Text style={[styles.headerSubtitle, { fontFamily: typography.fontFamily }]}>Fastest File Transfer</Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {isTransferring && (
                <TouchableOpacity 
                   onPress={() => navigation.navigate('FileTransferV2')}
                   style={styles.progressHeaderBtn}
                >
                  <CircularProgress 
                    size={38} 
                    strokeWidth={3} 
                    progress={overallProgress} 
                    count={fileCount} 
                    color="#FFF" 
                  />
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => { HapticUtil.light(); toggleTheme(); }} style={styles.iconButton}>
                <Icon name={isDark ? "weather-sunny" : "weather-night"} size={22} color="#FFF" />
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* Connection Status Pill */}
        {isConnected ? (
          <Animated.View style={[
            styles.statusPill,
            {
              backgroundColor: isDark ? 'rgba(76, 175, 80, 0.15)' : '#E8F5E9',
              borderColor: isDark ? 'rgba(76, 175, 80, 0.4)' : '#C8E6C9',
              opacity: fadeAnim
            }
          ]}>
            <View style={styles.statusContent}>
              <View style={[styles.statusIconCircle, { backgroundColor: isDark ? 'rgba(76, 175, 80, 0.25)' : '#A5D6A7' }]}>
                <Icon name="wifi-strength-4" size={18} color={isDark ? '#81C784' : '#2E7D32'} />
              </View>
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={[styles.statusTitlePill, { color: isDark ? '#A5D6A7' : '#1B5E20', fontFamily: typography.fontFamily }]} numberOfLines={1}>
                  {ssid || 'Connected to Peer'}
                </Text>
                <Text style={[styles.statusSubPill, { color: isDark ? '#81C784' : '#388E3C', fontFamily: typography.fontFamily }]}>
                  Ready to transfer files
                </Text>
              </View>
              <TouchableOpacity onPress={() => { 
                HapticUtil.light();
                // Hard disconnect: tears down P2P group
                WiFiDirectTransferServiceV2.disconnect();
                resetTransfer();
                resetConnection();
              }} activeOpacity={0.7} style={[styles.disconnectPillBtn, { backgroundColor: isDark ? 'rgba(244, 67, 54, 0.2)' : '#FFCDD2' }]}>
                <Text style={[styles.disconnectText, { color: isDark ? '#EF5350' : '#C62828', fontFamily: typography.fontFamily }]}>Disconnect</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        ) : (
          <Animated.View
            style={[
              styles.statusPill,
              {
                backgroundColor: isDark ? 'rgba(52, 152, 219, 0.12)' : '#E3F2FD',
                borderColor: isDark ? 'rgba(52, 152, 219, 0.3)' : '#BBDEFB',
                opacity: fadeAnim,
              }
            ]}
          >
            <View style={styles.statusContent}>
              <View style={[styles.statusIconCircle, { backgroundColor: isDark ? 'rgba(52,152,219,0.25)' : '#90CAF9' }]}>
                <Icon name="link-variant-off" size={18} color={isDark ? '#64B5F6' : '#1565C0'} />
              </View>
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={[styles.statusTitlePill, { color: isDark ? '#90CAF9' : '#0D47A1', fontFamily: typography.fontFamily }]}>
                  Device not paired
                </Text>
                <Text style={[styles.statusSubPill, { color: isDark ? '#64B5F6' : '#1976D2', fontFamily: typography.fontFamily }]}>
                  {wifiEnabled ? 'Ready for connection' : 'WiFi is turned off'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  HapticUtil.light();
                  if (!wifiEnabled) {
                    if (Platform.OS === 'android') {
                      Linking.sendIntent('android.settings.WIFI_SETTINGS');
                    } else {
                      Linking.openURL('App-Prefs:root=WIFI');
                    }
                  } else {
                    navigation.navigate('ReceiveV2');
                  }
                }}
                activeOpacity={0.7}
                style={[styles.disconnectPillBtn, { backgroundColor: isDark ? 'rgba(52,152,219,0.25)' : '#90CAF9' }]}
              >
                <Text style={[styles.disconnectText, { color: isDark ? '#E3F2FD' : '#0D47A1', fontFamily: typography.fontFamily }]}>
                  {wifiEnabled ? 'Connect' : 'WiFi'}
                </Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}

        {/* Main Grid */}
        <Animated.View style={[styles.gridContainer, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <View style={styles.row}>
            <DashboardCard
              title="Send"
              subtitle="Share files quickly"
              icon="upload"
              color={colors.primary}
              isPrimary={true}
              onPress={() => navigation.navigate('Send', { v2: true })}
            />
            <DashboardCard
              title="Receive"
              subtitle="Get files securely"
              icon="download"
              color={colors.secondary}
              isPrimary={false}
              onPress={() => navigation.navigate('ReceiveV2')}
            />
          </View>

          {!isConnected && (
            <>
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionHeading, { color: colors.text, fontFamily: typography.fontFamily }]}>Quick Connect</Text>
                <View style={[styles.sectionDivider, { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)' }]} />
              </View>

              <TouchableOpacity
                style={[styles.pcShareRow, { backgroundColor: isDark ? colors.surface : '#FFFFFF', borderColor: isDark ? 'rgba(255,255,255,0.05)' : '#F0F0F0' }]}
                onPress={() => { HapticUtil.light(); navigation.navigate('PCConnectionV2'); }}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={['#009688', '#00796B']}
                  style={styles.pcShareIconBox}
                >
                  <Icon name="monitor-cellphone" size={28} color="#FFF" />
                </LinearGradient>
                <View style={styles.pcShareTextWrap}>
                  <Text style={[styles.pcShareTitle, { color: colors.text, fontFamily: typography.fontFamily }]}>PC Share</Text>
                  <Text style={[styles.pcShareSub, { color: colors.subtext, fontFamily: typography.fontFamily }]}>Connect from any web browser</Text>
                </View>
                <View style={[styles.pcShareChevron, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#F5F5F5' }]}>
                  <Icon name="arrow-right" size={20} color={isDark ? '#FFF' : '#455A64'} />
                </View>
              </TouchableOpacity>
            </>
          )}

          <View style={{ alignItems: 'center', marginTop: 30 }}>
            {DisplayAds && (
              <BannerAd
                unitId={adUnitId}
                size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
                requestOptions={{
                  requestNonPersonalizedAdsOnly: false,
                }}
              />
            )}
          </View>

          <View style={styles.listContainer}>
            <TouchableOpacity
              style={[styles.historyRow, { backgroundColor: isDark ? colors.surface : '#FFFFFF' }]}
              onPress={() => { HapticUtil.light(); navigation.navigate('History'); }}
              activeOpacity={0.8}
            >
              <LinearGradient 
                colors={isDark ? ['#333', '#222'] : ['#F5F7FA', '#E8ECF1']} 
                style={styles.historyIconWrap}
              >
                <Icon name="history" size={24} color={isDark ? '#E0E0E0' : '#455A64'} />
              </LinearGradient>
              <View style={{ flex: 1, paddingHorizontal: 16 }}>
                <Text style={[styles.historyTitle, { color: colors.text, fontFamily: typography.fontFamily }]}>Transfer History</Text>
                <Text style={[styles.historySub, { color: colors.subtext, fontFamily: typography.fontFamily }]}>View past sent & received files</Text>
              </View>
              <View style={[styles.chevronWrap, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F5F5F5' }]}>
                <Icon name="chevron-right" size={20} color={colors.subtext} />
              </View>
            </TouchableOpacity>
          </View>

          {/* Made with love in Bharat */}
          <View style={{ alignItems: 'center', marginTop: 40, marginBottom: 20 }}>
            <Text style={{ fontSize: 13, color: colors.subtext, fontFamily: typography.fontFamily, fontWeight: '500', opacity: 0.6, letterSpacing: 0.5 }}>
              MADE WITH ❤️ IN BHARAT
            </Text>
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
    paddingBottom: 20,
  },
  headerGradient: {
    ...StyleSheet.absoluteFillObject,
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'android' ? 56 : 24,
    paddingBottom: 20,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFF',
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.85)',
    letterSpacing: 0.2,
  },
  iconButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  progressHeaderBtn: {
    padding: 2,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  boltContainer: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  boltEmoji: {
    fontSize: 24,
  },
  scrollContent: {
    paddingBottom: 40,
    paddingHorizontal: 24,
  },
  statusPill: {
    borderRadius: 100,
    padding: 8,
    paddingRight: 12,
    marginVertical: 16,
    marginBottom: 0,
    borderWidth: 1,
  },
  statusContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  statusIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusTitlePill: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 1,
  },
  statusSubPill: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.9,
  },
  disconnectPillBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 30,
    marginLeft: 8,
  },
  disconnectText: {
    fontSize: 13,
    fontWeight: '700',
  },
  gridContainer: {
    gap: 20,
    marginTop: 24,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  dashboardCard: {
    borderRadius: 28,
    padding: 20,
    justifyContent: 'space-between',
    overflow: 'hidden',
    position: 'relative',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardIconCtx: {
    width: 56,
    height: 56,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTextCtx: {
    marginTop: 'auto',
  },
  cardTitle: {
    fontWeight: '800',
    fontSize: 24,
    marginBottom: 4,
    letterSpacing: -0.5,
  },
  cardSubtitle: {
    fontSize: 13,
    fontWeight: '500',
  },
  bgHugeIcon: {
    position: 'absolute',
    right: -25,
    bottom: -20,
    transform: [{ rotate: '-10deg' }],
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  sectionHeading: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  sectionDivider: {
    flex: 1,
    height: 1,
    marginLeft: 16,
  },
  pcShareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 24,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  pcShareIconBox: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pcShareTextWrap: {
    flex: 1,
    paddingHorizontal: 16,
  },
  pcShareTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  pcShareSub: {
    fontSize: 13,
    fontWeight: '500',
  },
  pcShareChevron: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContainer: {
    marginTop: 20,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'transparent', // Inherits shadow for depth or handled by parent
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
  },
  historyIconWrap: {
    width: 50,
    height: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2,
  },
  historySub: {
    fontSize: 13,
    fontWeight: '500',
    opacity: 0.7,
  },
  chevronWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default HomeScreen;
