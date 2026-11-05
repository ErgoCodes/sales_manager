import { ADMIN_PERMISSIONS, PERMISSIONS } from '@monaco/contracts';
import { describe, expect, it } from 'vitest';

import {
  can,
  effectivePermissions,
  hasPermissionAnywhere,
  isAdminPermission,
  isOwnerOnlyPermission,
  OWNER_ONLY_PERMISSIONS,
  toGrants,
} from '../permissions';
import {
  atLocations,
  CASHIER_ROLE,
  customRole,
  LOC_A,
  LOC_B,
  LOC_C,
  MANAGER_ROLE,
  OWNER_ROLE,
  tenantWide,
} from './fixtures';

describe('permission classification', () => {
  it('flags administrative permissions', () => {
    for (const p of PERMISSIONS) expect(isAdminPermission(p)).toBe(ADMIN_PERMISSIONS.includes(p as never));
  });
  it('owner-only permissions are a subset of the administrative ones', () => {
    for (const p of OWNER_ONLY_PERMISSIONS) {
      expect(isAdminPermission(p)).toBe(true);
      expect(isOwnerOnlyPermission(p)).toBe(true);
    }
    expect(isOwnerOnlyPermission('locations:manage')).toBe(false);
    expect(isOwnerOnlyPermission('sales:create')).toBe(false);
  });
});

describe('effectivePermissions', () => {
  it('is empty without assignments', () => {
    const e = effectivePermissions([]);
    expect(e.tenantWide.size).toBe(0);
    expect(e.byLocation.size).toBe(0);
  });

  it('collects tenant-wide permissions', () => {
    const e = effectivePermissions([tenantWide(OWNER_ROLE)]);
    expect([...e.tenantWide].sort()).toEqual([...PERMISSIONS].sort());
    expect(e.byLocation.size).toBe(0);
  });

  it('keeps location permissions per location', () => {
    const e = effectivePermissions([atLocations(CASHIER_ROLE, LOC_A), atLocations(MANAGER_ROLE, LOC_B)]);
    expect(e.tenantWide.size).toBe(0);
    expect(e.byLocation.get(LOC_A)?.has('sales:void')).toBe(false);
    expect(e.byLocation.get(LOC_B)?.has('sales:void')).toBe(true);
    expect(e.byLocation.get(LOC_C)).toBeUndefined();
  });

  it('unions assignments, also on the same location', () => {
    const e = effectivePermissions([
      atLocations(CASHIER_ROLE, LOC_A),
      atLocations(customRole('x', 'catalog:write'), LOC_A, LOC_B),
      tenantWide(customRole('y', 'reports:view')),
    ]);
    expect(e.byLocation.get(LOC_A)).toEqual(new Set(['sales:create', 'reports:view', 'cash:close', 'catalog:write']));
    expect(e.byLocation.get(LOC_B)).toEqual(new Set(['catalog:write']));
    expect(e.tenantWide).toEqual(new Set(['reports:view']));
  });

  it('never makes an administrative permission effective from a locations scope', () => {
    const e = effectivePermissions([atLocations(customRole('bad', 'users:manage', 'sales:create'), LOC_A)]);
    expect(e.byLocation.get(LOC_A)).toEqual(new Set(['sales:create']));
    expect(can(e, 'users:manage', LOC_A)).toBe(false);
    expect(hasPermissionAnywhere(e, 'users:manage')).toBe(false);
  });
});

describe('can', () => {
  const e = effectivePermissions([
    tenantWide(customRole('t', 'reports:view')),
    atLocations(MANAGER_ROLE, LOC_A),
  ]);

  it.each([
    ['tenant-wide permission, no location', 'reports:view', undefined, true],
    ['tenant-wide permission holds in any location', 'reports:view', LOC_C, true],
    ['location permission, right location', 'sales:void', LOC_A, true],
    ['location permission, other location', 'sales:void', LOC_B, false],
    ['location permission asked without a location', 'sales:void', undefined, false],
    ['permission never granted', 'users:manage', LOC_A, false],
    ['permission never granted, no location', 'users:manage', undefined, false],
  ] as const)('%s', (_label, permission, location, expected) => {
    expect(can(e, permission, location)).toBe(expected);
  });

  it('denies everything to a user without assignments', () => {
    const none = effectivePermissions([]);
    for (const p of PERMISSIONS) {
      expect(can(none, p)).toBe(false);
      expect(can(none, p, LOC_A)).toBe(false);
    }
  });
});

describe('hasPermissionAnywhere', () => {
  const e = effectivePermissions([atLocations(CASHIER_ROLE, LOC_A), atLocations(MANAGER_ROLE, LOC_B)]);
  it('finds permissions in any location', () => {
    expect(hasPermissionAnywhere(e, 'sales:create')).toBe(true);
    expect(hasPermissionAnywhere(e, 'sales:void')).toBe(true);
  });
  it('is false when held nowhere', () => {
    expect(hasPermissionAnywhere(e, 'users:manage')).toBe(false);
  });
  it('is true when tenant-wide', () => {
    expect(hasPermissionAnywhere(effectivePermissions([tenantWide(OWNER_ROLE)]), 'users:manage')).toBe(true);
  });
});

describe('toGrants', () => {
  it('emits tenant grants first-class and location grants with sorted ids, in catalog order', () => {
    const e = effectivePermissions([
      tenantWide(customRole('t', 'reports:view')),
      atLocations(CASHIER_ROLE, LOC_B, LOC_A),
      atLocations(customRole('m', 'sales:create'), LOC_C),
    ]);
    expect(toGrants(e)).toEqual([
      { permission: 'sales:create', scope: { type: 'locations', locationIds: [LOC_A, LOC_B, LOC_C] } },
      { permission: 'reports:view', scope: { type: 'tenant' } },
      { permission: 'cash:close', scope: { type: 'locations', locationIds: [LOC_A, LOC_B] } },
    ]);
  });
  it('is empty without permissions', () => {
    expect(toGrants(effectivePermissions([]))).toEqual([]);
  });
});
