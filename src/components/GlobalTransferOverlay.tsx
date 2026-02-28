import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
  Platform
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';
import { useTransferStore } from '../store';
import { useConnectionStore } from '../store';
import { useTheme } from '../theme/ThemeContext';
import { navigationRef } from '../../App';

const { width } = Dimensions.get('window');

const GlobalTransferOverlay = () => {
  const { colors, layout } = useTheme();
  const { isTransferring, transferStats, role, deviceName } = useTransferStore();
  const { isConnected } = useConnectionStore();
  const [currentRoute, setCurrentRoute] = React.useState<string | null>(null);

  // Animation values
  const slideAnim = useRef(new Animated.Value(100)).current; // start off-screen (below)
  const opacityAnim = useRef(new Animated.Value(0)).current;

  // Track current route for hiding overlay on FileTransfer screen
  useEffect(() => {
    const updateRoute = () => {
      try {
        if (navigationRef.isReady()) {
          const route = navigationRef.getCurrentRoute();
          setCurrentRoute(route ? route.name : null);
        }
      } catch (_) { }
    };

    updateRoute();

    // Use navigation listener instead of polling
    let unsubscribe: (() => void) | undefined;
    if (navigationRef.isReady()) {
      unsubscribe = navigationRef.addListener('state', updateRoute);
    }

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Determine whether overlay should be visible
  const progress = transferStats?.overallProgress ?? 0;
  const isCompleted = progress >= 1 && progress > 0;
  const onTransferScreen = currentRoute === 'FileTransfer';
  // Guard: only show if actively transferring AND actually connected to a device
  const shouldShow = isTransferring && isConnected && !onTransferScreen && !isCompleted;

  // Animate in/out
  useEffect(() => {
    if (shouldShow) {
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 60,
          friction: 10,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 100,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [shouldShow]);

  if (!isTransferring) return null; // Don't render at all if not transferring

  const progressPct = Math.round(progress * 100);
  return null;
  return (
    <Animated.View
      pointerEvents={shouldShow ? 'auto' : 'none'}
      style={[
        styles.container,
        {
          bottom: Platform.OS === 'ios' ? 40 : 20,
          transform: [{ translateY: slideAnim }],
          opacity: opacityAnim,
        },
      ]}
    >
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => {
          if (navigationRef.isReady()) {
            (navigationRef as any).navigate('FileTransfer', { role, deviceName });
          }
        }}
        style={[styles.content, { backgroundColor: colors.surface, ...layout.shadow.medium }]}
      >
        {/* Progress bar at bottom */}
        <LinearGradient
          colors={colors.gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.progressBg}
        >
          <View
            style={[
              styles.progressFill,
              { width: `${100 - progressPct}%`, backgroundColor: colors.surface },
            ]}
          />
        </LinearGradient>

        <View style={styles.innerContent}>
          <View style={[styles.iconBox, { backgroundColor: colors.primary + '20' }]}>
            <Icon
              name={role === 'sender' ? 'arrow-up-circle' : 'arrow-down-circle'}
              size={22}
              color={colors.primary}
            />
          </View>

          <View style={styles.textContainer}>
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
              {role === 'sender' ? 'Sending to' : 'Receiving from'}{' '}
              <Text style={{ color: colors.primary }}>{deviceName || 'Device'}</Text>
            </Text>
            <Text style={[styles.subtitle, { color: colors.subtext }]} numberOfLines={1}>
              {progressPct}%
              {transferStats?.transferSpeed ? ` • ${transferStats.transferSpeed}` : ''}
              {transferStats?.eta && transferStats.eta !== '--:--'
                ? ` • ETA: ${transferStats.eta}`
                : ''}
            </Text>
          </View>

          <Icon name="chevron-right" size={24} color={colors.subtext} />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 20,
    right: 20,
    zIndex: 9999,
    elevation: 10,
  },
  content: {
    borderRadius: 20,
    overflow: 'hidden',
    height: 70,
  },
  progressBg: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 4,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  progressFill: {
    height: '100%',
  },
  innerContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 12,
  },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 12,
    marginTop: 2,
  },
});

export default GlobalTransferOverlay;
