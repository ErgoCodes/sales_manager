# 16 · Resumen de entradas por producto y fecha

**Prioridad: Media · Esfuerzo: ~1 día**

La clienta (Mercado Mónaco) reportó el 2026-07-19, probando la app por WhatsApp: "Me haría falta visualizar un resumen de entradas por productos y fechas". Pide un reporte de las entradas de inventario (compras/reposiciones) agregadas por producto y acotadas por rango de fechas, hoy inexistente.

## Estado actual

Las entradas de inventario ya se registran y almacenan, pero **no existe ninguna vista de resumen agregado** — solo un listado plano fila por fila.

- Las entradas viven en la tabla `movimientos_almacen` con `tipo = 'entrada'` ([db/schema.ts:17-36](../db/schema.ts#L17-L36)). Cada fila guarda `productId`, `quantity`, `date`, `unitCostPrice`, `salePrice`, `notes` y `cancelled`.
- `registerEntry` ([db/movements.ts:16-37](../db/movements.ts#L16-L37)) inserta la entrada con `type: 'entrada'` y recalcula el costo promedio; el alta se hace desde [app/inventory/stock-entry.tsx:93-132](../app/inventory/stock-entry.tsx#L93-L132).
- Ya hay una query para listar entradas: `listEntries(opts)` ([db/movements.ts:135-160](../db/movements.ts#L135-L160)) filtra por `type = 'entrada'` y acepta `productId`, `dateFrom`, `dateTo`, ordenando por `date` descendente. **Devuelve filas individuales, sin agrupar ni sumar** — no hay `SUM(cantidad)` ni valor total por producto. (Nota: no filtra `cancelled = false`; ver Preguntas abiertas.)
- La única pantalla que consume `listEntries` es [app/inventory/history.tsx:12-117](../app/inventory/history.tsx#L12-L117) ("Historial de entradas"): un `FlatList` plano con filtro de texto por producto y `DatePicker` Desde/Hasta, sin totales, sin agrupación por producto y sin exportación. Se llega a ella desde [app/(tabs)/_layout.tsx:102](../app/(tabs)/_layout.tsx#L102).
- El hub de reportes ([app/(tabs)/reports.tsx:84-122](../app/\(tabs\)/reports.tsx#L84-L122)) ofrece cuatro tarjetas: `daily`, `period`, `rankings` y `losses`. **Ninguna cubre entradas de inventario** (todas parten de la tabla `ventas`).
- El patrón a reutilizar existe en [app/reports/rankings.tsx:23-97](../app/reports/rankings.tsx#L23-L97): `PeriodBar` + `currentWeek()` ([components/ui/period-bar.tsx:50-86](../components/ui/period-bar.tsx#L50-L86)) para el rango, una query de agregación por rango (`getRangeRanking`, [db/queries.ts:269-304](../db/queries.ts#L269-L304)) y botón "Exportar a Excel" vía `exportToExcel(filename, sheets)` ([lib/excel.ts](../lib/excel.ts)), que arma un `.xlsx` con SheetJS y abre el share sheet con `expo-sharing`.

## Problema / Objetivo

La clienta necesita saber, para un período dado, **cuánto entró de cada producto y por qué monto**, y poder revisarlo por fechas — información hoy solo accesible leyendo entrada por entrada en el historial plano, sin subtotales. Es útil para conciliar compras con proveedores y valorar las reposiciones del mes. El objetivo es una vista de reporte que agregue las entradas por producto (cantidad total y valor total a costo) sobre un rango de fechas, con opción de exportar a Excel, reutilizando el patrón ya establecido de Rankings.

## Plan de mejora

1. **Query de agregación** en `db/movements.ts`: nueva función `getEntriesSummaryByProduct(from, to)` que agrupe `movimientos_almacen` con `tipo = 'entrada'` y `cancelled = false` por `producto_id`, devolviendo por producto: `SUM(cantidad)` (cantidad total), `SUM(cantidad × precio_costo_unitario)` (valor total a costo), `COUNT(*)` (nº de entradas) y `MAX(fecha)` (última entrada). Filtrar el rango con el mismo par `date(fecha) >= date(from)` / `date(fecha) <= date(to)` que usa `listEntries` ([db/movements.ts:138-141](../db/movements.ts#L138-L141)) y `getRangeRanking` ([db/queries.ts:291-295](../db/queries.ts#L291-L295)). Ordenar por valor total descendente. Exportar la interfaz `EntrySummary` correspondiente.
2. **Pantalla de reporte** `app/reports/stock-entries.tsx`, clonando la estructura de `app/reports/rankings.tsx`: `PeriodBar` con `currentWeek()` por defecto, `useEffect` que llama a `getEntriesSummaryByProduct(period.from, period.to)`, `FlatList` con una tarjeta por producto (nombre, cantidad total + unidad, valor total, nº de entradas y fecha de última entrada) y `EmptyState` cuando no hay datos en el rango.
3. **Exportación a Excel** reutilizando `exportToExcel` con el mismo `handleExport` de rankings ([app/reports/rankings.tsx:52-81](../app/reports/rankings.tsx#L52-L81)). Dos hojas para cubrir "por producto y fechas":
   - Hoja "Resumen por producto": columnas Producto, Cantidad, Valor a costo, Nº entradas, Última entrada.
   - Hoja "Detalle por fecha": reutilizar `listEntries({ dateFrom, dateTo })` para volcar fila por fila (Fecha, Producto, Cantidad, Costo unitario, Valor, Notas), ordenado por fecha.
4. **Tarjeta en el hub** `app/(tabs)/reports.tsx`: añadir un `<ReportCard>` (p. ej. icono `shippingbox.fill` o `tray.and.arrow.down.fill`, título "Entradas de inventario", subtítulo "Resumen de compras por producto") con `onPress={() => router.push("/reports/stock-entries")}`, siguiendo las cuatro tarjetas existentes ([app/(tabs)/reports.tsx:92-119](../app/\(tabs\)/reports.tsx#L92-L119)). La ruta se auto-registra por Expo Router (file-based), no requiere tocar `app/_layout.tsx`.
5. **Reutilizar formato**: usar `formatCurrency` ([lib/format.ts](../lib/format.ts)) para los montos y los tokens de tema (`Radius`, `Shadows`, `useAppColors`) igual que el resto de pantallas de reportes.

## Criterio de hecho

- El hub de reportes muestra una nueva tarjeta "Entradas de inventario" que abre `/reports/stock-entries`.
- La pantalla lista, para el período seleccionado con `PeriodBar`, una fila por producto con cantidad total ingresada y valor total a costo, ordenada de mayor a menor valor.
- Cambiar el período (semana/mes/rango) recalcula el resumen sin recargar la app.
- El botón "Exportar a Excel" genera un `.xlsx` con la hoja resumen por producto y la hoja de detalle por fecha, y abre el share sheet nativo.
- Las entradas anuladas (`cancelled = true`) no cuentan en los totales.
- Cuando no hay entradas en el rango, se muestra un `EmptyState` en vez de una lista vacía.
