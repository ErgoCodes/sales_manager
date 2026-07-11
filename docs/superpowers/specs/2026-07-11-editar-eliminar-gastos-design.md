# Editar/eliminar gastos y salidas de almacén + bloquear fecha futura

**Fecha:** 2026-07-11
**Origen:** [docs/11-editar-eliminar-gastos.md](../../11-editar-eliminar-gastos.md) (alcance ampliado durante brainstorming — ver decisiones abajo)
**Estado:** aprobado, pendiente de plan de implementación

## Contexto

El tab Gastos combina en una sola lista dos orígenes de datos: `gastos` (salario/multa/onat/rebaja_liquidacion, tabla `expenses`) y salidas de almacén (merma/retiro_owner/ajuste, tabla `warehouseMovements`). Ninguno de los dos es editable ni eliminable desde la app — un monto, concepto o fecha mal cargado solo se puede corregir tocando la base de datos directamente. Además, ningún formulario con fecha editable (gasto, salida, entrada de stock) bloquea fechas futuras.

T-22 (editar/anular ventas) ya resolvió el mismo problema para `ventas` con soft delete (`anulada`) + snackbar "Deshacer". Este diseño extiende el mismo patrón a gastos y salidas.

## Decisiones tomadas durante brainstorming

1. **Borrado:** soft delete + deshacer (no delete físico), por consistencia con `ventas` y para no perder datos por error de un toque.
2. **Alcance de filas editables:** se amplía a salidas de almacén (merma/retiro_owner/ajuste), no solo `gastos`. **Entradas de stock (`entrada`) quedan explícitamente fuera** — editarlas requeriría recalcular el costo promedio ponderado desde cero, operación que hoy no existe y no se va a improvisar en este alcance.
3. **maxDate:** se aplica a los tres formularios con fecha editable (gasto, salida, entrada de stock), no solo al de gasto — mismo bug, mismo fix, mismo componente.

## 1. Capa de datos — `db/expenses.ts`

- `updateExpense(id: number, changes: { type: string; concept?: string | null; amount: number; date: string }): Promise<void>` — UPDATE simple.
- `cancelExpense(id: number): Promise<void>` / `restoreExpense(id: number): Promise<void>` — soft delete vía columna `cancelled`.
- `listExpenses()` gana `includeCancelled?: boolean` (default `false`) en `ListExpensesOptions`, igual patrón que `listSales`.
- `ExpenseRecord` gana campo `cancelled: boolean`.

### Migración

`ALTER TABLE gastos ADD COLUMN anulado INTEGER NOT NULL DEFAULT 0` — nueva columna en `db/schema.ts`: `cancelled: integer('anulado', { mode: 'boolean' }).notNull().default(false)` en la tabla `expenses`. Generar con `drizzle-kit generate`.

## 2. Capa de datos — `db/movements.ts`

- `updateOutflow(id: number, changes: { type: string; quantity: number; unitCostPrice: number; date: string; notes?: string | null }): Promise<void>` — solo aplicable a filas con `type` en `['merma', 'retiro_owner', 'ajuste']`. La función no necesita validar el tipo en runtime (la UI solo la invoca desde salidas), pero el nombre y la doc del código dejan claro que no es para `entrada`.
- `cancelOutflow(id: number): Promise<void>` / `restoreOutflow(id: number): Promise<void>` — soft delete.
- `listMovements()` gana `includeCancelled?: boolean` (default `false`).
- `MovementWithProduct` gana campo `cancelled: boolean`.

### Migración

`ALTER TABLE movimientos_almacen ADD COLUMN anulado INTEGER NOT NULL DEFAULT 0` — misma técnica, columna `cancelled` en `warehouseMovements` en `db/schema.ts`.

### Impacto en cálculos derivados (`db/queries.ts`)

Todo lo que lee `warehouseMovements` para stock o pérdidas debe filtrar `cancelled = false`, igual que ya se hace con `sales.cancelled`:

- `calculateStock(productId)` — agregar `eq(warehouseMovements.cancelled, false)` al `where`.
- La función de stock en lote (cálculo para todos los productos) — mismo filtro.
- `sumLossOutflowsValue(dateFrom, dateTo)` en `db/movements.ts` — mismo filtro.
- Cualquier reporte que lea `warehouseMovements` directamente (p. ej. `app/reports/losses.tsx` si consulta la tabla en vez de pasar por las funciones de arriba) — auditar y aplicar el mismo filtro.

Como `entrada` no se cancela nunca desde esta feature, el filtro no cambia el comportamiento para entradas existentes (todas quedan con `cancelled = false` por el default).

## 3. UI — tab Gastos (`app/(tabs)/expenses.tsx`)

- Las filas del `LedgerRow` combinado pasan de `View` a `Pressable`.
- Al tocar una fila: `Alert.alert` con acciones — mismo patrón que `openActions` en `app/sales/history.tsx`:
  - Si no está anulada: "Editar" / "Eliminar" (destructivo, con confirmación).
  - Si está anulada: "Restaurar".
- **Editar** navega en modo edición a la pantalla de formulario correspondiente al origen de la fila:
  - `exp-*` → `app/expenses/new.tsx?id=N` — precarga `type`, `concept`, `amount`, `date`; botón cambia a "Guardar cambios"; `onSubmit` llama `updateExpense` en vez de `registerExpense`.
  - `mov-*` → `app/expenses/outflow.tsx?id=N` — precarga `type`, `product`, `quantity` (con signo/dirección para `ajuste`), `unitCostPrice`, `date`, `notes`; mismo cambio de botón y de función de submit (`updateOutflow` en vez de `registerOutflow`).
- **Eliminar**: `Alert.alert` de confirmación destructiva → `cancelExpense`/`cancelOutflow` → recargar lista → `Snackbar` "Gasto eliminado"/"Salida eliminada" con acción "Deshacer" (5s, componente `Snackbar` ya existe, reutilizado tal cual de `sales/history.tsx`).
- Toggle "Mostrar anuladas" en la cabecera de la lista, mismo patrón visual que `sales/history.tsx` — filas anuladas se muestran tachadas y atenuadas (`opacity` reducida + `textDecorationLine: 'line-through'`).
- `useFocusEffect` existente pasa `includeCancelled` según el estado del toggle a `listExpenses`/`listMovements`.

## 4. maxDate

- `components/ui/date-picker.tsx`: nueva prop opcional `maxDate?: string` (ISO `yyyy-MM-dd`). En el calendario del modal, los días posteriores a `maxDate` se renderizan deshabilitados (no `Pressable`, opacidad reducida, sin `onPress`).
- Aplicar `maxDate={format(new Date(), 'yyyy-MM-dd')}` en:
  - `app/expenses/new.tsx`
  - `app/expenses/outflow.tsx`
  - `app/inventory/stock-entry.tsx`
- Respaldo en cada schema Zod: `.refine(v => v <= format(new Date(), 'yyyy-MM-dd'), 'La fecha no puede ser futura')`.

## 5. Fuera de alcance (explícito)

- Editar/eliminar/reclasificar entradas de stock (`entrada`) — bloqueado por la falta de una operación de recálculo de costo promedio ponderado inversa/reentrante.
- Reclasificación de ventas históricas con `paymentMethod = 'costo'` — tema de [docs/10](../../10-metodo-pago-costo-y-fiado.md), no relacionado.
- Cambiar de producto al editar una salida de almacén — mismo criterio que T-22 usó para ventas: si el producto está mal, anular y registrar de nuevo.

## Criterio de hecho

- Gasto existente editable (tipo, concepto, monto, fecha) y eliminable (soft delete + confirmación + deshacer).
- Salida de almacén (merma/retiro/ajuste) existente editable y eliminable, mismo mecanismo.
- Stock derivado y valor de pérdidas excluyen salidas anuladas.
- Entrada de stock permanece no editable/no eliminable (fuera de alcance, documentado en UI si hace falta — a definir en el plan si se necesita un mensaje explícito o simplemente la fila no es `Pressable`).
- Total del mes en el tab Gastos y el reporte de pérdidas (T-19) reflejan cualquier edición/eliminación de inmediato.
- Ningún formulario con fecha editable (gasto, salida, entrada) permite seleccionar ni forzar una fecha futura.
