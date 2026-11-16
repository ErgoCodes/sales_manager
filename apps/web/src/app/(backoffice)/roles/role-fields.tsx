import type { Permission } from '@monaco/contracts';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PermissionMatrix } from './permission-matrix';

export function RoleFields({ id, name, permissions = [], readOnly = false }: { id?: string; name?: string; permissions?: readonly Permission[]; readOnly?: boolean }) {
  const key = id ?? 'new';
  return (
    <>
      {id ? <input type="hidden" name="id" value={id} /> : null}
      <div className="space-y-1">
        <Label htmlFor={`role-name-${key}`}>Nombre</Label>
        <Input id={`role-name-${key}`} name="name" defaultValue={name} maxLength={60} required readOnly={readOnly} />
      </div>
      <div className="max-h-80 overflow-y-auto pr-1">
        <PermissionMatrix initial={permissions} readOnly={readOnly} idPrefix={key} />
      </div>
    </>
  );
}
