import { createHash, randomUUID } from 'node:crypto';

import type {
  AccessTokenClaims,
  AccessTokenService,
  ActorState,
  AuditEntry,
  Clock,
  IamTenantScope,
  NewRefreshToken,
  PasswordHasher,
  PreAuthLookup,
  RefreshTokenCodec,
  SecurityLog,
  TenantUnitOfWork,
  UserRecord,
} from '../../domain/auth-ports';

export const TENANT = '0190a000-0000-7000-8000-000000000001';

interface Device {
  id: string;
  userId: string;
  label: string;
  platform: string;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
}
interface Token {
  id: string;
  familyId: string;
  deviceId: string;
  hash: string;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  rotatedAt: Date | null;
  revokedAt: Date | null;
  reason: string | null;
}

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

/**
 * In-memory IAM persistence with transaction semantics: `run` works on a copy
 * and only keeps it if `work` resolves, like `withTenant` (commit/rollback).
 */
export class FakeIam implements TenantUnitOfWork, PreAuthLookup {
  users = new Map<string, UserRecord & { tenantId: string }>();
  devices: Device[] = [];
  tokens: Token[] = [];
  audit: AuditEntry[] = [];
  actorState: ActorState | null = null;
  runs: string[] = [];

  addUser(overrides: Partial<UserRecord> = {}): UserRecord {
    const user: UserRecord & { tenantId: string } = {
      id: randomUUID(),
      email: 'user@example.com',
      displayName: 'User',
      status: 'active',
      mustChangePassword: false,
      passwordHash: 'hash:secret password',
      passwordExpiresAt: null,
      tenantId: TENANT,
      ...overrides,
    };
    this.users.set(user.id, user);
    return user;
  }

  async findUserByEmail(email: string) {
    const user = [...this.users.values()].find((u) => u.email === email);
    return user ? { id: user.id, tenantId: user.tenantId, passwordHash: user.passwordHash, status: user.status } : null;
  }

  async findRefreshTenant(tokenHash: Uint8Array) {
    return this.tokens.some((t) => t.hash === hex(tokenHash)) ? { tenantId: TENANT } : null;
  }

  async run<T>(tenantId: string, work: (scope: IamTenantScope) => Promise<T>): Promise<T> {
    this.runs.push(tenantId);
    const snapshot = structuredClone({ users: this.users, devices: this.devices, tokens: this.tokens, audit: this.audit });
    try {
      return await work(this.scope());
    } catch (error) {
      Object.assign(this, snapshot);
      throw error;
    }
  }

  private scope(): IamTenantScope {
    const revoke = (tokens: Token[], reason: string, now: Date) =>
      tokens.filter((t) => t.revokedAt === null).forEach((t) => Object.assign(t, { revokedAt: now, reason }));
    const insert = (familyId: string, t: NewRefreshToken) =>
      this.tokens.push({
        id: randomUUID(),
        familyId,
        deviceId: t.deviceId,
        hash: hex(t.tokenHash),
        expiresAt: t.expiresAt,
        absoluteExpiresAt: t.absoluteExpiresAt,
        rotatedAt: null,
        revokedAt: null,
        reason: null,
      });
    return {
      users: {
        findById: async (id) => this.users.get(id) ?? null,
        setPassword: async (id, passwordHash) => {
          Object.assign(this.users.get(id)!, { passwordHash, mustChangePassword: false, passwordExpiresAt: null });
        },
      },
      tenants: { findCurrent: async () => ({ id: TENANT, name: 'Tenant', slug: 'tenant' }) },
      devices: {
        findActive: async (id, userId) => this.devices.find((d) => d.id === id && d.userId === userId && d.revokedAt === null) ?? null,
        create: async ({ userId, label, platform, now }) => {
          const id = randomUUID();
          this.devices.push({ id, userId, label, platform, lastSeenAt: now, revokedAt: null });
          return id;
        },
        touch: async (id, now) => {
          this.devices.find((d) => d.id === id)!.lastSeenAt = now;
        },
        revokeAllExcept: async (userId, keep, now) => {
          const revoked = this.devices.filter((d) => d.userId === userId && d.id !== keep && d.revokedAt === null);
          revoked.forEach((d) => (d.revokedAt = now));
          return revoked.map((d) => d.id);
        },
      },
      refreshTokens: {
        startFamily: async (t) => {
          const familyId = randomUUID();
          insert(familyId, t);
          return familyId;
        },
        append: async (familyId, t) => {
          insert(familyId, t);
        },
        findForUpdate: async (tokenHash) => {
          const t = this.tokens.find((x) => x.hash === hex(tokenHash));
          if (!t) return null;
          const device = this.devices.find((d) => d.id === t.deviceId)!;
          const user = this.users.get(device.userId)!;
          return { ...t, userId: device.userId, deviceRevokedAt: device.revokedAt, userStatus: user.status };
        },
        markRotated: async (id, now) => {
          this.tokens.find((t) => t.id === id)!.rotatedAt = now;
        },
        revokeFamily: async (familyId, reason, now) => revoke(this.tokens.filter((t) => t.familyId === familyId), reason, now),
        revokeByDevices: async (ids, reason, now) => revoke(this.tokens.filter((t) => ids.includes(t.deviceId)), reason, now),
      },
      audit: {
        record: async (entry) => {
          this.audit.push(entry);
        },
      },
      actors: { load: async () => this.actorState },
    };
  }
}

/** Deterministic "hash": `hash:<password>`. */
export const fakeHasher: PasswordHasher & { dummyCalls: number } = {
  dummyCalls: 0,
  hash: async (password) => `hash:${password}`,
  verify: async (hash, password) => hash === `hash:${password}`,
  async verifyDummy() {
    this.dummyCalls += 1;
  },
};

let tokenCounter = 0;
export const fakeCodec: RefreshTokenCodec = {
  generate() {
    tokenCounter += 1;
    const token = `refresh-${tokenCounter}`;
    return { token, hash: this.hash(token) };
  },
  hash: (token) => createHash('sha256').update(token).digest(),
};

export class FakeAccessTokens implements AccessTokenService {
  issued: AccessTokenClaims[] = [];
  valid = new Map<string, AccessTokenClaims>();

  async issue(claims: AccessTokenClaims) {
    this.issued.push(claims);
    const token = `access-${this.issued.length}`;
    this.valid.set(token, claims);
    return { token, expiresIn: 600 };
  }

  async verify(token: string) {
    return this.valid.get(token) ?? null;
  }
}

export class FakeClock implements Clock {
  constructor(public current = new Date('2026-11-05T12:00:00Z')) {}

  now() {
    return new Date(this.current);
  }

  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export const fakeSecurityLog = (): SecurityLog & { unknown: (string | null)[] } => {
  const unknown: (string | null)[] = [];
  return { unknown, loginWithUnknownEmail: ({ ip }) => void unknown.push(ip) };
};
