import { expect, type BrowserContext, type Page } from '@playwright/test';
import { loadRuntime, type DemoUser } from './runtime';

export const runtime = loadRuntime();
export const demo = runtime.demoUsers;

/** Unique per run so repeated runs against the same database never collide. */
export const runId = Date.now().toString(36);

export async function login(page: Page, credentials: Pick<DemoUser, 'email' | 'password'>): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(credentials.email);
  await page.getByLabel('Contraseña').fill(credentials.password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
}

export async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login$/);
}

/** Value of a (httpOnly) session cookie, read through the browser context. */
export async function cookieValue(context: BrowserContext, name: string): Promise<string | undefined> {
  return (await context.cookies()).find((cookie) => cookie.name === name)?.value;
}

/** Calls the API directly with a bearer token (the API is the real authority). */
export async function apiFetchWithToken(token: string, method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${runtime.apiUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

/** Same, with the access token of the browser session. */
export async function apiFetch(context: BrowserContext, method: string, path: string, body?: unknown): Promise<Response> {
  const token = await cookieValue(context, '__Host-access');
  if (!token) throw new Error('No access cookie: the session is not active');
  return apiFetchWithToken(token, method, path, body);
}
