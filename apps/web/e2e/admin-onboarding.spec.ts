import { expect, test } from '@playwright/test';
import { demo, login, logout, runId } from './support/session';

// Flows 1 and 2: the owner sets up a location, a user and its assignment; the new user then logs in and is
// forced to change the temporary password. Serial: the second test needs what the first one created.
test.describe.serial('owner onboards a new user', () => {
  const location = { name: `Punto E2E ${runId}`, code: `E2E-${runId}` };
  const user = { email: `new-${runId}@demo.example`, displayName: `Nuevo ${runId}` };
  let temporaryPassword = '';

  test('owner creates a location and a user, then assigns a role there', async ({ page }) => {
    await login(page, demo.owner);
    await expect(page.getByRole('heading', { name: 'Tablero', level: 1 })).toBeVisible();

    await page.goto('/puntos-de-venta');
    await page.getByRole('button', { name: 'Nuevo punto de venta' }).click();
    await page.getByLabel('Nombre').fill(location.name);
    await page.getByLabel('Código').fill(location.code);
    await page.getByRole('button', { name: 'Crear' }).click();
    await expect(page.getByRole('cell', { name: location.name })).toBeVisible();

    await page.goto('/usuarios');
    await page.getByRole('button', { name: 'Nuevo usuario' }).click();
    await page.getByLabel('Correo electrónico').fill(user.email);
    await page.getByLabel('Nombre').fill(user.displayName);
    await page.getByRole('button', { name: 'Crear' }).click();
    const shown = page.getByTestId('temporary-password');
    await expect(shown).toBeVisible();
    temporaryPassword = (await shown.textContent())?.trim() ?? '';
    expect(temporaryPassword.length).toBeGreaterThanOrEqual(12);
    await page.getByRole('button', { name: 'Cerrar' }).click();

    const row = page.getByRole('row').filter({ hasText: user.email });
    await expect(row.getByText('Debe cambiar la contraseña')).toBeVisible();
    await row.getByRole('link', { name: 'Asignaciones' }).click();
    await page.getByRole('button', { name: 'Agregar asignación' }).click();
    await page.getByRole('combobox', { name: 'Rol' }).click();
    await page.getByRole('option', { name: 'Cashier' }).click();
    await page.getByRole('combobox', { name: 'Alcance' }).click();
    await page.getByRole('option', { name: 'Puntos de venta específicos' }).click();
    await page.getByLabel(location.name).check();
    await page.getByRole('button', { name: 'Guardar asignaciones' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Asignaciones guardadas.' })).toBeVisible();
  });

  test('the new user must change the temporary password before using the app', async ({ page }) => {
    expect(temporaryPassword).not.toBe('');
    await login(page, { email: user.email, password: temporaryPassword });
    await expect(page).toHaveURL(/\/cambiar-contrasena$/);

    // The gate holds: any other page sends the user back.
    await page.goto('/usuarios');
    await expect(page).toHaveURL(/\/cambiar-contrasena$/);

    const newPassword = `changed-${runId}-pass`;
    await page.getByLabel('Contraseña actual', { exact: true }).fill(temporaryPassword);
    await page.getByLabel('Nueva contraseña', { exact: true }).fill(newPassword);
    await page.getByLabel('Confirma la nueva contraseña').fill(newPassword);
    await page.getByRole('button', { name: 'Cambiar contraseña' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Estado del sistema' })).toBeVisible();
    await logout(page);

    // The temporary password no longer works; the new one does.
    await login(page, { email: user.email, password: temporaryPassword });
    await expect(page.getByRole('alert')).toBeVisible();
    await login(page, { email: user.email, password: newPassword });
    await expect(page).toHaveURL(/\/$/);
  });
});
