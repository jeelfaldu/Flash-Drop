// jest.mock('@react-native-async-storage/async-storage', () =>
//   require('@react-native-async-storage/async-storage/jest/async-storage-mock')
// );
// Wait, the documentation says to use the provided mock. Let's see if it works.

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(),
  getItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
  getAllKeys: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
    SafeAreaProvider: ({ children }) => children,
    SafeAreaView: ({ children }) => children,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

jest.mock('@react-navigation/native-stack', () => ({
    createNativeStackNavigator: () => ({
        Navigator: ({ children }) => children,
        Screen: ({ children }) => children,
    }),
}));

// jest.mock('react-native-permissions', () => require('react-native-permissions/mock'));
jest.mock('react-native-permissions', () => ({
  check: jest.fn(),
  request: jest.fn(),
  PERMISSIONS: { ANDROID: {}, IOS: {} },
  RESULTS: { GRANTED: 'granted' },
}));

// Mock other native modules used in App
jest.mock('react-native-wifi-reborn', () => ({}));
jest.mock('react-native-tcp-socket', () => ({}));
jest.mock('react-native-fs', () => ({}));
jest.mock('react-native-device-info', () => ({}));
jest.mock('react-native-vision-camera', () => ({}));
jest.mock('@react-native-camera-roll/camera-roll', () => ({}));
jest.mock('@react-native-documents/picker', () => ({}));
jest.mock('react-native-contacts', () => ({}));
jest.mock('react-native-qrcode-svg', () => 'QRCode');
jest.mock('react-native-svg', () => 'Svg');
jest.mock('react-native-wifi-p2p', () => ({}));

jest.mock('@notifee/react-native', () => ({
  displayNotification: jest.fn(),
  AndroidImportance: {},
}));
