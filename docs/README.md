# docs/ — Análisis y planes de mejora

Conjunto de documentos generados el 2026-07-07 a partir del análisis del [ROADMAP.md](../ROADMAP.md) y del código. Cada documento cubre un tema: qué hay hoy (con referencias `archivo:línea`), qué problema causa, el plan concreto para mejorarlo y el criterio para darlo por hecho.

> **Tracking de tareas (desde 2026-07-11):** el estado de cada tarea pendiente vive en Notion — [Centro de Proyectos › Mercado Mónaco — MVP multiplataforma](https://app.notion.com/p/39a19c33c39081fab767c40eb46cc347). Estos docs siguen siendo la spec técnica; Notion dice qué está pendiente/en curso/hecho. Diseño del sistema en [el spec de tracking](superpowers/specs/2026-07-11-notion-roadmap-tracking-design.md).
>
> **Ojo con los docs 01 y 02:** quedaron desactualizados — afirman pendientes tareas del roadmap (T-12, T-15 a T-22) que se implementaron después del 2026-07-07. Hay una tarea en el tablero para actualizarlos/archivarlos; mientras tanto, la fuente de verdad del estado es `ROADMAP.md` + el tablero de Notion. Lo mismo aplica al "Orden de ataque" de abajo, que se conserva por su parte de deuda técnica aún vigente.

## Índice

| Doc | Tema | Prioridad | Esfuerzo |
|---|---|---|---|
| [01 · Estado del proyecto](01-estado-del-proyecto.md) | Resumen ejecutivo, arquitectura, avance del roadmap (14/23), riesgos | — | lectura |
| [02 · Plan del roadmap pendiente](02-plan-roadmap-pendiente.md) | Cómo ejecutar T-12, T-15, reportes (T-16–T-20), respaldo (T-21) y edición de ventas (T-22) | ALTA | ~12 días |
| [03 · Testing y CI](03-testing-y-ci.md) | jest-expo + tests de lógica financiera + GitHub Actions | ALTA | 1-2 días |
| [04 · Consistencia de estilos](04-consistencia-de-estilos.md) | Migrar tabs a uniwind, `formatCurrency` único, decisión sobre dark mode | MEDIA | 1-2 días |
| [05 · Manejo de errores](05-manejo-de-errores.md) | try/catch + Alert en todas las escrituras; eliminar fallbacks silenciosos | ALTA | ½ día |
| [06 · Rendimiento](06-rendimiento.md) | Arreglar N+1 de stock bajo, debounce del buscador, verificación en lote | MEDIA | ½ día |
| [07 · Calidad de datos](07-calidad-de-datos.md) | Date picker en vez de texto libre; validación uniforme | ALTA | 1 día |
| [08 · Limpieza de código](08-limpieza-de-codigo.md) | Borrar/cablear infra muerta (dark mode, stores vacíos, config sin usar) | BAJA-MEDIA | ½ día |
| [09 · Accesibilidad](09-accesibilidad.md) | Roles, estados y áreas táctiles en componentes compartidos | MEDIA | ½-1 día |
| [10 · Método de pago: costo y fiado](10-metodo-pago-costo-y-fiado.md) | Venta a costo debe permitir elegir efectivo/transferencia; diseño futuro de ventas fiadas (deuda) | MEDIA | ~2-3 días |
| [11 · Editar/eliminar gastos + fecha futura](11-editar-eliminar-gastos.md) | Editar y eliminar gastos registrados; bloquear fecha futura en gastos | MEDIA | ~1 día |
| [12 · Visión: plataforma multi-negocio](12-vision-multiplataforma.md) | Etapa 2 a futuro: multi-tenant, backend, sync offline-first — preguntas abiertas de diseño | BAJA | lectura |

## Feedback de la clienta (2026-07-19)

Bugs y features detectados por Yamile probando la app (conversación de WhatsApp). Cada doc apunta a su tarea en el tablero de Notion (PRJ-2).

| Doc | Tema | Prioridad | Esfuerzo |
|---|---|---|---|
| [13 · Utilidad y costo promedio inflados](13-utilidad-costo-promedio.md) | La utilidad usa `costo_promedio` (arranca en 0 y se diluye) en vez de `precio_costo`; afecta ventas y ranking "Más rentables" | ALTA | ~1.5-2 días |
| [14 · Retiro/merma rebajan mal el inventario](14-retiro-dueno-rebaja-inventario.md) | Doble negación de signo: retiro del dueño suma al stock en vez de restar | ALTA | ~½ día |
| [15 · Total "Pérdidas y gastos del mes"](15-perdidas-gastos-mes-total.md) | Coherencia UI: la lista no filtra por mes/tipo y no cuadra con el total | MEDIA | ~½-1 día |
| [16 · Resumen de entradas por producto y fecha](16-resumen-entradas-producto-fecha.md) | Nuevo reporte agregado de entradas de inventario (patrón de rankings + Excel) | MEDIA | ~1 día |
| [17 · Constancia de salidas por producto](17-constancia-salidas-por-producto.md) | Añadir cantidad/unidad y tipo "otro concepto" al reporte de salidas | MEDIA | ~1 día |
| [18 · Resumen de venta por método de pago](18-resumen-venta-por-metodo-pago.md) | Agrupar productos por efectivo/transferencia en el resumen del carrito | MEDIA | ~½-1 día |

## Orden de ataque recomendado

1. **Primero, una tarde de deuda crítica** antes de seguir con features — son arreglos pequeños que protegen todo lo demás:
   - Smoke-test en dispositivo real (pendiente desde T-01; nada se ha verificado en runtime).
   - [05](05-manejo-de-errores.md) manejo de errores (½ día) — evita pérdida silenciosa de registros.
   - [06](06-rendimiento.md) los 3 fixes de queries (½ día).
   - Base de [03](03-testing-y-ci.md): runner + tests de `lib/` + CI (1 día).
2. **Adelantar T-21 (respaldo)** si la app va a usarse con datos reales pronto — argumento en [02](02-plan-roadmap-pendiente.md).
3. **Seguir el roadmap:** T-12 → T-15 → M5 (reportes) → T-22, incorporando [07](07-calidad-de-datos.md) (el `DateField` conviene tenerlo antes de construir los selectores de período de los reportes).
4. **Entre medias, cuando haya huecos:** [04](04-consistencia-de-estilos.md), [08](08-limpieza-de-codigo.md) y [09](09-accesibilidad.md) — mejor como PRs pequeños e independientes.
