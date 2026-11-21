'use client';

import { useId, useState } from 'react';
import { CURRENCIES } from '@monaco/contracts';
import { CATEGORIES, UNITS_OF_MEASURE } from '@monaco/domain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { emptyProductForm, productFormFromProduct, validateProductForm, type ProductField, type ProductFormValues } from '@/lib/catalog/product-form';
import { FormField, SELECT_CLASS, errorProps } from './form-field';
import { useTransferProposal } from './use-transfer-proposal';

type EditableProduct = Parameters<typeof productFormFromProduct>[0] & { id: string };

/**
 * Fields of the create / edit product dialog (inside `FormDialog`). Controlled, so values survive a
 * failed submit; errors show per field once it was changed. The Server Action validates again with
 * the same rules and the contract schema, and the API is the authority. `showCost` mirrors the D10
 * rule: without it the cost field is not rendered and the request leaves the cost untouched.
 */
export function ProductFormFields({ product, showCost }: { product?: EditableProduct; showCost: boolean }) {
  const uid = useId();
  const initial = product ? productFormFromProduct(product, { showCost }) : { ...emptyProductForm(), costPrice: showCost ? '' : undefined };
  const [values, setValues] = useState<Omit<ProductFormValues, 'cashPrice' | 'transferPrice'>>(initial);
  const prices = useTransferProposal(initial.cashPrice, initial.transferPrice);
  const [dirty, setDirty] = useState<ReadonlySet<ProductField>>(new Set());

  const all: ProductFormValues = { ...values, cashPrice: prices.cash, transferPrice: prices.transfer };
  const result = validateProductForm(all);
  const error = (field: ProductField) => (!result.ok && dirty.has(field) ? result.errors[field] : undefined);
  const touch = (field: ProductField) => setDirty((cur) => new Set(cur).add(field));
  const set = (field: Exclude<ProductField, 'cashPrice' | 'transferPrice'>) => (value: string) => {
    setValues((cur) => ({ ...cur, [field]: value }));
    touch(field);
  };
  const id = (field: ProductField) => `${uid}-${field}`;
  const currencyChanged = product !== undefined && values.currency !== product.currency;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {product ? <input type="hidden" name="id" value={product.id} /> : null}
      <div className="sm:col-span-2">
        <FormField id={id('name')} label="Nombre" error={error('name')}>
          <Input id={id('name')} name="name" value={values.name} onChange={(e) => set('name')(e.target.value)} maxLength={200} required {...errorProps(id('name'), error('name'))} />
        </FormField>
      </div>
      <FormField id={id('unitOfMeasure')} label="Unidad de medida" error={error('unitOfMeasure')}>
        <select id={id('unitOfMeasure')} name="unitOfMeasure" className={SELECT_CLASS} value={values.unitOfMeasure} onChange={(e) => set('unitOfMeasure')(e.target.value)}>
          {UNITS_OF_MEASURE.map((unit) => (
            <option key={unit.value} value={unit.value}>
              {unit.label}
            </option>
          ))}
        </select>
      </FormField>
      <FormField id={id('category')} label="Categoría" error={error('category')}>
        <select id={id('category')} name="category" className={SELECT_CLASS} value={values.category} onChange={(e) => set('category')(e.target.value)}>
          <option value="">Sin categoría</option>
          {CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </FormField>
      <FormField
        id={id('currency')}
        label="Moneda"
        error={error('currency')}
        hint={currencyChanged ? 'Al cambiar la moneda se envían de nuevo todos los precios base en la nueva moneda. No es posible si el producto tiene precios por punto o movimientos de inventario.' : undefined}
      >
        <select id={id('currency')} name="currency" className={SELECT_CLASS} value={values.currency} onChange={(e) => set('currency')(e.target.value)}>
          {CURRENCIES.map((currency) => (
            <option key={currency} value={currency}>
              {currency}
            </option>
          ))}
        </select>
      </FormField>
      {values.costPrice !== undefined ? (
        <FormField id={id('costPrice')} label="Costo" error={error('costPrice')}>
          <Input id={id('costPrice')} name="costPrice" inputMode="decimal" value={values.costPrice} onChange={(e) => set('costPrice')(e.target.value)} {...errorProps(id('costPrice'), error('costPrice'))} />
        </FormField>
      ) : null}
      <FormField id={id('cashPrice')} label="Precio en efectivo" error={error('cashPrice')}>
        <Input
          id={id('cashPrice')}
          name="cashPrice"
          inputMode="decimal"
          value={prices.cash}
          onChange={(e) => {
            prices.setCash(e.target.value);
            touch('cashPrice');
          }}
          {...errorProps(id('cashPrice'), error('cashPrice'))}
        />
      </FormField>
      <FormField id={id('transferPrice')} label="Precio por transferencia" error={error('transferPrice')} hint={<ProposalHint proposal={prices.proposal} onApply={prices.applyProposal} />}>
        <Input
          id={id('transferPrice')}
          name="transferPrice"
          inputMode="decimal"
          value={prices.transfer}
          onChange={(e) => {
            prices.setTransfer(e.target.value);
            touch('transferPrice');
          }}
          {...errorProps(id('transferPrice'), error('transferPrice'))}
        />
      </FormField>
      <FormField id={id('lowStockThreshold')} label="Umbral de bajo stock" error={error('lowStockThreshold')} hint="Vacío: se usa el umbral de la categoría.">
        <Input id={id('lowStockThreshold')} name="lowStockThreshold" inputMode="decimal" value={values.lowStockThreshold} onChange={(e) => set('lowStockThreshold')(e.target.value)} {...errorProps(id('lowStockThreshold'), error('lowStockThreshold'))} />
      </FormField>
      <FormField id={id('expirationDate')} label="Fecha de vencimiento" error={error('expirationDate')}>
        <Input id={id('expirationDate')} name="expirationDate" type="date" value={values.expirationDate} onChange={(e) => set('expirationDate')(e.target.value)} {...errorProps(id('expirationDate'), error('expirationDate'))} />
      </FormField>
    </div>
  );
}

/** The transfer price proposal (cash + 10 %, rounded to 5), with a button to apply it again. */
export function ProposalHint({ proposal, onApply }: { proposal: string | null; onApply: () => void }) {
  if (proposal === null) return <>Se propone a partir del precio en efectivo.</>;
  return (
    <span className="flex items-center gap-2">
      <span>Propuesta: {proposal} (efectivo + 10 %, redondeado a 5).</span>
      <Button type="button" size="sm" variant="ghost" className="h-6 px-2" onClick={onApply}>
        Usar propuesta
      </Button>
    </span>
  );
}
