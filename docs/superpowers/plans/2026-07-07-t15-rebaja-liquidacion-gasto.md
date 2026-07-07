# T-15 · Rebaja de liquidación → gasto automático — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user accepts a "Sugerir rebaja" (stagnant/near-expiration markdown) suggestion on the product form and saves, automatically register the resulting potential loss as a `rebaja_liquidacion` expense — no separate manual step.

**Architecture:** All changes live in the existing product form screen (`app/catalog/[id].tsx`), which already renders the rebaja banner from T-08. Add local state to remember the price *before* the rebaja was applied and the product's current stock (already computed but previously discarded), then in the existing submit handler compute `(priceBeforeRebaja - newPrice) * stock` and call the existing `registerExpense` (T-14) with a new expense type. No schema changes — `expenses.type` is a free-text column; only the type registry (`constants/expenses.ts`) and its label/tone maps need the new value.

**Tech Stack:** React Native, Expo Router, react-hook-form + zod, Drizzle ORM (SQLite), date-fns. No test runner is configured in this project — verification is manual, via the Expo dev build (per this repo's CLAUDE.md).

---

## Task 1: Register the `rebaja_liquidacion` expense type

**Files:**
- Modify: `constants/expenses.ts:11-15`

- [ ] **Step 1: Add the new type to `EXPENSE_TYPES`**

```ts
/** Gastos periódicos que reducen la utilidad real (T-14, T-15). */
export const EXPENSE_TYPES = [
  { label: 'Salario', value: 'salario' },
  { label: 'Multa', value: 'multa' },
  { label: 'ONAT', value: 'onat' },
  { label: 'Rebaja de liquidación', value: 'rebaja_liquidacion' },
] as const;
```

`getTypeLabel` and `TYPE_LABELS` below it are built from this array automatically — no other change needed in this file.

- [ ] **Step 2: Add a badge tone for the new type**

File: `app/(tabs)/expenses.tsx:17-24`

```ts
const TONE_BY_TYPE: Record<string, BadgeTone> = {
  merma: 'danger',
  retiro_owner: 'warning',
  ajuste: 'neutral',
  salario: 'info',
  multa: 'danger',
  onat: 'cost',
  rebaja_liquidacion: 'warning',
};
```

(Matches the amber/warning styling already used for the rebaja banner in the product form.)

- [ ] **Step 3: Verify with lint**

Run: `npx expo lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add constants/expenses.ts "app/(tabs)/expenses.tsx"
git commit -m "feat(t15): registrar tipo de gasto rebaja_liquidacion"
```

---

## Task 2: Track pre-rebaja price and current stock in the product form

**Files:**
- Modify: `app/catalog/[id].tsx:64-101`

The screen already computes `stock` inside the `useEffect` that loads the product (line 83, via `calculateStock`) but only uses it to derive `stagnantInfo` and then discards it. We need to keep it in state, plus add two new pieces of state: whether the rebaja banner's suggestion was accepted, and what the cash price was right before that happened.

- [ ] **Step 1: Add the new state variables**

Locate (around line 64-65):

```ts
  const [stagnantInfo, setStagnantInfo] = useState<{ stagnant: boolean; nearExpiration: boolean } | null>(null);
  const [discountPct, setDiscountPct] = useState(15);
```

Replace with:

```ts
  const [stagnantInfo, setStagnantInfo] = useState<{ stagnant: boolean; nearExpiration: boolean } | null>(null);
  const [discountPct, setDiscountPct] = useState(15);
  const [currentStock, setCurrentStock] = useState(0);
  const [rebajaApplied, setRebajaApplied] = useState(false);
  const [priceBeforeRebaja, setPriceBeforeRebaja] = useState(0);
```

- [ ] **Step 2: Persist the stock value computed in the load effect**

Locate (around line 82-91):

```ts
      const [stock, lastSaleDate, pctStr] = await Promise.all([
        calculateStock(Number(id)),
        getLastSaleDate(Number(id)),
        getConfig(CONFIG_KEYS.stagnantDiscountPercent),
      ]);
      setDiscountPct(Number(pctStr ?? 15));
      setStagnantInfo({
        stagnant: isStagnant({ stock, lastSaleDate }),
        nearExpiration: isNearExpiration({ expirationDate: p.expirationDate }),
      });
```

Replace with:

```ts
      const [stock, lastSaleDate, pctStr] = await Promise.all([
        calculateStock(Number(id)),
        getLastSaleDate(Number(id)),
        getConfig(CONFIG_KEYS.stagnantDiscountPercent),
      ]);
      setCurrentStock(stock);
      setDiscountPct(Number(pctStr ?? 15));
      setStagnantInfo({
        stagnant: isStagnant({ stock, lastSaleDate }),
        nearExpiration: isNearExpiration({ expirationDate: p.expirationDate }),
      });
```

- [ ] **Step 3: Capture the pre-rebaja price when the banner button is pressed**

Locate the "Sugerir rebaja" `Pressable` (around line 255-262):

```tsx
          <Pressable
            hitSlop={8}
            onPress={() => setValue('cashPrice', String(suggestedRebaja))}>
            <Text variant="label" className="text-amber-700">
              Sugerir rebaja
            </Text>
          </Pressable>
```

Replace the `onPress` with:

```tsx
          <Pressable
            hitSlop={8}
            onPress={() => {
              setPriceBeforeRebaja(cashNum);
              setRebajaApplied(true);
              setValue('cashPrice', String(suggestedRebaja));
            }}>
            <Text variant="label" className="text-amber-700">
              Sugerir rebaja
            </Text>
          </Pressable>
```

Note: this is the *only* place `rebajaApplied` is set to `true`. The other suggestion button ("Usar sugerido", cost+30% pricing) must NOT touch it — leave that `Pressable` (around line 235-241) unchanged.

- [ ] **Step 4: Verify with lint**

Run: `npx expo lint`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add app/catalog/\[id\].tsx
git commit -m "feat(t15): registrar precio previo y stock al aceptar una rebaja"
```

---

## Task 3: Register the expense automatically on save

**Files:**
- Modify: `app/catalog/[id].tsx:1-18` (imports), `:103-118` (`onSubmit`)

- [ ] **Step 1: Import `registerExpense` and `format`**

Locate the top imports (around line 1-17):

```ts
import { zodResolver } from '@hookform/resolvers/zod';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, ScrollView, View } from 'react-native';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Text } from '@/components/ui/text';
import { CATEGORY_OPTIONS, UNITS_OF_MEASURE } from '@/constants/catalog';
import { CONFIG_KEYS, getConfig } from '@/db/config';
import { createProduct, getProduct, updateProduct } from '@/db/products';
import { calculateStock, getLastSaleDate } from '@/db/queries';
import { isNearExpiration, isStagnant } from '@/lib/product-status';
import { calculateTransferPrice } from '@/lib/pricing';
```

Replace with:

```ts
import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, ScrollView, View } from 'react-native';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Text } from '@/components/ui/text';
import { CATEGORY_OPTIONS, UNITS_OF_MEASURE } from '@/constants/catalog';
import { CONFIG_KEYS, getConfig } from '@/db/config';
import { registerExpense } from '@/db/expenses';
import { createProduct, getProduct, updateProduct } from '@/db/products';
import { calculateStock, getLastSaleDate } from '@/db/queries';
import { isNearExpiration, isStagnant } from '@/lib/product-status';
import { calculateTransferPrice } from '@/lib/pricing';
```

- [ ] **Step 2: Register the expense in `onSubmit` when a rebaja was accepted and actually lowered the price**

Locate `onSubmit` (around line 103-118):

```ts
  const onSubmit = handleSubmit(async (values) => {
    const cash = Number(values.cashPrice);
    const data = {
      name: values.name.trim(),
      unitOfMeasure: values.unitOfMeasure,
      category: values.category,
      lowStockThreshold: Number(values.lowStockThreshold),
      costPrice: Number(values.costPrice),
      cashPrice: cash,
      transferPrice: calculateTransferPrice(cash),
      expirationDate: values.expirationDate?.trim() || null,
    };
    if (isNew) await createProduct(data);
    else await updateProduct(Number(id), data);
    router.back();
  });
```

Replace with:

```ts
  const onSubmit = handleSubmit(async (values) => {
    const cash = Number(values.cashPrice);
    const data = {
      name: values.name.trim(),
      unitOfMeasure: values.unitOfMeasure,
      category: values.category,
      lowStockThreshold: Number(values.lowStockThreshold),
      costPrice: Number(values.costPrice),
      cashPrice: cash,
      transferPrice: calculateTransferPrice(cash),
      expirationDate: values.expirationDate?.trim() || null,
    };
    if (isNew) await createProduct(data);
    else await updateProduct(Number(id), data);

    if (!isNew && rebajaApplied && priceBeforeRebaja > cash && currentStock > 0) {
      const potentialLoss = (priceBeforeRebaja - cash) * currentStock;
      await registerExpense({
        type: 'rebaja_liquidacion',
        concept: values.name.trim(),
        amount: potentialLoss,
        date: format(new Date(), 'yyyy-MM-dd'),
      });
    }

    router.back();
  });
```

The `priceBeforeRebaja > cash` guard prevents registering a bogus (zero/negative) expense if the user accepted the suggestion and then raised the price back up before saving. The `currentStock > 0` guard skips it for out-of-stock products, where there's no inventory left to value the loss against.

- [ ] **Step 3: Verify with lint**

Run: `npx expo lint`
Expected: no new errors.

- [ ] **Step 4: Manual verification (no test runner in this project)**

Run: `npx expo start` and open on device/emulator.

1. Go to a product that is stagnant or near expiration (or temporarily set `umbral_alerta`/`fecha_vencimiento` on one via the catalog form to trigger the banner — see T-08's `isStagnant`/`isNearExpiration` conditions in `lib/product-status.ts`).
2. Open that product's edit screen — confirm the amber "Sugerir rebaja" banner appears.
3. Note the current stock and cash price.
4. Tap "Sugerir rebaja" — confirm the cash price field updates to the suggested (discounted) value.
5. Tap "Guardar cambios".
6. Go to the Gastos tab — confirm a new entry appears with label "Rebaja de liquidación", the product's name as concept, today's date, and amount equal to `(precio_anterior - precio_nuevo) × stock`.
7. Repeat steps 1-3 on another product, tap "Sugerir rebaja", then manually raise the cash price back above the original before saving — confirm no expense is created this time.
8. Edit a product's price normally (no "Sugerir rebaja" tap) — confirm no expense is created.

Expected: all four scenarios behave as described above.

- [ ] **Step 5: Commit**

```bash
git add app/catalog/\[id\].tsx
git commit -m "feat(t15): registrar gasto de rebaja de liquidacion al guardar"
```

---

## Spec coverage check

- Detect an accepted rebaja at submit time → Task 2 Step 3 + Task 3 Step 2 (`rebajaApplied` flag).
- Compute potential loss `(precio_anterior - precio_nuevo) × stock_actual` using `calculateStock` → Task 2 Step 2 (`currentStock`) + Task 3 Step 2.
- Call `registerExpense({ type: 'rebaja_liquidacion', ... })` in the same operation as the save → Task 3 Step 2.
- `constants/expenses.ts` label for `rebaja_liquidacion` → Task 1 Step 1 (added), Task 1 Step 2 (badge tone, bonus — not in original doc but required for the Gastos tab to render sensibly).
- Acceptance: "aprobar rebaja inserta el gasto solo" → Task 3 Step 4, scenario 1-6.
- Acceptance: "ventas posteriores usan el precio rebajado" → already works today (sales read `cashPrice`/`transferPrice` off the catalog); no task needed.
