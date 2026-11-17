import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@monaco/contracts';
import { PERMISSION_GROUPS, PERMISSION_LABELS, canAny, canAt, canTenantWide } from '../permissions';

const tenant = { type: 'tenant' } as const;
const at = (...ids: string[]) => ({ type: 'locations', locationIds: ids }) as const;

describe('permission checks (UI hints only, the API is the authority)', () => {
  const grants = [
    { permission: 'users:manage', scope: tenant },
    { permission: 'sales:create', scope: at('a', 'b') },
  ] as const;

  it('canAny: held with any scope', () => {
    expect(canAny(grants, 'sales:create')).toBe(true);
    expect(canAny(grants, 'roles:manage')).toBe(false);
  });

  it('canTenantWide: only tenant scope counts', () => {
    expect(canTenantWide(grants, 'users:manage')).toBe(true);
    expect(canTenantWide(grants, 'sales:create')).toBe(false);
  });

  it('canAt: tenant scope covers every location, location scope only its list', () => {
    expect(canAt(grants, 'users:manage', 'z')).toBe(true);
    expect(canAt(grants, 'sales:create', 'a')).toBe(true);
    expect(canAt(grants, 'sales:create', 'z')).toBe(false);
  });

  it('handles an empty grant list', () => {
    expect(canAny([], 'users:manage')).toBe(false);
  });
});

describe('permission catalog presentation', () => {
  it('labels every permission in Spanish and groups each exactly once', () => {
    for (const p of PERMISSIONS) expect(PERMISSION_LABELS[p]).toBeTruthy();
    const grouped = PERMISSION_GROUPS.flatMap((g) => g.permissions);
    expect([...grouped].sort()).toEqual([...PERMISSIONS].sort());
  });
});
