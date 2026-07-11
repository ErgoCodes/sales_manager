# Registro del roadmap en Notion + visión multiplataforma

> Diseño de dónde y cómo queda registrado el trabajo pendiente del proyecto, para que implementar sea lo único que quede por hacer. No es una feature de la app — es organización de trabajo.

## Contexto

El proyecto (Mercado Mónaco, app de inventario/ventas para un solo negocio) tiene el `ROADMAP.md` original prácticamente terminado: **de las 23 tareas (T-00 a T-22), solo quedan 2 ítems sin marcar** — el test de persistencia en dispositivo real (T-01) y el recordatorio semanal de respaldo (T-21). Lo pendiente real hoy es deuda técnica transversal y features nuevas ya diseñadas en `docs/` pero no implementadas.

**Nota sobre fuentes:** `docs/01-estado-del-proyecto.md` y `docs/02-plan-roadmap-pendiente.md` (fechados 2026-07-07) quedaron obsoletos casi de inmediato — afirman que T-12 y T-15 a T-22 están pendientes, pero los commits posteriores a esa fecha las implementaron todas. La lista de tareas de este spec se verificó contra `ROADMAP.md` y el código actual, no contra esos docs. Actualizarlos/archivarlos es una de las tareas registradas.

El usuario quiere escalar la app hacia una herramienta multiplataforma de gestión de punto de venta e inventarios, en dos etapas:

1. **Etapa 1 (accionable ya):** consolidar el MVP actual de un solo negocio en las plataformas que Expo ya cubre (iOS, Android, Web).
2. **Etapa 2 (visión a futuro, sin trabajo iniciado):** evolucionar a una plataforma multi-negocio/multi-tenant con backend propio.

Ya existe un espacio de trabajo en Notion ("🗂️ Centro de Proyectos") con dos bases de datos conectadas — **Proyectos** (`Objetivo`, `Estado`, `Prioridad`, `Área`, `Periodo`, rollups de puntos) y **Tareas** (`Size` XS-XL → puntos Fibonacci, `Dificultad`, `Prioridad`, `Etiquetas`, `Fecha límite`, `Notas`, relación a `Proyecto`) — que ya sigue exactamente el patrón que este proyecto necesita.

## Decisión: Notion para tareas, `docs/` para specs técnicas

Notion es el tablero de estado (qué está pendiente/en curso/hecho, prioridad, tamaño). `docs/` sigue siendo la fuente técnica detallada (referencias `archivo:línea`, planes paso a paso, criterios de aceptación) que ya se usa bien en este repo. Cada tarea de Notion referencia su doc en el campo `Notas` en vez de duplicar el contenido — evita que las dos fuentes diverjan.

## Estructura en Notion

Dos filas nuevas en **Proyectos**, no una: separan "lo que se toca esta semana" de "visión a 6+ meses", evitando que el tablero semanal se ensucie con algo que no es accionable todavía.

| Campo | Mercado Mónaco — MVP multiplataforma | Mercado Mónaco — Plataforma multi-negocio |
|---|---|---|
| Objetivo | Consolidar la app actual (iOS/Android/Web vía Expo) para un solo negocio: cerrar deuda técnica, implementar las features ya diseñadas en docs/10-11, y validarla en dispositivo real. | Evolucionar de app single-tenant a plataforma con backend, cuentas y sincronización para múltiples puntos de venta. |
| Estado | In progress | Not started |
| Prioridad | Alta | Baja |
| Área | Cliente | Cliente |
| Periodo | (sin fecha fija) | (sin fecha fija) |
| Tareas | 15 filas (ver abajo) | ninguna todavía |

El proyecto de Etapa 2 existe solo para que la visión quede escrita en algún lado con dueño y prioridad — no dispara tareas ni fechas hasta que se decida priorizarlo.

## Tareas de Etapa 1 (15, verificadas contra el código el 2026-07-11)

Todas ligadas al proyecto "MVP multiplataforma", con `Notas` apuntando al doc y sección exactos.

**Restos del roadmap original** — 2 tareas:

1. Smoke-test de persistencia en dispositivo real (T-01; único `[ ]` de M0 — nada se ha validado fuera de `tsc`/lint/bundle).
2. Recordatorio semanal local de respaldo (T-21; `lib/notifications.ts` solo tiene el recordatorio de reporte del lunes, falta el de backup del domingo).

**Deuda técnica transversal** (verificada vigente) — 6 tareas:

3. Testing + CI (`docs/03`; sin jest ni script `test` en `package.json`).
4. Manejo de errores en escrituras DB (`docs/05`; cero `try/catch` en `db/*.ts`).
5. Rendimiento: `countLowStock` N+1, debounce en `ProductPicker`, `verifySessionStock` en lote (`docs/06`; los 3 fixes siguen pendientes).
6. Accesibilidad en componentes compartidos (`docs/09`; cero `accessibilityRole`/`accessibilityLabel` en `components/ui/`).
7. Estilos: tokens en Tailwind + migrar los 4 tabs de inline styles a `className` (`docs/04` **alcance reducido**: `formatCurrency` ya está unificado en `lib/format.ts` y el dark mode ya se implementó de verdad — solo queda la migración de estilos).
8. Limpieza residual (`docs/08` **alcance reducido**: borrar `useDailySummaryStore` vacío y `scripts/reset-project.js`; `businessName` ya está cableado al header).

**Features diseñadas en docs/10-11, no implementadas** — 4 tareas:

9. Método de pago real en venta a costo + flag `isCostSale` (`docs/10` §1; la columna no existe en `db/schema.ts`).
10. Ventas fiadas/deuda (`docs/10` §2; diseño futuro, se registra con prioridad Baja para no perder el análisis).
11. Editar/eliminar gastos (`docs/11` §1; sin `updateExpense`/`deleteExpense` en `db/expenses.ts`).
12. Bloquear fecha futura en gastos/salidas/entradas (`docs/11` §2; `date-picker.tsx` no expone `maxDate`).

**Deuda documental** — 3 tareas:

13. Corregir rutas obsoletas en `ROADMAP.md` (siguen en español: `app/catalogo/`, `db/productos.ts`, etc.).
14. Reemplazar el `README.md` boilerplate de `create-expo-app` por uno real.
15. Actualizar o archivar `docs/01` y `docs/02` (afirman pendiente lo que ya está implementado; señalar en `docs/README.md` qué sigue vigente).

`Estado` de cada una arranca en "Not started".

## En `docs/` del repo

- **Nuevo `docs/12-vision-multiplataforma.md`**: documenta la Etapa 2 (multi-tenant, backend, sincronización) con las preguntas de diseño abiertas (auth, modelo de datos por negocio, estrategia de sync offline-first). Es lo que el proyecto de Notion "Plataforma multi-negocio" referencia en su `Objetivo`.
- **`docs/README.md`**: se añade una fila al índice para el doc 12, y una nota de que el tracking de tareas vive ahora en Notion (con link).
- La actualización de `docs/01`/`docs/02` y de `ROADMAP.md` se ejecuta como tareas del tablero (13 y 15), no como parte de este spec.

## Fuera de alcance

- No se migra contenido técnico existente de `docs/` a Notion (duplicaría la fuente de verdad).
- No se crea ninguna tarea para la Etapa 2 — es solo el proyecto contenedor de la visión.
- No se decide aquí el diseño técnico de multi-tenant (auth, backend, sync) — eso es contenido de `docs/12`, no de este spec.

## Ejecución

Sin código de por medio: la "implementación" de este spec es directamente crear las filas en Notion (2 proyectos + 15 tareas) y escribir `docs/12-vision-multiplataforma.md` + actualizar `docs/README.md`. Se ejecuta directo tras aprobar este spec, sin pasar por plan formal de implementación.
