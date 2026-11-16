'use client';

import { useActionState, useState } from 'react';
import type { Permission } from '@monaco/contracts';
import type { ActionState } from '@/lib/action-state';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { buildAssignments, rowsFromAssignments, type AssignmentRow } from '@/lib/admin/assignments';
import type { components } from '@/lib/api/schema';
import { replaceAssignmentsAction } from './actions';

interface RoleOption {
  id: string;
  name: string;
  permissions: readonly Permission[];
}
interface LocationOption {
  id: string;
  name: string;
}

let rowCounter = 0;
const newKey = () => `new-${++rowCounter}`;

/**
 * Edits the whole assignment set of one user (role + scope). Saving replaces it atomically through
 * `PUT /users/:id/assignments`; the API validates ownership, escalation and scope rules again.
 */
export function AssignmentsEditor({ userId, roles, locations, initial }: { userId: string; roles: readonly RoleOption[]; locations: readonly LocationOption[]; initial: readonly components['schemas']['Assignment_Output'][] }) {
  const [rows, setRows] = useState<AssignmentRow[]>(() => rowsFromAssignments(initial));
  const [state, formAction, pending] = useActionState<ActionState, FormData>(replaceAssignmentsAction, {});
  const built = buildAssignments(rows, roles);

  const update = (key: string, patch: Partial<AssignmentRow>) => setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const toggleLocation = (row: AssignmentRow, locationId: string, checked: boolean) =>
    update(row.key, { locationIds: checked ? [...row.locationIds.filter((l) => l !== locationId), locationId] : row.locationIds.filter((l) => l !== locationId) });

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="id" value={userId} />
      <input type="hidden" name="payload" value={JSON.stringify(built.ok ? built.assignments : [])} />
      {rows.length === 0 ? <p className="text-sm opacity-70">Este usuario no tiene asignaciones: no podrá hacer nada hasta que le asignes un rol.</p> : null}
      {rows.map((row, index) => (
        <fieldset key={row.key} aria-label={`Asignación ${index + 1}`} className="space-y-3 rounded-md border p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Rol</Label>
              <Select value={row.roleId} onValueChange={(roleId) => update(row.key, { roleId })}>
                <SelectTrigger aria-label="Rol" className="w-full">
                  <SelectValue placeholder="Elige un rol">{roles.find((r) => r.id === row.roleId)?.name}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Alcance</Label>
              <Select value={row.scope} onValueChange={(scope) => update(row.key, { scope: scope as AssignmentRow['scope'] })}>
                <SelectTrigger aria-label="Alcance" className="w-full">
                  <SelectValue>{row.scope === 'tenant' ? 'Todo el negocio' : 'Puntos de venta específicos'}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tenant">Todo el negocio</SelectItem>
                  <SelectItem value="locations">Puntos de venta específicos</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {row.scope === 'locations' ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Puntos de venta</p>
              {locations.map((location) => {
                const id = `loc-${row.key}-${location.id}`;
                return (
                  <div key={location.id} className="flex items-center gap-2">
                    <Checkbox id={id} checked={row.locationIds.includes(location.id)} onCheckedChange={(checked) => toggleLocation(row, location.id, checked === true)} />
                    <Label htmlFor={id} className="font-normal">
                      {location.name}
                    </Label>
                  </div>
                );
              })}
            </div>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={() => setRows((cur) => cur.filter((r) => r.key !== row.key))}>
            Quitar
          </Button>
        </fieldset>
      ))}
      <Button type="button" variant="outline" onClick={() => setRows((cur) => [...cur, { key: newKey(), roleId: '', scope: 'tenant', locationIds: [] }])}>
        Agregar asignación
      </Button>
      {!built.ok && rows.length > 0 ? (
        <p role="alert" className="text-sm text-amber-700">
          {built.error}
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
      {state.done ? <p role="status" className="text-sm text-green-700">Asignaciones guardadas.</p> : null}
      <Button type="submit" disabled={pending || !built.ok}>
        {pending ? 'Guardando…' : 'Guardar asignaciones'}
      </Button>
    </form>
  );
}
