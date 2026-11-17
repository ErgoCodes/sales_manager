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
