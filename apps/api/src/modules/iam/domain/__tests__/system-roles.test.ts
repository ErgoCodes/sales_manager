import { ADMIN_PERMISSIONS, PERMISSIONS } from '@monaco/contracts';
import { describe, expect, it } from 'vitest';

import { isOwnerRole, SYSTEM_ROLES } from '../system-roles';

describe('system roles', () => {
  it('Owner has every permission, tenant-wide by default', () => {
    expect(SYSTEM_ROLES.owner.permissions).toEqual(PERMISSIONS);
    expect(SYSTEM_ROLES.owner.defaultScope).toBe('tenant');
  });

  it('Manager and Cashier are location-scoped by default', () => {
    expect(SYSTEM_ROLES.manager.defaultScope).toBe('locations');
    expect(SYSTEM_ROLES.cashier.defaultScope).toBe('locations');
  });

  it('Manager matches the spec table', () => {
    expect([...SYSTEM_ROLES.manager.permissions].sort()).toEqual(
      [
        'catalog:write',
        'inventory:write',
        'inventory:transfer',
        'sales:create',
        'sales:void',
        'reports:view',
        'cash:close',
        'devices:manage',
      ].sort(),
    );
  });

  it('Cashier matches the spec table', () => {
    expect([...SYSTEM_ROLES.cashier.permissions].sort()).toEqual(['cash:close', 'reports:view', 'sales:create']);
  });

  it('only Owner carries administrative permissions (so only Owner is tenant-only)', () => {
    for (const role of [SYSTEM_ROLES.manager, SYSTEM_ROLES.cashier]) {
      for (const admin of ADMIN_PERMISSIONS) expect(role.permissions).not.toContain(admin);
    }
  });

  it('keys match their record entry and names are unique', () => {
    for (const [key, spec] of Object.entries(SYSTEM_ROLES)) expect(spec.key).toBe(key);
    expect(new Set(Object.values(SYSTEM_ROLES).map((r) => r.name)).size).toBe(3);
  });

  it('isOwnerRole requires the system Owner role', () => {
    expect(isOwnerRole({ isSystem: true, key: 'owner' })).toBe(true);
    expect(isOwnerRole({ isSystem: true, key: 'manager' })).toBe(false);
    expect(isOwnerRole({ isSystem: false, key: 'owner' })).toBe(false);
    expect(isOwnerRole({ isSystem: false, key: null })).toBe(false);
  });
});
