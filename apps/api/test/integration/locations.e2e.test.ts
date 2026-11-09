import { Location, PaginatedLocations } from '@monaco/contracts';
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

const locationRow = async (id: string) =>
  (await admin.query('select name, code, archived_at from locations where id = $1', [id])).rows[0] as
    | { name: string; code: string; archived_at: Date | null }
    | undefined;

describe('locations', () => {
  it('an Owner creates, renames and archives a location; each step is audited', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    const created = Location.parse((await owner.post('/locations', { name: 'Norte', code: 'N1' }).expect(201)).body);
    expect(created).toMatchObject({ name: 'Norte', code: 'N1', archivedAt: null });

    const renamed = Location.parse((await owner.patch(`/locations/${created.id}`, { name: 'Norte 2' }).expect(200)).body);
    expect(renamed).toMatchObject({ id: created.id, name: 'Norte 2', code: 'N1' });

    const archived = Location.parse((await owner.post(`/locations/${created.id}/archive`).expect(200)).body);
    expect(archived.archivedAt).not.toBeNull();
    const again = Location.parse((await owner.post(`/locations/${created.id}/archive`).expect(200)).body);
    expect(again.archivedAt).toBe(archived.archivedAt);

    expect(await locationRow(created.id)).toMatchObject({ name: 'Norte 2', code: 'N1', archived_at: expect.any(Date) });
    const audit = (await auditRows(admin, a.id)).filter((row) => row.type.startsWith('location_'));
    expect(audit.map((row) => [row.type, row.actor_user_id, row.target_id])).toEqual([
      ['location_created', a.owner, created.id],
      ['location_updated', a.owner, created.id],
      ['location_archived', a.owner, created.id],
    ]);
  });

  it('a duplicate code is a generic 409 and creates nothing', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    const res = await owner.post('/locations', { name: 'Otra', code: 'L1' }).expect(409);
    expect(res.body).toEqual({ error: { code: 'CONFLICT', message: 'Conflict' } });
    const { rows } = await admin.query('select count(*)::int as n from locations where tenant_id = $1', [a.id]);
    expect(rows[0].n).toBe(2);
  });

  it('lists every location to a tenant-wide holder, paginated with a cursor', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    const first = PaginatedLocations.parse((await owner.get('/locations?limit=1').expect(200)).body);
    expect(first.items.map((l) => l.id)).toEqual([a.locations[0]]);
    expect(first.nextCursor).not.toBeNull();
    const second = PaginatedLocations.parse((await owner.get(`/locations?limit=1&cursor=${first.nextCursor}`).expect(200)).body);
    expect(second.items.map((l) => l.id)).toEqual([a.locations[1]]);
    expect(second.nextCursor).toBeNull();
    await owner.get('/locations?cursor=not-a-cursor').expect(400);
  });

  it('a cashier of location 1 only sees location 1, and cannot manage locations (403)', async () => {
    await seeder.user(a.id, 'cashier@a.example', [[a.roles.cashier, [a.locations[0]]]]);
    const cashier = await loginAs(app, 'cashier@a.example');
    const page = PaginatedLocations.parse((await cashier.get('/locations').expect(200)).body);
    expect(page.items.map((l) => l.id)).toEqual([a.locations[0]]);

    expect((await cashier.post('/locations', { name: 'X', code: 'X' }).expect(403)).body).toEqual({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    await cashier.patch(`/locations/${a.locations[1]}`, { name: 'X' }).expect(403);
    await cashier.post(`/locations/${a.locations[1]}/archive`).expect(403);
    expect(await locationRow(a.locations[1])).toMatchObject({ name: 'Location L2', archived_at: null });
  });

  it('a user without assignments sees no location', async () => {
    await seeder.user(a.id, 'nobody@a.example');
    const nobody = await loginAs(app, 'nobody@a.example');
    expect(PaginatedLocations.parse((await nobody.get('/locations').expect(200)).body).items).toEqual([]);
  });

  it('an unknown id is 404 and a malformed one 400', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    await owner.patch('/locations/0190a000-0000-7000-8000-000000000999', { name: 'X' }).expect(404);
    await owner.post('/locations/0190a000-0000-7000-8000-000000000999/archive').expect(404);
    await owner.patch('/locations/123', { name: 'X' }).expect(400);
  });
});
