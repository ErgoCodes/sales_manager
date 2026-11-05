import { AuthTokens, PERMISSIONS, type Permission } from '@monaco/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Pool } from 'pg';
import request from 'supertest';

import { CLIENT_IP_HEADER } from '../../src/common/http/client-ip';
import { uuidv7 } from '../../src/infrastructure/db/uuidv7';
import { SYSTEM_ROLES } from '../../src/modules/iam/domain/system-roles';
import { Argon2PasswordHasher } from '../../src/modules/iam/infrastructure/argon2-password-hasher';
import { freshIp, PASSWORD, signedIpHeader } from './auth-fixtures';

const hasher = new Argon2PasswordHasher();
let passwordHash: Promise<string> | undefined;

export type ScopeSpec = 'tenant' | string[];

/** One tenant as the CLI will create it (T5): the three system roles, two locations and an Owner. */
export interface SeededTenant {
  id: string;
  slug: string;
  locations: [string, string];
  roles: { owner: string; manager: string; cashier: string };
  owner: string;
}

export class Seeder {
  constructor(private readonly admin: Pool) {}

  async tenant(slug: string): Promise<SeededTenant> {
    const id = uuidv7();
    await this.admin.query(`insert into tenants (id, name, slug) values ($1, $2, $3)`, [id, `Tenant ${slug}`, slug]);
    const locations: [string, string] = [await this.location(id, 'L1'), await this.location(id, 'L2')];
    const roles = {
      owner: await this.role(id, 'Owner', PERMISSIONS, 'owner'),
      manager: await this.role(id, 'Manager', SYSTEM_ROLES.manager.permissions, 'manager'),
      cashier: await this.role(id, 'Cashier', SYSTEM_ROLES.cashier.permissions, 'cashier'),
    };
    const owner = await this.user(id, `owner@${slug}.example`, [[roles.owner, 'tenant']]);
    return { id, slug, locations, roles, owner };
  }

  async location(tenant: string, code: string): Promise<string> {
    const id = uuidv7();
    await this.admin.query(`insert into locations (id, tenant_id, name, code) values ($1, $2, $3, $4)`, [id, tenant, `Location ${code}`, code]);
    return id;
  }

  async role(tenant: string, name: string, permissions: readonly Permission[], key: string | null = null): Promise<string> {
    const id = uuidv7();
    await this.admin.query(`insert into roles (id, tenant_id, key, name, is_system) values ($1, $2, $3, $4, $5)`, [id, tenant, key, name, key !== null]);
    for (const permission of permissions) {
      await this.admin.query(`insert into role_permissions (role_id, permission, tenant_id) values ($1, $2, $3)`, [id, permission, tenant]);
    }
    return id;
  }

  async user(tenant: string, email: string, assignments: [string, ScopeSpec][] = []): Promise<string> {
    const id = uuidv7();
    passwordHash ??= hasher.hash(PASSWORD);
    await this.admin.query(`insert into users (id, tenant_id, email, display_name, password_hash) values ($1, $2, $3, $4, $5)`, [
      id,
      tenant,
      email,
      email.split('@')[0],
      await passwordHash,
    ]);
    for (const [roleId, scope] of assignments) await this.assign(tenant, id, roleId, scope);
    return id;
  }

  async assign(tenant: string, userId: string, roleId: string, scope: ScopeSpec): Promise<string> {
    const id = uuidv7();
    await this.admin.query(`insert into role_assignments (id, tenant_id, user_id, role_id, scope) values ($1, $2, $3, $4, $5)`, [
      id,
      tenant,
      userId,
      roleId,
      scope === 'tenant' ? 'tenant' : 'locations',
    ]);
    for (const locationId of scope === 'tenant' ? [] : scope) {
      await this.admin.query(`insert into role_assignment_locations (assignment_id, location_id, tenant_id) values ($1, $2, $3)`, [id, locationId, tenant]);
    }
    return id;
  }
}

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

/** An HTTP client authenticated as one user, going through the "BFF" (signed client IP on every request). */
export class Session {
  constructor(
    private readonly app: NestExpressApplication,
    readonly token: string,
    readonly deviceId: string,
    readonly ip = freshIp(),
  ) {}

  call(method: Method, path: string, body?: object) {
    const pathOnly = path.split('?')[0]!;
    const agent = request(this.app.getHttpServer());
    const req = agent[method](path)
      .set('authorization', `Bearer ${this.token}`)
      .set(CLIENT_IP_HEADER, signedIpHeader(method.toUpperCase(), pathOnly, this.ip));
    return body ? req.send(body) : req;
  }

  get = (path: string) => this.call('get', path);
  post = (path: string, body: object = {}) => this.call('post', path, body);
  patch = (path: string, body: object) => this.call('patch', path, body);
  put = (path: string, body: object) => this.call('put', path, body);
  delete = (path: string) => this.call('delete', path);
}

export async function loginAs(app: NestExpressApplication, email: string, password = PASSWORD): Promise<Session> {
  const ip = freshIp();
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .set(CLIENT_IP_HEADER, signedIpHeader('POST', '/auth/login', ip))
    .send({ email, password })
    .expect(200);
  const tokens = AuthTokens.parse(res.body);
  return new Session(app, tokens.accessToken, tokens.deviceId);
}

export async function auditRows(admin: Pool, tenant: string) {
  const { rows } = await admin.query<{ type: string; actor_user_id: string | null; target_id: string | null; metadata: Record<string, unknown> }>(
    'select type, actor_user_id, target_id, metadata from audit_events where tenant_id = $1 order by created_at, id',
    [tenant],
  );
  return rows;
}

export async function resetAll(admin: Pool): Promise<void> {
  await admin.query('truncate table tenants cascade');
  await admin.query('truncate table rate_limits');
}
