module.exports = {
  preset: 'react-native',
  testPathIgnorePatterns: [
    '/node_modules/',
    '/TruckExpoAI/',
  ],
  moduleNameMapper: {
    '^@rnmapbox/maps$': '<rootDir>/__mocks__/@rnmapbox/maps.js',
    '^react-native-tts$': '<rootDir>/__mocks__/react-native-tts.js',
    '^react-native-audio-recorder-player$': '<rootDir>/__mocks__/react-native-audio-recorder-player.js',
    '^react-native-config$': '<rootDir>/__mocks__/react-native-config.js',
    '^@react-native-async-storage/async-storage$': require.resolve('@react-native-async-storage/async-storage/jest/async-storage-mock'),
  },
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@react-navigation|@rnmapbox|react-native-vector-icons|react-native-tts|react-native-audio-recorder-player|react-native-geolocation-service|react-native-safe-area-context|react-native-screens)/)',
  ],
};
