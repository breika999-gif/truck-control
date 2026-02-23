const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  resolver: {
    resolverMainFields: ['react-native', 'source', 'browser', 'main'],
    resolveRequest: (context, moduleName, platform) => {
      // Force @pawan-pk/react-native-mapbox-navigation to resolve from its
      // TypeScript source so that @react-native/babel-plugin-codegen can
      // process *NativeComponent.ts and generate the Fabric view config.
      // Without this, Metro picks up pre-compiled .mjs via the package
      // "exports" field, bypassing the codegen babel transform.
      if (moduleName === '@pawan-pk/react-native-mapbox-navigation') {
        return {
          filePath: path.resolve(
            __dirname,
            'node_modules/@pawan-pk/react-native-mapbox-navigation/src/index.tsx',
          ),
          type: 'sourceFile',
        };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
