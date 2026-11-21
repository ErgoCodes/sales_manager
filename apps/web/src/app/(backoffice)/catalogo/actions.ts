'use server';

import { CURRENCIES, CreateProductRequest, SetLocationPriceRequest, UpdateProductRequest, type CurrencyCode } from '@monaco/contracts';
import type { ActionState } from '@/lib/action-state';
import { requestInit } from '@/lib/api/admin';
import { parseId } from '@/lib/admin/form-ids';
import { runMutation, text } from '@/lib/admin/run-mutation';
import { validateLocationPriceForm, validateProductForm, type FieldErrors, type ProductFormValues } from '@/lib/catalog/product-form';

const LIST = '/catalogo';
const BAD_ID = { error: 'El registro indicado no es válido.' };
const INVALID = { error: 'Revisa los datos del producto.' };

/** First field error, so the dialog shows the same message the fields show. */
const firstError = (errors: FieldErrors<string>): ActionState => ({ error: Object.values(errors)[0] ?? INVALID.error });

function readProductForm(formData: FormData): ProductFormValues {
  return {
    name: text(formData, 'name'),
    unitOfMeasure: text(formData, 'unitOfMeasure'),
    category: text(formData, 'category'),
    currency: text(formData, 'currency'),
    // Absent when the cost field was not rendered (D10): the request then leaves the cost as it is.
    costPrice: formData.has('costPrice') ? text(formData, 'costPrice') : undefined,
    cashPrice: text(formData, 'cashPrice'),
    transferPrice: text(formData, 'transferPrice'),
    lowStockThreshold: text(formData, 'lowStockThreshold'),
    expirationDate: text(formData, 'expirationDate'),
  };
}

export async function createProductAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const form = validateProductForm(readProductForm(formData));
  if (!form.ok) return firstError(form.errors);
  const body = CreateProductRequest.safeParse(form.body);
  if (!body.success) return INVALID;
  return runMutation((api) => api.POST('/products', { body: body.data, ...requestInit() }), [LIST]);
}

/** Sends every base price (amount or null) in the form's currency: a currency change must restate them all. */
export async function updateProductAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = parseId(text(formData, 'id'));
  if (!id) return BAD_ID;
  const form = validateProductForm(readProductForm(formData));
  if (!form.ok) return firstError(form.errors);
  const body = UpdateProductRequest.safeParse(form.body);
  if (!body.success) return INVALID;
  return runMutation((api) => api.PATCH('/products/{id}', { params: { path: { id } }, body: body.data, ...requestInit() }), [LIST, `${LIST}/${id}`]);
}

export async function archiveProductAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = parseId(text(formData, 'id'));
  if (!id) return BAD_ID;
  return runMutation((api) => api.POST('/products/{id}/archive', { params: { path: { id } }, ...requestInit() }), [LIST, `${LIST}/${id}`]);
}

function isCurrency(value: string): value is CurrencyCode {
  return (CURRENCIES as readonly string[]).includes(value);
}

export async function setLocationPriceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const productId = parseId(text(formData, 'productId'));
  const locationId = parseId(text(formData, 'locationId'));
  const currency = text(formData, 'currency');
  if (!productId || !locationId || !isCurrency(currency)) return BAD_ID;
  const form = validateLocationPriceForm({ cashPrice: text(formData, 'cashPrice'), transferPrice: text(formData, 'transferPrice') }, currency);
  if (!form.ok) return firstError(form.errors);
  const body = SetLocationPriceRequest.safeParse(form.body);
  if (!body.success) return INVALID;
  return runMutation(
    (api) => api.PUT('/locations/{locationId}/products/{productId}/price', { params: { path: { locationId, productId } }, body: body.data, ...requestInit() }),
    [LIST, `${LIST}/${productId}`],
  );
}
