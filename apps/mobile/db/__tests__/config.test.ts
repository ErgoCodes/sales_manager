import { CONFIG_DEFAULTS, CONFIG_KEYS, getAllConfig, getConfig, setConfig } from '../config';

import { resetDb } from './helpers';

describe('db/config', () => {
  beforeEach(() => {
    resetDb();
  });

  describe('getConfig', () => {
    it('returns null for a key that has not been set', async () => {
      expect(await getConfig(CONFIG_KEYS.businessName)).toBeNull();
    });

    it('returns the stored value once set', async () => {
      await setConfig(CONFIG_KEYS.businessName, 'Mercado Mónaco');
      expect(await getConfig(CONFIG_KEYS.businessName)).toBe('Mercado Mónaco');
    });
  });

  describe('setConfig', () => {
    it('upserts without creating a duplicate row for the same key', async () => {
      await setConfig(CONFIG_KEYS.generalStockThreshold, '5');
      await setConfig(CONFIG_KEYS.generalStockThreshold, '10');

      expect(await getConfig(CONFIG_KEYS.generalStockThreshold)).toBe('10');
      const all = await getAllConfig();
      expect(all[CONFIG_KEYS.generalStockThreshold]).toBe('10');
    });
  });

  describe('getAllConfig', () => {
    it('merges stored values over CONFIG_DEFAULTS without dropping unset keys', async () => {
      await setConfig(CONFIG_KEYS.cashDiscountPercent, '20');

      const all = await getAllConfig();
      expect(all[CONFIG_KEYS.cashDiscountPercent]).toBe('20');
      // Untouched default keys are still present.
      expect(all[CONFIG_KEYS.stagnantDiscountPercent]).toBe(CONFIG_DEFAULTS[CONFIG_KEYS.stagnantDiscountPercent]);
    });
  });
});
