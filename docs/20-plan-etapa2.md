# 20 · Plan de desarrollo de la Etapa 2

**Estado: SP1 completo (en `main`) · SP2 en curso: ver [docs/21](21-estado-sp2-y-continuacion-local.md)**

> Este doc baja a ejecución el [spec de la Etapa 2](superpowers/specs/2026-07-11-etapa2-plataforma-multinegocio-design.md): orden, calendario, criterios de salida de cada sub-proyecto y las decisiones que el spec dejó abiertas. El *qué* y el *por qué* siguen en el spec; el estado de cada tarea vive en Notion ([PRJ «Plataforma multi-negocio»](https://app.notion.com/39a19c33c39081b99f1dc6a2cfdfa957)). El plan detallado de SP1 está en [superpowers/plans/2026-11-04-sp1-fundaciones.md](superpowers/plans/2026-11-04-sp1-fundaciones.md).

## Decisiones de planificación (2026-11-04)

| Tema | Decisión | Consecuencia en el plan |
|---|---|---|
| Ritmo | Dedicación completa, ~40 h/semana | Calendario de ~15 semanas con colchón |
| Contrato de API | REST + OpenAPI generado desde los esquemas Zod de `packages/contracts` (`nestjs-zod`) | La web y mobile consumen un cliente tipado generado desde el OpenAPI (`openapi-typescript` + `openapi-fetch`); CI falla si el OpenAPI commiteado no coincide con el código |
| Deploy | Solo local (Docker Compose) hasta cerrar SP4; la demo pública sale al final de SP4 | El proveedor se decide en el spec de SP4. SP1 deja la API y la web *deployables* (config por env vars validada, Dockerfile de la API) para que eso no sea un cambio grande |
| Seguimiento | Sub-proyectos y tareas de SP1 en Notion, con link a este doc | Las tareas de SP2 a SP5 se crean cuando se escriba el spec de cada una |

### Decisiones técnicas que el spec no cubría

1. **Cómo comparten código los paquetes con NestJS.** Hoy `@monaco/domain` exporta `.ts` crudo (`main: ./src/index.ts`) y corre sus tests con `jest-expo`. Metro lo transpila, pero Node no aplica *type stripping* dentro de `node_modules`, y la metadata de decoradores de Nest pide SWC/tsc, no esbuild. Por eso **los paquetes compartidos (`domain`, `contracts`) compilan a `dist/` con `tsc -b`** y exponen `exports` con `types` + `default`. Los consumidores importan lo compilado, y CI compila los paquetes antes del typecheck (`pnpm -r` respeta el orden topológico). La primera tarea de SP1 cambia también el runner de tests de `domain` a Vitest (sin preset de Expo).
2. **Versión de Zod.** `packages/contracts` nace con Zod 4. Mobile sigue con Zod 3 (y `@hookform/resolvers` 3) hasta SP4, que es cuando consume `contracts` por primera vez. Así SP1 no toca la app mobile.
3. **Login en mobile.** El spec pone la vista "Hoy" en SP4 detrás de `reports:view`, así que mobile necesita sesión antes de SP5. El **login online con registro de dispositivo entra en SP4**. SP5 agrega lo que hace falta offline (cache de permisos efectivos, refresh en background).
4. **Next.js.** Se usa la misma línea que el portafolio (Next 16 con App Router, `cacheComponents`), con shadcn/ui. Antes de escribir código de Next se leen las guías de `node_modules/next/dist/docs/`.
5. **Tests de la API contra Postgres real.** Integración con Testcontainers (Postgres 17), no con mocks del ORM. Las políticas RLS se prueban conectando con el rol de la aplicación, que no es superusuario (un superusuario se salta RLS y el test pasaría en falso).
6. **ADRs.** Cada decisión de arquitectura queda como ADR corto en `docs/adr/`. Es parte del entregable de portafolio, no burocracia.

## Calendario

Inicio previsto: **lunes 2026-11-09**. Estimación con ~20% de colchón; cada sub-proyecto arranca con su spec (½–1 día) y su plan.

| # | Sub-proyecto | Semanas | Ventana estimada | Gate de salida |
|---|---|---|---|---|
| SP1 | Fundaciones | 1,5 | 11-09 → 11-18 | `docker compose up` + `pnpm dev` levantan API y web; la web muestra `/health` con el cliente tipado; CI verde con tests de integración en Postgres real; mobile sin cambios |
| SP2 | Identidad y tenancy | 3 | 11-19 → 12-09 | Login web con refresh rotativo por dispositivo y revocación; tenants, puntos de venta y usuarios; RBAC (permisos en código, roles por tenant, asignación con alcance); RLS activo con un test de fuga entre tenants; owner protegido |
| SP3 | Catálogo e inventario | 3 | 12-10 → 01-08 | Catálogo central con precio y stock por punto (stock derivado con `@monaco/domain`); entradas, salidas y transferencias entre puntos; CRUD en la web con permisos aplicados por punto. *Incluye fiestas de fin de año* |
| SP4 | Dashboard + demo pública | 2 | 01-11 → 01-22 | KPIs en la web sobre datos sembrados; mobile con login online y vista "Hoy"; tenant demo sembrado; **demo pública desplegada** |
| SP5 | Sync offline de mobile | 5 | 01-25 → 02-26 | UUIDv7 en mobile con la suite financiera en verde; op-log y push/pull idempotente; catálogo descargado de solo lectura; ventas offline que sincronizan; política definida para permisos revocados offline |

**Total: ~14,5 semanas → cierre estimado a fines de febrero de 2027.**

SP5 es el más incierto: si se pasa, el producto ya se puede demostrar de punta a punta desde SP4. Ese es el motivo del orden del spec.

## Reglas de ejecución

- **Ciclo por sub-proyecto:** spec (`docs/superpowers/specs/`) → plan (`docs/superpowers/plans/`) → código, con un PR por tarea del plan. Cada PR deja CI en verde.
- **Mobile no se rompe:** hasta SP4, `apps/mobile` solo recibe cambios de tooling. La suite financiera (96 tests) y sus umbrales de cobertura son un gate en todos los PRs.
- **Dominio único:** cualquier regla de precio, stock o costo que necesite la API va a `packages/domain`, nunca duplicada en `apps/api`.
- **Seguridad por defecto:** la API valida *permiso + punto* en cada caso de uso; RLS es la segunda barrera, no la primera. Ningún endpoint sin guard, salvo los que se marquen explícitamente como públicos (`/health`, `/auth/*`).
- **Notion:** al empezar una tarea se marca "In progress"; al mergear, "Done". El contenido técnico se queda en `docs/`.

## Arquitectura de referencia (destino al final de SP4)

```
apps/
  api/        NestJS · hexagonal por módulo (domain / application / infrastructure / http)
  web/        Next.js · back-office + dashboard · cliente generado desde OpenAPI
  mobile/     Expo · caja (SQLite local), sin cambios de comportamiento hasta SP4
packages/
  domain/     reglas puras (precio, stock derivado, costo promedio) → dist/
  contracts/  esquemas Zod de request/response, errores, paginación → dist/ + openapi.json
infra/
  docker-compose.yml   Postgres 17 (+ Adminer opcional)
docs/adr/     decisiones de arquitectura
```

Estructura de un módulo de la API (se fija en SP1 con el módulo `health` y se repite en el resto):

```
apps/api/src/modules/<contexto>/
  domain/          entidades y puertos (interfaces de repositorio), sin Nest ni Drizzle
  application/     casos de uso; reciben puertos por inyección
  infrastructure/  adaptadores Drizzle, mapeo fila ↔ entidad
  http/            controllers, DTOs desde contracts, guards
```

## Riesgos de planificación

| Riesgo | Mitigación |
|---|---|
| Next 16 y NestJS sobre Node 24 con pnpm `nodeLinker: hoisted` | Primera tarea de SP1 con build y arranque mínimos de los tres apps antes de agregar features |
| RLS mal configurado da falsa seguridad | Test explícito de fuga entre tenants con el rol de la aplicación desde SP1 (prueba de concepto) y en SP2 (real) |
| SP3 cae sobre las fiestas | Ventana de 3 semanas con colchón; si hace falta, transferencias entre puntos pasa al inicio de SP4 |
| El tablero de Notion de la Etapa 1 está desfasado | Ver "Pendiente de la Etapa 1" abajo |

## Pendiente de la Etapa 1

El tablero de Notion tiene tareas de la Etapa 1 en "Not started" que según el historial de git ya se mergearon: TSK-43 (`9fcb0bb`, `e868645`), TSK-44 (`07f9cc1`), TSK-45 (`a5c30a4`), TSK-46 (PR #9), TSK-48 (`26a939b`, `bb8a3ba`), TSK-11 (`fe421f1`), TSK-50 (PR #19). Hay que verificarlas y cerrarlas antes de arrancar SP1, para que el tablero sea confiable. TSK-13 (venta a costo) también parece hecha: `isCostSale` ya está en `db/sales.ts` y en el store. TSK-47 (constancia de salidas) no tiene un commit identificable. El único pendiente seguro es el smoke-test en dispositivo real (TSK-5), que conviene hacer antes de SP5.

Las tareas TSK-20 a TSK-23 eran los sub-proyectos del diseño anterior (2026-07-11). Se reutilizan para SP1 a SP4 del diseño nuevo, y SP5 se crea aparte.
