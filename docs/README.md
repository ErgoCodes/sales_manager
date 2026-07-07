# docs/ — Análisis y planes de mejora

Conjunto de documentos generados el 2026-07-07 a partir del análisis del [ROADMAP.md](../ROADMAP.md) y del código. Cada documento cubre un tema: qué hay hoy (con referencias `archivo:línea`), qué problema causa, el plan concreto para mejorarlo y el criterio para darlo por hecho.

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

## Orden de ataque recomendado

1. **Primero, una tarde de deuda crítica** antes de seguir con features — son arreglos pequeños que protegen todo lo demás:
   - Smoke-test en dispositivo real (pendiente desde T-01; nada se ha verificado en runtime).
   - [05](05-manejo-de-errores.md) manejo de errores (½ día) — evita pérdida silenciosa de registros.
   - [06](06-rendimiento.md) los 3 fixes de queries (½ día).
   - Base de [03](03-testing-y-ci.md): runner + tests de `lib/` + CI (1 día).
2. **Adelantar T-21 (respaldo)** si la app va a usarse con datos reales pronto — argumento en [02](02-plan-roadmap-pendiente.md).
3. **Seguir el roadmap:** T-12 → T-15 → M5 (reportes) → T-22, incorporando [07](07-calidad-de-datos.md) (el `DateField` conviene tenerlo antes de construir los selectores de período de los reportes).
4. **Entre medias, cuando haya huecos:** [04](04-consistencia-de-estilos.md), [08](08-limpieza-de-codigo.md) y [09](09-accesibilidad.md) — mejor como PRs pequeños e independientes.
