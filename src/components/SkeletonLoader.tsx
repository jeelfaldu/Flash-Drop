/**
 * SkeletonLoader — Shimmer loading placeholder.
 * Pure React Native Animated — no extra package.
 *
 * Usage:
 *   <SkeletonLoader width={200} height={16} borderRadius={8} />
 *   <FileCardSkeleton />   ← pre-built file card skeleton
 */
import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Dimensions, ViewStyle } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface SkeletonBoxProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export const SkeletonBox: React.FC<SkeletonBoxProps> = ({
  width = '100%',
  height = 16,
  borderRadius = 8,
  style,
}) => {
  const shimmerX = useRef(new Animated.Value(-1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(shimmerX, {
        toValue: 1,
        duration: 1200,
        useNativeDriver: true,
      })
    ).start();
  }, []);

  const translateX = shimmerX.interpolate({
    inputRange: [-1, 1],
    outputRange: [-SCREEN_WIDTH, SCREEN_WIDTH],
  });

  return (
    <View
      style={[
        {
          width: width as any,
          height,
          borderRadius,
          backgroundColor: '#E2E8F0',
          overflow: 'hidden',
        },
        style,
      ]}
    >
      <Animated.View
        style={[StyleSheet.absoluteFill, { transform: [{ translateX }] }]}
      >
        <LinearGradient
          colors={['transparent', 'rgba(255,255,255,0.55)', 'transparent']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
};

/** Pre-built skeleton that matches the FileCardItem layout */
export const FileCardSkeleton: React.FC<{ count?: number; isDark?: boolean }> = ({
  count = 4,
  isDark = false,
}) => {
  const bg = isDark ? '#2D333E' : '#E2E8F0';
  const shimmerColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.55)';
  const shimmerX = useRef(new Animated.Value(-1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(shimmerX, { toValue: 1, duration: 1300, useNativeDriver: true })
    ).start();
  }, []);

  const translateX = shimmerX.interpolate({
    inputRange: [-1, 1],
    outputRange: [-SCREEN_WIDTH, SCREEN_WIDTH],
  });

  const SkeletonRect = ({ w, h, br = 8, mt = 0 }: { w: any; h: number; br?: number; mt?: number }) => (
    <View style={{ width: w, height: h, borderRadius: br, backgroundColor: bg, marginTop: mt, overflow: 'hidden' }}>
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX }] }]}>
        <LinearGradient
          colors={['transparent', shimmerColor, 'transparent']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );

  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.cardRow}>
          {/* Thumbnail placeholder */}
          <SkeletonRect w={50} h={50} br={12} />
          {/* Text lines */}
          <View style={{ flex: 1, marginLeft: 16, gap: 8 }}>
            <SkeletonRect w="70%" h={14} />
            <SkeletonRect w="45%" h={10} />
            {/* Progress bar placeholder */}
            <SkeletonRect w="100%" h={6} br={3} mt={4} />
          </View>
        </View>
      ))}
    </>
  );
};

const styles = StyleSheet.create({
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
});
