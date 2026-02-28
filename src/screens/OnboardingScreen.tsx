import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Animated,
  Platform,
  StatusBar,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../theme/ThemeContext';

const { width, height } = Dimensions.get('window');

const SLIDES = [
  {
    icon: 'lightning-bolt',
    iconColor: '#FFD700',
    bgGradient: ['#1A0533', '#3D0B6B', '#0F1115'],
    title: 'Blazing Fast\nFile Sharing',
    subtitle: 'Transfer files between devices at full Wi-Fi Direct speed — no internet needed.',
    accentColor: '#7C4DFF',
  },
  {
    icon: 'qrcode-scan',
    iconColor: '#00E5FF',
    bgGradient: ['#001A2C', '#00364D', '#0F1115'],
    title: 'Scan & Go\nInstantly',
    subtitle: 'Simply show the QR code on one device, scan from the other — and you\'re connected.',
    accentColor: '#00D1FF',
  },
  {
    icon: 'shield-check',
    iconColor: '#00D189',
    bgGradient: ['#001A14', '#003329', '#0F1115'],
    title: 'Private &\nSecure',
    subtitle: 'All transfers happen locally on your network. No cloud, no tracking, no limits.',
    accentColor: '#00D189',
  },
];

const OnboardingScreen = ({ navigation }: any) => {
  const { colors, typography } = useTheme();
  const [currentIndex, setCurrentIndex] = useState(0);
  const scrollX = useRef(new Animated.Value(0)).current;
  const flatListRef = useRef<any>(null);
  const iconScale = useRef(new Animated.Value(1)).current;

  const handleNext = () => {
    if (currentIndex < SLIDES.length - 1) {
      const next = currentIndex + 1;
      flatListRef.current?.scrollToIndex({ index: next, animated: true });
      setCurrentIndex(next);

      // Bounce the icon
      Animated.sequence([
        Animated.timing(iconScale, { toValue: 0.85, duration: 120, useNativeDriver: true }),
        Animated.spring(iconScale, { toValue: 1, friction: 5, useNativeDriver: true }),
      ]).start();
    } else {
      handleFinish();
    }
  };

  const handleFinish = async () => {
    await AsyncStorage.setItem('hasSeenOnboarding', 'true');
    navigation.replace('Home');
  };

  const slide = SLIDES[currentIndex];

  return (
    <View style={styles.container}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />

      {/* Background Gradient — changes per slide */}
      <LinearGradient
        colors={slide.bgGradient as any}
        style={StyleSheet.absoluteFillObject}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
      />

      {/* Skip Button */}
      <TouchableOpacity style={styles.skipBtn} onPress={handleFinish} activeOpacity={0.7}>
        <Text style={[styles.skipText, { fontFamily: typography.fontFamily }]}>Skip</Text>
      </TouchableOpacity>

      {/* Icon Area */}
      <View style={styles.iconArea}>
        <Animated.View style={[styles.iconOuter, { borderColor: slide.accentColor + '40', transform: [{ scale: iconScale }] }]}>
          <View style={[styles.iconInner, { backgroundColor: slide.accentColor + '18' }]}>
            <Icon name={slide.icon} size={72} color={slide.iconColor} />
          </View>
        </Animated.View>

        {/* Decorative rings */}
        <View style={[styles.ring, styles.ring1, { borderColor: slide.accentColor + '20' }]} />
        <View style={[styles.ring, styles.ring2, { borderColor: slide.accentColor + '10' }]} />
      </View>

      {/* Text */}
      <View style={styles.textArea}>
        <Text style={[styles.title, { fontFamily: typography.fontFamily }]}>
          {slide.title}
        </Text>
        <Text style={[styles.subtitle, { fontFamily: typography.fontFamily }]}>
          {slide.subtitle}
        </Text>
      </View>

      {/* Dots */}
      <View style={styles.dotsRow}>
        {SLIDES.map((_, i) => {
          const isActive = i === currentIndex;
          return (
            <View
              key={i}
              style={[
                styles.dot,
                {
                  backgroundColor: isActive ? slide.accentColor : 'rgba(255,255,255,0.25)',
                  width: isActive ? 24 : 8,
                },
              ]}
            />
          );
        })}
      </View>

      {/* Next / Get Started Button */}
      <TouchableOpacity
        style={[styles.nextBtn, { backgroundColor: slide.accentColor }]}
        onPress={handleNext}
        activeOpacity={0.85}
      >
        <Text style={[styles.nextBtnText, { fontFamily: typography.fontFamily }]}>
          {currentIndex === SLIDES.length - 1 ? 'Get Started' : 'Next'}
        </Text>
        <Icon
          name={currentIndex === SLIDES.length - 1 ? 'check' : 'arrow-right'}
          size={20}
          color="#FFF"
        />
      </TouchableOpacity>

      {/* Already used? */}
      {currentIndex === SLIDES.length - 1 && (
        <TouchableOpacity onPress={handleFinish} style={{ marginTop: 16 }}>
          <Text style={[styles.alreadyText, { fontFamily: typography.fontFamily }]}>
            Already know the drill? Skip →
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingTop: Platform.OS === 'android' ? 50 : 60,
    paddingBottom: 50,
  },
  skipBtn: {
    position: 'absolute',
    top: Platform.OS === 'android' ? 56 : 60,
    right: 24,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  skipText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    fontWeight: '600',
  },
  iconArea: {
    width: 200,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 48,
    position: 'relative',
  },
  iconOuter: {
    width: 160,
    height: 160,
    borderRadius: 48,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  iconInner: {
    width: 130,
    height: 130,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    borderRadius: 999,
    borderWidth: 1,
  },
  ring1: {
    width: 190,
    height: 190,
  },
  ring2: {
    width: 210,
    height: 210,
  },
  textArea: {
    alignItems: 'center',
    marginBottom: 40,
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 42,
    letterSpacing: -0.5,
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.65)',
    textAlign: 'center',
    lineHeight: 24,
    fontWeight: '400',
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 40,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  nextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 40,
    paddingVertical: 16,
    borderRadius: 30,
    width: '100%',
  },
  nextBtnText: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '700',
  },
  alreadyText: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
    fontWeight: '500',
  },
});

export default OnboardingScreen;
