import React, { useEffect, useState } from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { BackHandler, PermissionsAndroid, Platform, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import HomeScreen from './src/screens/HomeScreen';
import SendScreen from './src/screens/SendScreen';
import ReceiveScreen from './src/screens/ReceiveScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import SharingScreen from './src/screens/SharingScreen';
import FileTransferScreen from './src/screens/FileTransferScreen';
import PCConnectionScreen from './src/screens/PCConnectionScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import { requestConnectPermissions } from './src/utils/permissionHelper';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { ToastProvider } from './src/components/Toast';
import { GlobalTransferOverlay } from './src/components/GlobalTransferOverlay';
import mobileAds, { RewardedAd, RewardedAdEventType, TestIds } from 'react-native-google-mobile-ads';

const rewardedAdUnitId = __DEV__ ? TestIds.REWARDED : 'ca-app-pub-3940256099942544/5224354917';
const rewarded = RewardedAd.createForAdRequest(rewardedAdUnitId, {
  requestNonPersonalizedAdsOnly: false,
});

mobileAds()
  .initialize()
  .then(adapterStatuses => {
    console.log('AdMob initialization complete!', adapterStatuses);
  });

export const navigationRef = createNavigationContainerRef();

// ── Global Error Boundary ─────────────────────────────────────────────────────
interface ErrorBoundaryState { hasError: boolean; error: Error | null; }
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <View style={errStyles.container}>
          <Text style={errStyles.emoji}>⚠️</Text>
          <Text style={errStyles.title}>Something went wrong</Text>
          <Text style={errStyles.message}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </Text>
          <TouchableOpacity
            style={errStyles.btn}
            onPress={() => this.setState({ hasError: false, error: null })}
          >
            <Text style={errStyles.btnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const errStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F1115', alignItems: 'center', justifyContent: 'center', padding: 32 },
  emoji: { fontSize: 60, marginBottom: 20 },
  title: { fontSize: 22, fontWeight: '800', color: '#F7F9FC', marginBottom: 12 },
  message: { fontSize: 14, color: '#9CA3AF', textAlign: 'center', lineHeight: 22, marginBottom: 32 },
  btn: { backgroundColor: '#7C4DFF', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 16 },
  btnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
});
// ─────────────────────────────────────────────────────────────────────────────

const Stack = createNativeStackNavigator();

const AppNavigator = () => {
  const { colors, isDark } = useTheme();
  const [initialRoute, setInitialRoute] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem('hasSeenOnboarding').then((val) => {
      setInitialRoute(val === 'true' ? 'Home' : 'Onboarding');
    });
  }, []);

  if (!initialRoute) return null; // Wait for AsyncStorage check

  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator
        initialRouteName={initialRoute}
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.background },
          headerShown: false,
          headerTitle: '',
          headerBackTitle: '',
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ animation: 'fade' }} />
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Send" component={SendScreen} />
        <Stack.Screen name="Receive" component={ReceiveScreen} />
        <Stack.Screen name="History" component={HistoryScreen} />
        <Stack.Screen name="Sharing" component={SharingScreen} />
        <Stack.Screen name="FileTransfer" component={FileTransferScreen} />
        <Stack.Screen name="PCConnection" component={PCConnectionScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

const App = () => {
  useEffect(() => {
    requestConnectPermissions();

    // Load and show rewarded ad on app startup
    const unsubscribeLoaded = rewarded.addAdEventListener(RewardedAdEventType.LOADED, () => {
      rewarded.show();
    });

    let isLoaded = false;
    try {
      isLoaded = rewarded.loaded;
    } catch (e) { }

    if (isLoaded) {
      rewarded.show();
    } else {
      rewarded.load();
    }

    return () => {
      unsubscribeLoaded();
    };
  }, []);

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <View style={{ flex: 1 }}>
            <AppNavigator />
            <GlobalTransferOverlay />
          </View>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
};

export default App;
