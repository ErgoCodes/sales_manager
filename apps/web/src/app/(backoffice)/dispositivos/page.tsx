import type { Metadata } from 'next';
import { FormDialog } from '@/components/admin/form-dialog';
import { ErrorNotice } from '@/components/admin/page-state';
import { Pager } from '@/components/admin/pager';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { callApi, requestInit } from '@/lib/api/admin';
import { listAll } from '@/lib/api/list-all';
import { getMe } from '@/lib/api/me';
import { parseId } from '@/lib/admin/form-ids';
import { formatDateTime } from '@/lib/audit-labels';
import { canAny } from '@/lib/permissions';
import { revokeDeviceAction } from './actions';

export const metadata: Metadata = { title: 'Dispositivos' };

const select = 'w-full rounded-md border bg-background px-3 py-2 text-sm';

export default async function DevicesPage({ searchParams }: { searchParams: Promise<{ cursor?: string; userId?: string }> }) {
  const query = await searchParams;
  const me = await getMe();
  const canManageOthers = me.ok && canAny(me.data.permissions, 'devices:manage');
  const canListUsers = me.ok && canAny(me.data.permissions, 'users:manage');
  // Only someone with devices:manage may look at another user's devices; the API enforces it anyway.
  const userId = canManageOthers && query.userId ? (parseId(query.userId) ?? undefined) : undefined;

  const [list, users] = await Promise.all([
    callApi((api) => api.GET('/devices', { params: { query: { cursor: query.cursor, limit: 50, userId } }, ...requestInit() }), { canRefresh: false }),
    canManageOthers && canListUsers ? listAll((cursor) => callApi((api) => api.GET('/users', { params: { query: { cursor, limit: 100 } }, ...requestInit() }), { canRefresh: false })) : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Dispositivos</h1>
      <p className="text-sm opacity-70">{userId ? 'Dispositivos del usuario elegido.' : 'Tus dispositivos con sesión iniciada.'}</p>
      {canManageOthers ? (
        // A GET form: it only filters the list, it never changes state.
        <form method="get" action="/dispositivos" className="flex max-w-xl items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="device-user">Ver dispositivos de otro usuario</Label>
            {users?.ok ? (
              <select id="device-user" name="userId" defaultValue={userId ?? ''} className={select}>
                <option value="">Mis dispositivos</option>
                {users.data.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.displayName} ({user.email})
                  </option>
                ))}
              </select>
            ) : (
              <input id="device-user" name="userId" defaultValue={userId ?? ''} placeholder="ID del usuario" className={select} />
            )}
          </div>
          <Button type="submit" variant="outline">
            Ver
          </Button>
        </form>
      ) : null}
      {!list.ok ? (
        <ErrorNotice message={list.message} />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dispositivo</TableHead>
                <TableHead>Plataforma</TableHead>
                <TableHead>Último uso (UTC)</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.items.map((device) => (
                <TableRow key={device.id}>
                  <TableCell className="max-w-xs truncate" title={device.label}>
                    {device.label}
                    {device.current ? <Badge className="ml-2">Este dispositivo</Badge> : null}
                  </TableCell>
                  <TableCell>{device.platform}</TableCell>
                  <TableCell>{formatDateTime(device.lastSeenAt)}</TableCell>
                  <TableCell>{device.revokedAt ? <Badge variant="secondary">Revocado</Badge> : <Badge variant="outline">Activo</Badge>}</TableCell>
                  <TableCell className="text-right">
                    {device.revokedAt ? null : (
                      <FormDialog
                        trigger="Revocar"
                        destructive
                        title="Revocar dispositivo"
                        description={device.current ? 'Es el dispositivo que estás usando: tu sesión se cerrará.' : 'Se cerrará la sesión en ese dispositivo.'}
                        submitLabel="Revocar"
                        action={revokeDeviceAction}
                      >
                        <input type="hidden" name="id" value={device.id} />
                      </FormDialog>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {list.data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5}>No hay dispositivos para mostrar.</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
          <Pager basePath="/dispositivos" nextCursor={list.data.nextCursor} extraQuery={userId ? { userId } : undefined} />
        </>
      )}
    </div>
  );
}
