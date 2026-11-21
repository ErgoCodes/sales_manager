import {
  CURRENCIES,
  EXIT_REASONS,
  MAX_DOCUMENT_LINES,
  MAX_NOTES_LENGTH,
  type CreateAdjustmentRequest,
  type CreateEntryRequest,
  type CreateExitRequest,
  type CreateTransferRequest,
  type CurrencyCode,
  type ExitReason,
} from '@monaco/contracts';
import type { ActionState } from '@/lib/action-state';
import { parseMoneyInput } from '@/lib/catalog/money';

/** The document kinds recorded with the lines form. A transfer's `locationId` is its origin (D6, one step). */
export type DocumentFormKind = 'entry' | 'exit' | 'adjustment' | 'transfer';

export interface DocumentLineValues {
  productId: string;
  quantity: string;
  /** Entries only; empty otherwise. */
  unitCost: string;
}

/** Raw form values, as typed. `id` is the client-generated document id (idempotency key). */
export interface DocumentFormValues {
  id: string;
  locationId: string;
  /** Transfers only: the destination location. */
  toLocationId?: string;
  reason: string;
  /** `YYYY-MM-DD`, or empty for "now". */
  occurredOn: string;
  notes: string;
  lines: DocumentLineValues[];
}

export interface LineErrors {
  productId?: string;
  quantity?: string;
  unitCost?: string;
}

export interface DocumentFormErrors {
  toLocationId?: string;
  reason?: string;
  occurredOn?: string;
  notes?: string;
  lines?: string;
  lineErrors: LineErrors[];
}

export type DocumentBody = CreateEntryRequest | CreateExitRequest | CreateAdjustmentRequest | CreateTransferRequest;
export type DocumentFormResult = { ok: true; body: DocumentBody } | { ok: false; errors: DocumentFormErrors };

/** A product the form offers, from the location's stock. `currency` is null when the API hid the cost (D10). */
export interface ProductOption {
  id: string;
  name: string;
  unitOfMeasure: string;
  currency: CurrencyCode | null;
  quantity: number;
  archived: boolean;
}

/** One product of an `INSUFFICIENT_STOCK` answer; the numbers are null when the API detail could not be read. */
export interface Shortage {
  productId: string;
  available: number | null;
  shortBy: number | null;
}

/** State of an inventory document Server Action: success redirects, so only failures come back. */
export interface InventoryActionState extends ActionState {
  shortages?: Shortage[];
}

const POSITIVE_QUANTITY = /^\d{1,11}(?:[.,]\d{1,3})?$/;
const SIGNED_QUANTITY = /^-?\d{1,11}(?:[.,]\d{1,3})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const MESSAGES = {
  product: 'Elige un producto.',
  repeated: 'El producto ya está en otra línea.',
  quantity: 'La cantidad debe ser mayor que 0, con hasta 3 decimales.',
  delta: 'La cantidad debe ser distinta de 0, con hasta 3 decimales (negativa para restar).',
  costRequired: 'Indica el costo unitario.',
  costInvalid: 'El importe no es válido: usa números con hasta 2 decimales.',
  currency: 'No se conoce la moneda del producto: no se puede registrar su costo.',
  noLines: 'Agrega al menos una línea.',
  tooManyLines: `Un documento admite hasta ${MAX_DOCUMENT_LINES} líneas.`,
  reason: 'Elige el motivo de la salida.',
  destination: 'Elige el punto de destino.',
  sameLocation: 'El destino debe ser distinto del origen.',
  futureDate: 'La fecha no puede ser futura.',
  invalidDate: 'La fecha no es válida.',
  notes: `Las notas admiten hasta ${MAX_NOTES_LENGTH} caracteres.`,
} as const;

export function emptyLine(productId = '', quantity = ''): DocumentLineValues {
  return { productId, quantity, unitCost: '' };
}

/** Local calendar date `YYYY-MM-DD`. */
export function todayDate(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function isValidDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/**
 * The business date of the document (D13: never in the future). Empty or today is left out, so the API
 * records "now"; a past day is sent as noon UTC of that day. The mapping is deterministic, so a resubmit
 * of the same form hashes the same and is an idempotent retry.
 */
export function occurredAtFor(occurredOn: string, today: string): { ok: true; value: string | undefined } | { ok: false; error: string } {
  const value = occurredOn.trim();
  if (value === '') return { ok: true, value: undefined };
  if (!isValidDate(value)) return { ok: false, error: MESSAGES.invalidDate };
  if (value > today) return { ok: false, error: MESSAGES.futureDate };
  return { ok: true, value: value === today ? undefined : `${value}T12:00:00.000Z` };
}

function parseQuantity(raw: string, signed: boolean): number | null {
  const value = raw.trim();
  if (!(signed ? SIGNED_QUANTITY : POSITIVE_QUANTITY).test(value)) return null;
  const quantity = Number(value.replace(',', '.'));
  return quantity === 0 ? null : quantity;
}

function isExitReason(value: string): value is ExitReason {
  return (EXIT_REASONS as readonly string[]).includes(value);
}

/**
 * Validates a document form and builds its request body. The same function runs in the browser (as the
 * user types) and in the Server Action; the API stays the authority (stock, archived, currency).
 */
export function validateDocumentForm(
  kind: DocumentFormKind,
  values: DocumentFormValues,
  { today, currencyOf }: { today: string; currencyOf: (productId: string) => CurrencyCode | null | undefined },
): DocumentFormResult {
  const errors: DocumentFormErrors = { lineErrors: [] };
  const seen = new Set<string>();

  const lines = values.lines.map((line, index) => {
    const lineErrors: LineErrors = {};
    errors.lineErrors[index] = lineErrors;
    const productId = line.productId.trim();
    if (productId === '') lineErrors.productId = MESSAGES.product;
    else if (seen.has(productId)) lineErrors.productId = MESSAGES.repeated;
    seen.add(productId);

    const quantity = parseQuantity(line.quantity, kind === 'adjustment');
    if (quantity === null) lineErrors.quantity = kind === 'adjustment' ? MESSAGES.delta : MESSAGES.quantity;

    if (kind === 'adjustment') return { productId, quantityDelta: quantity ?? 0 };
    if (kind === 'exit' || kind === 'transfer') return { productId, quantity: quantity ?? 0 };

    const cost = parseMoneyInput(line.unitCost);
    const currency = productId === '' ? null : currencyOf(productId);
    if (!cost.ok) lineErrors.unitCost = MESSAGES.costInvalid;
    else if (cost.amount === null) lineErrors.unitCost = MESSAGES.costRequired;
    else if (productId !== '' && !currency) lineErrors.unitCost = MESSAGES.currency;
    const amount = cost.ok && cost.amount !== null ? cost.amount : 0;
    return { productId, quantity: quantity ?? 0, unitCost: { amount, currency: currency ?? 'CUP' } };
  });

  if (values.lines.length === 0) errors.lines = MESSAGES.noLines;
  else if (values.lines.length > MAX_DOCUMENT_LINES) errors.lines = MESSAGES.tooManyLines;

  const reason = values.reason.trim();
  if (kind === 'exit' && !isExitReason(reason)) errors.reason = MESSAGES.reason;

  const toLocationId = values.toLocationId?.trim() ?? '';
  if (kind === 'transfer') {
    if (toLocationId === '') errors.toLocationId = MESSAGES.destination;
    else if (toLocationId === values.locationId) errors.toLocationId = MESSAGES.sameLocation;
  }

  const occurredAt = occurredAtFor(values.occurredOn, today);
  if (!occurredAt.ok) errors.occurredOn = occurredAt.error;

  const notes = values.notes.trim();
  if (notes.length > MAX_NOTES_LENGTH) errors.notes = MESSAGES.notes;

  const lineFailed = errors.lineErrors.some((e) => Object.keys(e).length > 0);
  if (lineFailed || errors.lines || errors.toLocationId || errors.reason || errors.occurredOn || errors.notes || !occurredAt.ok) return { ok: false, errors };

  const header = {
    id: values.id,
    ...(kind === 'transfer' ? { fromLocationId: values.locationId, toLocationId } : { locationId: values.locationId }),
    ...(kind === 'exit' ? { reason: reason as ExitReason } : {}),
    ...(occurredAt.value ? { occurredAt: occurredAt.value } : {}),
    ...(notes ? { notes } : {}),
  };
  return { ok: true, body: { ...header, lines } as DocumentBody };
}

/** First error of a failed validation, for the Server Action's single message. */
export function firstDocumentError(errors: DocumentFormErrors): string {
  const line = errors.lineErrors.find((e) => Object.keys(e).length > 0);
  return errors.lines ?? errors.toLocationId ?? errors.reason ?? errors.occurredOn ?? errors.notes ?? line?.productId ?? line?.quantity ?? line?.unitCost ?? 'Revisa los datos del documento.';
}

function textOf(value: FormDataEntryValue | null | undefined): string {
  return typeof value === 'string' ? value : '';
}

/** Reads the posted form: header fields plus the repeated `line-*` fields, in document order. */
export function readDocumentForm(formData: FormData): DocumentFormValues {
  const productIds = formData.getAll('line-productId');
  const quantities = formData.getAll('line-quantity');
  const costs = formData.getAll('line-unitCost');
  return {
    id: textOf(formData.get('id')).trim(),
    locationId: textOf(formData.get('locationId')).trim(),
    ...(formData.has('toLocationId') ? { toLocationId: textOf(formData.get('toLocationId')).trim() } : {}),
    reason: textOf(formData.get('reason')),
    occurredOn: textOf(formData.get('occurredOn')),
    notes: textOf(formData.get('notes')),
    lines: productIds.map((productId, i) => ({ productId: textOf(productId), quantity: textOf(quantities[i]), unitCost: textOf(costs[i]) })),
  };
}

/** Product currencies posted with an entry (`line-currency`, one per line). The API rejects a mismatch (422). */
export function postedCurrencies(formData: FormData): (productId: string) => CurrencyCode | undefined {
  const productIds = formData.getAll('line-productId');
  const currencies = formData.getAll('line-currency');
  const byProduct = new Map<string, string>();
  productIds.forEach((id, i) => byProduct.set(textOf(id), textOf(currencies[i])));
  return (productId) => {
    const currency = byProduct.get(productId);
    return currency && (CURRENCIES as readonly string[]).includes(currency) ? (currency as CurrencyCode) : undefined;
  };
}
