import { ADMIN_PERMISSIONS, ReplaceAssignmentsRequest, type AssignmentInput, type Permission } from '@monaco/contracts';
import type { components } from '@/lib/api/schema';

export interface AssignmentRow {
  /** Stable React key; never sent to the API. */
  key: string;
  roleId: string;
  scope: 'tenant' | 'locations';
  locationIds: string[];
}

interface RoleLike {
  id: string;
  name: string;
  permissions: readonly Permission[];
}

export type BuildResult = { ok: true; assignments: AssignmentInput[] } | { ok: false; error: string };

/** Editable rows from the API's assignments. */
export function rowsFromAssignments(assignments: readonly components['schemas']['Assignment_Output'][]): AssignmentRow[] {
  return assignments.map((a) => ({
    key: a.id,
    roleId: a.roleId,
    scope: a.scope.type,
    locationIds: a.scope.type === 'locations' ? [...a.scope.locationIds] : [],
  }));
}

/**
 * Turns the editor rows into the `PUT /users/:id/assignments` body, validated with the shared contract.
 * Rules are mirrored from the API only to give early, clear feedback; the API remains the authority.
 */
export function buildAssignments(rows: readonly AssignmentRow[], roles: readonly RoleLike[]): BuildResult {
  const assignments: AssignmentInput[] = [];
  for (const row of rows) {
    const role = roles.find((r) => r.id === row.roleId);
    if (!role) return { ok: false, error: 'Elige un rol en cada asignación.' };
    if (row.scope === 'tenant') {
      assignments.push({ roleId: role.id, scope: { type: 'tenant' } });
      continue;
    }
    if (row.locationIds.length === 0) return { ok: false, error: `Elige al menos un punto de venta para el rol ${role.name}.` };
    if (role.permissions.some((p) => (ADMIN_PERMISSIONS as readonly string[]).includes(p))) {
      return { ok: false, error: `El rol ${role.name} incluye permisos administrativos: solo puede asignarse a todo el negocio.` };
    }
    assignments.push({ roleId: role.id, scope: { type: 'locations', locationIds: [...row.locationIds] } });
  }
  const parsed = ReplaceAssignmentsRequest.safeParse({ assignments });
  if (!parsed.success) return { ok: false, error: 'Hay asignaciones repetidas o inválidas. Revísalas.' };
  return { ok: true, assignments: parsed.data.assignments };
}
