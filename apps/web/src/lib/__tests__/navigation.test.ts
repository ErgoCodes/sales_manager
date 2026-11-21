import { describe, expect, it } from 'vitest';
import { navItemsFor } from '../navigation';

const tenant = { type: 'tenant' } as const;
const labels = (perms: string[]) =>
  navItemsFor(perms.map((permission) => ({ permission, scope: tenant }) as never)).map((i) => i.label);

describe('navItemsFor', () => {
  it('shows only the shared entries to a user without admin permissions (cashier)', () => {
    expect(labels(['sales:create'])).toEqual(['Inicio', 'Puntos de venta', 'Dispositivos']);
  });

  it('adds entries per permission', () => {
    expect(labels(['users:manage'])).toContain('Usuarios');
    expect(labels(['roles:manage'])).toContain('Roles');
    expect(labels(['audit:view'])).toContain('Auditoría');
    expect(labels(['users:manage'])).not.toContain('Roles');
  });

  it('shows "Catálogo" with catalog:view, or catalog:write (D9), after "Puntos de venta"', () => {
    expect(labels(['catalog:view'])).toEqual(['Inicio', 'Puntos de venta', 'Catálogo', 'Dispositivos']);
    expect(labels(['catalog:write'])).toContain('Catálogo');
    expect(labels(['inventory:write'])).not.toContain('Catálogo');
  });
});
