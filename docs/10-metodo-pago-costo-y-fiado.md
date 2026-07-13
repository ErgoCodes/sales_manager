# 10 · Venta a costo con modo de pago + ventas fiadas (deuda)

**Prioridad: MEDIA · Esfuerzo: ~2-3 días (incluye migración de datos)**

Dos ajustes relacionados al modelo de `paymentMethod`, detectados el 2026-07-08 al revisar por qué el resumen de la pantalla principal no cuadra cuando hay ventas a precio de costo.

## 1. Venta a precio de costo debe permitir elegir efectivo/transferencia

### Estado actual

En [app/sales/new-session.tsx:68-106](../app/sales/new-session.tsx#L68-L106), el checkbox "Venta a trabajador (costo)" fuerza `paymentMethod: 'costo'` como una tercera categoría, separada de `'efectivo'` y `'transferencia'`. Esto se propaga a:

- `db/schema.ts:57` — `metodo_pago` es texto libre, sin `enum`/`check`, así que `'costo'` convive con los otros dos valores sin restricción.
- `db/queries.ts:97-104` (`getDailySummary`) y `db/queries.ts:157-164` (`getRangeSummary`) — el `if/else if` solo acumula en `cash`/`transfer` cuando el método es `'efectivo'`/`'transferencia'`; las ventas a costo caen solo en `summary.total`, nunca en `cash` ni `transfer`.

### Problema

`summary.total` ≠ `summary.cash + summary.transfer` cuando hubo ventas a costo ese día, y la pantalla principal ([app/(tabs)/index.tsx:188-195](../app/\(tabs\)/index.tsx#L188-L195)) no muestra esa diferencia en ningún lado — el dinero que sí entró (a precio de costo, en efectivo o transferencia) no aparece en el desglose de caja, solo en el total genérico. Además conceptualmente **el precio de costo es solo un descuento del 100% del margen, no un tercer método de cobro** — el dinero sigue entrando en efectivo o por transferencia real.

### Plan de mejora

1. En `new-session.tsx`, cuando `workerSale` está activo, mantener los botones "Efectivo" / "Transferencia" (en vez de reemplazarlos por el botón único "A costo $X"), pero:
   - Forzar `discountPercent = 0` (sin descuento ni recargo).
   - `appliedPrice = product.costPrice ?? product.averageCost` en vez del precio efectivo/transferencia normal.
   - `paymentMethod` queda como `'efectivo'` o `'transferencia'` real (el que el usuario toque), no `'costo'`.
2. Añadir un flag independiente para marcar que la línea fue "a costo" sin inventar un método de pago falso — opción más simple: columna nueva `isCostSale: integer(mode: boolean)` en `sales` (migración Drizzle). Así los reportes pueden seguir mostrando "Costo: $X" como desglose informativo sin que afecte el agrupado de caja.
3. Actualizar `getDailySummary`/`getRangeSummary` para que dejen de tratar `'costo'` como método válido de agrupación (ya no existirá para ventas nuevas).
4. **Migración de datos existentes**: las filas históricas con `metodo_pago = 'costo'` no tienen forma de saber si el dinero entró en efectivo o transferencia (ese dato nunca se capturó). Decisión pendiente: dejarlas tal cual con un tercer bucket legacy en los reportes, o pedir al usuario que las reclasifique a mano una vez (probablemente son pocas filas). No inventar el dato.
5. Revisar `app/reports/daily.tsx` y `app/reports/period.tsx` — si ya desglosan `'costo'` como categoría propia, adaptar esa lógica a filtrar por `isCostSale = true` en vez de por `paymentMethod`.

### Criterio de hecho

- Ninguna venta nueva se guarda con `paymentMethod = 'costo'`.
- `summary.cash + summary.transfer === summary.total` siempre (salvo ventas fiadas pendientes, ver sección 2).
- Los reportes siguen pudiendo mostrar cuánto se vendió a precio de costo, ahora vía `isCostSale`.

---

## 2. Ventas fiadas (deuda) — futuro, no roadmap inmediato

### Idea

Permitir marcar una venta como "fiada": el producto sale del inventario de inmediato (igual que cualquier venta), pero el cobro no ocurre ese día, así que **no debe sumar al balance de caja del día de la venta**. El dinero debe reflejarse en el balance del día en que efectivamente se cobra.

### Por qué encaja con el modelo actual

`registerSalesSession` ([db/sales.ts:50-100](../db/sales.ts#L50-L100)) ya inserta una fila en `sales` por cada línea del carrito y el descuento de stock se calcula a partir de esas filas (`calculateStock`) sin importar el `paymentMethod` — es decir, **la baja de inventario ya sería automática** para una venta fiada, sin cambios en esa parte.

### Plan de mejora (borrador, a refinar cuando se priorice)

1. Nuevo valor de `paymentMethod`: `'fiado'` (o tabla separada `deudas` si se necesita registrar deudor/teléfono — más flexible pero más esfuerzo).
2. Añadir a `sales` (o a la tabla de deudas): `paymentStatus: 'pendiente' | 'pagado'` (default `'pagado'` para no romper filas existentes), `paidDate`, `paidMethod`.
3. `getDailySummary`/`getRangeSummary` deben excluir filas con `paymentStatus = 'pendiente'` del todo (ni total, ni cash, ni transfer) hasta que se salden.
4. Al saldar una deuda: actualizar la fila con `paymentStatus = 'pagado'`, `paidMethod` (efectivo/transferencia elegido al cobrar) y `paidDate = hoy`. Los resúmenes deben agrupar por `paidDate` para esas filas, no por `date` (fecha original de la venta) — cambio no trivial en las queries de resumen, que hoy agrupan todo por `sales.date`.
5. UI nueva: pantalla de "Deudas pendientes" (listado por cliente/monto/fecha de venta) + acción "Marcar como pagada" que pide método de cobro y fecha.
6. Definir si se necesita registrar identidad del deudor (nombre/teléfono) desde el día 1, o si por ahora basta con una nota de texto libre — afecta si esto requiere tabla nueva o alcanza con columnas en `sales`.

### Criterio de hecho (cuando se implemente)

- Una venta fiada resta stock inmediatamente pero no aparece en `cash`/`transfer`/`total` del día de la venta.
- Al marcarse como pagada, sí aparece en el resumen del día en que se cobró.
- Existe una pantalla para ver y saldar deudas pendientes.
