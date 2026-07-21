# 13 · Utilidad y costo promedio inflados (ganancia mal calculada)

**Prioridad: Alta · Esfuerzo: ~1.5-2 días (incluye backfill de datos)**

Reportado por la clienta (Mercado Mónaco) el 2026-07-19 probando la app: *"Un chupa chupa lo compro a 45, y lo vendo a 60, la ganancia son 15, no 37,50 como dice de utilidad. Esa es la misma cuenta q pone de costo promedio"*. También pidió revisar el costo unitario y notó que el ranking "Más rentables" usa ese mismo costo promedio inflado para decidir qué producto da más ganancia.

## Estado actual

La utilidad de cada línea de venta se calcula como `(precio_aplicado − costo_promedio) × cantidad`, **usando `averageCost` (columna `costo_promedio`) como costo**, nunca `costPrice` (`precio_costo`, el precio de compra que la clienta escribe):

- En el carrito, al añadir la línea: [app/sales/new-session.tsx:86](../app/sales/new-session.tsx#L86) — `profit = (appliedPrice - product.averageCost) * qty` y [app/sales/new-session.tsx:98](../app/sales/new-session.tsx#L98) — `costAtSale: product.averageCost`.
- Al persistir la venta (fuente de verdad): [db/sales.ts:100-101](../db/sales.ts#L100-L101) — `const costAtSale = prod.averageCost; const profit = (item.appliedPrice - costAtSale) * item.quantity;`. Este valor se congela en la fila (`ventas.utilidad`, `ventas.costo_al_vender`).

El `averageCost` sale de la columna `costo_promedio`, que **por defecto es 0** ([db/schema.ts:11](../db/schema.ts#L11)) y **no se siembra al crear el producto**: `createProduct` ([db/products.ts:48-51](../db/products.ts#L48-L51)) inserta `precio_costo`, `precio_efectivo` y `precio_transferencia` pero nunca `costo_promedio`. El formulario de producto ([app/catalog/[id].tsx:128-146](../app/catalog/[id].tsx#L128-L146)) captura "Precio de costo" pero ese valor no llega a `costo_promedio`.

El único punto que actualiza `costo_promedio` es la entrada de almacén: `registerEntry` → `recalculateAverageCost` ([db/queries.ts:64-84](../db/queries.ts#L64-L84)):

```ts
const currentAverageCost = prod?.averageCost ?? 0;
const denominator = currentStock + newQuantity;
if (denominator <= 0) return newCost;
return (currentStock * currentAverageCost + newQuantity * newCost) / denominator;
```

Es un promedio ponderado que mezcla el stock existente (a su `costo_promedio` actual) con el lote nuevo. Si el stock existente arrastra `costo_promedio = 0` (porque nunca se sembró, o porque se sumó stock con un `ajuste`, que **no** recalcula el promedio — [db/movements.ts:56-66](../db/movements.ts#L56-L66)), el promedio se diluye hacia 0.

Los resúmenes y reportes consumen esa utilidad congelada sin recalcularla:
- Resumen del día: [db/queries.ts:100](../db/queries.ts#L100) (`SUM(ventas.utilidad)`), mostrado en [app/(tabs)/index.tsx:201-211](../app/\(tabs\)/index.tsx#L201-L211) y [app/(tabs)/sales.tsx:114-124](../app/\(tabs\)/sales.tsx#L114-L124).
- Ranking "Más rentables": el margen es `SUM(utilidad) / SUM(ingreso)` ([db/queries.ts:302](../db/queries.ts#L302)), reutilizando la misma utilidad inflada; se muestra en [app/reports/rankings.tsx:221](../app/reports/rankings.tsx#L221).

Existe ya el patrón de fallback correcto en el repo, pero **solo se usa en salidas de almacén**, no en el cálculo de utilidad: [app/expenses/outflow.tsx:105](../app/expenses/outflow.tsx#L105) — `const cost = p.averageCost > 0 ? p.averageCost : (p.costPrice ?? 0);`.

## Problema / Objetivo

**Causa raíz:** la utilidad depende de `costo_promedio`, que puede quedar en 0 o diluido porque (a) no se siembra al crear el producto desde `precio_costo`, (b) el cálculo de utilidad no cae de vuelta a `precio_costo` cuando el promedio es 0/menor, y (c) `recalculateAverageCost` mezcla stock previo sin costo (a 0) con lotes reales.

El caso del chupa chupa: precio de compra real 45, venta 60, utilidad esperada 15. La app reporta 37,50, es decir un `costo_promedio` de 22,50 (= 60 − 37,50). 22,50 es exactamente el promedio ponderado de un lote real a 45 con un lote "fantasma" de igual cantidad a costo 0: `(q·0 + q·45) / (q + q) = 22,50`. El mismo número aparece como "costo promedio" en la ficha del producto ([app/sales/new-session.tsx:250-251](../app/sales/new-session.tsx#L250-L251)), por eso la clienta dice "es la misma cuenta". En el ranking, `37,50 / 60 ≈ 62 %` de margen — de ahí los ~61-62 % inflados de "Más rentables". El arroz (costo 650, efectivo 780) tiene margen real ≈ 17 %; con el promedio diluido por debajo de 650 el margen se dispara.

Objetivo: que la utilidad y el margen reflejen el costo real de compra (`precio_costo`) cuando el `costo_promedio` no es fiable, y que `costo_promedio` deje de partir de 0.

## Plan de mejora

1. **Sembrar `costo_promedio` al crear el producto.** En `createProduct` ([db/products.ts:48-51](../db/products.ts#L48-L51)) inicializar `averageCost: data.costPrice ?? 0` para que un producto recién creado tenga un costo base real desde la primera venta, sin depender de una entrada de almacén.
2. **Usar el fallback a `precio_costo` en el cálculo de utilidad**, reutilizando el patrón de [app/expenses/outflow.tsx:105](../app/expenses/outflow.tsx#L105). Definir un helper único (p. ej. `effectiveUnitCost(product)` en `lib/pricing.ts`) que devuelva `averageCost > 0 ? averageCost : (costPrice ?? 0)` y usarlo en:
   - [db/sales.ts:100-101](../db/sales.ts#L100-L101) (fuente de verdad al persistir).
   - [app/sales/new-session.tsx:86,98](../app/sales/new-session.tsx#L86) (preview del carrito).
3. **Endurecer `recalculateAverageCost`** ([db/queries.ts:64-84](../db/queries.ts#L64-L84)): cuando `currentAverageCost` sea 0 pero exista stock previo, tratar ese stock al `precio_costo` del producto en vez de a 0 (o, más simple, ignorar el término de stock previo cuando su costo es 0), evitando la dilución hacia abajo. Decidir la regla con la clienta (ver dudas abiertas).
4. **Corregir la venta a costo (opcional, verificar).** En venta a trabajador se fuerza `profit = 0` ([app/sales/new-session.tsx:77-79](../app/sales/new-session.tsx#L77-L79)); confirmar que eso sigue siendo el comportamiento deseado tras el cambio (a costo real la utilidad sería 0 de todos modos).
5. **Backfill de datos existentes.** Las filas de `ventas` ya guardaron `utilidad` y `costo_al_vender` inflados, y los productos tienen `costo_promedio` diluido:
   - Recalcular `productos.costo_promedio` de los productos afectados (los que quedaron en 0 o por debajo de `precio_costo`).
   - Recalcular `ventas.utilidad`/`ventas.costo_al_vender` con el costo corregido, mediante una migración/script de una sola pasada (reusar el patrón de recálculo de `updateSale` en [db/sales.ts:209-234](../db/sales.ts#L209-L234), que recomputa utilidad a partir de `costAtSale`).
6. **Verificar reportes.** Tras el backfill, confirmar utilidad del día ([db/queries.ts:100](../db/queries.ts#L100)) y margen del ranking ([db/queries.ts:302](../db/queries.ts#L302)) con el ejemplo del chupa chupa (15) y del arroz (~17 %).

## Criterio de hecho

- Vender chupa chupa comprado a 45 y vendido a 60 reporta utilidad **15**, no 37,50.
- El "costo promedio" mostrado en la ficha del producto ([app/sales/new-session.tsx:250-251](../app/sales/new-session.tsx#L250-L251)) coincide con el precio de compra real cuando no hubo entradas que lo modifiquen.
- Un producto recién creado tiene `costo_promedio` = `precio_costo` (no 0) y su primera venta calcula utilidad correcta sin necesidad de registrar una entrada de almacén.
- El ranking "Más rentables" ([app/reports/rankings.tsx](../app/reports/rankings.tsx)) ordena por utilidad/margen reales (arroz ≈ 17 %, no ~62 %).
- Las ventas históricas afectadas quedan recalculadas (utilidad y costo) tras el backfill; los totales de utilidad del día/período reflejan los valores corregidos.
- Registrar una entrada de almacén sobre stock previo sin costo ya no diluye `costo_promedio` hacia 0.
