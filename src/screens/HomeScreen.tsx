import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions, SafeAreaView, StatusBar } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../theme/ThemeContext';
import { useConnectionStore } from '../store';
import WifiP2PManager from '../utils/WifiP2PManager';
import DeviceInfo from 'react-native-device-info';
import { Platform } from 'react-native';

const { height } = Dimensions.get('window');

const HomeScreen = ({ navigation }: any) => {
  const { colors, isDark, toggleTheme, spacing, typography, layout } = useTheme();
  const { isConnected, ssid, resetConnection, setConnected, setConnectionDetails } = useConnectionStore();

  useEffect(() => {
    const checkExistingConnection = async () => {
      try {
        const connInfo: any = await WifiP2PManager.getConnectionInfo();
        if (connInfo && connInfo.groupFormed) {
          const ip = await DeviceInfo.getIpAddress();
          if (ip && ip !== '0.0.0.0' && ip !== '127.0.0.1') {
            setConnected(true);
            setConnectionDetails({
              type: 'wifi-direct',
              ssid: 'WiFi-Direct Group',
              ip: ip
            });
          }
        }
      } catch (e) {
        console.log('[HomeScreen] Connection check failed:', e);
      }
    };

    checkExistingConnection();
  }, []);

  console.log('[HomeScreen] Connection Status:', isConnected, 'SSID:', ssid);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* Header Section */}
      <View style={styles.headerWrapper}>
        <LinearGradient
          colors={colors.gradient}
          style={styles.headerGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
        <SafeAreaView>
          {isConnected && (
            <View style={styles.connectionStatusBar}>
              <Icon name="link-variant" size={16} color="#FFF" style={{ marginRight: 6 }} />
              <Text style={styles.connectionStatusText}>
                Connected to {ssid || 'Device'}
              </Text>
            </View>
          )}
          <View style={styles.headerContent}>
            <View>
              <Text style={[styles.greeting, { fontFamily: typography.fontFamily, color: '#FFF' }]}>Welcome to</Text>
              <Text style={[styles.title, { fontFamily: typography.fontFamily, color: '#FFF' }]}>Flash Drop</Text>
            </View>
            <View style={styles.headerIcons}>
              {isConnected && (
                <TouchableOpacity onPress={() => resetConnection()} style={[styles.iconButton, { backgroundColor: 'rgba(255,100,100,0.3)' }]}>
                  <Icon name="link-off" size={24} color="#FFF" />
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={toggleTheme} style={styles.iconButton}>
                <Icon name={isDark ? "weather-sunny" : "weather-night"} size={24} color="#FFF" />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => navigation.navigate('History')} style={styles.iconButton}>
                <Icon name="history" size={24} color="#FFF" />
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      </View>

      {/* Main Content */}
      <View style={styles.content}>
        <View style={[styles.card, { backgroundColor: colors.surface, ...layout.shadow.medium }]}>
          <Text style={[styles.cardTitle, { color: colors.text, fontFamily: typography.fontFamily }]}>File Transfer</Text>
          <Text style={[styles.cardSubtitle, { color: colors.subtext, fontFamily: typography.fontFamily }]}>
            Share files, images, videos & documents instantly
          </Text>

          <View style={styles.buttonRow}>
            {/* Send Button */}
            <TouchableOpacity 
              style={[styles.actionButton, { backgroundColor: isDark ? colors.border : '#E3F2FD', borderColor: isDark ? colors.border : '#BBDEFB' }]}
              onPress={() => navigation.navigate('Send')}
              activeOpacity={0.8}
            >
              <View style={[styles.iconContainer, { backgroundColor: isDark ? colors.surface : '#FFF' }]}>
                <Icon name="send" size={28} color={isDark ? colors.primary : "#2196F3"} />
              </View>
              <View style={styles.buttonTextContainer}>
                <Text style={[styles.buttonTitle, { color: colors.text, fontFamily: typography.fontFamily }]}>Send</Text>
                <Text style={[styles.buttonLabel, { color: colors.subtext, fontFamily: typography.fontFamily }]}>Transfer files</Text>
              </View>
            </TouchableOpacity>

            {/* Receive Button */}
            <TouchableOpacity 
              style={[styles.actionButton, { backgroundColor: isDark ? colors.border : '#FFF3E0', borderColor: isDark ? colors.border : '#FFE0B2' }]}
              onPress={() => navigation.navigate('Receive')}
              activeOpacity={0.8}
            >
              <View style={[styles.iconContainer, { backgroundColor: isDark ? colors.surface : '#FFF' }]}>
                <Icon name="download" size={28} color={isDark ? colors.secondary : "#FF9800"} />
              </View>
              <View style={styles.buttonTextContainer}>
                <Text style={[styles.buttonTitle, { color: colors.text, fontFamily: typography.fontFamily }]}>Receive</Text>
                <Text style={[styles.buttonLabel, { color: colors.subtext, fontFamily: typography.fontFamily }]}>Get files</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* Quick Actions / Recent (Placeholder for now) */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text, fontFamily: typography.fontFamily }]}>Recent Activity</Text>
          <View style={[styles.emptyState, { borderColor: colors.border }]}>
            <Icon name="clock-outline" size={40} color={colors.subtext} />
            <Text style={[styles.emptyText, { color: colors.subtext, fontFamily: typography.fontFamily }]}>No recent transfers</Text>
          </View>
        </View>

      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerWrapper: {
    height: height * 0.32,
    width: '100%',
    position: 'absolute',
    top: 0,
  },
  headerGradient: {
    ...StyleSheet.absoluteFillObject,
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 40,
  },
  connectionStatusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingVertical: 6,
    borderRadius: 12,
    marginHorizontal: 24,
    marginTop: 10,
  },
  connectionStatusText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
  greeting: {
    fontSize: 16,
    opacity: 0.9,
    fontWeight: '500',
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  headerIcons: {
    flexDirection: 'row',
    gap: 12,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    marginTop: height * 0.22,
    paddingHorizontal: 20,
    zIndex: 1,
  },
  card: {
    borderRadius: 28,
    padding: 24,
    marginBottom: 24,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
  },
  cardSubtitle: {
    fontSize: 14,
    marginBottom: 24,
    lineHeight: 20,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 16,
  },
  actionButton: {
    flex: 1,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
  },
  iconContainer: {
    width: 52,
    height: 52,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  buttonTextContainer: {
    gap: 2,
  },
  buttonTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  buttonLabel: {
    fontSize: 12,
  },
  section: {
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
    marginLeft: 4,
  },
  emptyState: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 20,
    height: 120,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    fontSize: 14,
  }
});

export default HomeScreen;

