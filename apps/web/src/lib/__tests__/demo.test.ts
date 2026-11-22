import { describe, expect, it } from 'vitest';
import { demoAccounts } from '../demo';

const ACCOUNTS = JSON.stringify([
  { label: 'Propietario', email: 'owner@example.test', password: 'owner-secret' },
  { label: 'Cajero', email: 'cashier@example.test', password: 'cashier-secret' },
]);

describe('demoAccounts', () => {
  it('returns the configured accounts only with DEMO_MODE=true', () => {
    expect(demoAccounts({ DEMO_MODE: 'true', DEMO_ACCOUNTS: ACCOUNTS })).toEqual([
      { label: 'Propietario', email: 'owner@example.test', password: 'owner-secret' },
      { label: 'Cajero', email: 'cashier@example.test', password: 'cashier-secret' },
    ]);
  });

  it.each([
    ['no DEMO_MODE', { DEMO_ACCOUNTS: ACCOUNTS }],
    ['DEMO_MODE=false', { DEMO_MODE: 'false', DEMO_ACCOUNTS: ACCOUNTS }],
    ['no accounts', { DEMO_MODE: 'true' }],
    ['malformed JSON', { DEMO_MODE: 'true', DEMO_ACCOUNTS: '[{' }],
    ['an invalid email', { DEMO_MODE: 'true', DEMO_ACCOUNTS: JSON.stringify([{ label: 'X', email: 'nope', password: 'p' }]) }],
  ])('shows nothing with %s', (_label, env) => {
    expect(demoAccounts(env)).toEqual([]);
  });
});
