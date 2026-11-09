import type { Permission } from '@monaco/contracts';
import { describe, expect, it } from 'vitest';

import { InvalidScope, SystemRoleImmutable, type EscalationReason } from '../errors';
import { assertNoEscalation, canManageDevicesOf, type EscalationCheck } from '../escalation';
import type { Actor, Assignment } from '../types';
import {
  actor,
  ADMIN_ROLE,
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

const owner = actor('owner-1', tenantWide(OWNER_ROLE));
/** Custom admin (users:manage + roles:manage + sales:create), not an Owner. */
const admin = actor('admin-1', tenantWide(ADMIN_ROLE));
/** Admin who is also a Manager in A and B: holds sales:void etc. only inside A and B. */
const lead = actor('lead-1', tenantWide(ADMIN_ROLE), atLocations(MANAGER_ROLE, LOC_A, LOC_B));
/** Plain Manager (no administrative permissions) in A and B. */
const manager = actor('manager-1', atLocations(MANAGER_ROLE, LOC_A, LOC_B));

function allowed(who: Actor, check: EscalationCheck) {
  expect(() => assertNoEscalation(who, check)).not.toThrow();
}
function forbidden(who: Actor, check: EscalationCheck, reason: EscalationReason) {
  expect(() => assertNoEscalation(who, check)).toThrow(
    expect.objectContaining({ code: 'forbidden_escalation', reason }),
  );
}

describe('create_role', () => {
  const create = (...permissions: Permission[]): EscalationCheck => ({ kind: 'create_role', permissions });

  it('lets an Owner define any role, including every administrative permission', () => {
    allowed(owner, create('tenant:manage', 'users:manage', 'roles:manage', 'audit:view', 'sales:void'));
  });

  it('allows an empty permission list and permissions the actor holds tenant-wide', () => {
    allowed(admin, create());
    allowed(admin, create('sales:create'));
  });

  it('rejects a permission the actor does not hold', () => {
    forbidden(admin, create('sales:void'), 'permission_not_held');
    forbidden(admin, create('sales:create', 'catalog:write'), 'permission_not_held');
    forbidden(admin, create('locations:manage'), 'permission_not_held');
  });

  it.each(['users:manage', 'roles:manage', 'tenant:manage', 'audit:view'] as const)(
    'only an Owner can put %s in a role, even a non-Owner who holds it',
    (permission) => {
      const holder = actor('h', tenantWide(customRole('holder', permission)));
      forbidden(holder, create(permission), 'owner_only');
    },
  );

  it('a non-Owner can still hand out locations:manage if they hold it tenant-wide', () => {
    const holder = actor('h', tenantWide(customRole('holder', 'locations:manage')));
    allowed(holder, create('locations:manage'));
  });

  it('rejects a permission held only in some locations: roles are assignable anywhere', () => {
    forbidden(lead, create('sales:void'), 'scope_exceeds');
    forbidden(manager, create('sales:void'), 'scope_exceeds');
  });

  it('a user with no assignments can define nothing but the empty role', () => {
    const nobody = actor('n');
    forbidden(nobody, create('reports:view'), 'permission_not_held');
    allowed(nobody, create());
  });
});

describe('update_role', () => {
  const custom = customRole('c1', 'sales:create', 'sales:void');
  const update = (role = custom, ...permissions: Permission[]): EscalationCheck => ({
    kind: 'update_role',
    role,
    permissions,
    hasLocationScopedAssignments: false,
  });

  it('never edits the Owner role, not even an Owner', () => {
    expect(() => assertNoEscalation(owner, update(OWNER_ROLE, 'sales:create'))).toThrow(SystemRoleImmutable);
  });

  it('lets an Owner edit custom and non-Owner system roles', () => {
    allowed(owner, update(custom, 'sales:create', 'users:manage'));
    allowed(owner, update(MANAGER_ROLE, 'sales:create'));
  });

  it('a rename (same permissions) needs nothing beyond the base authorization', () => {
    allowed(actor('nobody'), update(custom, 'sales:create', 'sales:void'));
  });

  it('rejects ADDING a permission the editor does not hold', () => {
    forbidden(admin, update(custom, 'sales:create', 'sales:void', 'catalog:write'), 'permission_not_held');
  });

  it('rejects REMOVING a permission the editor does not hold (it changes every holder)', () => {
    forbidden(admin, update(custom, 'sales:create'), 'permission_not_held');
  });

  it('allows changes limited to permissions the editor holds tenant-wide', () => {
    const editor = actor('e', tenantWide(customRole('ed', 'sales:void', 'catalog:write')));
    allowed(editor, update(custom, 'sales:create', 'catalog:write'));
  });

  it('only an Owner can add or remove owner-only permissions', () => {
    const holder = actor('h', tenantWide(customRole('hr', 'users:manage')));
    forbidden(holder, update(custom, 'sales:create', 'sales:void', 'users:manage'), 'owner_only');
    const withAdmin = customRole('c2', 'sales:create', 'audit:view');
    forbidden(admin, update(withAdmin, 'sales:create'), 'owner_only');
  });

  it('adding an admin permission to a role held with a locations scope is invalid (422)', () => {
    const check: EscalationCheck = {
      kind: 'update_role',
      role: custom,
      permissions: ['sales:create', 'sales:void', 'locations:manage'],
      hasLocationScopedAssignments: true,
    };
    expect(() => assertNoEscalation(owner, check)).toThrow(InvalidScope);
    expect(() => assertNoEscalation(owner, check)).toThrow(
      expect.objectContaining({ reason: 'admin_permission_requires_tenant_scope' }),
    );
  });

  it('with location-scoped holders, non-admin additions and removals are fine, and so are admin additions when none exist', () => {
    const withAdmin = customRole('c5', 'sales:create', 'locations:manage');
    const scoped = (role: typeof custom, ...permissions: Permission[]): EscalationCheck => ({
      kind: 'update_role',
      role,
      permissions,
      hasLocationScopedAssignments: true,
    });
    allowed(owner, scoped(custom, 'sales:create', 'sales:void', 'catalog:write'));
    allowed(owner, scoped(withAdmin, 'sales:create')); // removing an admin permission
    allowed(owner, scoped(withAdmin, 'sales:create', 'locations:manage', 'sales:void')); // already had it
    allowed(owner, update(custom, 'sales:create', 'sales:void', 'locations:manage'));
  });

  it('a holder of the role cannot use its edit to widen their own reach', () => {
    const self = actor('s', tenantWide(customRole('c3', 'roles:manage', 'sales:create')), atLocations(MANAGER_ROLE, LOC_A));
    forbidden(self, update(customRole('c4', 'sales:create'), 'sales:create', 'sales:void'), 'scope_exceeds');
  });
});

describe('replace_assignments', () => {
  const replace = (
    targetUserId: string,
    current: Assignment[],
    next: Assignment[],
  ): EscalationCheck => ({ kind: 'replace_assignments', targetUserId, current, next });

  describe('self-modification', () => {
    it('is forbidden for everyone, Owner included', () => {
      forbidden(owner, replace('owner-1', [], [tenantWide(CASHIER_ROLE)]), 'self_modification');
      forbidden(manager, replace('manager-1', [], [tenantWide(OWNER_ROLE)]), 'self_modification');
      forbidden(admin, replace('admin-1', [], []), 'self_modification');
    });
  });

  describe('Owner-only operations', () => {
    it('a Manager cannot make another user an Owner', () => {
      forbidden(manager, replace('u', [], [tenantWide(OWNER_ROLE)]), 'owner_only');
    });
    it('a custom admin cannot grant Owner', () => {
      forbidden(admin, replace('u', [], [tenantWide(OWNER_ROLE)]), 'owner_only');
    });
    it('a custom admin cannot revoke Owner from an Owner', () => {
      forbidden(admin, replace('u', [tenantWide(OWNER_ROLE)], []), 'owner_only');
    });
    it('a custom admin cannot touch ANY assignment of an Owner, even unrelated ones', () => {
      forbidden(
        admin,
        replace('u', [tenantWide(OWNER_ROLE)], [tenantWide(OWNER_ROLE), tenantWide(customRole('x', 'sales:create'))]),
        'owner_only',
      );
    });
    it('an Owner can grant and revoke Owner', () => {
      allowed(owner, replace('u', [], [tenantWide(OWNER_ROLE)]));
      allowed(owner, replace('u', [tenantWide(OWNER_ROLE)], [tenantWide(MANAGER_ROLE)]));
    });
    it('a role with owner-only permissions cannot be assigned by a non-Owner who holds them', () => {
      const admins = customRole('admins', 'users:manage');
      forbidden(admin, replace('u', [], [tenantWide(admins)]), 'owner_only');
      allowed(owner, replace('u', [], [tenantWide(admins)]));
    });
    it('an Owner-key role that is not the system role is not an Owner role', () => {
      const fake = { ...OWNER_ROLE, id: 'fake', isSystem: false, permissions: ['sales:create'] as Permission[] };
      allowed(admin, replace('u', [], [tenantWide(fake)]));
    });
  });

  describe('scope validation', () => {
    it('rejects admin permissions with a locations scope (422) before anything else', () => {
      const bad = atLocations(customRole('bad', 'locations:manage'), LOC_A);
      expect(() => assertNoEscalation(owner, replace('u', [], [bad]))).toThrow(InvalidScope);
    });
    it('rejects the Owner role limited to locations', () => {
      expect(() => assertNoEscalation(owner, replace('u', [], [atLocations(OWNER_ROLE, LOC_A)]))).toThrow(InvalidScope);
    });
    it('rejects an empty or duplicated location list', () => {
      expect(() => assertNoEscalation(owner, replace('u', [], [atLocations(CASHIER_ROLE)]))).toThrow(InvalidScope);
      expect(() => assertNoEscalation(owner, replace('u', [], [atLocations(CASHIER_ROLE, LOC_A, LOC_A)]))).toThrow(
        InvalidScope,
      );
    });
    it('only validates the new set: a legacy invalid assignment being removed does not block the change', () => {
      const legacy = atLocations(customRole('legacy', 'users:manage'), LOC_A);
      allowed(owner, replace('u', [legacy], [tenantWide(CASHIER_ROLE)]));
    });
  });

  describe('permission and scope coverage', () => {
    it('lets an actor assign what they hold with equal or wider scope', () => {
      allowed(lead, replace('u', [], [atLocations(CASHIER_ROLE, LOC_A)]));
      allowed(lead, replace('u', [], [atLocations(CASHIER_ROLE, LOC_A, LOC_B)]));
      allowed(lead, replace('u', [], [atLocations(MANAGER_ROLE, LOC_B)]));
    });
    it('rejects a scope wider than the actor’s own', () => {
      forbidden(lead, replace('u', [], [atLocations(CASHIER_ROLE, LOC_C)]), 'scope_exceeds');
      forbidden(lead, replace('u', [], [atLocations(CASHIER_ROLE, LOC_A, LOC_C)]), 'scope_exceeds');
      forbidden(lead, replace('u', [], [tenantWide(CASHIER_ROLE)]), 'scope_exceeds');
      forbidden(lead, replace('u', [], [atLocations(MANAGER_ROLE, LOC_A, LOC_B, LOC_C)]), 'scope_exceeds');
    });
    it('rejects a custom role with permissions the actor lacks', () => {
      const foreign = customRole('foreign', 'sales:create', 'locations:manage');
      forbidden(lead, replace('u', [], [tenantWide(foreign)]), 'permission_not_held');
      forbidden(admin, replace('u', [], [atLocations(MANAGER_ROLE, LOC_A)]), 'permission_not_held');
    });
    it('a role with no permissions can be assigned by anyone with the base authorization', () => {
      allowed(actor('nobody'), replace('u', [], [atLocations(customRole('empty'), LOC_A)]));
    });
    it('an Owner covers every scope', () => {
      allowed(owner, replace('u', [], [tenantWide(MANAGER_ROLE), atLocations(CASHIER_ROLE, LOC_C)]));
    });
  });

  describe('replace semantics', () => {
    it('only the added and removed assignments are checked', () => {
      const outside = atLocations(MANAGER_ROLE, LOC_C);
      allowed(lead, replace('u', [outside, atLocations(CASHIER_ROLE, LOC_A)], [outside, atLocations(CASHIER_ROLE, LOC_A, LOC_B)]));
    });
    it('removing an assignment outside the actor’s reach is rejected too', () => {
      const outside = atLocations(MANAGER_ROLE, LOC_C);
      forbidden(lead, replace('u', [outside], []), 'scope_exceeds');
    });
    it('removing an assignment whose locations were all archived requires tenant-wide coverage', () => {
      const archivedOnly = atLocations(CASHIER_ROLE);
      forbidden(lead, replace('u', [archivedOnly], []), 'scope_exceeds');
      allowed(owner, replace('u', [archivedOnly], []));
    });
    it('location order does not matter', () => {
      allowed(actor('nobody'), replace('u', [atLocations(CASHIER_ROLE, LOC_A, LOC_B)], [atLocations(CASHIER_ROLE, LOC_B, LOC_A)]));
    });
    it('the same role at the same locations twice is one assignment', () => {
      allowed(actor('nobody'), replace('u', [tenantWide(CASHIER_ROLE)], [tenantWide(CASHIER_ROLE)]));
    });
    it('the same role with different scopes are different assignments', () => {
      forbidden(
        lead,
        replace('u', [atLocations(CASHIER_ROLE, LOC_A)], [atLocations(CASHIER_ROLE, LOC_A), atLocations(CASHIER_ROLE, LOC_C)]),
        'scope_exceeds',
      );
    });
    it('empty to empty is a no-op', () => {
      allowed(actor('nobody'), replace('u', [], []));
    });
  });
});

describe('disable_user and reset_password', () => {
  const kinds = ['disable_user', 'reset_password'] as const;

  describe.each(kinds)('%s', (kind) => {
    const check = (targetUserId: string, ...targetAssignments: Assignment[]): EscalationCheck => ({
      kind,
      targetUserId,
      targetAssignments,
    });

    it('is forbidden on yourself', () => {
      forbidden(owner, check('owner-1', tenantWide(OWNER_ROLE)), 'self_modification');
      forbidden(lead, check('lead-1'), 'self_modification');
    });
    it('a non-Owner cannot touch an Owner', () => {
      forbidden(admin, check('u', tenantWide(OWNER_ROLE)), 'owner_only');
      forbidden(lead, check('u', tenantWide(OWNER_ROLE), atLocations(CASHIER_ROLE, LOC_A)), 'owner_only');
    });
    it('an Owner can touch another Owner and anyone else', () => {
      allowed(owner, check('u', tenantWide(OWNER_ROLE)));
      allowed(owner, check('u', tenantWide(MANAGER_ROLE), atLocations(CASHIER_ROLE, LOC_C)));
    });
    it('a user without assignments can be handled by an admin', () => {
      allowed(admin, check('u'));
    });
    it('the actor must cover everything the target holds (no takeover of a stronger account)', () => {
      allowed(lead, check('u', atLocations(CASHIER_ROLE, LOC_A)));
      forbidden(lead, check('u', atLocations(MANAGER_ROLE, LOC_C)), 'scope_exceeds');
      forbidden(lead, check('u', atLocations(CASHIER_ROLE)), 'scope_exceeds');
      forbidden(lead, check('u', atLocations(CASHIER_ROLE, LOC_A), tenantWide(MANAGER_ROLE)), 'scope_exceeds');
      forbidden(admin, check('u', atLocations(MANAGER_ROLE, LOC_A)), 'permission_not_held');
    });
    it('a non-Owner cannot touch another administrator', () => {
      const other = customRole('other-admin', 'users:manage');
      forbidden(admin, check('u', tenantWide(other)), 'owner_only');
    });
  });
});

describe('update_user', () => {
  const check = (targetUserId: string, ...targetAssignments: Assignment[]): EscalationCheck => ({
    kind: 'update_user',
    targetUserId,
    targetAssignments,
  });

  it('lets anyone edit their own profile', () => {
    allowed(owner, check('owner-1', tenantWide(OWNER_ROLE)));
    allowed(lead, check('lead-1'));
  });
  it('only an Owner edits an Owner', () => {
    forbidden(admin, check('u', tenantWide(OWNER_ROLE)), 'owner_only');
    allowed(owner, check('u', tenantWide(OWNER_ROLE)));
  });
  it('the actor must cover everything the target holds', () => {
    allowed(lead, check('u', atLocations(CASHIER_ROLE, LOC_A)));
    allowed(admin, check('u'));
    forbidden(lead, check('u', atLocations(MANAGER_ROLE, LOC_C)), 'scope_exceeds');
    forbidden(admin, check('u', atLocations(MANAGER_ROLE, LOC_A)), 'permission_not_held');
  });
});

describe('canManageDevicesOf', () => {
  const eff = (...a: Assignment[]) => actor('x', ...a);
  const managerAB = eff(atLocations(MANAGER_ROLE, LOC_A, LOC_B));

  it('a tenant-wide holder manages anyone, Owners included', () => {
    const e = eff(tenantWide(OWNER_ROLE));
    expect(canManageDevicesOf(e, [])).toBe(true);
    expect(canManageDevicesOf(e, [tenantWide(OWNER_ROLE)])).toBe(true);
    expect(canManageDevicesOf(e, [atLocations(CASHIER_ROLE, LOC_C)])).toBe(true);
  });

  it('a location Manager manages users entirely inside their locations', () => {
    expect(canManageDevicesOf(managerAB, [atLocations(CASHIER_ROLE, LOC_A)])).toBe(true);
    expect(canManageDevicesOf(managerAB, [atLocations(CASHIER_ROLE, LOC_A, LOC_B)])).toBe(true);
    expect(canManageDevicesOf(managerAB, [atLocations(CASHIER_ROLE, LOC_A), atLocations(CASHIER_ROLE, LOC_B)])).toBe(true);
  });

  it('rejects users that reach beyond the Manager’s locations', () => {
    expect(canManageDevicesOf(managerAB, [atLocations(CASHIER_ROLE, LOC_A, LOC_C)])).toBe(false);
    expect(canManageDevicesOf(managerAB, [atLocations(CASHIER_ROLE, LOC_A), atLocations(CASHIER_ROLE, LOC_C)])).toBe(false);
    expect(canManageDevicesOf(managerAB, [atLocations(CASHIER_ROLE)])).toBe(false);
    expect(canManageDevicesOf(managerAB, [tenantWide(CASHIER_ROLE)])).toBe(false);
  });

  it('rejects Owners and users without assignments', () => {
    expect(canManageDevicesOf(managerAB, [tenantWide(OWNER_ROLE)])).toBe(false);
    expect(canManageDevicesOf(managerAB, [atLocations(CASHIER_ROLE, LOC_A), tenantWide(OWNER_ROLE)])).toBe(false);
    expect(canManageDevicesOf(managerAB, [])).toBe(false);
  });

  it('only an Owner manages an Owner’s devices, even a non-Owner with tenant-wide devices:manage', () => {
    const devAdmin = eff(tenantWide(customRole('dev', 'devices:manage')));
    expect(canManageDevicesOf(devAdmin, [tenantWide(OWNER_ROLE)])).toBe(false);
    expect(canManageDevicesOf(devAdmin, [tenantWide(MANAGER_ROLE)])).toBe(true);
    expect(canManageDevicesOf(eff(tenantWide(OWNER_ROLE)), [tenantWide(OWNER_ROLE)])).toBe(true);
  });

  it('requires devices:manage in each location, not just any permission', () => {
    const mixed = eff(atLocations(MANAGER_ROLE, LOC_A), atLocations(CASHIER_ROLE, LOC_B));
    expect(canManageDevicesOf(mixed, [atLocations(CASHIER_ROLE, LOC_A)])).toBe(true);
    expect(canManageDevicesOf(mixed, [atLocations(CASHIER_ROLE, LOC_B)])).toBe(false);
  });

  it('a user without devices:manage manages nobody', () => {
    expect(canManageDevicesOf(eff(atLocations(CASHIER_ROLE, LOC_A)), [atLocations(CASHIER_ROLE, LOC_A)])).toBe(false);
    expect(canManageDevicesOf(eff(), [atLocations(CASHIER_ROLE, LOC_A)])).toBe(false);
  });
});
