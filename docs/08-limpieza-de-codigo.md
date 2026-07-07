# 08 · Limpieza de código e infraestructura sin cablear

**Prioridad: BAJA-MEDIA · Esfuerzo: medio día**

## Estado actual y decisiones por ítem

Inventario de todo lo que existe en el repo pero está muerto, sin usar o sin conectar, con la decisión propuesta para cada uno: **cablear** (conectarlo de verdad), **conservar** (lo usa una tarea pendiente concreta) o **borrar**.

| Ítem | Ubicación | Estado | Decisión |
|---|---|---|---|
| `useDailySummaryStore` | [store/index.ts:70](../store/index.ts#L70) | `create(() => ({}))` — vacío desde T-00; los resúmenes se leen de DB por pantalla | **Borrar.** El patrón actual (query en `useFocusEffect`) es el correcto; el store nunca va a hacer falta |
| `lib/notifications.ts` | [lib/notifications.ts](../lib/notifications.ts) | Nunca importado | **Conservar.** Lo usan T-17 (recordatorio del lunes) y T-21 (recordatorio de backup) — ver [02-plan-roadmap-pendiente.md](02-plan-roadmap-pendiente.md) |
| `businessName` en configuración | [db/config.ts:7](../db/config.ts#L7) + [app/configuration.tsx](../app/configuration.tsx) | Se guarda pero el header del Home está hardcodeado como `'Mercado Mónaco'` ([app/(tabs)/_layout.tsx:64](<../app/(tabs)/_layout.tsx#L64>)) | **Cablear** (15 min): leer la config en el layout de tabs (o en el Home con `useFocusEffect`) y usarla como `headerTitle`, con `'Mercado Mónaco'` de fallback. También usarla en los reportes de M5 (encabezado del reporte compartido) |
| `cashDiscountPercent` | [db/config.ts:8](../db/config.ts#L8), default `'10'` | Se guarda, nadie lo lee | **Revisar antes de T-12.** El modelo de precios actual ya no descuenta desde transferencia (son 3 precios explícitos por producto), así que esta clave parece herencia de un diseño anterior. Si T-12 no la necesita como default del % de descuento, **borrarla** de config y de la pantalla de Configuración |
| Paleta `Colors.dark` + hooks de tema | `constants/theme.ts`, `hooks/use-theme-color.ts`, `hooks/use-color-scheme*.ts` | Sin consumidores; `app.json` fuerza light | **Borrar** (decisión argumentada en [04-consistencia-de-estilos.md](04-consistencia-de-estilos.md)) |
| `themed-text.tsx`, `themed-view.tsx` | `components/` | Restos del starter, no usados por ninguna pantalla de la app | **Borrar** junto con los hooks de tema |
| `scripts/reset-project.js` + script `reset-project` | `package.json:7` | Utilidad del starter para vaciar `app/` — destructiva y ya sin sentido con la app construida | **Borrar** (script y entrada en package.json) |
| README.md boilerplate | raíz | Texto genérico de create-expo-app | **Reescribir** (qué es la app, requisitos, `pnpm install` + `npx expo start`, enlaces a ROADMAP.md y docs/) |

### Valores hardcodeados a consolidar

No son código muerto, pero son constantes de negocio dispersas que conviene centralizar (o al menos conocer):

| Valor | Dónde | Propuesta |
|---|---|---|
| Locale `'es-CU'` ×4 | tabs (formatCurrency duplicado) | Se resuelve con `lib/format.ts` ([04](04-consistencia-de-estilos.md)) |
| Multiplicador transferencia `1.1` y redondeo a `5` | [lib/pricing.ts](../lib/pricing.ts) | OK donde está (es LA regla de negocio y tiene nombre); solo añadir test ([03](03-testing-y-ci.md)) |
| Margen sugerido `1.3` | [app/catalog/[id].tsx:100](../app/catalog/%5Bid%5D.tsx#L100) | Mover a `lib/pricing.ts` como `suggestOptimalPrice(cost)` — junto a su regla hermana y testeable |
| Umbrales 7 días (estancado y vencimiento) | [lib/product-status.ts:3-4](../lib/product-status.ts#L3-L4) | Ya son constantes con nombre: suficiente. Hacerlos configurables solo si Yamile lo pide |
| Umbrales por categoría (Bebidas 24, Granos 6) | [constants/catalog.ts:25-28](../constants/catalog.ts#L25-L28) | OK como constantes; nota: `countLowStock` no los aplica — inconsistencia a corregir en el Fix 1 de [06-rendimiento.md](06-rendimiento.md) |

## Problema / impacto

Ninguno de estos ítems rompe nada hoy. El coste es de mantenimiento y confianza: código que parece funcionalidad (dark mode, businessName configurable) y no lo es engaña al que llega al repo — incluido un asistente de código, que puede "arreglar" o extender infraestructura muerta. Borrar es barato y git lo recuerda todo.

## Plan de mejora

1. **PR de borrado** (30 min): `useDailySummaryStore`, dark theme + hooks + themed components, `reset-project`, y `cashDiscountPercent` si la revisión pre-T-12 lo confirma. Verificar con `tsc` + `expo lint` + arranque en emulador que nada los importaba.
2. **PR de cableado** (30 min): `businessName` → header del Home; mover el `×1.3` a `lib/pricing.ts`.
3. **README nuevo** (30 min).
4. Los ítems "conservar" quedan documentados aquí con su tarea consumidora, para que nadie los borre por error antes de tiempo.

## Criterio de hecho

- `grep -rn "useDailySummaryStore\|use-theme-color\|ThemedText\|ThemedView" .` (fuera de node_modules) → 0 resultados.
- Cambiar el nombre del negocio en Configuración cambia el título del Home.
- README describe el proyecto real.
