import { Device, PaginatedAuditEvents, PaginatedDevices } from '@monaco/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { auditRows, loginAs, resetAll, type SeededTenant, Seeder } from './admin-fixtures';
import { createAuthApp } from './auth-fixtures';
import { adminPool } from './helpers';

let app: NestExpressApplication;
let admin: Pool;
let seeder: Seeder;
let a: SeededTenant;

beforeAll(async () => {
  admin = adminPool();
  seeder = new Seeder(admin);
  app = await createAuthApp();
});
afterAll(async () => {
  await app.close();
  await resetAll(admin);
  await admin.end();
});
beforeEach(async () => {
  await resetAll(admin);
  a = await seeder.tenant('a');
});

const deviceRevoked = async (id: string) => (await admin.query<{ revoked: boolean }>('select revoked_at is not null as revoked from devices where id = $1', [id])).rows[0]!.revoked;

describe('devices', () => {
  it('a user lists and revokes their own devices; the revoked session gets 401 at once', async () => {
    await seeder.user(a.id, 'cashier@a.example', [[a.roles.cashier, [a.locations[0]]]]);
    const phone = await loginAs(app, 'cashier@a.example');
    const laptop = await loginAs(app, 'cashier@a.example');

    const page = PaginatedDevices.parse((await laptop.get('/devices').expect(200)).body);
    expect(page.items.map((d) => [d.id, d.current])).toEqual([
      [laptop.deviceId, true],
      [phone.deviceId, false],
    ]);

    const revoked = Device.parse((await laptop.post(`/devices/${phone.deviceId}/revoke`).expect(200)).body);
    expect(revoked.revokedAt).not.toBeNull();
    await phone.get('/me').expect(401);
    await laptop.get('/me').expect(200);
    const live = await admin.query('select 1 from refresh_tokens where device_id = $1 and revoked_at is null', [phone.deviceId]);
    expect(live.rowCount).toBe(0);
    expect((await auditRows(admin, a.id)).filter((r) => r.type === 'device_revoked').map((r) => r.target_id)).toEqual([phone.deviceId]);
  });

  it("a Manager manages devices of users inside its locations only, never an Owner's", async () => {
    const [l1, l2] = a.locations;
    await seeder.user(a.id, 'manager@a.example', [[a.roles.manager, [l1]]]);
    const inside = await seeder.user(a.id, 'in@a.example', [[a.roles.cashier, [l1]]]);
    const outside = await seeder.user(a.id, 'out@a.example', [[a.roles.cashier, [l2]]]);
    const insideSession = await loginAs(app, 'in@a.example');
    const outsideSession = await loginAs(app, 'out@a.example');
    const ownerSession = await loginAs(app, 'owner@a.example');
    const m = await loginAs(app, 'manager@a.example');

    expect(PaginatedDevices.parse((await m.get(`/devices?userId=${inside}`).expect(200)).body).items.map((d) => d.id)).toEqual([insideSession.deviceId]);
    await m.get(`/devices?userId=${outside}`).expect(403);
    await m.get(`/devices?userId=${a.owner}`).expect(403);
    await m.post(`/devices/${outsideSession.deviceId}/revoke`).expect(403);
    await m.post(`/devices/${ownerSession.deviceId}/revoke`).expect(403);
    await m.post(`/devices/${insideSession.deviceId}/revoke`).expect(200);
    expect(await deviceRevoked(insideSession.deviceId)).toBe(true);
    expect(await deviceRevoked(outsideSession.deviceId)).toBe(false);
    expect(await deviceRevoked(ownerSession.deviceId)).toBe(false);
  });

  it("without devices:manage, another user's devices are 403", async () => {
    const other = await seeder.user(a.id, 'other@a.example', [[a.roles.cashier, [a.locations[0]]]]);
    await seeder.user(a.id, 'cashier@a.example', [[a.roles.cashier, [a.locations[0]]]]);
    const otherSession = await loginAs(app, 'other@a.example');
    const c = await loginAs(app, 'cashier@a.example');
    await c.get(`/devices?userId=${other}`).expect(403);
    await c.post(`/devices/${otherSession.deviceId}/revoke`).expect(403);
    await c.get('/devices?userId=0190a000-0000-7000-8000-000000000999').expect(403);
    expect(await deviceRevoked(otherSession.deviceId)).toBe(false);
  });

  it('unknown ids are 404 for someone who may manage devices', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    await owner.get('/devices?userId=0190a000-0000-7000-8000-000000000999').expect(404);
    await owner.post('/devices/0190a000-0000-7000-8000-000000000999/revoke').expect(404);
  });
});

describe('GET /audit-events', () => {
  it('pages through real events, newest first, for audit:view holders only', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    for (const code of ['A1', 'A2', 'A3']) await owner.post('/locations', { name: code, code }).expect(201);
    const expected = (await auditRows(admin, a.id)).reverse();
    expect(expected.map((r) => r.type)).toEqual(['location_created', 'location_created', 'location_created', 'login_succeeded']);

    const seen: { type: string; targetId: string | null }[] = [];
    let cursor: string | null = null;
    do {
      const query: string = cursor ? `?limit=3&cursor=${cursor}` : '?limit=3';
      const page = PaginatedAuditEvents.parse((await owner.get(`/audit-events${query}`).expect(200)).body);
      seen.push(...page.items.map((e) => ({ type: e.type, targetId: e.targetId })));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(expected.map((r) => ({ type: r.type, targetId: r.target_id })));

    await seeder.user(a.id, 'cashier@a.example', [[a.roles.cashier, [a.locations[0]]]]);
    const c = await loginAs(app, 'cashier@a.example');
    await c.get('/audit-events').expect(403);
    await owner.get('/audit-events?cursor=bogus').expect(400);
  });
});
