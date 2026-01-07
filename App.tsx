import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar, BackHandler, PermissionsAndroid, Platform } from 'react-native';

import HomeScreen from './src/screens/HomeScreen';
import SendScreen from './src/screens/SendScreen';
import ReceiveScreen from './src/screens/ReceiveScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import SharingScreen from './src/screens/SharingScreen';
import FileTransferScreen from './src/screens/FileTransferScreen';
import { requestConnectPermissions } from './src/utils/permissionHelper';
import { ThemeProvider } from './src/theme/ThemeContext';

const Stack = createNativeStackNavigator();

const App = () => {

  useEffect(() => {
    // Proactive request on app load
    requestConnectPermissions();
  }, []);

  return (
    <ThemeProvider>
      <NavigationContainer>
        <StatusBar barStyle="light-content" backgroundColor="#121212" />
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: '#121212' },
          headerTintColor: '#fff',
          contentStyle: { backgroundColor: '#121212' },
          headerShown: true,
          headerTitle: '',
          headerBackTitle: ''
        }}
      >
        <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Send" component={SendScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Receive" component={ReceiveScreen} options={{ headerShown: false }} />
        <Stack.Screen name="History" component={HistoryScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Sharing" component={SharingScreen} options={{ headerShown: false }} />
        <Stack.Screen name="FileTransfer" component={FileTransferScreen} options={{ headerShown: false }} />
      </Stack.Navigator>
    </NavigationContainer>
    </ThemeProvider>
  );
};

export default App;
