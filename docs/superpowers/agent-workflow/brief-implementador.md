# Brief común para agentes implementadores (sales_manager)

> Se usó en la nube para SP1 y SP2 (un agente por tarea). Pásale a cada agente la ruta de este archivo y su tarea. Ajusta las rutas a tu checkout local.

Repo: raíz de tu checkout de sales_manager (pnpm 11, nodeLinker hoisted). Lee primero: CLAUDE.md, docs/20-plan-etapa2.md (sección de decisiones técnicas) y TU sección del plan que indique tu prompt (SP1: docs/superpowers/plans/2026-11-04-sp1-fundaciones.md; SP2: docs/superpowers/plans/2026-11-05-sp2-identidad-tenancy.md + su spec docs/superpowers/specs/2026-11-05-sp2-identidad-tenancy-design.md, que manda). Cumple su "Hecho cuando".

## Reglas
- Código, identificadores y commits en inglés; docs/ADRs en español (como el resto de docs/).
- Conventional commits, sin líneas de atribución de IA en el mensaje salvo las que tu herramienta agregue por política propia.
- Rama: créala desde la rama base indicada en tu prompt (`git checkout -B <tu-rama> origin/<base>` o la local si aún no se pusheó). Push: `git push -u origin <tu-rama>` (si hay errores de red, reintenta con backoff 2/4/8/16 s). NO abras PRs ni mergees nada. No toques otras ramas.
- Antes de usar APIs de NestJS, Next 16, Drizzle, nestjs-zod, Vitest, Testcontainers, openapi-typescript, etc., consulta la doc vigente con Context7 (mcp__Context7__*, cárgalo con ToolSearch) o, para Next, `node_modules/next/dist/docs/`. No confíes en la memoria.
- Usa versiones estables actuales (verifica con `pnpm view <pkg> version`). Commitea pnpm-lock.yaml.
- Antes de pushear, en la raíz deben pasar: `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage` (más lo específico de tu tarea). Mobile (`apps/mobile`) debe quedar igual: sus tests y umbrales en verde. El hook pre-push de husky corre `pnpm test`.
- No uses `--no-verify`, no desactives ni saltes tests, no bajes umbrales de cobertura existentes.
- Secretos: nada real en el repo; solo `.env.example` con valores de desarrollo. Nada de `NEXT_PUBLIC_` para secretos.

## Entorno
- Node 24 (como CI). Docker es necesario para `pnpm --filter api test:integration` y `pnpm db:up`.
- Testcontainers: si Ryuk da problemas, `TESTCONTAINERS_RYUK_DISABLED=true`. Imagen de Postgres sobreescribible con `POSTGRES_IMAGE`.

## Subagentes
Puedes lanzar subagentes (Agent) para trabajo acotado y paralelizable (p. ej. investigar una API en la doc o explorar archivos). Usa `haiku` o `sonnet` para eso y pídeles respuestas cortas. Prioriza eficiencia de tokens: no leas archivos enteros que no necesitas.

## Reporte final (máx. 15 líneas)
Rama y SHA final pusheado; qué hiciste (bullets); desviaciones del plan y por qué; comandos de verificación que corriste y resultado; riesgos o pendientes.
