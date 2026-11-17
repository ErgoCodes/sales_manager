import type { PermissionGrant } from '@monaco/contracts';
import { canAny } from './permissions';

export interface NavItem {
  href: string;
  label: string;
}

/** Sidebar entries the signed-in user can see. Derived from `GET /me`; the API still authorizes every call. */
export function navItemsFor(grants: readonly PermissionGrant[]): NavItem[] {
  const items: NavItem[] = [{ href: '/', label: 'Inicio' }, { href: '/puntos-de-venta', label: 'Puntos de venta' }];
  if (canAny(grants, 'users:manage')) items.push({ href: '/usuarios', label: 'Usuarios' });
  if (canAny(grants, 'roles:manage')) items.push({ href: '/roles', label: 'Roles' });
  items.push({ href: '/dispositivos', label: 'Dispositivos' });
  if (canAny(grants, 'audit:view')) items.push({ href: '/auditoria', label: 'Auditoría' });
  return items;
}
