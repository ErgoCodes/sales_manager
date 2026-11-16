'use client';

import { useState } from 'react';
import type { Permission } from '@monaco/contracts';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { togglePermission } from '@/lib/admin/roles-form';
import { PERMISSION_GROUPS, PERMISSION_LABELS } from '@/lib/permissions';

/**
 * Grouped permission checkboxes. The selection travels as hidden `permissions` fields so the Server Action
 * reads plain FormData. In `readOnly` mode (Owner role) nothing is submitted.
 */
export function PermissionMatrix({ initial, readOnly = false, idPrefix }: { initial: readonly Permission[]; readOnly?: boolean; idPrefix: string }) {
  const [selected, setSelected] = useState<Permission[]>([...initial]);
  return (
    <div className="space-y-3">
      {PERMISSION_GROUPS.map((group) => (
        <fieldset key={group.title} className="space-y-2">
          <legend className="text-sm font-medium">{group.title}</legend>
          {group.permissions.map((permission) => {
            const id = `perm-${idPrefix}-${permission}`;
            return (
              <div key={permission} className="flex items-center gap-2">
                <Checkbox id={id} checked={selected.includes(permission)} disabled={readOnly} onCheckedChange={(checked) => setSelected((cur) => togglePermission(cur, permission, checked === true))} />
                <Label htmlFor={id} className="font-normal">
                  {PERMISSION_LABELS[permission]}
                </Label>
              </div>
            );
          })}
        </fieldset>
      ))}
      {readOnly ? null : selected.map((permission) => <input key={permission} type="hidden" name="permissions" value={permission} />)}
    </div>
  );
}
