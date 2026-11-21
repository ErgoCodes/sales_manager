'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { CreateAdjustmentRequest, CreateEntryRequest, CreateExitRequest, CreateTransferRequest } from '@monaco/contracts';
import { callApi, requestInit, type ApiResult } from '@/lib/api/admin';
import type { ErrorDetail } from '@/lib/api-errors';
import { parseId } from '@/lib/admin/form-ids';
import {
  firstDocumentError,
  postedCurrencies,
  readDocumentForm,
  todayDate,
  validateDocumentForm,
  type DocumentFormKind,
  type InventoryActionState,
  type Shortage,
} from '@/lib/inventory/document-form';

const INVALID = { error: 'Revisa los datos del documento.' };

/** Inventory-specific wording for codes the catalog also uses. */
const INVENTORY_MESSAGES: Record<string, string> = {
  ARCHIVED: 'El producto o el punto de venta está archivado y no admite esta operación.',
  CURRENCY_MISMATCH: 'El costo unitario debe estar en la moneda del producto.',
};

const SHORTAGE = /^Available (-?\d+(?:\.\d+)?), short by (\d+(?:\.\d+)?)$/;

/** `INSUFFICIENT_STOCK` details: `path` is the product id. Only the numbers are kept, never the API text. */
function shortagesOf(details: readonly ErrorDetail[] | undefined): Shortage[] {
  return (details ?? []).map(({ path, message }) => {
    const match = SHORTAGE.exec(message);
    return { productId: path, available: match ? Number(match[1]) : null, shortBy: match ? Number(match[2]) : null };
  });
}

function failure(result: Extract<ApiResult<unknown>, { ok: false }>): InventoryActionState {
  const error = (result.code && INVENTORY_MESSAGES[result.code]) || result.message;
  return result.code === 'INSUFFICIENT_STOCK' ? { error, shortages: shortagesOf(result.details) } : { error };
}

/**
 * Validates, posts the document with its client-generated `id` and, on success (201, or 200 for an
 * idempotent retry), revalidates the inventory and catalog pages and returns to the location's stock.
 */
async function record(kind: DocumentFormKind, formData: FormData): Promise<InventoryActionState> {
  const values = readDocumentForm(formData);
  const id = parseId(values.id);
  const locationId = parseId(values.locationId);
  if (!id || !locationId) return { error: 'El documento o el punto de venta no es válido.' };
  const toLocationId = values.toLocationId ? parseId(values.toLocationId) : '';
  if (toLocationId === null) return { error: 'El punto de destino no es válido.' };

  const form = validateDocumentForm(kind, { ...values, id, locationId, toLocationId }, { today: todayDate(), currencyOf: postedCurrencies(formData) });
  if (!form.ok) return { error: firstDocumentError(form.errors) };

  let result: ApiResult<unknown>;
  if (kind === 'entry') {
    const body = CreateEntryRequest.safeParse(form.body);
    if (!body.success) return INVALID;
    result = await callApi((api) => api.POST('/inventory/entries', { body: body.data, ...requestInit() }), { canRefresh: true });
  } else if (kind === 'exit') {
    const body = CreateExitRequest.safeParse(form.body);
    if (!body.success) return INVALID;
    result = await callApi((api) => api.POST('/inventory/exits', { body: body.data, ...requestInit() }), { canRefresh: true });
  } else if (kind === 'adjustment') {
    const body = CreateAdjustmentRequest.safeParse(form.body);
    if (!body.success) return INVALID;
    result = await callApi((api) => api.POST('/inventory/adjustments', { body: body.data, ...requestInit() }), { canRefresh: true });
  } else {
    const body = CreateTransferRequest.safeParse(form.body);
    if (!body.success) return INVALID;
    result = await callApi((api) => api.POST('/inventory/transfers', { body: body.data, ...requestInit() }), { canRefresh: true });
  }
  if (!result.ok) return failure(result);

  // The whole subtree: stock, ledger, and the forms (so a new visit renders a new document id).
  revalidatePath('/inventario', 'layout');
  revalidatePath('/catalogo', 'layout');
  redirect(`/inventario?locationId=${locationId}&registrado=1`);
}

export async function recordEntryAction(_prev: InventoryActionState, formData: FormData): Promise<InventoryActionState> {
  return record('entry', formData);
}

export async function recordExitAction(_prev: InventoryActionState, formData: FormData): Promise<InventoryActionState> {
  return record('exit', formData);
}

export async function recordAdjustmentAction(_prev: InventoryActionState, formData: FormData): Promise<InventoryActionState> {
  return record('adjustment', formData);
}

/** D6: one atomic document from the origin (`locationId`) to `toLocationId`; returns to the origin's stock. */
export async function recordTransferAction(_prev: InventoryActionState, formData: FormData): Promise<InventoryActionState> {
  return record('transfer', formData);
}
