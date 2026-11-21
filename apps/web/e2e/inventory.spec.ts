import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { apiFetch, demo, login, runId } from './support/session';

// SP3 inventory flows. The demo Manager and Cashier are assigned to P1 only; the seed stocks both locations.
// Transfers and reversals use the Owner (D7 needs `inventory:transfer` in both locations).
//
// The Owner signs in once for the whole file: the login limit is 5 attempts per (IP, email) in 5 minutes, and
// other specs sign the Owner in too. Every flow uses products of its own, created here, so the stock it expects
// does not depend on the seed or on other runs.
const products = {
  manager: `Producto E2E ${runId}`,
  transferred: `Transferido E2E ${runId}`,
  reversed: `Revertido E2E ${runId}`,
};
const ids = { p1: '', p2: '' };
let owner: BrowserContext;
let ownerPage: Page;

test.beforeAll(async ({ browser }) => {
  owner = await browser.newContext();
  ownerPage = await owner.newPage();
  await login(ownerPage, demo.owner);
  await expect(ownerPage).toHaveURL(/\/$/);
  for (const name of Object.values(products)) {
    const created = await apiFetch(owner, 'POST', '/products', { name, unitOfMeasure: 'ud', category: 'Otros', currency: 'CUP' });
    expect(created.status).toBe(201);
  }
  const all = (await (await apiFetch(owner, 'GET', '/locations')).json()) as { items: { id: string; code: string }[] };
  ids.p1 = all.items.find((l) => l.code === 'P1')!.id;
  ids.p2 = all.items.find((l) => l.code === 'P2')!.id;
});

test.afterAll(async () => {
  await owner.close();
});

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
  const product = products.manager;

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

test('the cashier sees only the stock of their location, without write actions (and the API refuses them)', async ({ page, context }) => {
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
  expect((await apiFetch(context, 'GET', `/locations/${ids.p1}/stock`)).status).toBe(200);
  expect((await apiFetch(context, 'GET', `/locations/${ids.p2}/stock`)).status).toBe(403);
  const stock = (await (await apiFetch(context, 'GET', `/locations/${ids.p1}/stock?q=Arroz`)).json()) as { items: { productId: string }[] };
  const productId = stock.items[0]!.productId;
  const entry = await apiFetch(context, 'POST', '/inventory/entries', {
    id: '01990000-0000-7000-8000-0000000e2e01',
    locationId: ids.p1,
    lines: [{ productId, quantity: 1, unitCost: { amount: 100, currency: 'CUP' } }],
  });
  expect(entry.status).toBe(403);
});

// Transfers and reversals, as the demo Owner. Each flow stocks its product with an entry recorded in this run.
test.describe.serial('the owner transfers between locations and reverses a document', () => {
  const { transferred, reversed } = products;

  /** Records an entry from the inventory page of `locationId` and waits for the confirmation. */
  async function recordEntry(page: Page, locationId: string, product: string, quantity: string): Promise<void> {
    await page.goto(`/inventario?locationId=${locationId}`);
    await page.getByRole('link', { name: 'Registrar entrada' }).click();
    await expect(page.getByRole('heading', { name: 'Registrar entrada' })).toBeVisible();
    await chooseProduct(page, 1, product);
    await page.getByLabel('Cantidad (línea 1)').fill(quantity);
    await page.getByLabel('Costo unitario (línea 1)').fill('100');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Documento registrado.' })).toBeVisible();
  }

  test('a transfer from P1 to P2 moves the stock out of the origin and into the destination', async () => {
    const page = ownerPage;
    await recordEntry(page, ids.p1, transferred, '10');
    await expect(stockOf(page, transferred)).toHaveText('10 ud');

    await page.getByRole('link', { name: 'Registrar transferencia' }).click();
    await expect(page.getByLabel('Origen', { exact: true })).toHaveValue(ids.p1);
    await page.getByLabel('Destino', { exact: true }).selectOption(ids.p2);
    await chooseProduct(page, 1, transferred);
    await page.getByLabel('Cantidad (línea 1)').fill('4');
    await page.getByRole('button', { name: 'Guardar' }).click();

    await expect(page).toHaveURL(new RegExp(`/inventario\\?locationId=${ids.p1}&registrado=1$`));
    await expect(page.getByRole('status').filter({ hasText: 'Documento registrado.' })).toBeVisible();
    await expect(stockOf(page, transferred)).toHaveText('6 ud');

    await page.goto(`/inventario?locationId=${ids.p2}`);
    await expect(stockOf(page, transferred)).toHaveText('4 ud');
  });

  test('reversing an entry takes its stock back, and a second reversal is refused', async () => {
    const page = ownerPage;
    const context = owner;
    await recordEntry(page, ids.p1, reversed, '7');
    await expect(stockOf(page, reversed)).toHaveText('7 ud');

    // The entry just recorded: the only movement of this run's product.
    const stock = (await (await apiFetch(context, 'GET', `/locations/${ids.p1}/stock?q=${encodeURIComponent(reversed)}`)).json()) as {
      items: { productId: string }[];
    };
    const movements = (await (
      await apiFetch(context, 'GET', `/locations/${ids.p1}/inventory-movements?productId=${stock.items[0]!.productId}`)
    ).json()) as { items: { documentId: string }[] };
    expect(movements.items).toHaveLength(1);
    const entryId = movements.items[0]!.documentId;

    await page.goto(`/inventario/movimientos/${entryId}`);
    await page.getByRole('button', { name: 'Revertir' }).click();
    await expect(page.getByText('¿Revertir este documento?')).toBeVisible();
    await page.getByRole('button', { name: 'Confirmar reversión' }).click();
    await expect(page).toHaveURL(/\/inventario\/movimientos\/[0-9a-f-]+\?revertido=1$/);
    await expect(page.getByText('Documento revertido.')).toBeVisible();

    await page.goto(`/inventario?locationId=${ids.p1}`);
    await expect(stockOf(page, reversed)).toHaveText('0 ud');

    // "Revertir" may still be offered on the reversed entry: the API is the authority and answers ALREADY_REVERSED.
    await page.goto(`/inventario/movimientos/${entryId}`);
    await page.getByRole('button', { name: 'Revertir' }).click();
    await page.getByRole('button', { name: 'Confirmar reversión' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'El documento ya fue revertido o es una reversión: un documento solo se revierte una vez.' }),
    ).toBeVisible();
    await page.goto(`/inventario?locationId=${ids.p1}`);
    await expect(stockOf(page, reversed)).toHaveText('0 ud');
  });
});
