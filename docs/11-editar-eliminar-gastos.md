# 11 · Editar/eliminar gastos + bloquear fecha futura

**Prioridad: MEDIA · Esfuerzo: ~1 día**

Detectado el 2026-07-08 al revisar el flujo de gastos: no hay forma de corregir un gasto mal cargado, ni de impedir que quede uno con fecha futura.

## 1. Editar y eliminar gastos registrados

### Estado actual

`db/expenses.ts` solo expone `registerExpense`/`listExpenses`/`sumExpenses` — no hay `updateExpense` ni `deleteExpense`. [app/expenses/new.tsx](../app/expenses/new.tsx) solo crea; en la lista del tab Gastos ([app/\(tabs\)/expenses.tsx](<../app/(tabs)/expenses.tsx>)) las filas no son tocables, no hay acción editar/eliminar.

Contraste: T-22 ya resolvió este mismo problema para ventas (`cancelSale`/`updateSale` en `db/sales.ts`, soft delete con `cancelled` + snackbar deshacer en `app/sales/history.tsx`). Gastos se quedó sin el equivalente.

### Problema

Un monto, concepto o fecha mal escrito en un gasto (salario/multa/onat) no se puede corregir ni borrar desde la app — solo tocando la base de datos directamente. Afecta el total del mes en el tab Gastos y el reporte de pérdidas (T-19).

### Plan de mejora

1. `db/expenses.ts`: agregar `updateExpense(id, changes)` y `deleteExpense(id)`. A diferencia de `ventas`, un gasto no tiene stock/costo derivado que dependa de él, así que un DELETE físico es aceptable (o soft delete si se quiere mantener "deshacer" — decidir según se prefiera consistencia con T-22 o simplicidad).
2. UI en `app/(tabs)/expenses.tsx`: envolver cada fila en `Pressable` que abra un modal/ActionSheet "Editar / Eliminar", mismo patrón que `app/sales/history.tsx`.
3. Reusar `app/expenses/new.tsx` como formulario en modo edición (precargar valores vía params de ruta, cambiar el label del botón a "Guardar cambios").
4. Confirmación previa a eliminar (`Alert.alert`), igual que el resto de flujos destructivos del proyecto.

### Criterio de hecho

- Gasto existente editable (tipo, concepto, monto, fecha).
- Eliminar gasto pide confirmación antes de proceder.
- Total del mes en el tab Gastos y el reporte de pérdidas (T-19) reflejan el cambio de inmediato.

---

## 2. Bloquear registro de gasto con fecha futura

### Estado actual

En [app/expenses/new.tsx:20](../app/expenses/new.tsx#L20) el schema Zod solo valida `date.min(1)` (no vacío) — sin tope superior. [components/ui/date-picker.tsx](../components/ui/date-picker.tsx) no expone una prop `maxDate` para deshabilitar días futuros en el calendario. El mismo hueco existe en [app/expenses/outflow.tsx](../app/expenses/outflow.tsx) (retiros/mermas/ajustes) y en [app/inventory/stock-entry.tsx](../app/inventory/stock-entry.tsx).

### Problema

Se puede registrar un gasto (o una salida de almacén) con fecha futura por error de selección, lo que ensucia los reportes por período (T-17/T-19), que agrupan y filtran por fecha.

### Plan de mejora

1. Agregar soporte `maxDate` opcional a `components/ui/date-picker.tsx` (deshabilita/oculta los días posteriores en el calendario nativo).
2. En `app/expenses/new.tsx`: pasar `maxDate={format(new Date(), 'yyyy-MM-dd')}` al `DatePicker` y agregar `.refine(v => v <= hoy, 'La fecha no puede ser futura')` al schema Zod como respaldo.
3. Evaluar aplicar el mismo `maxDate` en `app/expenses/outflow.tsx` y `app/inventory/stock-entry.tsx` por consistencia — el mismo problema de fecha futura aplica a cualquier movimiento con fecha editable.

### Criterio de hecho

- El selector de fecha no permite elegir un día posterior a hoy en el formulario de gasto.
- Si se fuerza una fecha futura, el formulario muestra error de validación y no persiste el registro.
