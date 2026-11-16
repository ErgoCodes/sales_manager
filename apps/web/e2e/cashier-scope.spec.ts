import { expect, test } from '@playwright/test';
import { apiFetch, demo, login } from './support/session';

// Flow 3: the demo cashier is assigned to P1 only. Two separate facts are shown here:
//  - location scope: GET /locations returns only P1 (the cashier never sees P2);
//  - missing permission: the cashier role has no `locations:manage`, so mutations on any location answer 403.
// The 403 below therefore proves the missing permission, not location scope. The refusal of an action on
// another location for a role that does hold the permission is covered by the API integration test
// `location scope` in apps/api/test/integration/admin-isolation.e2e.test.ts.
test('the cashier only sees its own location and gets 403 on location admin actions', async ({ page, context }) => {
  await login(page, demo.cashier);
  await expect(page).toHaveURL(/\/$/);

  // The back-office hides what the cashier cannot do.
  await page.goto('/puntos-de-venta');
  await expect(page.getByRole('heading', { name: 'Puntos de venta' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nuevo punto de venta' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Usuarios' })).toHaveCount(0);

  // Only P1 is visible to the cashier.
  const visible = (await (await apiFetch(context, 'GET', '/locations')).json()) as { items: { id: string; code: string }[] };
  expect(visible.items.map((l) => l.code)).toEqual(['P1']);

  // The owner sees both; P2's id is a real target for the cashier's (forbidden) mutations.
  const owner = await context.browser()!.newContext();
  const ownerPage = await owner.newPage();
  await login(ownerPage, demo.owner);
  await expect(ownerPage).toHaveURL(/\/$/);
  const all = (await (await apiFetch(owner, 'GET', '/locations')).json()) as { items: { id: string; code: string }[] };
  const p2 = all.items.find((l) => l.code === 'P2');
  expect(p2).toBeDefined();
  await owner.close();

  const archiveOther = await apiFetch(context, 'POST', `/locations/${p2!.id}/archive`);
  expect(archiveOther.status).toBe(403);
  const rename = await apiFetch(context, 'PATCH', `/locations/${p2!.id}`, { name: 'Hijack' });
  expect(rename.status).toBe(403);
  const create = await apiFetch(context, 'POST', '/locations', { name: 'Other', code: 'OTHER' });
  expect(create.status).toBe(403);
});
