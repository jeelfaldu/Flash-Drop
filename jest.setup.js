
// Mock Async Storage
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Mock Safe Area Context
import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock';
jest.mock('react-native-safe-area-context', () => mockSafeAreaContext);

// Mock Native Modules
jest.mock('react-native-linear-gradient', () => 'LinearGradient');
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

jest.mock('react-native-fs', () => ({
  stat: jest.fn(),
  exists: jest.fn(),
  readDir: jest.fn(),
  ExternalStorageDirectoryPath: '/sdcard',
  DownloadDirectoryPath: '/sdcard/Download',
}));

jest.mock('@react-native-camera-roll/camera-roll', () => ({
  CameraRoll: {
    getPhotos: jest.fn(),
  },
}));

jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(),
  types: { allFiles: 'allFiles' },
  isErrorWithCode: jest.fn(),
  errorCodes: { OPERATION_CANCELED: 'OPERATION_CANCELED' },
}));

jest.mock('react-native-device-info', () => ({
  getApiLevel: jest.fn(() => Promise.resolve(30)),
}));

jest.mock('react-native-contacts', () => ({
  getAll: jest.fn(),
}));

jest.mock('react-native-wifi-p2p', () => ({}));
jest.mock('react-native-wifi-reborn', () => ({}));
jest.mock('react-native-tcp-socket', () => ({}));
jest.mock('@notifee/react-native', () => ({}));
jest.mock('react-native-vision-camera', () => ({}));

// Mock Permissions
jest.mock('react-native-permissions', () => require('react-native-permissions/mock'));
