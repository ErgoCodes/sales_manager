import type { AuditEventType, DevicePlatform, Permission, SystemRoleKey } from '@monaco/contracts';

import type { SessionRevocationReason } from './auth-policy';

/*
 * Outbound ports of authentication (ADR 0001, ADR 0004). Adapters live in
 * ../infrastructure. Tenant-scoped repositories are only reachable through
 * `TenantUnitOfWork.run`, which opens `withTenant` (RLS) around the work.
 */

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
  /** Same cost as `verify`, against a dummy hash: used when the email does not exist. */
  verifyDummy(password: string): Promise<void>;
}

export interface AccessTokenClaims {
  /** User id. */
  readonly sub: string;
  /** Tenant id. */
  readonly tid: string;
  /** Device id. */
  readonly did: string;
  /** Refresh family (session) id. */
  readonly sid: string;
}

export interface AccessTokenService {
  issue(claims: AccessTokenClaims): Promise<{ token: string; expiresIn: number }>;
  /** Claims of a valid token, or null for anything else (bad signature, expired, wrong alg/iss/aud/typ...). */
  verify(token: string): Promise<AccessTokenClaims | null>;
}

/** Opaque refresh tokens: only their SHA-256 is ever stored. */
export interface RefreshTokenCodec {
  generate(): { token: string; hash: Uint8Array };
  hash(token: string): Uint8Array;
}

/** Pre-authentication lookups (SECURITY DEFINER functions): the only reads without a tenant. */
export interface PreAuthLookup {
  findUserByEmail(email: string): Promise<{ id: string; tenantId: string; passwordHash: string; status: string } | null>;
  findRefreshTenant(tokenHash: Uint8Array): Promise<{ tenantId: string } | null>;
}

export interface UserRecord {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly status: 'active' | 'disabled';
  readonly mustChangePassword: boolean;
  readonly passwordHash: string;
  readonly passwordExpiresAt: Date | null;
}

export interface UserRepository {
  findById(userId: string): Promise<UserRecord | null>;
  /** Sets a new password chosen by the user: clears `must_change_password` and the expiry. */
  setPassword(userId: string, passwordHash: string): Promise<void>;
}

export interface TenantRecord {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export interface TenantRepository {
  findCurrent(): Promise<TenantRecord | null>;
}

export interface DeviceRepository {
  /** The device if it belongs to `userId` and is not revoked. */
  findActive(deviceId: string, userId: string): Promise<{ id: string } | null>;
  create(input: { userId: string; label: string; platform: DevicePlatform; now: Date }): Promise<string>;
  touch(deviceId: string, now: Date): Promise<void>;
  /** Revokes every active device of the user but `keepDeviceId`; returns the revoked ids. */
  revokeAllExcept(userId: string, keepDeviceId: string, now: Date): Promise<string[]>;
}

export interface RefreshTokenRecord {
  readonly id: string;
  readonly familyId: string;
  readonly deviceId: string;
  readonly userId: string;
  readonly expiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly rotatedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly deviceRevokedAt: Date | null;
  readonly userStatus: 'active' | 'disabled';
}

export interface NewRefreshToken {
  readonly deviceId: string;
  readonly tokenHash: Uint8Array;
  readonly expiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly now: Date;
}

export interface RefreshTokenRepository {
  /** Starts a new family (login, password change); returns its id. */
  startFamily(token: NewRefreshToken): Promise<string>;
  /** Adds the next token of a family (rotation). */
  append(familyId: string, token: NewRefreshToken): Promise<void>;
  /** Locks the token row (`FOR UPDATE`) together with its device and user state. */
  findForUpdate(tokenHash: Uint8Array): Promise<RefreshTokenRecord | null>;
  markRotated(tokenId: string, now: Date): Promise<void>;
  revokeFamily(familyId: string, reason: SessionRevocationReason, now: Date): Promise<void>;
  revokeByDevices(deviceIds: readonly string[], reason: SessionRevocationReason, now: Date): Promise<void>;
}

export interface AuditEntry {
  readonly type: AuditEventType;
  readonly actorUserId: string | null;
  readonly targetType?: string;
  readonly targetId?: string;
  /** Never secrets, hashes or tokens. */
  readonly metadata?: Record<string, unknown>;
  readonly ip: string | null;
}

export interface AuditLog {
  record(entry: AuditEntry): Promise<void>;
}

/** One assignment as stored: the raw input of `effectivePermissions`. */
export interface StoredAssignment {
  readonly roleId: string;
  readonly roleKey: SystemRoleKey | null;
  readonly isSystem: boolean;
  readonly permissions: readonly Permission[];
  readonly scope: 'tenant' | 'locations';
  /** Non-archived locations of a `locations` assignment. */
  readonly locationIds: readonly string[];
}

/** Everything the per-request check needs, read in a single query. */
export interface ActorState {
  readonly userActive: boolean;
  readonly mustChangePassword: boolean;
  readonly deviceActive: boolean;
  readonly sessionActive: boolean;
  readonly assignments: readonly StoredAssignment[];
}

export interface ActorStateReader {
  /** Null when the user or the device (of that user) does not exist in the tenant. */
  load(userId: string, deviceId: string, sessionId: string): Promise<ActorState | null>;
}

/** Repositories bound to one tenant-scoped transaction. */
export interface IamTenantScope {
  readonly users: UserRepository;
  readonly tenants: TenantRepository;
  readonly devices: DeviceRepository;
  readonly refreshTokens: RefreshTokenRepository;
  readonly audit: AuditLog;
  readonly actors: ActorStateReader;
}

/**
 * Runs `work` in one transaction scoped to `tenantId` (adapter: `withTenant`).
 * Whatever `work` returns is committed; a throw rolls everything back, so a
 * use case that must persist something *and* fail (reuse detection, a failed
 * login's audit) returns an outcome and throws after `run` resolves.
 */
export interface TenantUnitOfWork {
  run<T>(tenantId: string, work: (scope: IamTenantScope) => Promise<T>): Promise<T>;
}

/** Structured security log for events that have no tenant (unknown emails). */
export interface SecurityLog {
  loginWithUnknownEmail(context: { ip: string | null }): void;
}

export interface Clock {
  now(): Date;
}
