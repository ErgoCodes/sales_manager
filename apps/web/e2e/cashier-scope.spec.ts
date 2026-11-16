import { expect, test } from '@playwright/test';
import { apiFetch, demo, login } from './support/session';

// Flow 3: the demo cashier is assigned to P1 only. The API answers 403 for anything at P2 or outside the role.
test('the cashier of one location gets 403 on another location and on admin actions', async ({ page, context }) => {
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

  // The owner sees both; its ids are what the cashier must not be able to act on.
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
