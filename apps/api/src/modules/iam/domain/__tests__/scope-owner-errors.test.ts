import { describe, expect, it } from 'vitest';

import {
  ForbiddenEscalation,
  IamDomainError,
  InvalidCursor,
  InvalidScope,
  OwnerInvariantViolation,
  PermissionDenied,
  ResourceConflict,
  ResourceNotFound,
  RoleInUse,
  SystemRoleImmutable,
} from '../errors';
import {
  assertOwnerInvariant,
  assertRoleDeletable,
  assertRoleEditable,
  countActiveOwners,
  holdsOwnerRole,
  isOwnerAssignment,
  type OwnerCandidate,
} from '../owner';
import { assertValidAssignment } from '../scope';
import {
  atLocations,
  CASHIER_ROLE,
  customRole,
  LOC_A,
  LOC_B,
  MANAGER_ROLE,
  OWNER_ROLE,
  tenantWide,
} from './fixtures';

describe('assertValidAssignment', () => {
  it('accepts tenant scope for any role, admin permissions included', () => {
    expect(() => assertValidAssignment(tenantWide(OWNER_ROLE))).not.toThrow();
    expect(() => assertValidAssignment(tenantWide(CASHIER_ROLE))).not.toThrow();
  });

  it('accepts a locations scope for non-administrative roles', () => {
    expect(() => assertValidAssignment(atLocations(MANAGER_ROLE, LOC_A, LOC_B))).not.toThrow();
  });

  it('rejects an empty locations list', () => {
    expect(() => assertValidAssignment(atLocations(CASHIER_ROLE))).toThrow(
      expect.objectContaining({ code: 'invalid_scope', reason: 'empty_locations' }),
    );
  });

  it('rejects duplicate locations', () => {
    expect(() => assertValidAssignment(atLocations(CASHIER_ROLE, LOC_A, LOC_A))).toThrow(
      expect.objectContaining({ reason: 'duplicate_locations' }),
    );
  });

  it.each(['tenant:manage', 'locations:manage', 'users:manage', 'roles:manage', 'audit:view'] as const)(
    'rejects %s with a locations scope',
    (permission) => {
      const role = customRole('r', 'sales:create', permission);
      expect(() => assertValidAssignment(atLocations(role, LOC_A))).toThrow(
        expect.objectContaining({ reason: 'admin_permission_requires_tenant_scope' }),
      );
    },
  );

  it('rejects the Owner role with a locations scope', () => {
    expect(() => assertValidAssignment(atLocations(OWNER_ROLE, LOC_A))).toThrow(InvalidScope);
  });
});

describe('owner helpers', () => {
  it('isOwnerAssignment needs the system Owner role AND tenant scope', () => {
    expect(isOwnerAssignment(tenantWide(OWNER_ROLE))).toBe(true);
    expect(isOwnerAssignment(atLocations(OWNER_ROLE, LOC_A))).toBe(false);
    expect(isOwnerAssignment(tenantWide(MANAGER_ROLE))).toBe(false);
    expect(isOwnerAssignment(tenantWide({ ...OWNER_ROLE, isSystem: false }))).toBe(false);
  });

  it('holdsOwnerRole looks across all assignments', () => {
    expect(holdsOwnerRole([])).toBe(false);
    expect(holdsOwnerRole([atLocations(CASHIER_ROLE, LOC_A), tenantWide(OWNER_ROLE)])).toBe(true);
    expect(holdsOwnerRole([atLocations(CASHIER_ROLE, LOC_A)])).toBe(false);
  });
});

describe('Owner invariant', () => {
  const owner = (status: 'active' | 'disabled'): OwnerCandidate => ({ status, assignments: [tenantWide(OWNER_ROLE)] });
  const manager: OwnerCandidate = { status: 'active', assignments: [tenantWide(MANAGER_ROLE)] };

  it('counts only active Owners', () => {
    expect(countActiveOwners([owner('active'), owner('disabled'), manager])).toBe(1);
    expect(countActiveOwners([])).toBe(0);
  });

  it('passes with one or more active Owners', () => {
    expect(() => assertOwnerInvariant([owner('active')])).not.toThrow();
    expect(() => assertOwnerInvariant([owner('active'), owner('active'), manager])).not.toThrow();
  });

  it.each([
    ['nobody left', []],
    ['only disabled Owners', [owner('disabled')]],
    ['only non-Owners', [manager]],
    ['Owner role demoted to locations scope', [{ status: 'active', assignments: [atLocations(OWNER_ROLE, LOC_A)] } as OwnerCandidate]],
  ])('fails when %s', (_label, users) => {
    expect(() => assertOwnerInvariant(users)).toThrow(OwnerInvariantViolation);
  });
});

describe('role mutability', () => {
  it('forbids editing the Owner role only', () => {
    expect(() => assertRoleEditable(OWNER_ROLE)).toThrow(SystemRoleImmutable);
    expect(() => assertRoleEditable(MANAGER_ROLE)).not.toThrow();
    expect(() => assertRoleEditable(customRole('c'))).not.toThrow();
  });

  it('forbids deleting system roles, even unused', () => {
    expect(() => assertRoleDeletable(MANAGER_ROLE, 0)).toThrow(
      expect.objectContaining({ code: 'system_role_immutable', operation: 'delete' }),
    );
  });

  it('forbids deleting a role in use', () => {
    expect(() => assertRoleDeletable(customRole('c'), 2)).toThrow(RoleInUse);
  });

  it('allows deleting an unused custom role', () => {
    expect(() => assertRoleDeletable(customRole('c'), 0)).not.toThrow();
  });
});

describe('domain errors', () => {
  it('share a base class, a stable code and the class name', () => {
    const errors = [
      new ForbiddenEscalation('owner_only'),
      new OwnerInvariantViolation(),
      new InvalidScope('empty_locations'),
      new SystemRoleImmutable('update'),
      new SystemRoleImmutable('delete'),
      new RoleInUse(),
    ];
    for (const e of errors) {
      expect(e).toBeInstanceOf(IamDomainError);
      expect(e).toBeInstanceOf(Error);
      expect(e.name).toBe(e.constructor.name);
      expect(e.code).toMatch(/^[a-z_]+$/);
    }
    expect(errors.map((e) => e.code)).toEqual([
      'forbidden_escalation',
      'owner_invariant_violation',
      'invalid_scope',
      'system_role_immutable',
      'system_role_immutable',
      'role_in_use',
    ]);
    expect(errors[3].message).toContain('edited');
    expect(errors[4].message).toContain('deleted');
  });
});

describe('admin API errors', () => {
  it.each([
    [new PermissionDenied('users:manage'), 'permission_denied', 'Forbidden'],
    [new ResourceNotFound('user'), 'not_found', 'Not found'],
    [new ResourceConflict('Could not create the user'), 'conflict', 'Could not create the user'],
    [new InvalidCursor(), 'invalid_cursor', 'Invalid cursor'],
  ])('%o has a stable code and a generic message', (error, code, message) => {
    expect(error).toBeInstanceOf(IamDomainError);
    expect(error).toMatchObject({ code, message, name: error.constructor.name });
  });
});
