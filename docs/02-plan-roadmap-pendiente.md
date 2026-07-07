# 02 · Plan de ejecución del roadmap pendiente

> Cómo llevar a cabo las 9 tareas pendientes del [ROADMAP.md](../ROADMAP.md), aprovechando lo que ya existe en el código. Rutas nuevas en inglés (convención de CLAUDE.md); las rutas en español del ROADMAP están obsoletas.

## Orden recomendado

Mismo orden que el ROADMAP, con una excepción: **adelantar T-21 (respaldo)** si la app va a empezar a usarse con datos reales antes de terminar los reportes. Un backup manual funcional protege el negocio desde el primer día de uso real.

| # | Tarea | Prioridad | Estimación | Depende de |
|---|---|---|---|---|
| 1 | T-12 Descuentos de marketing | MEDIA | 1d | — |
| 2 | T-15 Rebajas de liquidación → gasto | MEDIA | 1d | — |
| 3 | T-16 Reporte diario | ALTA | 2d | — |
| 4 | T-17 Reporte semanal/mensual + notificación | ALTA | 2d | T-16 |
| 5 | T-18 Rankings de productos | ALTA | 1d | T-16 |
| 6 | T-19 Reporte de pérdidas desglosado | MEDIA | 1d | T-16 |
| 7 | T-20 Exportar/compartir por WhatsApp | ALTA | 2d | T-16…T-19 |
| 8 | T-21 Respaldo y restauración | ALTA | 2d | — (⚠ adelantar si hay uso real) |
| 9 | T-22 Editar y anular ventas | MEDIA | 2d | — |

---

## T-12 · Descuentos de marketing en ventas

**Ya existe:** la columna `ventas.descuento_pct` está en el esquema y hoy se inserta siempre como `0` ([db/sales.ts:66](../db/sales.ts#L66)). El tipo `CartItem` vive en [store/index.ts:4-14](../store/index.ts#L4-L14).

**Plan:**
1. Añadir `discountPercent: number` a `CartItem` y al formulario rápido de [app/sales/new-session.tsx](../app/sales/new-session.tsx) (campo opcional, default 0, visible solo al expandir "Descuento").
2. Recalcular en pantalla el precio final: `appliedPrice = basePrice * (1 - discountPercent / 100)` antes de añadir al carrito. El precio base del catálogo **no** se toca.
3. En `registerSalesSession` ([db/sales.ts:43](../db/sales.ts#L43)): guardar `discountPercent` del item en vez del `0` hardcodeado. La utilidad ya se calcula sobre `appliedPrice`, así que no requiere cambios.
4. Mostrar el % en el carrito y en [app/sales/history.tsx](../app/sales/history.tsx) (badge "-10%").

**Acepta si:** el catálogo no cambia, el descuento queda en el historial, precio final correcto.

---

## T-15 · Rebaja de liquidación → gasto automático

**Ya existe:** el flujo de rebaja de T-08 en [app/catalog/[id].tsx](../app/catalog/[id].tsx) (banner "Sugerir rebaja" cuando el producto está estancado/por vencer, con `suggestedRebaja` en la línea 101), `registerExpense` en [db/expenses.ts](../db/expenses.ts) y el tipo `rebaja_liquidacion` ya contemplado en el enum de gastos del ROADMAP (T-01).

**Plan:**
1. Detectar en el submit del formulario de producto cuándo el guardado proviene de una rebaja aceptada (p. ej. estado `rebajaApplied` que se activa al tocar el banner y persiste hasta guardar).
2. Al guardar con rebaja: calcular `pérdida potencial = (precio_anterior - precio_nuevo) × stock_actual` usando `calculateStock` ([db/queries.ts:7](../db/queries.ts#L7)) y llamar `registerExpense({ type: 'rebaja_liquidacion', concept: nombre del producto, amount, date: hoy })` en la misma operación.
3. Verificar que `constants/expenses.ts` incluye label para `rebaja_liquidacion` (añadirlo si falta) para que aparezca bien en el tab Gastos.

**Acepta si:** aprobar rebaja inserta el gasto solo; ventas posteriores usan el precio rebajado (ya funciona: leen el catálogo); T-19 podrá agrupar la partida.

---

## M5 · Reportes (T-16 a T-20)

Estructura propuesta: convertir el placeholder [app/(tabs)/reports.tsx](<../app/(tabs)/reports.tsx>) en un hub con tarjetas de navegación, y crear las pantallas bajo `app/reports/`:

```
app/reports/daily.tsx      (T-16)
app/reports/period.tsx     (T-17: semana/mes/rango)
app/reports/rankings.tsx   (T-18)
app/reports/losses.tsx     (T-19)
```

### T-16 · Reporte diario

**Ya existe casi todo el dato:** `getDailySummary` ([db/queries.ts:84](../db/queries.ts#L84)), `getDailyBreakdown` ([db/queries.ts:115](../db/queries.ts#L115)), `listSales` con filtros de fecha ([db/sales.ts:98](../db/sales.ts#L98)), `listProducts` con stock y `countLowStock`.

**Plan:** pantalla con selector de fecha + hero de totales (reutilizar `StatCard`) + tabla de ventas del día (nombre, cantidad, método, importe, costo, utilidad) + sección de inventario con alertas. Solo composición de UI; no hace falta SQL nuevo.

### T-17 · Reporte semanal y mensual

**Falta en la capa de datos:** agregaciones por rango. Añadir a `db/queries.ts`:
- `getRangeSummary(from, to)` — generalización de `getDailySummary` (cambiar `date(...) = date(...)` por `BETWEEN`).
- `getDailyTotalsInRange(from, to)` — GROUP BY `date(fecha)` para la vista semanal "agregado por día".
- `sumExpenses`/`sumLossOutflowsValue` ya existen para la parte de pérdidas del mensual.

**Notificación del lunes 9am:** primer uso real de [lib/notifications.ts](../lib/notifications.ts). Usar `expo-notifications` con trigger `{ weekday: 2, hour: 9, minute: 0, repeats: true }` (weekday 2 = lunes en el calendario de Expo). Programarla al abrir la pantalla de reportes por primera vez (guardar flag en `configuracion` para no duplicar). **Nota:** las notificaciones locales programadas no funcionan de forma fiable en Expo Go (SDK 53+); requieren development build — probar ahí.

### T-18 · Rankings

Añadir a `db/queries.ts` una query estilo `getDailyBreakdown` pero por rango, ordenable por `SUM(cantidad)` (más vendidos) o `SUM(utilidad)` (más rentables), con margen % = `SUM(utilidad) / SUM(ingreso)`. UI: lista numerada con barra proporcional (View con width % — no hace falta librería de gráficos).

### T-19 · Reporte de pérdidas desglosado

**Ya existe:** `listMovements`/`sumLossOutflowsValue` en [db/movements.ts](../db/movements.ts) y `listExpenses`/`sumExpenses` en [db/expenses.ts](../db/expenses.ts). Falta una query agregada: gastos agrupados por `tipo` + salidas (`merma`, `retiro_owner`) valoradas a costo, por rango. UI: secciones colapsables por categoría (Retiros / Mermas / Salarios / Multas / ONAT / Rebajas) con subtotal y total general.

### T-20 · Exportar y compartir

**Ya instalado:** `expo-sharing` y `expo-file-system`. **Falta instalar:** `react-native-view-shot` (screenshot de la vista; más simple y suficiente vs. generar PDF).

**Plan:**
1. Componente `ShareReportButton` que recibe un `ref` de la vista del reporte, captura con `captureRef(ref, { format: 'png' })`, guarda con nombre `reporte_diario_2026-07-07.png` y llama `Sharing.shareAsync(uri)`.
2. Montarlo en las 4-5 pantallas de reportes. Envolver el contenido a capturar en un `View` con fondo sólido (los screenshots de ScrollView capturan solo lo visible: usar la opción `snapshotContentContainer` o renderizar una vista "para exportar" sin scroll).
3. Todo el flujo es local/offline; WhatsApp aparece en el share sheet nativo.

---

## T-21 · Respaldo y restauración ⚠ prioritario si hay uso real

**Ya existe:** `expo-file-system`, `expo-sharing`, la pantalla [app/configuration.tsx](../app/configuration.tsx) para mostrar "último respaldo" y `setConfig` para persistir la fecha. **Falta instalar:** `expo-document-picker` (para elegir el archivo al restaurar).

**Plan:**
1. `lib/backup.ts` con:
   - `exportBackup()`: copiar `${Paths.document}/SQLite/db.sqlite` a `respaldo_monaco_YYYY-MM-DD.db` en caché y compartir con `Sharing.shareAsync`. Antes de copiar, ejecutar `PRAGMA wal_checkpoint(FULL)` en la conexión (expo-sqlite usa WAL; sin checkpoint el `.db` puede ir incompleto).
   - `restoreBackup()`: `DocumentPicker` → diálogo de confirmación ("reemplaza TODOS los datos, irreversible") → cerrar la conexión (`db.$client.closeSync()`) → sobrescribir el archivo → reiniciar la app o reabrir conexión. Validar antes que el archivo elegido es SQLite (magic header `SQLite format 3`).
2. Sección "Respaldo" en Configuración: botón Exportar, botón Restaurar, texto "Último respaldo: {fecha}" (clave nueva `ultimo_respaldo` en `configuracion`, escrita tras exportar).
3. Recordatorio semanal (domingo noche) con la misma infra de notificaciones de T-17.

**Acepta si:** backup en <3 toques; restaurar en un teléfono limpio recupera todo; fecha visible; recordatorio llega con la app cerrada (development build).

---

## T-22 · Editar y anular ventas

**Ya existe:** la columna `ventas.anulada` (todas las queries ya filtran `cancelled = false`, p. ej. [db/queries.ts:23](../db/queries.ts#L23), [db/sales.ts:99](../db/sales.ts#L99)), el historial con filtros ([app/sales/history.tsx](../app/sales/history.tsx)) y el stock derivado, que hace que anular/editar ajuste stock y reportes automáticamente.

**Plan:**
1. `db/sales.ts`: añadir `cancelSale(id)` (set `anulada = true` — soft delete, nunca DELETE físico: da el "deshacer" gratis con `anulada = false`) y `updateSale(id, changes)` que recalcule `utilidad` con el `costo_al_vender` congelado.
2. En el historial: tocar una venta abre un ActionSheet/modal con Editar / Anular. Anular pide confirmación y muestra snackbar "Venta anulada — DESHACER" (5 s) que revierte.
3. Editar: modal con cantidad, método de pago y precio aplicado (cambiar el producto es más simple como anular + registrar de nuevo; proponerlo así en la UI).
4. Devoluciones = reducir cantidad o anular (mismo mecanismo, como pide el ROADMAP).
5. Opcional: toggle "mostrar anuladas" en el historial (tachadas, badge gris).

**Acepta si:** venta de días atrás editable, stock se ajusta solo, anulación con confirmación y deshacer, totales/reportes reflejan el cambio al instante.

---

## Después del MVP (fuera del roadmap actual)

Ideas para una v1.1, en orden de valor probable para Yamile: respaldo automático a la nube cuando haya conexión (Google Drive), gráfico simple de tendencia semanal en el hub de reportes, multi-dispositivo/backend (gran salto — solo si aparece un segundo usuario), y modo oscuro real (ver [04-consistencia-de-estilos.md](04-consistencia-de-estilos.md)).
