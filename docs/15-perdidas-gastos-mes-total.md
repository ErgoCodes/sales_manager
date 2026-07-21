# 15 · Total "Pérdidas y gastos del mes" no coincide con las salidas listadas

**Prioridad: Media · Esfuerzo: ~0.5-1 día**

Reportado por la clienta (Mercado Mónaco) el 2026-07-19 probando el tab Gastos: el encabezado "PÉRDIDAS Y GASTOS DEL MES" muestra `$0.00` mientras abajo hay salidas con monto listadas. Textual: *"El total del mes deberia sumar esos conceptos y no da $0.00"* — vio Cerveza (Ajuste de inventario) $4,200.00 del 2026-07-16 y Arroz 1kg (Retiro del dueño) $650.00 del 2026-06-20, y esperaba que el total los sumara.

## Estado actual

El tab Gastos calcula dos cosas con **alcances distintos** que no coinciden:

- **El total del encabezado está acotado al mes en curso.** En [app/\(tabs\)/expenses.tsx:190-191](<../app/(tabs)/expenses.tsx#L190-L191>) se calcula `monthStart`/`monthEnd` con `startOfMonth`/`endOfMonth`, y en [app/\(tabs\)/expenses.tsx:236](<../app/(tabs)/expenses.tsx#L236>) el total es `setMonthTotal(expSum + lossSum)`, donde `expSum = sumExpenses(monthStart, monthEnd)` y `lossSum = sumLossOutflowsValue(monthStart, monthEnd)` ([app/\(tabs\)/expenses.tsx:199-200](<../app/(tabs)/expenses.tsx#L199-L200>)).

- **La lista de abajo NO está acotada por fecha.** En [app/\(tabs\)/expenses.tsx:193-201](<../app/(tabs)/expenses.tsx#L193-L201>), `listExpenses({ includeCancelled })` y `listMovements({ types: OUTFLOW_FILTER, includeCancelled })` se llaman **sin `dateFrom`/`dateTo`**, así que devuelven registros de **todos los meses**. Por eso el retiro de Arroz de junio aparece en la lista aunque el total sea de julio.

- **La lista incluye `'ajuste'`, pero el total nunca valora los ajustes.** `OUTFLOW_FILTER = ["merma", "retiro_owner", "ajuste"]` ([app/\(tabs\)/expenses.tsx:35](<../app/(tabs)/expenses.tsx#L35>)), y cada fila de salida calcula `amount: Math.abs(m.quantity) * m.unitCostPrice` ([app/\(tabs\)/expenses.tsx:224](<../app/(tabs)/expenses.tsx#L224>)) para **cualquier** tipo, incluido `ajuste`. En cambio, `sumLossOutflowsValue` sólo suma `['merma', 'retiro_owner']` y excluye `'ajuste'` a propósito ([db/movements.ts:221-242](../db/movements.ts#L221-L242), condición `inArray(...['merma', 'retiro_owner'])` en la línea [db/movements.ts:226](../db/movements.ts#L226)). La documentación de la función lo dice explícito: *"El 'ajuste' se excluye porque es una corrección de conteo, no una pérdida."*

Esta exclusión del ajuste es **intencional y consistente** con el reporte de pérdidas (T-19): `getLossesBreakdown` en [db/queries.ts:348-371](../db/queries.ts#L348-L371) también filtra sólo `["merma", "retiro_owner"]`, y `LOSS_CATEGORIES` ([db/queries.ts:334-340](../db/queries.ts#L334-L340)) no incluye `ajuste` como categoría de pérdida.

El subtítulo del encabezado ya declara el alcance real: *"Gastos + mermas y retiros valorados"* ([app/\(tabs\)/expenses.tsx:285](<../app/(tabs)/expenses.tsx#L285>)) — es decir, el ajuste nunca debió sumar. Con los datos de la clienta: la Cerveza/Ajuste de julio queda fuera **por tipo** y el Arroz/Retiro de junio queda fuera **por fecha** (junio ≠ julio). Ambas exclusiones son correctas según la lógica actual, por lo que `$0.00` es numéricamente coherente con la definición de "pérdidas y gastos" del propio código.

## Problema / Objetivo

No es un error de agregación ni de rango de mes: el total está bien calculado. El bug es de **coherencia de UI/UX**. La lista y el encabezado hablan de cosas distintas:

1. La lista muestra registros de **todos los meses** (sin filtro de fecha), pero el encabezado dice "DEL MES" y sólo suma el mes actual → aparecen filas (el retiro de junio) que no pueden estar en el total de julio.
2. La lista muestra los `ajuste` con un monto en `$` grande y llamativo, como si fueran pérdidas, pero un ajuste es una corrección de conteo que **nunca** cuenta como pérdida ni en este total ni en el reporte T-19.

El resultado es que la clienta ve conceptos con monto y un total en `$0.00`, y pierde confianza en la pantalla de dinero. El objetivo es que **lo que se lista y lo que se suma se refieran al mismo período y al mismo conjunto de conceptos**.

## Plan de mejora

1. **Acotar la lista al mismo mes que el total.** En [app/\(tabs\)/expenses.tsx:193-201](<../app/(tabs)/expenses.tsx#L193-L201>), pasar `dateFrom: monthStart, dateTo: monthEnd` a `listExpenses(...)` (ya soporta `dateFrom`/`dateTo`, ver [db/expenses.ts:74-97](../db/expenses.ts#L74-L97)) y a `listMovements(...)` (soporta los mismos parámetros, [db/movements.ts:184-214](../db/movements.ts#L184-L214)). Así el retiro de junio deja de aparecer en la vista de julio y la lista concuerda con el encabezado.
2. **Resolver la incoherencia del `ajuste`** (decisión de producto, ver dudas abiertas). Opción recomendada: sacar `'ajuste'` de `OUTFLOW_FILTER` ([app/\(tabs\)/expenses.tsx:35](<../app/(tabs)/expenses.tsx#L35>)) para que el tab "Pérdidas y gastos" muestre sólo conceptos que sí son pérdida/gasto, y reubicar la consulta de ajustes en el historial de inventario. Alternativa menos invasiva: mantener el ajuste visible pero renderizarlo de forma distinta (sin `$` que sugiera pérdida, mostrando sólo el cambio de conteo `±cantidad`) y con una etiqueta clara de "no cuenta en el total".
3. **Fuente única de verdad para lista y total (opcional pero recomendado).** Evaluar reusar `getLossesBreakdown(monthStart, monthEnd)` ([db/queries.ts:348-371](../db/queries.ts#L348-L371)) tanto para pintar la lista como para el total, de modo que el tab no pueda volver a divergir del reporte T-19. Hoy el tab arma la lista por su cuenta y suma con `sumExpenses` + `sumLossOutflowsValue`, dos caminos que pueden desincronizarse.
4. **Verificar el signo/monto del ajuste si se decide mostrarlo.** `amount: Math.abs(m.quantity) * m.unitCostPrice` ([app/\(tabs\)/expenses.tsx:224](<../app/(tabs)/expenses.tsx#L224>)) convierte cualquier ajuste (incluso uno que suma stock) en un valor positivo, lo que refuerza la lectura errónea de "pérdida". Revisarlo junto con el paso 2.

## Criterio de hecho

- La lista de movimientos del tab Gastos y el total "Pérdidas y gastos del mes" se refieren al **mismo período** (el mes en curso): ningún registro de otro mes aparece en la lista mientras el encabezado dice "DEL MES".
- Si se muestran ajustes, quedan visualmente diferenciados y es evidente que **no** suman al total; si se decide ocultarlos, ya no aparecen en este tab.
- Con los datos del reporte de la clienta, el comportamiento es explicable sin contradicción: o el concepto está en la lista **y** cuenta en el total, o no está en ninguno.
- El total del tab coincide con `getLossesBreakdown` / el reporte de pérdidas (T-19) para el mismo rango de fechas.
