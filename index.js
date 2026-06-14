/**
 * @format
 */

import * as Sentry from '@sentry/react-native';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { SENTRY_DSN } from './src/shared/constants/config';

Sentry.init({
  dsn: SENTRY_DSN,
  environment: __DEV__ ? 'development' : 'production',
  // Release is set by the Sentry Gradle plugin from versionName + versionCode
  tracesSampleRate: __DEV__ ? 0 : 0.1,
  // Attach RN JS stack traces (unminified via source maps in release builds)
  attachStacktrace: true,
});

AppRegistry.registerComponent(appName, () => Sentry.wrap(App));
