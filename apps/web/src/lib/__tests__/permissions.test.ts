import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@monaco/contracts';
import { PERMISSION_GROUPS, PERMISSION_LABELS, canAny, canAt, canReadCatalog, canSeeCatalogCosts, canTenantWide } from '../permissions';

const tenant = { type: 'tenant' } as const;
const at = (...ids: string[]) => ({ type: 'locations', locationIds: ids }) as const;

describe('permission checks (UI hints only, the API is the authority)', () => {
  const grants = [
    { permission: 'users:manage', scope: tenant },
    { permission: 'sales:create', scope: at('a', 'b') },
  ] as const;

  it('canAny: held with any scope', () => {
    expect(canAny(grants, 'sales:create')).toBe(true);
    expect(canAny(grants, 'roles:manage')).toBe(false);
  });

  it('canTenantWide: only tenant scope counts', () => {
    expect(canTenantWide(grants, 'users:manage')).toBe(true);
    expect(canTenantWide(grants, 'sales:create')).toBe(false);
  });

  it('canAt: tenant scope covers every location, location scope only its list', () => {
    expect(canAt(grants, 'users:manage', 'z')).toBe(true);
    expect(canAt(grants, 'sales:create', 'a')).toBe(true);
    expect(canAt(grants, 'sales:create', 'z')).toBe(false);
  });

  it('handles an empty grant list', () => {
    expect(canAny([], 'users:manage')).toBe(false);
  });
});

describe('catalog hints (D9 read implication, D10 cost visibility)', () => {
  const cashier = [{ permission: 'catalog:view', scope: at('a') }] as const;
  const manager = [{ permission: 'catalog:write', scope: at('a') }] as const;
  const owner = [{ permission: 'catalog:write', scope: tenant }] as const;
  const stocker = [{ permission: 'inventory:write', scope: at('a') }] as const;

  it('canReadCatalog: catalog:view or catalog:write, anywhere or at a location', () => {
    expect(canReadCatalog(cashier)).toBe(true);
    expect(canReadCatalog(cashier, 'a')).toBe(true);
    expect(canReadCatalog(cashier, 'b')).toBe(false);
    expect(canReadCatalog(manager, 'a')).toBe(true);
    expect(canReadCatalog(stocker)).toBe(false);
    expect(canReadCatalog([{ permission: 'sales:create', scope: tenant }])).toBe(false);
  });

  it('canSeeCatalogCosts: catalog:write or inventory:write at the location, or tenant-wide without one', () => {
    expect(canSeeCatalogCosts(cashier, 'a')).toBe(false);
    expect(canSeeCatalogCosts(manager, 'a')).toBe(true);
    expect(canSeeCatalogCosts(manager)).toBe(false);
    expect(canSeeCatalogCosts(stocker, 'a')).toBe(true);
    expect(canSeeCatalogCosts(owner)).toBe(true);
  });
});

describe('permission catalog presentation', () => {
  it('labels every permission in Spanish and groups each exactly once', () => {
    for (const p of PERMISSIONS) expect(PERMISSION_LABELS[p]).toBeTruthy();
    const grouped = PERMISSION_GROUPS.flatMap((g) => g.permissions);
    expect([...grouped].sort()).toEqual([...PERMISSIONS].sort());
  });
});

describe('SP3 read permissions', () => {
  it('labels and groups catalog:view and inventory:view with the catalog and inventory group', () => {
    expect(PERMISSION_LABELS['catalog:view']).toBe('Ver el catálogo');
    expect(PERMISSION_LABELS['inventory:view']).toBe('Ver el inventario');
    const group = PERMISSION_GROUPS.find((g) => g.title === 'Catálogo e inventario');
    expect(group?.permissions).toEqual(expect.arrayContaining(['catalog:view', 'inventory:view']));
  });
});
