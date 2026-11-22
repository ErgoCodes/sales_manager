import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { isSessionSupported, session, type SessionState } from './index';

const UNSUPPORTED: SessionState = { status: 'unsupported' };

export function useSession(): SessionState {
  const state = useSyncExternalStore(session.subscribe, session.getState);
  return isSessionSupported ? state : UNSUPPORTED;
}

/** Mounted once at the root: resumes a stored session and revalidates it on every return to the foreground. */
export function useSessionLifecycle(): void {
  useEffect(() => {
    if (!isSessionSupported) return;
    void session.restore();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void session.revalidate();
    });
    return () => subscription.remove();
  }, []);
}
