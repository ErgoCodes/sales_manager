import * as SecureStore from 'expo-secure-store';

/** Only the long-lived secrets live here; the access token stays in memory. */
export const REFRESH_TOKEN_KEY = 'monaco.session.refresh_token';
export const DEVICE_ID_KEY = 'monaco.session.device_id';

export interface SecureStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Keychain/Keystore readable only while the device is unlocked and never migrated to
 * another device from a backup. Android Auto Backup exclusion comes from the
 * `expo-secure-store` config plugin (`configureAndroidBackup` in app.json).
 */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export function createSecureStorage(): SecureStorage {
  return {
    async get(key) {
      try {
        return await SecureStore.getItemAsync(key, OPTIONS);
      } catch {
        // An entry that can no longer be decrypted (e.g. restored keystore) is treated as absent.
        return null;
      }
    },
    set: (key, value) => SecureStore.setItemAsync(key, value, OPTIONS),
    delete: (key) => SecureStore.deleteItemAsync(key, OPTIONS),
  };
}
