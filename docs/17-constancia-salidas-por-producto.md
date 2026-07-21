# 17 · Constancia de salidas por producto (cantidad + tipo)

**Prioridad: Media · Esfuerzo: ~1 día**

Feedback de la clienta (Mercado Mónaco) el 2026-07-19 probando la app: "Necesito constancia de las cantidades x productos en el caso de retiro x dueño, merma y otro concepto y q se rebaje del inventario". Pide un registro/constancia consultable de las salidas de almacén desglosado **por producto y cantidad**, no solo por monto. (La parte de "que se rebaje del inventario" es el bug de inventario y se documenta aparte; aquí el foco es la constancia/reporte.)

## Estado actual

Ya existe un reporte de pérdidas y su export a Excel, pero está pensado en **valor monetario**, no en cantidades por producto.

- La pantalla es [app/reports/losses.tsx](../app/reports/losses.tsx) ("Pérdidas y gastos"). Carga los datos con `getLossesBreakdown(period.from, period.to)` en [app/reports/losses.tsx:46-57](../app/reports/losses.tsx#L46-L57) y los agrupa por categoría.
- El export a Excel (`handleExport`, [app/reports/losses.tsx:68-93](../app/reports/losses.tsx#L68-L93)) genera el archivo `reporte_perdidas_${period.from}.xlsx` que la clienta ya vio ([app/reports/losses.tsx:80](../app/reports/losses.tsx#L80)). Sus columnas son solo `["Categoría", "Concepto", "Fecha", "Monto"]` ([app/reports/losses.tsx:72](../app/reports/losses.tsx#L72)) y cada fila se arma como `[cat.label, r.label, r.date, r.amount]` ([app/reports/losses.tsx:76](../app/reports/losses.tsx#L76)) — **no incluye cantidad ni unidad de medida**.
- La query `getLossesBreakdown` ([db/queries.ts:348-422](../db/queries.ts#L348-L422)) selecciona de `warehouseMovements` solo el `value` (`ABS(cantidad) × precio_costo_unitario`, [db/queries.ts:358](../db/queries.ts#L358)) pero **no proyecta `quantity` ni `unitOfMeasure`**. El tipo `LossRecord` ([db/queries.ts:306-312](../db/queries.ts#L306-L312)) tiene `label`, `amount`, `date`, sin campo de cantidad. En la UI, cada registro solo muestra fecha, nombre y monto ([app/reports/losses.tsx:222-256](../app/reports/losses.tsx#L222-L256)).
- Las categorías de salidas de almacén que entran al reporte están fijadas en `LOSS_CATEGORIES` ([db/queries.ts:328-340](../db/queries.ts#L328-L340)): solo `retiro_owner` y `merma` (source `"movement"`). El filtro de la query también se limita a esos dos tipos ([db/queries.ts:365](../db/queries.ts#L365)).
- Los tipos de salida disponibles al registrar son `OUTFLOW_TYPES` en [drizzle/constants/expenses.ts:2-6](../drizzle/constants/expenses.ts#L2-L6): `merma`, `retiro_owner`, `ajuste`. **No existe un "otro concepto"**; `ajuste` se excluye a propósito de las pérdidas (`sumLossOutflowsValue`, [db/movements.ts:221-242](../db/movements.ts#L221-L242)) por ser corrección de conteo.
- El formulario de registro es [app/expenses/outflow.tsx](../app/expenses/outflow.tsx); el `Select` de tipo se alimenta de `OUTFLOW_TYPES` ([app/expenses/outflow.tsx:188-193](../app/expenses/outflow.tsx#L188-L193)) y persiste vía `registerOutflow` ([db/movements.ts:56-66](../db/movements.ts#L56-L66)), que guarda `type`, `quantity`, `unitCostPrice` en `warehouseMovements`. El schema ya tiene `quantity` (`real('cantidad')`) y el producto su `unitOfMeasure` ([db/schema.ts:25](../db/schema.ts#L25), [db/schema.ts:6](../db/schema.ts#L6)).

Es decir: la salida ya se registra con su cantidad, pero **ni el reporte en pantalla ni el Excel la muestran**, y falta el tipo "otro concepto" que pide la clienta.

## Problema / Objetivo

La clienta necesita una constancia clara de **qué producto salió, cuánta cantidad y por qué motivo** (retiro del dueño, merma u otro concepto), consultable y exportable. Hoy el reporte solo entrega el valor en dinero por concepto, lo que sirve para contabilidad pero no como constancia física de inventario ("salieron 3 kg de X por merma"). Además falta un tercer motivo genérico ("otro concepto") para salidas que no son ni merma ni retiro del dueño ni ajuste de conteo.

## Plan de mejora

1. **Exponer la cantidad en la query.** En `getLossesBreakdown` ([db/queries.ts:352-371](../db/queries.ts#L352-L371)) añadir al `select` de `warehouseMovements` los campos `quantity: warehouseMovements.quantity` y `unitOfMeasure: products.unitOfMeasure`. Extender `LossRecord` ([db/queries.ts:306-312](../db/queries.ts#L306-L312)) con `quantity?: number` y `unitOfMeasure?: string` (opcionales, porque los registros de gastos —salario/multa/onat— no tienen cantidad). Poblar esos campos solo en el bucle de `movementRows` ([db/queries.ts:392-401](../db/queries.ts#L392-L401)).
2. **Mostrar la cantidad en pantalla.** En la fila de registro expandido ([app/reports/losses.tsx:222-256](../app/reports/losses.tsx#L222-L256)) añadir, cuando `r.quantity` esté definido, un texto tipo `{r.quantity} {r.unitOfMeasure}` junto al nombre del producto, para que la constancia lea "Manzana · 3 kg · $X".
3. **Añadir cantidad y unidad al Excel.** En `handleExport` ([app/reports/losses.tsx:71-79](../app/reports/losses.tsx#L71-L79)) cambiar los encabezados a `["Categoría", "Concepto", "Cantidad", "Unidad", "Fecha", "Monto"]` y armar cada fila como `[cat.label, r.label, r.quantity ?? "", r.unitOfMeasure ?? "", r.date, r.amount]`. Ajustar la fila `TOTAL` a las nuevas columnas.
4. **Añadir el tipo "otro concepto".** En `OUTFLOW_TYPES` ([drizzle/constants/expenses.ts:2-6](../drizzle/constants/expenses.ts#L2-L6)) agregar `{ label: 'Otro concepto', value: 'otro' }`. Al derivar de esa constante, el `Select` de [app/expenses/outflow.tsx:188-193](../app/expenses/outflow.tsx#L188-L193) y `getTypeLabel` lo recogen sin cambios.
5. **Incluir "otro" en el reporte.** Añadir la categoría `{ type: 'otro', label: 'Otras salidas', source: 'movement' }` a `LOSS_CATEGORIES` ([db/queries.ts:328-340](../db/queries.ts#L328-L340)) y agregar `'otro'` al `inArray(...)` del filtro de movimientos ([db/queries.ts:365](../db/queries.ts#L365)). Decidir con la clienta si "otro concepto" debe sumar al total de pérdidas (`sumLossOutflowsValue`, [db/movements.ts:221-242](../db/movements.ts#L221-L242)) — igual que merma/retiro— o quedar como categoría informativa fuera del total. Por defecto tratarlo como pérdida (incluirlo en el `inArray` de `sumLossOutflowsValue`).
6. **(Opcional) Hoja "Constancia por producto".** Añadir una segunda `Sheet` al mismo libro en `handleExport` que agregue las salidas por producto+tipo (sumando cantidades), aprovechando que `exportToExcel` ya acepta múltiples hojas ([lib/excel.ts:20-45](../lib/excel.ts#L20-L45)). Útil si la clienta quiere el total de unidades salidas por producto además del detalle por registro.

## Criterio de hecho

- El reporte de pérdidas muestra, para cada salida de almacén (merma, retiro del dueño, otro concepto), la **cantidad y unidad de medida** del producto junto al monto, tanto en pantalla como en el Excel exportado.
- El Excel `reporte_perdidas_*.xlsx` incluye columnas de Cantidad y Unidad.
- Existe el tipo de salida "Otro concepto" seleccionable en [app/expenses/outflow.tsx](../app/expenses/outflow.tsx) y sus registros aparecen como categoría propia en el reporte.
- Los gastos periódicos (salario/multa/onat/rebaja) siguen mostrándose sin cantidad, sin romper el layout ni el export.
