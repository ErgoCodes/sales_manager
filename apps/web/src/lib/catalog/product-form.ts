import { CURRENCIES, type CreateProductRequest, type CurrencyCode, type Money, type SetLocationPriceRequest } from '@monaco/contracts';
import { isCategory, isUnitOfMeasure } from '@monaco/domain';
import { minorToInput, parseMoneyInput } from './money';

/** Raw form values (strings, as typed). `costPrice` is undefined when the cost field is not rendered. */
export interface ProductFormValues {
  name: string;
  unitOfMeasure: string;
  category: string;
  currency: string;
  costPrice: string | undefined;
  cashPrice: string;
  transferPrice: string;
  lowStockThreshold: string;
  expirationDate: string;
}
export type ProductField = keyof ProductFormValues;
export type FieldErrors<K extends string> = Partial<Record<K, string>>;

type Result<T, K extends string> = { ok: true; body: T } | { ok: false; errors: FieldErrors<K> };

const INVALID_AMOUNT = 'El importe no es válido: usa números con hasta 2 decimales.';
const THRESHOLD = /^\d{1,11}(?:[.,]\d{1,3})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function emptyProductForm(): ProductFormValues {
  return { name: '', unitOfMeasure: 'ud', category: '', currency: 'CUP', costPrice: '', cashPrice: '', transferPrice: '', lowStockThreshold: '', expirationDate: '' };
}

interface EditableProduct {
  name: string;
  unitOfMeasure: string;
  category: string | null;
  currency: CurrencyCode;
  costPrice: Money | null;
  cashPrice: Money | null;
  transferPrice: Money | null;
  lowStockThreshold: number | null;
  expirationDate: string | null;
}

/** Form values of an existing product. Without cost visibility the cost stays out of the form (and of the request). */
export function productFormFromProduct(product: EditableProduct, { showCost }: { showCost: boolean }): ProductFormValues {
  return {
    name: product.name,
    unitOfMeasure: product.unitOfMeasure,
    category: product.category ?? '',
    currency: product.currency,
    costPrice: showCost ? minorToInput(product.costPrice?.amount) : undefined,
    cashPrice: minorToInput(product.cashPrice?.amount),
    transferPrice: minorToInput(product.transferPrice?.amount),
    lowStockThreshold: product.lowStockThreshold == null ? '' : String(product.lowStockThreshold),
    expirationDate: product.expirationDate ?? '',
  };
}

function isCurrency(value: string): value is CurrencyCode {
  return (CURRENCIES as readonly string[]).includes(value);
}

/**
 * Validates the product form and builds the request body (minor units, the chosen currency).
 * Every base price is always sent (an amount or null), so a currency change restates them all,
 * as the API requires. The Server Action still runs the contract schema on the result.
 */
export function validateProductForm(values: ProductFormValues): Result<CreateProductRequest, ProductField> {
  const errors: FieldErrors<ProductField> = {};
  const name = values.name.trim();
  if (name === '') errors.name = 'El nombre es obligatorio.';
  else if (name.length > 200) errors.name = 'El nombre admite hasta 200 caracteres.';
  if (!isUnitOfMeasure(values.unitOfMeasure)) errors.unitOfMeasure = 'Elige una unidad de medida de la lista.';
  if (values.category !== '' && !isCategory(values.category)) errors.category = 'Elige una categoría de la lista.';
  const currency = isCurrency(values.currency) ? values.currency : null;
  if (!currency) errors.currency = 'Elige una moneda: CUP, USD o MLC.';

  const amount = (field: 'costPrice' | 'cashPrice' | 'transferPrice', raw: string): Money | null => {
    const parsed = parseMoneyInput(raw);
    if (!parsed.ok) {
      errors[field] = INVALID_AMOUNT;
      return null;
    }
    return parsed.amount === null || !currency ? null : { amount: parsed.amount, currency };
  };
  const costPrice = values.costPrice === undefined ? undefined : amount('costPrice', values.costPrice);
  const cashPrice = amount('cashPrice', values.cashPrice);
  const transferPrice = amount('transferPrice', values.transferPrice);

  const thresholdText = values.lowStockThreshold.trim();
  let lowStockThreshold: number | null = null;
  if (thresholdText !== '') {
    if (THRESHOLD.test(thresholdText)) lowStockThreshold = Number(thresholdText.replace(',', '.'));
    else errors.lowStockThreshold = 'El umbral debe ser un número mayor o igual que 0, con hasta 3 decimales.';
  }
  const expirationDate = values.expirationDate.trim();
  if (expirationDate !== '' && !(ISO_DATE.test(expirationDate) && !Number.isNaN(Date.parse(expirationDate)))) errors.expirationDate = 'La fecha de vencimiento no es válida.';

  if (Object.keys(errors).length > 0 || !currency) return { ok: false, errors };
  return {
    ok: true,
    body: {
      name,
      unitOfMeasure: values.unitOfMeasure,
      category: values.category === '' ? null : values.category,
      currency,
      ...(costPrice === undefined ? {} : { costPrice }),
      cashPrice,
      transferPrice,
      lowStockThreshold,
      expirationDate: expirationDate === '' ? null : expirationDate,
    },
  };
}

export interface LocationPriceFormValues {
  cashPrice: string;
  transferPrice: string;
}

/** Per-location override body: an empty field removes that override (null). Amounts go in the product currency. */
export function validateLocationPriceForm(values: LocationPriceFormValues, currency: CurrencyCode): Result<SetLocationPriceRequest, keyof LocationPriceFormValues> {
  const errors: FieldErrors<keyof LocationPriceFormValues> = {};
  const toMoney = (field: keyof LocationPriceFormValues): Money | null => {
    const parsed = parseMoneyInput(values[field]);
    if (!parsed.ok) {
      errors[field] = INVALID_AMOUNT;
      return null;
    }
    return parsed.amount === null ? null : { amount: parsed.amount, currency };
  };
  const cashPrice = toMoney('cashPrice');
  const transferPrice = toMoney('transferPrice');
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, body: { cashPrice, transferPrice } };
}
