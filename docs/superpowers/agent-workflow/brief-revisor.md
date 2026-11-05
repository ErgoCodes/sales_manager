# Brief para agentes revisores (code review + security review)

> Cada tarea se revisa antes de abrir su PR. Solo se abre el PR con `VERDICT: PASS`; los hallazgos menores se aplican antes si son baratos.

Repo: tu checkout local de sales_manager. Revisas el diff `git diff <base>...<rama>` (te los da el prompt). Spec de la tarea: su sección del plan (SP1: docs/superpowers/plans/2026-11-04-sp1-fundaciones.md; SP2: docs/superpowers/plans/2026-11-05-sp2-identidad-tenancy.md, y el spec de SP2 docs/superpowers/specs/2026-11-05-sp2-identidad-tenancy-design.md manda); reglas del repo en CLAUDE.md.

## Qué revisar
1. **Correctitud:** cumple el "Hecho cuando" de la tarea; bugs; casos borde; tests que de verdad prueban algo (no tautológicos); nada de tests saltados ni umbrales bajados.
2. **Seguridad:** secretos o credenciales commiteados; validación de entrada; fuga de stack traces o info interna en errores; CORS; config insegura por defecto; inyección SQL (sql crudo con interpolación); RLS/roles (rol de app sin BYPASSRLS, set_config con alcance de transacción); dependencias sospechosas o sin pin razonable; permisos de Dockerfile (no root en runtime); CI (no `pull_request_target`, permisos mínimos).
3. **Arquitectura/calidad:** fronteras hexagonales; nada de duplicar reglas de `packages/domain`; código muerto; nombres en inglés.

## Cómo
- Verifica tú mismo: corre `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test:coverage` en la rama (más tests de integración si aplica). Checkout con `git checkout <rama>` (no modifiques nada; no commitees).
- Solo reporta hallazgos verificados con evidencia (archivo:línea y escenario concreto). Sin nitpicks de estilo.
- Puedes lanzar un subagente barato (haiku/sonnet) si necesitas explorar en paralelo; prioriza eficiencia de tokens.

## Reporte (máx. 20 líneas)
Primera línea: `VERDICT: PASS` o `VERDICT: FAIL`. FAIL solo si hay hallazgos bloqueantes (bug real, problema de seguridad, criterio "Hecho cuando" no cumplido, CI que fallaría). Luego lista: [BLOQUEANTE|MENOR] archivo:línea — problema — fix sugerido. Luego resultado de los comandos que corriste.
