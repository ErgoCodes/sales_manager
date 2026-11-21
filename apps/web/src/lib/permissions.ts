import type { Permission, PermissionGrant } from '@monaco/contracts';

/** UI hints derived from `GET /me`. The API stays the authority and re-checks every request. */
type Grants = readonly PermissionGrant[];

export function canAny(grants: Grants, permission: Permission): boolean {
  return grants.some((g) => g.permission === permission);
}

export function canTenantWide(grants: Grants, permission: Permission): boolean {
  return grants.some((g) => g.permission === permission && g.scope.type === 'tenant');
}

export function canAt(grants: Grants, permission: Permission, locationId: string): boolean {
  return grants.some(
    (g) =>
      g.permission === permission && (g.scope.type === 'tenant' || g.scope.locationIds.includes(locationId)),
  );
}

/** D9: `catalog:write` implies `catalog:view`. Without a location: held anywhere. */
export function canReadCatalog(grants: Grants, locationId?: string): boolean {
  const check = (permission: Permission) => (locationId === undefined ? canAny(grants, permission) : canAt(grants, permission, locationId));
  return check('catalog:view') || check('catalog:write');
}

/** D9: `inventory:write` and `inventory:transfer` imply `inventory:view`. Without a location: held anywhere. */
export function canReadInventory(grants: Grants, locationId?: string): boolean {
  const check = (permission: Permission) => (locationId === undefined ? canAny(grants, permission) : canAt(grants, permission, locationId));
  return check('inventory:view') || check('inventory:write') || check('inventory:transfer');
}

/**
 * D10, as the API decides it: costs come back to whoever has `catalog:write` or `inventory:write`
 * at the asked location, or tenant-wide when no location was asked for. The UI uses it to hide
 * the cost column; a null cost is never rendered as a value.
 */
export function canSeeCatalogCosts(grants: Grants, locationId?: string): boolean {
  const check = (permission: Permission) => (locationId === undefined ? canTenantWide(grants, permission) : canAt(grants, permission, locationId));
  return check('catalog:write') || check('inventory:write');
}

export const PERMISSION_LABELS: Record<Permission, string> = {
  'tenant:manage': 'Administrar el negocio',
  'locations:manage': 'Administrar puntos de venta',
  'users:manage': 'Administrar usuarios',
  'roles:manage': 'Administrar roles',
  'devices:manage': 'Administrar dispositivos de otros usuarios',
  'audit:view': 'Ver la auditoría',
  'catalog:view': 'Ver el catálogo',
  'catalog:write': 'Editar el catálogo',
  'inventory:view': 'Ver el inventario',
  'inventory:write': 'Editar el inventario',
  'inventory:transfer': 'Transferir inventario',
  'sales:create': 'Registrar ventas',
  'sales:void': 'Anular ventas',
  'reports:view': 'Ver reportes',
  'cash:close': 'Cerrar caja',
};

export const PERMISSION_GROUPS: readonly { title: string; permissions: readonly Permission[] }[] = [
  { title: 'Administración', permissions: ['tenant:manage', 'locations:manage', 'users:manage', 'roles:manage', 'devices:manage', 'audit:view'] },
  { title: 'Catálogo e inventario', permissions: ['catalog:view', 'catalog:write', 'inventory:view', 'inventory:write', 'inventory:transfer'] },
  { title: 'Ventas y caja', permissions: ['sales:create', 'sales:void', 'cash:close'] },
  { title: 'Reportes', permissions: ['reports:view'] },
];
