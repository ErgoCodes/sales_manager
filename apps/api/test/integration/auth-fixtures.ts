import { PERMISSIONS } from '@monaco/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Pool } from 'pg';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { signClientIp } from '../../src/common/http/client-ip';
import { TEST_IP_SECRET, testConfig } from '../../src/__tests__/test-config';
import { uuidv7 } from '../../src/infrastructure/db/uuidv7';
import { Argon2PasswordHasher } from '../../src/modules/iam/infrastructure/argon2-password-hasher';
import { urls } from './helpers';

// UUIDv7 like every id the API emits (the response contracts require v7).
export const AUTH_TENANT_A = uuidv7();
export const AUTH_TENANT_B = uuidv7();
const TENANT_A = AUTH_TENANT_A;
const TENANT_B = AUTH_TENANT_B;

export const PASSWORD = 'correct horse battery staple';
const hasher = new Argon2PasswordHasher();

export interface SeededUser {
  id: string;
  email: string;
}

export interface AuthSeed {
  owner: SeededUser;
  cashier: SeededUser;
  other: SeededUser;
  location: string;
}

/** Tenant A: owner (all permissions, tenant-wide) and cashier (sales:create at one location). Tenant B: one user. */
export async function seedAuth(admin: Pool): Promise<AuthSeed> {
  const hash = await hasher.hash(PASSWORD);
  await admin.query(`insert into tenants (id, name, slug) values ($1, 'Tenant A', 'tenant-a'), ($2, 'Tenant B', 'tenant-b')`, [TENANT_A, TENANT_B]);
  const location = uuidv7();
  await admin.query(`insert into locations (id, tenant_id, name, code) values ($1, $2, 'Centro', 'centro')`, [location, TENANT_A]);

  const user = async (tenant: string, email: string): Promise<SeededUser> => {
    const id = uuidv7();
    await admin.query(`insert into users (id, tenant_id, email, display_name, password_hash) values ($1, $2, $3, $4, $5)`, [
      id,
      tenant,
      email,
      email.split('@')[0],
      hash,
    ]);
    return { id, email };
  };
  const role = async (tenant: string, key: string | null, name: string, permissions: readonly string[]) => {
    const id = uuidv7();
    await admin.query(`insert into roles (id, tenant_id, key, name, is_system) values ($1, $2, $3, $4, $5)`, [id, tenant, key, name, key !== null]);
    for (const permission of permissions) {
      await admin.query(`insert into role_permissions (role_id, permission, tenant_id) values ($1, $2, $3)`, [id, permission, tenant]);
    }
    return id;
  };
  const assign = async (tenant: string, userId: string, roleId: string, locationIds?: string[]) => {
    const id = uuidv7();
    await admin.query(`insert into role_assignments (id, tenant_id, user_id, role_id, scope) values ($1, $2, $3, $4, $5)`, [
      id,
      tenant,
      userId,
      roleId,
      locationIds ? 'locations' : 'tenant',
    ]);
    for (const locationId of locationIds ?? []) {
      await admin.query(`insert into role_assignment_locations (assignment_id, location_id, tenant_id) values ($1, $2, $3)`, [id, locationId, tenant]);
    }
  };

  const owner = await user(TENANT_A, 'owner@a.example');
  const cashier = await user(TENANT_A, 'cashier@a.example');
  const other = await user(TENANT_B, 'owner@b.example');
  await assign(TENANT_A, owner.id, await role(TENANT_A, 'owner', 'Owner', PERMISSIONS));
  await assign(TENANT_A, cashier.id, await role(TENANT_A, 'cashier', 'Cashier', ['sales:create']), [location]);
  await assign(TENANT_B, other.id, await role(TENANT_B, 'owner', 'Owner', PERMISSIONS));
  return { owner, cashier, other, location };
}

export async function createAuthApp(extraControllers: NonNullable<Parameters<typeof Test.createTestingModule>[0]['controllers']> = []) {
  const config = testConfig({ DATABASE_URL: urls().app, LOG_LEVEL: (process.env.IT_LOG_LEVEL as 'error' | undefined) ?? 'silent' });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)], controllers: extraControllers }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configureApp(app, config);
  await app.init();
  return app;
}

let ipCounter = 0;
/** A fresh documentation-range IP per call, so rate-limit keys never collide between tests. */
export function freshIp(): string {
  ipCounter += 1;
  return `198.51.${Math.floor(ipCounter / 250) % 250}.${(ipCounter % 250) + 1}`;
}

/** The header the BFF sends (signed with the test secret, current time). */
export function signedIpHeader(method: string, path: string, ip: string, timestamp = Math.floor(Date.now() / 1000), secret = TEST_IP_SECRET) {
  return signClientIp({ secret, ip, method, path, timestamp });
}
