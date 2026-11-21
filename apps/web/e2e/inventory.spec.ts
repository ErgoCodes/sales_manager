import { expect, test, type Page } from '@playwright/test';
import { apiFetch, demo, login, runId } from './support/session';

// SP3 inventory flows. The demo Manager and Cashier are assigned to P1 only; the seed stocks both locations.
// The transfer and reversal flows (T8b) are not covered here yet.

/** Selects the product of a document line by its name (the option label also shows the current stock). */
async function chooseProduct(page: Page, line: number, name: string): Promise<void> {
  const select = page.getByLabel(`Producto (línea ${line})`);
  const value = await select.locator('option', { hasText: name }).getAttribute('value');
  expect(value).toBeTruthy();
  await select.selectOption(value!);
}

/** The quantity cell of a product in the stock table of the current location. */
const stockOf = (page: Page, name: string) => page.getByRole('row').filter({ hasText: name }).getByRole('cell').nth(2);

test.describe.serial('the manager records inventory documents in their location', () => {
  const product = `Producto E2E ${runId}`;

  test.beforeAll(async ({ browser }) => {
    // A product of its own, so the stock this flow expects does not depend on the seed or on other runs.
    const owner = await browser.newContext();
    const page = await owner.newPage();
    await login(page, demo.owner);
    await expect(page).toHaveURL(/\/$/);
    const created = await apiFetch(owner, 'POST', '/products', { name: product, unitOfMeasure: 'ud', category: 'Otros', currency: 'CUP' });
    expect(created.status).toBe(201);
    await owner.close();
  });

  test('an entry raises the stock of the location', async ({ page }) => {
    await login(page, demo.manager);
    await expect(page).toHaveURL(/\/$/);

    await page.goto('/inventario');
    await expect(page.getByRole('heading', { name: 'Inventario' })).toBeVisible();
    await expect(stockOf(page, product)).toHaveText('0 ud');

    await page.getByRole('link', { name: 'Registrar entrada' }).click();
    await expect(page.getByRole('heading', { name: 'Registrar entrada' })).toBeVisible();
    await chooseProduct(page, 1, product);
    await page.getByLabel('Cantidad (línea 1)').fill('12');
    await page.getByLabel('Costo unitario (línea 1)').fill('150');
    await page.getByRole('button', { name: 'Guardar' }).click();

    await expect(page.getByRole('status').filter({ hasText: 'Documento registrado.' })).toBeVisible();
    await expect(stockOf(page, product)).toHaveText('12 ud');
  });

  test('an exit larger than the stock is refused with the shortage, and the stock does not change', async ({ page }) => {
    await login(page, demo.manager);
    await expect(page).toHaveURL(/\/$/);

    await page.goto('/inventario');
    await page.getByRole('link', { name: 'Registrar salida' }).click();
    await expect(page.getByRole('heading', { name: 'Registrar salida' })).toBeVisible();
    await page.getByLabel('Motivo').selectOption({ label: 'Merma' });
    await chooseProduct(page, 1, product);
    await page.getByLabel('Cantidad (línea 1)').fill('20');
    await page.getByRole('button', { name: 'Guardar' }).click();

    // Next's route announcer is also an alert: pick the form's one by its text.
    const alert = page.getByRole('alert').filter({ hasText: 'No hay stock suficiente' });
    await expect(alert).toContainText('No hay stock suficiente para registrar el documento.');
    await expect(alert).toContainText(`${product}: disponible 12 ud, faltan 8 ud`);

    await page.goto('/inventario');
    await expect(stockOf(page, product)).toHaveText('12 ud');
  });
});

test('the cashier sees only the stock of their location, without write actions (and the API refuses them)', async ({ page, context, browser }) => {
  await login(page, demo.cashier);
  await expect(page).toHaveURL(/\/$/);

  await page.goto('/inventario');
  await expect(page.getByRole('heading', { name: 'Inventario' })).toBeVisible();
  // Only P1 in the location selector, and its seeded stock is listed.
  await expect(page.getByLabel('Punto de venta').locator('option')).toHaveText(['Punto 1']);
  await expect(page.getByRole('row').filter({ hasText: 'Arroz' })).toBeVisible();
  for (const action of ['Registrar entrada', 'Registrar salida', 'Registrar ajuste']) {
    await expect(page.getByRole('link', { name: action })).toHaveCount(0);
  }

  // The write pages themselves are closed to the cashier.
  await page.goto('/inventario/entradas/nueva');
  await expect(page.getByRole('heading', { name: 'Registrar entrada' })).toHaveCount(0);

  // The API is the authority: P2's stock and any write answer 403.
  const owner = await browser.newContext();
  const ownerPage = await owner.newPage();
  await login(ownerPage, demo.owner);
  await expect(ownerPage).toHaveURL(/\/$/);
  const all = (await (await apiFetch(owner, 'GET', '/locations')).json()) as { items: { id: string; code: string }[] };
  await owner.close();
  const p1 = all.items.find((l) => l.code === 'P1')!;
  const p2 = all.items.find((l) => l.code === 'P2')!;

  expect((await apiFetch(context, 'GET', `/locations/${p1.id}/stock`)).status).toBe(200);
  expect((await apiFetch(context, 'GET', `/locations/${p2.id}/stock`)).status).toBe(403);
  const stock = (await (await apiFetch(context, 'GET', `/locations/${p1.id}/stock?q=Arroz`)).json()) as { items: { productId: string }[] };
  const productId = stock.items[0]!.productId;
  const entry = await apiFetch(context, 'POST', '/inventory/entries', {
    id: '01990000-0000-7000-8000-0000000e2e01',
    locationId: p1.id,
    lines: [{ productId, quantity: 1, unitCost: { amount: 100, currency: 'CUP' } }],
  });
  expect(entry.status).toBe(403);
});
