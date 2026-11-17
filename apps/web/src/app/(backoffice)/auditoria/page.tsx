import type { Metadata } from 'next';
import { ErrorNotice, NoAccess } from '@/components/admin/page-state';
import { Pager } from '@/components/admin/pager';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { callApi, requestInit } from '@/lib/api/admin';
import { getMe } from '@/lib/api/me';
import { AUDIT_EVENT_LABELS, formatDateTime, shortId } from '@/lib/audit-labels';
import { canAny } from '@/lib/permissions';

export const metadata: Metadata = { title: 'Auditoría' };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const { cursor } = await searchParams;
  const me = await getMe();
  if (me.ok && !canAny(me.data.permissions, 'audit:view')) return <NoAccess />;
  const list = await callApi((api) => api.GET('/audit-events', { params: { query: { cursor, limit: 50 } }, ...requestInit() }), { canRefresh: false });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Auditoría</h1>
      {!list.ok ? (
        <ErrorNotice message={list.message} />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha (UTC)</TableHead>
                <TableHead>Evento</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Objetivo</TableHead>
                <TableHead>IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.items.map((event) => (
                <TableRow key={event.id}>
                  <TableCell>{formatDateTime(event.createdAt)}</TableCell>
                  <TableCell>{AUDIT_EVENT_LABELS[event.type] ?? event.type}</TableCell>
                  <TableCell title={event.actorUserId ?? undefined}>{shortId(event.actorUserId)}</TableCell>
                  <TableCell title={event.targetId ?? undefined}>{event.targetType ? `${event.targetType} ${shortId(event.targetId)}` : '—'}</TableCell>
                  <TableCell>{event.ip ?? '—'}</TableCell>
                </TableRow>
              ))}
              {list.data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5}>No hay eventos para mostrar.</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
          <Pager basePath="/auditoria" nextCursor={list.data.nextCursor} />
        </>
      )}
    </div>
  );
}
