import { resetSecureStore, secureStoreData, secureStoreMock } from './fake-api';

import { DEVICE_ID_KEY, REFRESH_TOKEN_KEY, createSecureStorage } from '../secure-storage';

// Hoisted above the imports by babel-jest.
jest.mock('expo-secure-store', () => jest.requireActual('./fake-api').secureStoreMock);

const OPTIONS = { keychainAccessible: secureStoreMock.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

beforeEach(resetSecureStore);

describe('createSecureStorage', () => {
  it('writes, reads and deletes with WHEN_UNLOCKED_THIS_DEVICE_ONLY', async () => {
    const storage = createSecureStorage();

    await storage.set(REFRESH_TOKEN_KEY, 'r');
    expect(await storage.get(REFRESH_TOKEN_KEY)).toBe('r');
    await storage.delete(REFRESH_TOKEN_KEY);

    expect(secureStoreMock.setItemAsync).toHaveBeenCalledWith(REFRESH_TOKEN_KEY, 'r', OPTIONS);
    expect(secureStoreMock.getItemAsync).toHaveBeenCalledWith(REFRESH_TOKEN_KEY, OPTIONS);
    expect(secureStoreMock.deleteItemAsync).toHaveBeenCalledWith(REFRESH_TOKEN_KEY, OPTIONS);
    expect(secureStoreData.size).toBe(0);
  });

  it('reads a value it cannot decrypt as missing instead of crashing', async () => {
    secureStoreMock.getItemAsync.mockRejectedValueOnce(new Error('Could not decrypt'));
    expect(await createSecureStorage().get(DEVICE_ID_KEY)).toBeNull();
  });

  it('uses only key characters SecureStore accepts', () => {
    for (const key of [REFRESH_TOKEN_KEY, DEVICE_ID_KEY]) expect(key).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});
