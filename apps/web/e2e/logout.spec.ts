import { expect, test } from '@playwright/test';
import { apiFetchWithToken, cookieValue, demo, login, logout } from './support/session';

// Flow 4: logging out ends the session: cookies are gone, the gate redirects to /login, and the access
// token that was valid a moment ago is rejected by the API (immediate revocation).
test('logout clears the session and revokes the access token', async ({ page, context }) => {
  await login(page, demo.manager);
  await expect(page).toHaveURL(/\/tablero$/); // reports:view lands on the dashboard
  const accessToken = await cookieValue(context, '__Host-access');
  expect(accessToken).toBeTruthy();
  expect((await apiFetchWithToken(accessToken!, 'GET', '/me')).status).toBe(200);

  await logout(page);

  expect(await cookieValue(context, '__Host-access')).toBeUndefined();
  expect(await cookieValue(context, '__Host-refresh')).toBeUndefined();
  await page.goto('/roles');
  await expect(page).toHaveURL(/\/login$/);
  expect((await apiFetchWithToken(accessToken!, 'GET', '/me')).status).toBe(401);
});
