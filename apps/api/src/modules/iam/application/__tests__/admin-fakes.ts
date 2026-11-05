import type { Permission } from '@monaco/contracts';
import { vi } from 'vitest';

import type { AuthenticatedActor } from '../../domain/actor';
import type { AdminTenantScope, AdminUnitOfWork } from '../../domain/admin-ports';
import { effectivePermissions } from '../../domain/permissions';
import { SYSTEM_ROLES } from '../../domain/system-roles';
import type { Assignment, Scope } from '../../domain/types';

export const TENANT = '0190a000-0000-7000-8000-000000000001';
export const ACTOR_ID = '0190a000-0000-7000-8000-0000000000a1';
export const TARGET_ID = '0190a000-0000-7000-8000-0000000000b1';
export const LOC_1 = '0190a000-0000-7000-8000-0000000000c1';
export const LOC_2 = '0190a000-0000-7000-8000-0000000000c2';
export const NOW = new Date('2026-11-05T12:00:00.000Z');
export const clock = { now: () => NOW };

export const OWNER_ROLE = { id: 'role-owner', key: 'owner' as const, isSystem: true, permissions: SYSTEM_ROLES.owner.permissions };
export const MANAGER_ROLE = { id: 'role-manager', key: 'manager' as const, isSystem: true, permissions: SYSTEM_ROLES.manager.permissions };
export const CASHIER_ROLE = { id: 'role-cashier', key: 'cashier' as const, isSystem: true, permissions: SYSTEM_ROLES.cashier.permissions };
export const custom = (id: string, ...permissions: Permission[]) => ({ id, key: null, isSystem: false, permissions });

export const TENANT_SCOPE: Scope = { type: 'tenant' };
export const at = (...locationIds: string[]): Scope => ({ type: 'locations', locationIds });

export function actorWith(assignments: Assignment[], userId = ACTOR_ID): AuthenticatedActor {
  return {
    userId,
    tenantId: TENANT,
    deviceId: 'device-actor',
    sessionId: 'session-actor',
    mustChangePassword: false,
    assignments,
    effective: effectivePermissions(assignments),
  };
}

export const owner = () => actorWith([{ role: OWNER_ROLE, scope: TENANT_SCOPE }]);

/** A scope whose every repository method is a `vi.fn()`; tests set the results they need. */
export function fakeScope() {
  const fn = () => vi.fn();
  return {
    users: { findById: fn(), setPassword: fn() },
    tenants: { findCurrent: fn() },
    devices: { findActive: fn(), create: fn(), touch: fn(), revokeAllExcept: fn() },
    refreshTokens: { startFamily: fn(), append: fn(), findForUpdate: fn(), markRotated: fn(), revokeFamily: fn(), revokeByDevices: fn() },
    audit: { record: fn() },
    actors: { load: fn() },
    mutex: { lock: fn() },
    locations: { list: fn(), create: fn(), update: fn(), archive: fn(), findActiveIds: fn() },
    userAdmin: { list: fn(), findById: fn(), create: fn(), updateDisplayName: fn(), disable: fn(), setTemporaryPassword: fn() },
    roles: { list: fn(), findById: fn(), findByIds: fn(), create: fn(), update: fn(), delete: fn() },
    assignments: { listByUser: fn(), replace: fn(), ownerCandidates: fn(), countByRole: fn(), hasLocationScopedByRole: fn() },
    deviceAdmin: { listByUser: fn(), findById: fn(), revoke: fn() },
    auditEvents: { list: fn() },
  };
}
export type FakeScope = ReturnType<typeof fakeScope>;

/** Runs every unit of work on the same fake scope and remembers the tenants it was opened for. */
export function fakeUow(scope: FakeScope = fakeScope()) {
  const runs: string[] = [];
  const uow: AdminUnitOfWork = {
    run: async (tenantId, work) => {
      runs.push(tenantId);
      return work(scope as unknown as AdminTenantScope);
    },
  };
  return { uow, scope, runs };
}

/** The Owner invariant holds (one active Owner) unless a test says otherwise. */
export const oneActiveOwner = [{ status: 'active' as const, assignments: [{ role: OWNER_ROLE, scope: TENANT_SCOPE }] }];
