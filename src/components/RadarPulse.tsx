/**
 * RadarPulse — Animated radar/sonar ripple circles for discovery state.
 * Pure React Native Animated — no Lottie dependency needed.
 *
 * Usage:
 *   <RadarPulse size={180} color="#6200EA" icon="wifi-find" label="Scanning..." />
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface RadarPulseProps {
  size?: number;
  color?: string;
  icon?: string;
  label?: string;
  sublabel?: string;
  numRings?: number;
}

const RadarPulse: React.FC<RadarPulseProps> = ({
  size = 200,
  color = '#6200EA',
  icon = 'radar',
  label,
  sublabel,
  numRings = 3,
}) => {
  // One Animated.Value per ring, staggered
  const ringAnims = useRef(
    Array.from({ length: numRings }, () => new Animated.Value(0))
  ).current;
  const iconRotate = useRef(new Animated.Value(0)).current;
  const iconScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Staggered loop for each ring
    ringAnims.forEach((anim, i) => {
      const delay = (i * 700); // stagger by 700ms between rings
      const loop = Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, {
            toValue: 1,
            duration: numRings * 700,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ])
      );
      loop.start();
    });

    // Subtle icon rotation sweep
    Animated.loop(
      Animated.sequence([
        Animated.timing(iconRotate, {
          toValue: 1,
          duration: 3000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Icon pulse
    Animated.loop(
      Animated.sequence([
        Animated.timing(iconScale, { toValue: 1.12, duration: 900, useNativeDriver: true }),
        Animated.timing(iconScale, { toValue: 1.0, duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const rotation = iconRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const center = size / 2;

  return (
    <View style={styles.wrapper}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        {/* Ripple rings */}
        {ringAnims.map((anim, i) => {
          const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1.6] });
          const opacity = anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.6, 0.3, 0] });

          return (
            <Animated.View
              key={i}
              style={[
                styles.ring,
                {
                  width: size,
                  height: size,
                  borderRadius: center,
                  borderColor: color,
                  position: 'absolute',
                  transform: [{ scale }],
                  opacity,
                },
              ]}
            />
          );
        })}

        {/* Center icon bg */}
        <Animated.View
          style={[
            styles.centerCircle,
            {
              width: size * 0.42,
              height: size * 0.42,
              borderRadius: (size * 0.42) / 2,
              backgroundColor: color + '20',
              borderColor: color + '60',
              transform: [{ scale: iconScale }],
            },
          ]}
        >
          <Animated.View style={{ transform: [{ rotate: rotation }] }}>
            <Icon name={icon} size={size * 0.2} color={color} />
          </Animated.View>
        </Animated.View>
      </View>

      {label ? (
        <Text style={[styles.label, { color }]}>{label}</Text>
      ) : null}
      {sublabel ? (
        <Text style={styles.sublabel}>{sublabel}</Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  ring: {
    borderWidth: 1.5,
  },
  centerCircle: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  label: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  sublabel: {
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
    paddingHorizontal: 32,
    lineHeight: 19,
  },
});

export default RadarPulse;
