import type { Metadata } from 'next';
import Link from 'next/link';
import { ErrorNotice, NoAccess } from '@/components/admin/page-state';
import { Badge } from '@/components/ui/badge';
import { callApi, requestInit } from '@/lib/api/admin';
import { listAll } from '@/lib/api/list-all';
import { getMe } from '@/lib/api/me';
import { parseId } from '@/lib/admin/form-ids';
import { canAny } from '@/lib/permissions';
import { AssignmentsEditor } from './assignments-editor';

export const metadata: Metadata = { title: 'Asignaciones' };

export default async function UserAssignmentsPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (!id) return <ErrorNotice message="El usuario indicado no existe." />;
  const me = await getMe();
  if (me.ok && !(canAny(me.data.permissions, 'users:manage') && canAny(me.data.permissions, 'roles:manage'))) return <NoAccess />;

  const [user, roles, locations] = await Promise.all([
    callApi((api) => api.GET('/users/{id}', { params: { path: { id } }, ...requestInit() }), { canRefresh: false }),
    listAll((cursor) => callApi((api) => api.GET('/roles', { params: { query: { cursor, limit: 100 } }, ...requestInit() }), { canRefresh: false })),
    listAll((cursor) => callApi((api) => api.GET('/locations', { params: { query: { cursor, limit: 100 } }, ...requestInit() }), { canRefresh: false })),
  ]);
  const failure = [user, roles, locations].find((r) => !r.ok);
  if (failure && !failure.ok) return <ErrorNotice message={failure.message} />;
  if (!user.ok || !roles.ok || !locations.ok) return null;

  return (
    <div className="space-y-4">
      <Link href="/usuarios" className="text-sm underline">
        ← Usuarios
      </Link>
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold">{user.data.displayName}</h1>
        {user.data.status === 'active' ? <Badge>Activo</Badge> : <Badge variant="secondary">Desactivado</Badge>}
      </div>
      <p className="text-sm opacity-70">{user.data.email}</p>
      <h2 className="text-lg font-medium">Asignaciones</h2>
      <p className="text-sm opacity-70">Cada asignación da un rol en todo el negocio o solo en los puntos de venta elegidos. Guardar reemplaza todas las asignaciones del usuario.</p>
      <AssignmentsEditor userId={id} roles={roles.data} locations={locations.data.filter((l) => !l.archivedAt)} initial={user.data.assignments} />
    </div>
  );
}
