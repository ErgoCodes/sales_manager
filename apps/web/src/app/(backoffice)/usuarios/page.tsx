import type { Metadata } from 'next';
import Link from 'next/link';
import { FormDialog } from '@/components/admin/form-dialog';
import { ErrorNotice, NoAccess } from '@/components/admin/page-state';
import { Pager } from '@/components/admin/pager';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { callApi, requestInit } from '@/lib/api/admin';
import { getMe } from '@/lib/api/me';
import { canAny } from '@/lib/permissions';
import { createUserAction, disableUserAction, resetPasswordAction } from './actions';
import { UserFields } from './user-fields';

export const metadata: Metadata = { title: 'Usuarios' };

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const { cursor } = await searchParams;
  const me = await getMe();
  if (me.ok && !canAny(me.data.permissions, 'users:manage')) return <NoAccess />;
  const list = await callApi((api) => api.GET('/users', { params: { query: { cursor, limit: 50 } }, ...requestInit() }), { canRefresh: false });
  const canAssign = me.ok && canAny(me.data.permissions, 'roles:manage');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Usuarios</h1>
        <FormDialog trigger="Nuevo usuario" triggerVariant="default" title="Nuevo usuario" submitLabel="Crear" action={createUserAction}>
          <UserFields />
        </FormDialog>
      </div>
      {!list.ok ? (
        <ErrorNotice message={list.message} />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Correo</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.items.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>{user.displayName}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell className="space-x-1">
                    {user.status === 'active' ? <Badge>Activo</Badge> : <Badge variant="secondary">Desactivado</Badge>}
                    {user.mustChangePassword ? <Badge variant="outline">Debe cambiar la contraseña</Badge> : null}
                  </TableCell>
                  <TableCell className="space-x-2 text-right">
                    {canAssign ? (
                      <Link href={`/usuarios/${user.id}`} className="text-sm underline">
                        Asignaciones
                      </Link>
                    ) : null}
                    {user.status === 'active' ? (
                      <>
                        <FormDialog trigger="Restablecer contraseña" title={`Restablecer la contraseña de ${user.displayName}`} description="Se generará una contraseña temporal y se cerrarán todas sus sesiones." submitLabel="Restablecer" action={resetPasswordAction}>
                          <input type="hidden" name="id" value={user.id} />
                        </FormDialog>
                        <FormDialog trigger="Desactivar" destructive title={`Desactivar a ${user.displayName}`} description="Perderá el acceso y se cerrarán todas sus sesiones." submitLabel="Desactivar" action={disableUserAction}>
                          <input type="hidden" name="id" value={user.id} />
                        </FormDialog>
                      </>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager basePath="/usuarios" nextCursor={list.data.nextCursor} />
        </>
      )}
    </div>
  );
}
