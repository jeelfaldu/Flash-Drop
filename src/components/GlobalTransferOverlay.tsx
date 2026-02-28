import React, { useEffect, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Platform } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTransferStore } from '../store';
import { useTheme } from '../theme/ThemeContext';
import { navigationRef } from '../../App';
import { SafeAreaView } from 'react-native-safe-area-context';

export const GlobalTransferOverlay = () => {
  const { isTransferring, transferStats, role, deviceName } = useTransferStore();
  const { colors, typography, isDark, layout } = useTheme();

  const translateY = useRef(new Animated.Value(150)).current;
  const [currentRoute, setCurrentRoute] = useState('');

  // Subscribe to navigation state changes
  useEffect(() => {
    const checkRoute = () => {
      if (navigationRef.isReady()) {
        setCurrentRoute(navigationRef.getCurrentRoute()?.name || '');
      }
    };

    // Check initially
    checkRoute();

    // Polling is a fallback; `addListener` doesn't exist on navigationRef in the same way 
    // but React Navigation suggests using `onStateChange` on NavigationContainer.
    // For a drop-in component, polling is safe and cheap since it's just checking a ref.
    const interval = setInterval(checkRoute, 500);
    return () => clearInterval(interval);
  }, []);

  // Determine visibility
  const shouldShow = isTransferring && currentRoute !== 'FileTransfer';

  useEffect(() => {
    if (shouldShow) {
      Animated.spring(translateY, {
        toValue: 0,
        friction: 8,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(translateY, {
        toValue: 150,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [shouldShow, translateY]);

  if (!shouldShow && currentRoute === 'FileTransfer') {
    // Don't render if it's not showing AND we are on FileTransfer to save performance
    // However, keeping it around for the animation out is good.
  }

  const handlePress = () => {
    if (navigationRef.isReady()) {
      navigationRef.navigate('FileTransfer' as never);
    }
  };

  const isSending = role === 'sender';
  const accentColor = isSending ? colors.primary : colors.secondary;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          transform: [{ translateY }],
          paddingBottom: Platform.OS === 'ios' ? 24 : 16,
        },
      ]}
      pointerEvents={shouldShow ? 'box-none' : 'none'}
    >
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={handlePress}
        style={[
          styles.card,
          {
            backgroundColor: isDark ? colors.surface : '#FFFFFF',
            borderColor: isDark ? colors.border : '#F0F0F0',
            ...layout.shadow.medium,
          },
        ]}
      >
        <View style={styles.content}>
          <View style={[styles.iconContainer, { backgroundColor: accentColor + '20' }]}>
            <Icon 
              name={isSending ? "upload" : "download"}
              size={24}
              color={accentColor} 
            />
          </View>

          <View style={styles.textContainer}>
            <Text style={[styles.title, { color: colors.text, fontFamily: typography.fontFamily }]}>
              {isSending ? 'Sending to' : 'Receiving from'} {deviceName || 'Device'}
            </Text>

            <View style={styles.statsRow}>
              <Text style={[styles.statsText, { color: colors.subtext, fontFamily: typography.fontFamily }]}>
                {Math.round(transferStats.overallProgress * 100)}%
              </Text>
              <Text style={styles.dot}>•</Text>
              <Text style={[styles.statsText, { color: colors.subtext, fontFamily: typography.fontFamily }]}>
                {transferStats.transferSpeed}
              </Text>
            </View>

            <View style={[styles.progressBackground, { backgroundColor: isDark ? '#333' : '#E0E0E0' }]}>
              <View
                style={[
                  styles.progressFill,
                  {
                    backgroundColor: accentColor,
                    width: `${Math.min(100, Math.max(0, (transferStats.overallProgress || 0) * 100))}%`
                  }
                ]}
              />
            </View>
          </View>

          <TouchableOpacity style={styles.openButton} onPress={handlePress}>
            <Text style={[styles.openButtonText, { color: accentColor }]}>View</Text>
            <Icon name="chevron-right" size={20} color={accentColor} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    zIndex: 9999, // Ensure it's on top
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  statsText: {
    fontSize: 12,
  },
  dot: {
    color: '#9CA3AF',
    marginHorizontal: 6,
    fontSize: 12,
  },
  progressBackground: {
    marginTop: 2,
    width: '100%',
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  openButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
  },
  openButtonText: {
    fontSize: 14,
    fontWeight: '700',
  }
});

export default GlobalTransferOverlay;
