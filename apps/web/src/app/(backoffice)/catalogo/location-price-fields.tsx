'use client';

import { useId, useState } from 'react';
import type { CurrencyCode, Money } from '@monaco/contracts';
import { Input } from '@/components/ui/input';
import { formatMoney, minorToInput } from '@/lib/catalog/money';
import { validateLocationPriceForm, type LocationPriceFormValues } from '@/lib/catalog/product-form';
import { FormField, errorProps } from './form-field';
import { ProposalHint } from './product-form-fields';
import { useTransferProposal } from './use-transfer-proposal';

interface Props {
  productId: string;
  locationId: string;
  currency: CurrencyCode;
  basePrices: { cash: Money | null; transfer: Money | null };
  overrides: { cash: Money | null; transfer: Money | null };
}

/**
 * Fields of the "set location price" dialog: the two overrides of one product in one location.
 * An empty field removes that override, so the location falls back to the base price.
 */
export function LocationPriceFields({ productId, locationId, currency, basePrices, overrides }: Props) {
  const uid = useId();
  const prices = useTransferProposal(minorToInput(overrides.cash?.amount), minorToInput(overrides.transfer?.amount));
  const [dirty, setDirty] = useState<ReadonlySet<keyof LocationPriceFormValues>>(new Set());
  const result = validateLocationPriceForm({ cashPrice: prices.cash, transferPrice: prices.transfer }, currency);
  const error = (field: keyof LocationPriceFormValues) => (!result.ok && dirty.has(field) ? result.errors[field] : undefined);
  const touch = (field: keyof LocationPriceFormValues) => setDirty((cur) => new Set(cur).add(field));
  const cashId = `${uid}-cash`;
  const transferId = `${uid}-transfer`;

  return (
    <div className="space-y-3">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="locationId" value={locationId} />
      <input type="hidden" name="currency" value={currency} />
      <p className="text-sm opacity-70">
        Precio base: {formatMoney(basePrices.cash)} en efectivo, {formatMoney(basePrices.transfer)} por transferencia. Deja un campo vacío para usar el precio base.
      </p>
      <FormField id={cashId} label="Precio en efectivo del punto" error={error('cashPrice')}>
        <Input
          id={cashId}
          name="cashPrice"
          inputMode="decimal"
          value={prices.cash}
          onChange={(e) => {
            prices.setCash(e.target.value);
            touch('cashPrice');
          }}
          {...errorProps(cashId, error('cashPrice'))}
        />
      </FormField>
      <FormField id={transferId} label="Precio por transferencia del punto" error={error('transferPrice')} hint={<ProposalHint proposal={prices.proposal} onApply={prices.applyProposal} />}>
        <Input
          id={transferId}
          name="transferPrice"
          inputMode="decimal"
          value={prices.transfer}
          onChange={(e) => {
            prices.setTransfer(e.target.value);
            touch('transferPrice');
          }}
          {...errorProps(transferId, error('transferPrice'))}
        />
      </FormField>
    </div>
  );
}
