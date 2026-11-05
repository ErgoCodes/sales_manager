import { createHash, randomBytes } from 'node:crypto';

import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { uuidv7 } from '../../src/infrastructure/db/uuidv7';
import type { RefreshTokenRepository } from '../../src/modules/iam/domain/auth-ports';
import { DrizzleTenantUnitOfWork } from '../../src/modules/iam/infrastructure/drizzle-tenant-unit-of-work';
import { adminPool, appDatabase, resetTenants } from './helpers';

/**
 * Review of SP2·T3: a revocation that overlaps an uncommitted rotation must not
 * leave the rotated-in token alive. Under READ COMMITTED a bare
 * `UPDATE ... WHERE family_id = $1` waits for the locked old token but never
 * sees the new one, so revocations serialize with rotations per device.
 */
const TENANT = uuidv7();
const DAY = 24 * 60 * 60 * 1000;

let admin: Pool;
let app: ReturnType<typeof appDatabase>;
let uow: DrizzleTenantUnitOfWork;
let deviceId: string;
let familyId: string;
let oldHash: Buffer;

const hash = () => createHash('sha256').update(randomBytes(32)).digest();

beforeAll(() => {
  admin = adminPool();
  app = appDatabase(2);
  uow = new DrizzleTenantUnitOfWork(app.db);
});
afterAll(async () => {
  await resetTenants(admin);
  await admin.end();
  await app.pool.end();
});
beforeEach(async () => {
  await resetTenants(admin);
  const userId = uuidv7();
  deviceId = uuidv7();
  familyId = uuidv7();
  oldHash = hash();
  await admin.query(`insert into tenants (id, name, slug) values ($1, 'Race', 'race')`, [TENANT]);
  await admin.query(`insert into users (id, tenant_id, email, display_name, password_hash) values ($1, $2, 'race@example.com', 'race', 'x')`, [
    userId,
    TENANT,
  ]);
  await admin.query(`insert into devices (id, tenant_id, user_id, label, platform) values ($1, $2, $3, 'Phone', 'android')`, [deviceId, TENANT, userId]);
  const now = new Date();
  await admin.query(
    `insert into refresh_tokens (id, tenant_id, device_id, family_id, token_hash, expires_at, absolute_expires_at)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [uuidv7(), TENANT, deviceId, familyId, oldHash, new Date(now.getTime() + DAY), new Date(now.getTime() + 30 * DAY)],
  );
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** Rotates the old token inside a transaction that stays open until `release` resolves. */
async function rotateAndHold(rotated: () => void, release: Promise<void>) {
  await uow.run(TENANT, async ({ refreshTokens: repo }) => {
    const row = await repo.findForUpdate(oldHash);
    expect(row).not.toBeNull();
    const now = new Date();
    await repo.markRotated(row!.id, now);
    await repo.append(row!.familyId, {
      deviceId: row!.deviceId,
      tokenHash: hash(),
      expiresAt: new Date(now.getTime() + DAY),
      absoluteExpiresAt: row!.absoluteExpiresAt,
      now,
    });
    rotated();
    await release;
  });
}

async function liveTokens() {
  const { rows } = await admin.query<{ n: number }>(`select count(*)::int as n from refresh_tokens where family_id = $1 and revoked_at is null`, [
    familyId,
  ]);
  return rows[0]!.n;
}

async function race(revoke: (repo: RefreshTokenRepository) => Promise<void>) {
  const rotated = deferred();
  const release = deferred();
  const rotation = rotateAndHold(rotated.resolve, release.promise);
  await rotated.promise;
  const revocation = uow.run(TENANT, ({ refreshTokens }) => revoke(refreshTokens));
  // Give the revocation time to block on the open rotation before it commits.
  await new Promise((r) => setTimeout(r, 200));
  release.resolve();
  await Promise.all([rotation, revocation]);
}

describe('refresh revocation vs. concurrent rotation (SP2·T3 review)', () => {
  it('revokeFamily also revokes the token an overlapping rotation inserts', async () => {
    await race((repo) => repo.revokeFamily(familyId, 'logout', new Date()));
    expect(await liveTokens()).toBe(0);
  });

  it('revokeByDevices also revokes the token an overlapping rotation inserts', async () => {
    await race((repo) => repo.revokeByDevices([deviceId], 'superseded', new Date()));
    expect(await liveTokens()).toBe(0);
  });

  it('a rotation that starts after a committed revocation finds the token revoked', async () => {
    await uow.run(TENANT, ({ refreshTokens }) => refreshTokens.revokeFamily(familyId, 'logout', new Date()));
    const row = await uow.run(TENANT, ({ refreshTokens }) => refreshTokens.findForUpdate(oldHash));
    expect(row?.revokedAt).not.toBeNull();
  });
});
