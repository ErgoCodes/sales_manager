import type { Metadata } from 'next';
import Link from 'next/link';
import { ErrorNotice, NoAccess } from '@/components/admin/page-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { callApi, requestInit } from '@/lib/api/admin';
import { getMe } from '@/lib/api/me';
import { parseId } from '@/lib/admin/form-ids';
import { formatDateTime } from '@/lib/audit-labels';
import { DOCUMENT_KIND_LABELS, EXIT_REASON_LABELS, MOVEMENT_KIND_LABELS, OTHER_LOCATION, formatAverageCost, formatSignedQuantity } from '@/lib/inventory/format';
import { canReadInventory } from '@/lib/permissions';
import { productInfo, productLabel } from '../../data';

export const metadata: Metadata = { title: 'Documento de inventario' };

/**
 * One inventory document: header and the movements in locations the user reads. A location the user
 * cannot see comes back without id or name and is shown as "Otro punto". Read-only (revert: T8b).
 */
export default async function InventoryDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (!id) return <ErrorNotice message="El documento indicado no existe." />;
  const me = await getMe();
  if (!me.ok) return <ErrorNotice message={me.message} />;
  if (!canReadInventory(me.data.permissions)) return <NoAccess />;

  const result = await callApi((api) => api.GET('/inventory/documents/{id}', { params: { path: { id } }, ...requestInit() }), { canRefresh: false });
  if (!result.ok) return <ErrorNotice message={result.message} />;
  const doc = result.data;
  const products = await productInfo(doc.movements.map((m) => m.locationId));

  const isTransfer = doc.kind === 'transfer';
  const origin = doc.locationName ?? OTHER_LOCATION;
  const target = doc.targetLocationName ?? OTHER_LOCATION;
  const locationName = (locationId: string) => (locationId === doc.locationId ? origin : locationId === doc.targetLocationId ? target : OTHER_LOCATION);
  const showCost = doc.movements.some((m) => m.unitCost !== null);
  const back = doc.locationId ? `/inventario/movimientos?locationId=${doc.locationId}` : '/inventario/movimientos';

  return (
    <div className="space-y-4">
      <Link href={back} className="text-sm underline">
        ← Movimientos
      </Link>
      <h1 className="text-2xl font-semibold">{DOCUMENT_KIND_LABELS[doc.kind]}</h1>

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
        <dt className="font-medium">{isTransfer ? 'Origen' : 'Punto de venta'}</dt>
        <dd>{origin}</dd>
        {isTransfer ? (
          <>
            <dt className="font-medium">Destino</dt>
            <dd>{target}</dd>
          </>
        ) : null}
        {doc.reason ? (
          <>
            <dt className="font-medium">Motivo</dt>
            <dd>{EXIT_REASON_LABELS[doc.reason]}</dd>
          </>
        ) : null}
        <dt className="font-medium">Fecha del movimiento (UTC)</dt>
        <dd>{formatDateTime(doc.occurredAt)}</dd>
        <dt className="font-medium">Registrado (UTC)</dt>
        <dd>{formatDateTime(doc.createdAt)}</dd>
        <dt className="font-medium">Notas</dt>
        <dd>{doc.notes ?? '—'}</dd>
        {doc.reversesDocumentId ? (
          <>
            <dt className="font-medium">Revierte</dt>
            <dd>
              <Link href={`/inventario/movimientos/${doc.reversesDocumentId}`} className="underline">
                Ver documento revertido
              </Link>
            </dd>
          </>
        ) : null}
      </dl>

      <h2 className="text-lg font-medium">Líneas</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Punto de venta</TableHead>
            <TableHead>Producto</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Cantidad</TableHead>
            {showCost ? <TableHead>Costo unitario</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {doc.movements.map((m) => (
            <TableRow key={m.id}>
              <TableCell>{locationName(m.locationId)}</TableCell>
              <TableCell title={m.productId}>{productLabel(products, m.productId)}</TableCell>
              <TableCell>{MOVEMENT_KIND_LABELS[m.kind]}</TableCell>
              <TableCell>
                {formatSignedQuantity(m.quantityDelta)} {products.get(m.productId)?.unitOfMeasure ?? ''}
              </TableCell>
              {showCost ? <TableCell>{formatAverageCost(m.unitCost)}</TableCell> : null}
            </TableRow>
          ))}
          {doc.movements.length === 0 ? (
            <TableRow>
              <TableCell colSpan={showCost ? 5 : 4}>No hay líneas visibles en tus puntos de venta.</TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  );
}
