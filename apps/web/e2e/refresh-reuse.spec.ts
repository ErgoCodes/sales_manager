import { expect, test } from '@playwright/test';
import { apiFetchWithToken, cookieValue, demo, login, runtime } from './support/session';

const GRACE_MS = 10_000; // AUTH_POLICY.refreshGraceMs in apps/api

async function refresh(refreshToken: string): Promise<Response> {
  return fetch(`${runtime.apiUrl}/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken }) });
}

// Flow 5: a refresh token that was already rotated and is replayed after the grace window revokes the whole
// session family, including the legitimate descendant held by the browser.
test('a reused refresh token closes the session', async ({ page, context }) => {
  test.setTimeout(90_000);
  await login(page, demo.owner);
  await expect(page).toHaveURL(/\/tablero$/); // reports:view lands on the dashboard
  const stolen = await cookieValue(context, '__Host-refresh');
  expect(stolen).toBeTruthy();

  // Expire the access cookie so the proxy rotates the refresh token on the next navigation.
  const cookies = await context.cookies();
  await context.clearCookies({ name: '__Host-access' });
  await page.goto('/usuarios');
  await expect(page.getByRole('heading', { name: 'Usuarios' })).toBeVisible();
  const rotated = await cookieValue(context, '__Host-refresh');
  expect(rotated).toBeTruthy();
  expect(rotated).not.toBe(stolen);

  // Replaying the old token after the grace window is reuse: the API revokes the family.
  await page.waitForTimeout(GRACE_MS + 1_000);
  expect((await refresh(stolen!)).status).toBe(401);

  // The browser's own (rotated) token belongs to the same family and is now dead too.
  expect((await refresh(rotated!)).status).toBe(401);
  await context.clearCookies({ name: '__Host-access' });
  await page.goto('/usuarios');
  await expect(page).toHaveURL(/\/login$/);

  // And no access token minted before the revocation survives.
  const staleAccess = cookies.find((c) => c.name === '__Host-access')?.value;
  expect(staleAccess).toBeTruthy();
  expect((await apiFetchWithToken(staleAccess!, 'GET', '/me')).status).toBe(401);
});
