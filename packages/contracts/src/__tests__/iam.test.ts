import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  ADMIN_PERMISSIONS,
  Assignment,
  AssignmentInput,
  AssignmentScope,
  AUDIT_EVENT_TYPES,
  AuditEvent,
  AuthTokens,
  ChangePasswordRequest,
  CreateLocationRequest,
  CreateRoleRequest,
  CreateUserRequest,
  CreateUserResponse,
  Device,
  Email,
  Location,
  LoginRequest,
  MeResponse,
  Password,
  PaginatedAuditEvents,
  PaginatedDevices,
  PaginatedLocations,
  PaginatedRoles,
  PaginatedUsers,
  Permission,
  PERMISSIONS,
  RefreshRequest,
  RefreshResponse,
  ReplaceAssignmentsRequest,
  ReplaceAssignmentsResponse,
  ResetPasswordResponse,
  Role,
  UpdateLocationRequest,
  UpdateRoleRequest,
  UpdateUserRequest,
  User,
  UserDetail,
} from '../index';

const U1 = '018f3b5e-7c1a-7000-8000-0123456789ab';
const U2 = '018f3b5e-7c1a-7000-8000-0123456789ac';
const NOW = '2026-11-05T12:00:00Z';
const ok = (schema: z.ZodType, value: unknown) => expect(schema.safeParse(value).success).toBe(true);
const bad = (schema: z.ZodType, value: unknown) => expect(schema.safeParse(value).success).toBe(false);

describe('permission catalog', () => {
  it('matches the v1 catalog of the SP2 spec', () => {
    expect([...PERMISSIONS]).toEqual([
      'tenant:manage',
      'locations:manage',
      'users:manage',
      'roles:manage',
      'devices:manage',
      'audit:view',
      'catalog:write',
      'inventory:write',
      'inventory:transfer',
      'sales:create',
      'sales:void',
      'reports:view',
      'cash:close',
    ]);
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  it('administrative permissions are tenant-only and part of the catalog', () => {
    expect([...ADMIN_PERMISSIONS].sort()).toEqual(
      ['audit:view', 'locations:manage', 'roles:manage', 'tenant:manage', 'users:manage'].sort(),
    );
    for (const p of ADMIN_PERMISSIONS) expect(PERMISSIONS).toContain(p);
    expect(ADMIN_PERMISSIONS).not.toContain('devices:manage');
  });

  it('Permission validates catalog entries only', () => {
    for (const p of PERMISSIONS) ok(Permission, p);
    bad(Permission, 'sales:delete');
    bad(Permission, 'inventory:*');
    bad(Permission, '');
  });
});

describe('AssignmentScope', () => {
  it('accepts tenant and a locations list', () => {
    ok(AssignmentScope, { type: 'tenant' });
    ok(AssignmentScope, { type: 'locations', locationIds: [U1] });
    ok(AssignmentScope, { type: 'locations', locationIds: [U1, U2] });
  });
  it('rejects empty, duplicate, non-uuid and oversized lists', () => {
    bad(AssignmentScope, { type: 'locations', locationIds: [] });
    bad(AssignmentScope, { type: 'locations', locationIds: [U1, U1] });
    bad(AssignmentScope, { type: 'locations', locationIds: ['x'] });
    bad(AssignmentScope, { type: 'locations' });
    bad(
      AssignmentScope,
      { type: 'locations', locationIds: Array.from({ length: 201 }, (_, i) => `018f3b5e-7c1a-7000-8000-${String(i).padStart(12, '0')}`) },
    );
  });
  it('rejects unknown types', () => bad(AssignmentScope, { type: 'region' }));
});

describe('auth requests', () => {
  const login = { email: 'a@b.co', password: 'x'.repeat(12) };

  it('LoginRequest accepts email + password, with optional device data', () => {
    ok(LoginRequest, login);
    ok(LoginRequest, { ...login, deviceId: U1, device: { label: 'Chrome', platform: 'web' } });
  });
  it('LoginRequest rejects short/long passwords, bad emails and bad devices', () => {
    bad(LoginRequest, { ...login, password: 'x'.repeat(11) });
    bad(LoginRequest, { ...login, password: 'x'.repeat(257) });
    bad(LoginRequest, { ...login, email: 'not-an-email' });
    bad(LoginRequest, { ...login, email: `${'a'.repeat(250)}@b.co` });
    bad(LoginRequest, { ...login, deviceId: 'nope' });
    bad(LoginRequest, { ...login, device: { label: '', platform: 'web' } });
    bad(LoginRequest, { ...login, device: { label: 'x', platform: 'tv' } });
    bad(LoginRequest, { password: login.password });
  });
  it('Password allows exactly 12..256 characters and no composition rules', () => {
    ok(Password, 'a'.repeat(12));
    ok(Password, 'a'.repeat(256));
    bad(Password, 'a'.repeat(11));
    bad(Password, 'a'.repeat(257));
  });
  it('Email is bounded', () => {
    ok(Email, 'x@y.io');
    bad(Email, 'x');
  });

  it('ChangePasswordRequest needs a new, long enough password', () => {
    ok(ChangePasswordRequest, { currentPassword: 'old', newPassword: 'n'.repeat(12) });
    bad(ChangePasswordRequest, { currentPassword: 'old', newPassword: 'short' });
    bad(ChangePasswordRequest, { currentPassword: 'n'.repeat(12), newPassword: 'n'.repeat(12) });
    bad(ChangePasswordRequest, { currentPassword: '', newPassword: 'n'.repeat(12) });
    bad(ChangePasswordRequest, { currentPassword: 'x'.repeat(257), newPassword: 'n'.repeat(12) });
  });

  it('RefreshRequest takes a bounded opaque token', () => {
    ok(RefreshRequest, { refreshToken: 't' });
    bad(RefreshRequest, { refreshToken: '' });
    bad(RefreshRequest, { refreshToken: 't'.repeat(513) });
  });
});

describe('auth responses', () => {
  it('AuthTokens', () => {
    const base = { accessToken: 'a', refreshToken: 'r', expiresIn: 600, deviceId: U1, mustChangePassword: false };
    ok(AuthTokens, base);
    bad(AuthTokens, { ...base, expiresIn: 0 });
    bad(AuthTokens, { ...base, expiresIn: 1.5 });
    bad(AuthTokens, { ...base, refreshToken: '' });
  });
  it('RefreshResponse may omit the refresh token (grace window)', () => {
    ok(RefreshResponse, { accessToken: 'a', expiresIn: 600 });
    ok(RefreshResponse, { accessToken: 'a', expiresIn: 600, refreshToken: 'r' });
    bad(RefreshResponse, { accessToken: 'a', expiresIn: 600, refreshToken: '' });
  });
});

describe('me', () => {
  const me = {
    user: { id: U1, email: 'a@b.co', displayName: 'A', mustChangePassword: false },
    tenant: { id: U2, name: 'T', slug: 't' },
    deviceId: U1,
    permissions: [
      { permission: 'sales:create', scope: { type: 'locations', locationIds: [U1] } },
      { permission: 'users:manage', scope: { type: 'tenant' } },
    ],
  };
  it('accepts permissions with scope', () => ok(MeResponse, me));
  it('rejects unknown permissions', () =>
    bad(MeResponse, { ...me, permissions: [{ permission: 'x:y', scope: { type: 'tenant' } }] }));
});

describe('locations', () => {
  it('Location / pages', () => {
    const loc = { id: U1, name: 'Centro', code: 'CTR', archivedAt: null, createdAt: NOW };
    ok(Location, loc);
    ok(Location, { ...loc, archivedAt: NOW });
    ok(PaginatedLocations, { items: [loc], nextCursor: null });
  });
  it('CreateLocationRequest validates name and code', () => {
    ok(CreateLocationRequest, { name: ' Centro ', code: 'CTR_1-a' });
    bad(CreateLocationRequest, { name: '   ', code: 'CTR' });
    bad(CreateLocationRequest, { name: 'x'.repeat(101), code: 'CTR' });
    bad(CreateLocationRequest, { name: 'x', code: 'has space' });
    bad(CreateLocationRequest, { name: 'x', code: 'c'.repeat(33) });
    bad(CreateLocationRequest, { name: 'x', code: '' });
  });
  it('UpdateLocationRequest needs at least one field', () => {
    ok(UpdateLocationRequest, { name: 'N' });
    ok(UpdateLocationRequest, { code: 'C' });
    ok(UpdateLocationRequest, { name: 'N', code: 'C' });
    bad(UpdateLocationRequest, {});
    bad(UpdateLocationRequest, { code: 'bad code' });
  });
});

describe('users', () => {
  const user = { id: U1, email: 'a@b.co', displayName: 'A', status: 'active', mustChangePassword: true, createdAt: NOW };
  const assignment = { id: U2, roleId: U1, scope: { type: 'tenant' } };

  it('User / UserDetail / page', () => {
    ok(User, user);
    bad(User, { ...user, status: 'deleted' });
    ok(UserDetail, { ...user, assignments: [assignment] });
    bad(UserDetail, user);
    ok(PaginatedUsers, { items: [user], nextCursor: 'c' });
  });
  it('CreateUserRequest / UpdateUserRequest', () => {
    ok(CreateUserRequest, { email: 'a@b.co', displayName: 'A' });
    bad(CreateUserRequest, { email: 'a@b.co', displayName: ' ' });
    bad(CreateUserRequest, { email: 'a@b.co' });
    ok(UpdateUserRequest, { displayName: 'B' });
    bad(UpdateUserRequest, { displayName: 'x'.repeat(101) });
  });
  it('temporary passwords are returned once with an expiry', () => {
    const tmp = { temporaryPassword: 't'.repeat(16), temporaryPasswordExpiresAt: NOW };
    ok(CreateUserResponse, { user, ...tmp });
    ok(ResetPasswordResponse, tmp);
    bad(ResetPasswordResponse, { temporaryPassword: 'short', temporaryPasswordExpiresAt: NOW });
    bad(ResetPasswordResponse, { temporaryPassword: tmp.temporaryPassword });
  });
});

describe('roles', () => {
  const role = { id: U1, key: null, name: 'Supervisor', isSystem: false, permissions: ['sales:create'], createdAt: NOW };
  it('Role accepts system keys or null', () => {
    ok(Role, role);
    ok(Role, { ...role, key: 'owner', isSystem: true });
    bad(Role, { ...role, key: 'admin' });
    ok(PaginatedRoles, { items: [role], nextCursor: null });
  });
  it('CreateRoleRequest needs a name and unique catalog permissions', () => {
    ok(CreateRoleRequest, { name: 'N', permissions: ['sales:create', 'sales:void'] });
    bad(CreateRoleRequest, { name: 'N', permissions: [] });
    bad(CreateRoleRequest, { name: 'N', permissions: ['sales:create', 'sales:create'] });
    bad(CreateRoleRequest, { name: 'N', permissions: ['nope'] });
    bad(CreateRoleRequest, { name: ' ', permissions: ['sales:create'] });
    bad(CreateRoleRequest, { name: 'x'.repeat(61), permissions: ['sales:create'] });
  });
  it('UpdateRoleRequest needs at least one field', () => {
    ok(UpdateRoleRequest, { name: 'N' });
    ok(UpdateRoleRequest, { permissions: ['sales:create'] });
    bad(UpdateRoleRequest, {});
    bad(UpdateRoleRequest, { permissions: [] });
  });
});

describe('assignments', () => {
  const input = { roleId: U1, scope: { type: 'locations', locationIds: [U2] } };
  it('AssignmentInput / Assignment', () => {
    ok(AssignmentInput, input);
    ok(Assignment, { id: U2, ...input });
    bad(AssignmentInput, { roleId: 'x', scope: { type: 'tenant' } });
    bad(Assignment, input);
  });
  it('ReplaceAssignmentsRequest allows clearing and caps the size', () => {
    ok(ReplaceAssignmentsRequest, { assignments: [] });
    ok(ReplaceAssignmentsRequest, { assignments: [input, { roleId: U2, scope: { type: 'tenant' } }] });
    bad(ReplaceAssignmentsRequest, { assignments: Array.from({ length: 51 }, () => input) });
    bad(ReplaceAssignmentsRequest, {});
  });
  it('ReplaceAssignmentsResponse', () => {
    ok(ReplaceAssignmentsResponse, { assignments: [{ id: U2, ...input }] });
  });
});

describe('devices and audit', () => {
  it('Device / page', () => {
    const device = {
      id: U1,
      userId: U2,
      label: 'Chrome',
      platform: 'web',
      createdAt: NOW,
      lastSeenAt: null,
      revokedAt: NOW,
      current: true,
    };
    ok(Device, device);
    bad(Device, { ...device, platform: 'tv' });
    ok(PaginatedDevices, { items: [device], nextCursor: null });
  });
  it('AuditEvent / page', () => {
    const event = {
      id: U1,
      actorUserId: null,
      type: 'refresh_reuse_detected',
      targetType: 'device',
      targetId: U2,
      metadata: { familyId: U2 },
      ip: '10.0.0.1',
      createdAt: NOW,
    };
    ok(AuditEvent, event);
    ok(AuditEvent, { ...event, targetType: null, targetId: null, ip: null, actorUserId: U2 });
    bad(AuditEvent, { ...event, type: 'made_up' });
    bad(AuditEvent, { ...event, metadata: 'x' });
    ok(PaginatedAuditEvents, { items: [event], nextCursor: null });
    expect(new Set(AUDIT_EVENT_TYPES).size).toBe(AUDIT_EVENT_TYPES.length);
  });
});

describe('OpenAPI ids', () => {
  it('every root IAM schema registers a unique id', () => {
    const schemas = {
      Permission, AssignmentScope, Password, Email, LoginRequest, AuthTokens, RefreshRequest, RefreshResponse,
      ChangePasswordRequest, MeResponse, Location, PaginatedLocations, CreateLocationRequest, UpdateLocationRequest,
      User, UserDetail, PaginatedUsers, CreateUserRequest, UpdateUserRequest, CreateUserResponse, ResetPasswordResponse,
      Role, PaginatedRoles, CreateRoleRequest, UpdateRoleRequest, AssignmentInput, Assignment,
      ReplaceAssignmentsRequest, ReplaceAssignmentsResponse, Device, PaginatedDevices, AuditEvent, PaginatedAuditEvents,
    };
    const ids = Object.entries(schemas).map(([name, schema]) => [name, z.globalRegistry.get(schema as z.ZodType)?.id]);
    for (const [name, id] of ids) expect(id, name).toBe(name);
    expect(new Set(ids.map(([, id]) => id)).size).toBe(ids.length);
  });

  it('serializes to JSON Schema with named components', () => {
    const js = z.toJSONSchema(z.object({ r: ReplaceAssignmentsRequest, m: MeResponse, p: PaginatedUsers }), {
      reused: 'ref',
    }) as { $defs?: Record<string, unknown> };
    expect(Object.keys(js.$defs ?? {})).toEqual(
      expect.arrayContaining(['AssignmentScope', 'Permission', 'PermissionGrant', 'User', 'PaginatedUsers']),
    );
  });
});
