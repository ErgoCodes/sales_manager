/**
 * Frozen permissions of the system roles at the end of each sub-project, for the data-migration
 * tests. They are literals on purpose: deriving them from today's PERMISSIONS or SYSTEM_ROLES
 * would change what "a tenant created before X" looks like every time the catalog grows.
 */
type SystemKey = 'owner' | 'manager' | 'cashier';
export type SystemRolePermissions = Readonly<Record<SystemKey, readonly string[]>>;

const MANAGER_SP2 = ['catalog:write', 'inventory:write', 'inventory:transfer', 'sales:create', 'sales:void', 'reports:view', 'cash:close', 'devices:manage'];
const CASHIER_SP2 = ['sales:create', 'reports:view', 'cash:close'];
const OWNER_SP2 = [
  'tenant:manage',
  'locations:manage',
  'users:manage',
  'roles:manage',
  'devices:manage',
  'audit:view',
  'catalog:write',
  'inventory:write',
  'inventory:transfer',
  'sales:create',
  'sales:void',
  'reports:view',
  'cash:close',
];
const SP3_READS = ['catalog:view', 'inventory:view'];

/** After SP2 (before migrations 0008/0009). */
export const SP2_SYSTEM_ROLES: SystemRolePermissions = { owner: OWNER_SP2, manager: MANAGER_SP2, cashier: CASHIER_SP2 };

/** After SP3 (before migrations 0012/0013): the SP2 roles plus catalog:view and inventory:view. */
export const SP3_SYSTEM_ROLES: SystemRolePermissions = {
  owner: [...OWNER_SP2, ...SP3_READS],
  manager: [...MANAGER_SP2, ...SP3_READS],
  cashier: [...CASHIER_SP2, ...SP3_READS],
};
