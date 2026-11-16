import { CreateRoleRequest, type Permission } from '@monaco/contracts';

export type RoleFormResult = { ok: true; body: CreateRoleRequest } | { ok: false; error: string };

/** Parses the role dialog's FormData with the shared contract (create and update share the same fields). */
export function parseRoleForm(formData: FormData): RoleFormResult {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { ok: false, error: 'Escribe un nombre para el rol.' };
  const permissions = [...new Set(formData.getAll('permissions').map(String))];
  if (permissions.length === 0) return { ok: false, error: 'Elige al menos un permiso.' };
  const parsed = CreateRoleRequest.safeParse({ name, permissions });
  if (!parsed.success) return { ok: false, error: 'El nombre (máximo 60 caracteres) o los permisos no son válidos.' };
  return { ok: true, body: parsed.data };
}

export function togglePermission(current: readonly Permission[], permission: Permission, checked: boolean): Permission[] {
  const without = current.filter((p) => p !== permission);
  return checked ? [...without, permission] : without;
}
