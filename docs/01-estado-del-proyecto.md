> [!WARNING]
> **Documento obsoleto (desde 2026-07-11).** Este análisis de estado está obsoleto. Muchas de las tareas descritas aquí ya han sido implementadas y el estado actual del proyecto ha avanzado significativamente. La fuente de verdad activa para el seguimiento de tareas es el [tablero de Notion](https://app.notion.com/p/39a19c33c39081fab767c40eb46cc347). Este archivo se conserva únicamente como registro histórico.


# 01 · Estado del proyecto

> Resumen ejecutivo del estado de **Mercado Mónaco MVP** a 2026-07-07, basado en [ROADMAP.md](../ROADMAP.md), el historial de git y una revisión del código.

## Qué es la app

App móvil **offline-first** de gestión de inventario y ventas para un solo usuario (Yamile), dueña de un pequeño mercado. El problema central que resuelve: saber al final del día cuánto entró en **efectivo vs. transferencia** y cuál fue la utilidad real. Stack: Expo SDK 54 + Expo Router v6, TypeScript estricto, Drizzle ORM sobre expo-sqlite, Zustand, react-hook-form + Zod, uniwind (Tailwind v4). Sin backend: todo vive en `db.sqlite` en el dispositivo.

## Arquitectura actual

| Capa | Ubicación | Notas |
|---|---|---|
| Rutas/pantallas | `app/` | 5 tabs (Inicio, Inventario, Ventas, Gastos, Reportes) + stacks de catálogo, ventas, inventario, gastos y modal de configuración |
| Capa de datos | `db/` | Patrón repositorio: `products.ts`, `sales.ts`, `movements.ts`, `expenses.ts`, `queries.ts`, `config.ts` sobre `client.ts` (Drizzle) |
| Esquema/migraciones | `db/schema.ts` + `drizzle/` | 1 migración (`0000_dark_payback.sql`), aplicada en runtime con `useMigrations` en `app/_layout.tsx` |
| Lógica de dominio | `lib/` | `pricing.ts` (precio transferencia), `product-status.ts` (estancado/vencimiento), `notifications.ts` (sin usar aún) |
| Estado global | `store/index.ts` | `useCartStore` (carrito de sesión de venta) |
| UI compartida | `components/ui/` | Button, Input, Text, Select, Card, Badge, StatCard, ProductPicker, EmptyState, IconSymbol |
| Constantes | `constants/` | `catalog.ts` (unidades, categorías, umbrales), `expenses.ts`, `theme.ts` |

**Decisiones de diseño clave (fortalezas):**

- **Stock derivado**, no contador almacenado: se calcula como movimientos ± ventas no anuladas ([db/queries.ts:7-55](../db/queries.ts#L7-L55)). Esto hace que la futura edición/anulación de ventas (T-22) ajuste el stock "gratis".
- **Costo promedio ponderado** recalculado en cada entrada ([db/queries.ts:57-75](../db/queries.ts#L57-L75)).
- **Costo congelado al vender** (`costo_al_vender`) y utilidad calculada en la transacción de venta ([db/sales.ts:43-76](../db/sales.ts#L43-L76)).
- El esquema ya tiene columnas para features futuras: `ventas.descuento_pct` (T-12) y `ventas.anulada` (T-22).

## Estado del roadmap: 14 de 23 tareas hechas

| Milestone | Tareas | Estado |
|---|---|---|
| Setup + M0 (base) | T-00, T-01, T-02 | ✅ Hechas |
| M1 (catálogo y precios) | T-03, T-04, T-05 | ✅ Hechas |
| M2 (inventario) | T-06, T-07, T-08 | ✅ Hechas |
| M3 (ventas) | T-09, T-10, T-11 | ✅ Hechas · **T-12 pendiente** |
| M4 (pérdidas y gastos) | T-13, T-14 | ✅ Hechas · **T-15 pendiente** |
| M5 (reportes) | T-16 a T-20 | ❌ **Todo pendiente** (el tab Reportes es un placeholder) |
| M6 (respaldo) | T-21 | ❌ **Pendiente — crítico** |
| M7 (corrección) | T-22 | ❌ Pendiente |

Correlación con commits: el historial mapea limpio (T-00 → `727ea10`/`535620c`, T-01 → `24cdff5`, … T-08 → `c39cf76`, el más reciente). El plan detallado para las 9 tareas pendientes está en [02-plan-roadmap-pendiente.md](02-plan-roadmap-pendiente.md).

## Riesgos y deudas transversales

1. **Nada se ha verificado en un dispositivo real.** Casi todos los criterios de aceptación del ROADMAP llevan la nota *"runtime pendiente de Expo Go / device"*: solo se validó con `tsc` + `lint` + bundle de Android. Antes de seguir sumando features conviene una sesión de smoke-testing en dispositivo (persistencia tras reiniciar la app, navegación, formularios). Es el ítem abierto de T-01.
2. **Sin respaldo (T-21).** En una app offline-first, perder el teléfono = perder el negocio. Es la tarea `ALTA` pendiente de mayor impacto/riesgo.
3. **Sin tests ni CI** sobre lógica financiera (ver [03-testing-y-ci.md](03-testing-y-ci.md)).
4. **Drift documental del ROADMAP.** El refactor a inglés (`e28e54a`) renombró rutas, pero el ROADMAP sigue citando rutas en español que ya no existen o que nunca existirán con ese nombre:

   | ROADMAP dice | Realidad / ruta propuesta |
   |---|---|
   | `app/catalogo/index.tsx`, `app/catalogo/[id].tsx` | `app/catalog/index.tsx`, `app/catalog/[id].tsx` |
   | `app/inventario/entrada.tsx`, `historial.tsx` | `app/inventory/stock-entry.tsx`, `app/inventory/history.tsx` |
   | `app/ventas/nueva-sesion.tsx` | `app/sales/new-session.tsx` |
   | `app/configuracion.tsx` | `app/configuration.tsx` |
   | `app/reportes/diario.tsx`, `rankings.tsx`, `perdidas.tsx` (pendientes) | crear como `app/reports/daily.tsx`, `app/reports/rankings.tsx`, `app/reports/losses.tsx` |
   | `db/productos.ts`, `db/movimientos.ts` | `db/products.ts`, `db/movements.ts` |

   **Acción propuesta:** actualizar ROADMAP.md con las rutas reales (media hora) para que siga sirviendo como fuente de verdad.
5. **README.md es el boilerplate de `create-expo-app`.** Reemplazarlo por una descripción real del proyecto (qué es, cómo correr, dónde está el roadmap y estos docs).

## Índice de deudas por tema

Cada tema tiene su documento con plan de mejora:

- [02 · Plan del roadmap pendiente](02-plan-roadmap-pendiente.md) — T-12, T-15, M5, T-21, T-22
- [03 · Testing y CI](03-testing-y-ci.md) — cero tests sobre lógica financiera
- [04 · Consistencia de estilos](04-consistencia-de-estilos.md) — inline styles vs. uniwind, `formatCurrency` ×4
- [05 · Manejo de errores](05-manejo-de-errores.md) — escrituras a DB sin try/catch
- [06 · Rendimiento](06-rendimiento.md) — N+1 en stock bajo, picker sin debounce
- [07 · Calidad de datos](07-calidad-de-datos.md) — fechas como texto libre
- [08 · Limpieza de código](08-limpieza-de-codigo.md) — infra muerta o sin cablear
- [09 · Accesibilidad](09-accesibilidad.md) — Pressables sin roles/labels
