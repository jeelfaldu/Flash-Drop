module.exports = {
  preset: 'react-native',
  transformIgnorePatterns: [
    'node_modules/(?!(@react-native|react-native|@react-navigation|@react-native-community|react-native-vector-icons|react-native-linear-gradient|react-native-safe-area-context|react-native-permissions|react-native-qrcode-svg)/)',
  ],
  setupFiles: ['./jest.setup.js'],
};
