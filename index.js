/**
 * @format
 */

import * as Sentry from '@sentry/react-native';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { SENTRY_DSN, SENTRY_ENVIRONMENT } from './src/shared/constants/config';

Sentry.init({
  dsn: SENTRY_DSN,
  enabled: Boolean(SENTRY_DSN),
  environment: SENTRY_ENVIRONMENT,
  // Release is set by the Sentry Gradle plugin from versionName + versionCode
  tracesSampleRate: __DEV__ ? 0 : 0.1,
  // Attach RN JS stack traces (unminified via source maps in release builds)
  attachStacktrace: true,
  sendDefaultPii: false,
});

AppRegistry.registerComponent(appName, () => Sentry.wrap(App));
