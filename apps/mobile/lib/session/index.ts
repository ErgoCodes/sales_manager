import { Platform } from 'react-native';

import { API_URL } from '@/lib/api/config';

import { createSecureStorage } from './secure-storage';
import { createSession } from './session';

export type { ChangePasswordResult, LoginResult, Me, Session, SessionState } from './session';
export { PasswordChangeRequiredError } from './session';
export { accountRedirectFor, accountRouteFor, type AccountRoute } from './routes';

/** `expo-secure-store` exists only on Android and iOS; Expo web has no online session. */
export const isSessionSupported = Platform.OS === 'android' || Platform.OS === 'ios';

/** The process-wide session: one access token in memory and one single-flight refresh. */
export const session = createSession({
  baseUrl: API_URL,
  fetch: (request) => fetch(request),
  storage: createSecureStorage(),
  platform: Platform.OS === 'ios' ? 'ios' : 'android',
});
