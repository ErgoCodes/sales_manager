import { PERMISSIONS } from '@monaco/contracts';
import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { locations, tenantRef } from './tenants';
import { tenantIsolationPolicy } from './tenancy';
import { bytea, citext, createdAt, primaryId } from './types';

/*
 * Identity and access (SP2 spec, "Modelo de datos"). Every reference between
 * tenant-owned rows is a composite FK (x_id, tenant_id) -> parent (id,
 * tenant_id): RLS does not check the referenced row and FK checks ignore RLS,
 * so a plain FK would let one tenant point at (and probe for) another tenant's
 * ids (ADR 0003).
 */

export const USER_STATUSES = ['active', 'disabled'] as const;
export const SYSTEM_ROLE_KEYS = ['owner', 'manager', 'cashier'] as const;
export const ASSIGNMENT_SCOPES = ['tenant', 'locations'] as const;
export const DEVICE_PLATFORMS = ['web', 'android', 'ios'] as const;

const oneOf = (column: string, values: readonly string[]) =>
  sql.raw(`${column} in (${values.map((value) => `'${value}'`).join(', ')})`);

export const users = pgTable(
  'users',
  {
    id: primaryId(),
    tenantId: tenantRef(),
    // Unique across tenants: login looks the user up before knowing the tenant.
    email: citext('email').notNull().unique('users_email_unique'),
    displayName: text('display_name').notNull(),
    // Never leaves the persistence adapter.
    passwordHash: text('password_hash').notNull(),
    status: text('status', { enum: USER_STATUSES }).notNull().default('active'),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    // When a temporary password stops working (72 h after it is set).
    passwordExpiresAt: timestamp('password_expires_at', { withTimezone: true }),
    authzVersion: integer('authz_version').notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [
    check('users_status_check', oneOf('status', USER_STATUSES)),
    unique('users_id_tenant_id_unique').on(t.id, t.tenantId),
    index('users_tenant_id_idx').on(t.tenantId),
    tenantIsolationPolicy('users'),
  ],
);

export const roles = pgTable(
  'roles',
  {
    id: primaryId(),
    tenantId: tenantRef(),
    // owner / manager / cashier for system roles, null for custom ones.
    key: text('key', { enum: SYSTEM_ROLE_KEYS }),
    name: text('name').notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    check('roles_key_check', oneOf('key', SYSTEM_ROLE_KEYS)),
    check('roles_system_key_check', sql`${t.isSystem} = (${t.key} is not null)`),
    unique('roles_tenant_id_name_unique').on(t.tenantId, t.name),
    unique('roles_tenant_id_key_unique').on(t.tenantId, t.key),
    unique('roles_id_tenant_id_unique').on(t.id, t.tenantId),
    tenantIsolationPolicy('roles'),
  ],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id').notNull(),
    // The catalog (PERMISSIONS) lives in packages/contracts. The use cases
    // validate against it and the CHECK below is generated from it, so adding a
    // permission means a new migration (a test fails until it exists).
    permission: text('permission').notNull(),
    tenantId: tenantRef(),
  },
  (t) => [
    primaryKey({ name: 'role_permissions_pkey', columns: [t.roleId, t.permission] }),
    check('role_permissions_permission_check', oneOf('permission', PERMISSIONS)),
    foreignKey({ name: 'role_permissions_role_fk', columns: [t.roleId, t.tenantId], foreignColumns: [roles.id, roles.tenantId] }).onDelete(
      'cascade',
    ),
    index('role_permissions_tenant_id_idx').on(t.tenantId),
    tenantIsolationPolicy('role_permissions'),
  ],
);

export const roleAssignments = pgTable(
  'role_assignments',
  {
    id: primaryId(),
    tenantId: tenantRef(),
    userId: uuid('user_id').notNull(),
    roleId: uuid('role_id').notNull(),
    scope: text('scope', { enum: ASSIGNMENT_SCOPES }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('role_assignments_scope_check', oneOf('scope', ASSIGNMENT_SCOPES)),
    unique('role_assignments_user_id_role_id_unique').on(t.userId, t.roleId),
    unique('role_assignments_id_tenant_id_unique').on(t.id, t.tenantId),
    foreignKey({ name: 'role_assignments_user_fk', columns: [t.userId, t.tenantId], foreignColumns: [users.id, users.tenantId] }),
    // No cascade: a role in use cannot be deleted (409).
    foreignKey({ name: 'role_assignments_role_fk', columns: [t.roleId, t.tenantId], foreignColumns: [roles.id, roles.tenantId] }),
    index('role_assignments_tenant_id_role_id_idx').on(t.tenantId, t.roleId),
    tenantIsolationPolicy('role_assignments'),
  ],
);

/** Locations of an assignment with scope = 'locations' (enforced by the use case). */
export const roleAssignmentLocations = pgTable(
  'role_assignment_locations',
  {
    assignmentId: uuid('assignment_id').notNull(),
    locationId: uuid('location_id').notNull(),
    tenantId: tenantRef(),
  },
  (t) => [
    primaryKey({ name: 'role_assignment_locations_pkey', columns: [t.assignmentId, t.locationId] }),
    foreignKey({
      name: 'role_assignment_locations_assignment_fk',
      columns: [t.assignmentId, t.tenantId],
      foreignColumns: [roleAssignments.id, roleAssignments.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'role_assignment_locations_location_fk',
      columns: [t.locationId, t.tenantId],
      foreignColumns: [locations.id, locations.tenantId],
    }),
    index('role_assignment_locations_tenant_id_location_id_idx').on(t.tenantId, t.locationId),
    tenantIsolationPolicy('role_assignment_locations'),
  ],
);

export const devices = pgTable(
  'devices',
  {
    id: primaryId(),
    tenantId: tenantRef(),
    userId: uuid('user_id').notNull(),
    label: text('label').notNull(),
    platform: text('platform', { enum: DEVICE_PLATFORMS }).notNull(),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    check('devices_platform_check', oneOf('platform', DEVICE_PLATFORMS)),
    unique('devices_id_tenant_id_unique').on(t.id, t.tenantId),
    foreignKey({ name: 'devices_user_fk', columns: [t.userId, t.tenantId], foreignColumns: [users.id, users.tenantId] }),
    index('devices_tenant_id_user_id_idx').on(t.tenantId, t.userId),
    tenantIsolationPolicy('devices'),
  ],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: primaryId(),
    tenantId: tenantRef(),
    deviceId: uuid('device_id').notNull(),
    // The `sid` claim: every rotation of one login shares it.
    familyId: uuid('family_id').notNull(),
    // SHA-256 of the opaque token; the token itself is never stored.
    tokenHash: bytea('token_hash').notNull().unique('refresh_tokens_token_hash_unique'),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
  },
  (t) => [
    check('refresh_tokens_token_hash_check', sql`octet_length(${t.tokenHash}) = 32`),
    foreignKey({ name: 'refresh_tokens_device_fk', columns: [t.deviceId, t.tenantId], foreignColumns: [devices.id, devices.tenantId] }),
    index('refresh_tokens_tenant_id_family_id_idx').on(t.tenantId, t.familyId),
    index('refresh_tokens_tenant_id_device_id_idx').on(t.tenantId, t.deviceId),
    tenantIsolationPolicy('refresh_tokens'),
  ],
);
