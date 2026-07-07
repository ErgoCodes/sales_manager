# 07 · Calidad de datos de entrada

**Prioridad: ALTA (las fechas alimentan todos los reportes) · Esfuerzo: 1 día**

## Estado actual

### Fechas como texto libre

Todas las fechas se introducen en un `Input` de texto con placeholder `YYYY-MM-DD`:

- [app/sales/new-session.tsx](../app/sales/new-session.tsx) — fecha de la sesión de venta.
- [app/inventory/stock-entry.tsx](../app/inventory/stock-entry.tsx) — fecha de la entrada.
- [app/expenses/new.tsx](../app/expenses/new.tsx) y [app/expenses/outflow.tsx](../app/expenses/outflow.tsx) — fecha del gasto/salida.
- Filtros de fecha en [app/sales/history.tsx](../app/sales/history.tsx), [app/inventory/history.tsx](../app/inventory/history.tsx) y el selector del tab Ventas.

**Solo el formulario de producto valida el formato** con una regex Zod ([app/catalog/[id].tsx:32-35](../app/catalog/%5Bid%5D.tsx#L32-L35)). En el resto, cualquier cadena termina en la columna `fecha`.

### Números con fallback permisivo

Los campos numéricos son strings con `keyboardType="numeric"` parseados con `Number(...)`, a menudo como `Number(x) || 0` (p. ej. [app/catalog/[id].tsx:97-98](../app/catalog/%5Bid%5D.tsx#L97-L98)). En formularios con Zod (producto, entrada, gastos) hay refines que protegen el submit; en cantidades del carrito la protección depende de la pantalla.

## Problema / impacto

- Las queries comparan con `date(fecha)` de SQLite ([db/queries.ts:94](../db/queries.ts#L94), [db/sales.ts:102-104](../db/sales.ts#L102-L104)). Si la usuaria escribe `7/7/2026`, `2026-7-7` o `07-07-2026`, `date()` devuelve NULL y esa venta **desaparece de los resúmenes y reportes sin ningún error**. Es corrupción silenciosa del dato más importante de la app.
- Para la usuaria real (no técnica), teclear un formato ISO a mano es hostil y propenso a error diario.
- Con los reportes de M5 a la vuelta de la esquina, cada fecha malformada que entre ahora será una discrepancia en los totales después.

## Plan de mejora

### Paso 1 — Componente `DateField` único (core del fix)

Crear `components/ui/date-field.tsx` que reemplace los inputs de texto de fecha en toda la app:

- **Recomendado:** `pnpm add @react-native-community/datetimepicker` (soportado por Expo SDK 54; requiere development build o funciona en Expo Go). Pressable que muestra la fecha formateada legible (`EEE d 'de' MMMM`, con locale `es` de date-fns, ya instalada) y abre el picker nativo al tocar. Internamente el valor sigue siendo `yyyy-MM-dd`.
- Alternativa sin dependencia nativa: picker propio con 3 `Select` (día/mes/año) o botones "Hoy / Ayer / elegir…" — el 95 % de los registros son de hoy o ayer, así que dos atajos cubren casi todo y reducen toques.
- El componente **nunca** devuelve una cadena inválida: su API es `value: string (yyyy-MM-dd)` + `onChange`.

Pantallas a migrar: new-session, stock-entry, expenses/new, expenses/outflow, los 2 historiales y el selector del tab Ventas. Y el campo `fecha_vencimiento` del formulario de producto (puede quedarse la regex como cinturón, pero con picker deja de hacer falta).

### Paso 2 — Validación defensiva en la capa db

Aunque la UI ya no permita fechas malas, la capa de datos es la última línea (y T-21 permitirá restaurar backups de origen desconocido). En los repositorios de escritura (`registerSalesSession`, `registerEntry`, `registerOutflow`, `registerExpense`): validar con `isValid(parseISO(date))` de date-fns y lanzar si no cumple — el error sube al `safeWrite` de [05-manejo-de-errores.md](05-manejo-de-errores.md).

### Paso 3 — Unificar validación numérica

Extraer a `lib/validators.ts` los refines Zod repetidos (`positivePrice` de [app/catalog/[id].tsx:19-20](../app/catalog/%5Bid%5D.tsx#L19-L20), enteros positivos, cantidad > 0) y usarlos en todos los formularios. Regla: `Number(x) || 0` solo es aceptable para **mostrar** previews en vivo (como el precio sugerido), nunca en el dato que se guarda — el guardado siempre pasa por el schema Zod.

### Paso 4 — Auditoría puntual de datos existentes

Antes de dar por cerrado el tema, una consulta única (en dev, o botón oculto en Configuración): `SELECT COUNT(*) FROM ventas WHERE date(fecha) IS NULL` (ídem movimientos y gastos). Si hay filas, corregirlas a mano; son registros invisibles para los reportes.

## Criterio de hecho

- Ninguna pantalla tiene un `Input` de texto libre para fechas (`grep -rn "YYYY-MM-DD" app/` → 0 placeholders).
- Es imposible guardar una venta/entrada/gasto con `date(fecha) IS NULL` (test de la capa db: fecha inválida → lanza).
- Los refines numéricos compartidos viven en `lib/validators.ts` y los formularios los importan.
