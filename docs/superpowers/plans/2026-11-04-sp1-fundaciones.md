# SP1 · Fundaciones: plan de implementación

> **Para agentes:** se ejecuta tarea por tarea, con un PR por tarea y CI en verde en cada uno. Los pasos usan checkboxes (`- [ ]`). Antes de escribir código de Next, NestJS, Drizzle o nestjs-zod hay que consultar la documentación vigente (Context7 o `node_modules/next/dist/docs/`), porque estas APIs cambian entre versiones mayores.

**Objetivo:** dejar el monorepo listo para construir la plataforma: `apps/api` (NestJS hexagonal), `apps/web` (Next.js), `packages/contracts` (Zod 4 → OpenAPI), `packages/domain` consumible desde Node, Postgres en Docker Compose y CI con tests de integración. Este sub-proyecto no tiene features de negocio.

**Spec:** [Etapa 2](../specs/2026-07-11-etapa2-plataforma-multinegocio-design.md) · **Plan de fase:** [docs/20](../../20-plan-etapa2.md)

**Gate de salida de SP1**
- `docker compose -f infra/docker-compose.yml up -d && pnpm dev` levanta la API (`:4000`) y la web (`:3000`).
- La web muestra el estado de `GET /health` (incluido el ping a la DB) usando el cliente generado desde el OpenAPI.
- `pnpm lint && pnpm typecheck && pnpm test:coverage` pasan en la raíz, y en CI corren también los tests de integración contra Postgres.
- `apps/mobile` arranca y se comporta igual que antes; sus 77 tests y umbrales siguen en verde.

**Orden:** T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8. T6 puede ir en paralelo a T4 y T5 una vez mergeado T3.

---

### T1 · `packages/domain` consumible desde Node `S`

**Por qué:** hoy exporta `.ts` crudo y usa `jest-expo`. NestJS no puede consumirlo así (ver docs/20, decisión técnica 1).

- [ ] Cambiar el runner a Vitest: borrar el bloque `jest` y las devDeps `jest`/`jest-expo`/`@types/jest` de `packages/domain/package.json`, agregar `vitest` y `@vitest/coverage-v8`, y portar los umbrales actuales (95/90/95/95) a `vitest.config.ts`.
- [ ] Ajustar los 5 suites de `src/__tests__` (los imports `describe/it/expect` vienen de `vitest`, o se usa `globals: true`).
- [ ] Agregar build: `tsconfig.build.json` (`composite`, `declaration`, `outDir: dist`, `rootDir: src`, excluye tests), el script `build: tsc -b tsconfig.build.json` y `exports: { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } }`. Agregar `dist/` a `.gitignore`.
- [ ] Reemplazar `eslint-config-expo` por un config TS neutral compartido (`packages/eslint-config` o un `eslint.config.js` raíz con `typescript-eslint`).
- [ ] Raíz: script `build: pnpm -r --filter "./packages/**" build`, y que `typecheck`/`test` de los apps dependan de él (`pre*` scripts o un `pnpm -r build` previo en CI).
- [ ] Verificar que mobile siga resolviendo `@monaco/domain` desde `dist`: `pnpm --filter mobile test`, `typecheck` y `npx expo export --platform android` sin errores.

**Hecho cuando:** `grep -r jest-expo packages/domain` no devuelve nada, `pnpm --filter @monaco/domain test:coverage` pasa con los mismos umbrales y mobile no cambia.

### T2 · `packages/contracts` `M`

- [ ] Crear `@monaco/contracts` con el mismo esquema de build que T1, con `zod@^4` como dependencia.
- [ ] `src/common/`: `ErrorResponse` (`{ error: { code, message, details? } }`), `Paginated<T>` (cursor), `Uuid` (UUIDv7 validado), `IsoDateTime` y `Money` (entero en centavos más moneda, o decimal en string; queda escrito en un ADR).
- [ ] `src/health/`: `HealthResponse` (`status`, `version`, `db: 'up' | 'down'`).
- [ ] Tests unitarios de los esquemas (casos válidos e inválidos).
- [ ] ADR `docs/adr/0002-contratos-zod-openapi.md`: Zod como fuente de verdad → validación en Nest → OpenAPI → clientes generados. Alternativas descartadas: ts-rest y tRPC.

**Hecho cuando:** `pnpm --filter @monaco/contracts build test` pasan y el paquete no importa nada de Nest, Next ni React Native.

### T3 · Esqueleto de `apps/api` (NestJS hexagonal) `M`

- [ ] Generar `apps/api` con NestJS 11 y el builder SWC. Usar `vitest` en lugar de Jest para alinear con los paquetes.
- [ ] Config: `src/config/env.ts` valida `process.env` con Zod al arrancar (`PORT`, `DATABASE_URL`, `NODE_ENV`, `CORS_ORIGINS`), con fail-fast si falta algo. Agregar `apps/api/.env.example`.
- [ ] `nestjs-zod`: `ZodValidationPipe` global, DTOs creados desde `@monaco/contracts` y `ZodSerializerInterceptor` para validar también las respuestas.
- [ ] Filtro global de excepciones que traduce todo al `ErrorResponse` de contracts. Los errores no controlados devuelven 500 sin stack al cliente.
- [ ] Logging con `nestjs-pino`, con request-id por petición.
- [ ] OpenAPI: Swagger en `/docs` y script `openapi:generate` que escribe `packages/contracts/openapi.json` sin levantar el servidor HTTP (con `NestFactory.create` + `SwaggerModule.createDocument`).
- [ ] Módulo `health` con la estructura hexagonal de referencia (docs/20): puerto `DatabaseHealthPort` en `domain/`, caso de uso `CheckHealth` en `application/`, controller en `http/`. El adaptador Drizzle llega en T4; por ahora hay un adaptador stub.
- [ ] Regla de lint con `eslint-plugin-boundaries` o `no-restricted-imports`: `domain/` y `application/` no pueden importar `@nestjs/*` (salvo `@nestjs/common` para `Injectable`, si se decide así en el ADR) ni `drizzle-orm`.
- [ ] `Dockerfile` multi-stage de la API (pnpm `deploy --filter api`). Solo tiene que compilar; el deploy real es en SP4.
- [ ] ADR `docs/adr/0001-arquitectura-hexagonal-api.md`.

**Hecho cuando:** `pnpm --filter api dev` responde `GET /health` según el contrato, `/docs` muestra el endpoint y la regla de lint falla si `domain/` importa Drizzle (comprobarlo con un import a propósito y luego revertirlo).

### T4 · Postgres + Drizzle + base para RLS `M` · `Difícil`

- [ ] `infra/docker-compose.yml` con Postgres 17, volumen nombrado, healthcheck y `init.sql` que crea dos roles: `monaco_owner` (dueño del esquema, corre migraciones) y `monaco_app` (rol de la aplicación, **sin** `BYPASSRLS` ni superusuario).
- [ ] Drizzle en `apps/api/src/infrastructure/db/`: cliente `node-postgres`, `drizzle.config.ts` y migraciones en `apps/api/drizzle/`. Scripts `db:generate`, `db:migrate`, `db:studio`.
- [ ] Convención de tenancy (tabla de prueba `_tenancy_probe` con `tenant_id uuid not null`):
  - política RLS `USING (tenant_id = current_setting('app.tenant_id')::uuid)` con `FORCE ROW LEVEL SECURITY`;
  - helper `withTenant(tenantId, fn)` que abre una transacción y hace `select set_config('app.tenant_id', $1, true)` antes de `fn` (alcance de transacción, así no se filtra a otra petición del pool).
- [ ] Adaptador Drizzle real de `DatabaseHealthPort` (`select 1`).
- [ ] ADR `docs/adr/0003-aislamiento-tenants-rls.md`: esquema compartido + `tenant_id` + RLS como segunda barrera, alcance por transacción y rol de aplicación separado.

**Hecho cuando:** `pnpm --filter api db:migrate` funciona contra el Compose, `/health` reporta `db: up` y T5 demuestra que RLS bloquea.

### T5 · Tests de integración de la API `S`

- [ ] Vitest con dos proyectos: `unit` (rápido, sin DB) e `integration` (Testcontainers Postgres 17, aplica `init.sql` y las migraciones una vez por run).
- [ ] e2e de `GET /health` con `supertest` sobre la app Nest real.
- [ ] Test de RLS conectado como `monaco_app`: con el tenant A se insertan filas de A y B (como owner); dentro de `withTenant(A)` solo se ven las de A, sin `set_config` no se ve nada y un insert con `tenant_id = B` dentro de `withTenant(A)` falla (`WITH CHECK`).
- [ ] Umbral de cobertura inicial para `apps/api` (se sube en SP2).

**Hecho cuando:** `pnpm --filter api test:integration` pasa en local con Docker y el test de RLS falla si se quita la política (comprobarlo a propósito).

### T6 · Esqueleto de `apps/web` (Next.js) `M`

- [ ] Crear `apps/web` con Next 16 (App Router, TypeScript strict, Tailwind v4) y shadcn/ui. Leer antes las guías de `node_modules/next/dist/docs/01-app`.
- [ ] Cliente tipado: `openapi-typescript` genera `src/lib/api/schema.d.ts` desde `packages/contracts/openapi.json`, y `openapi-fetch` crea el cliente con `API_URL` desde env validada con Zod (solo del lado del servidor; nada de `NEXT_PUBLIC_` para secretos).
- [ ] Layout del back-office: shell con sidebar (vacío), página `/` que llama a `/health` desde un Server Component y muestra el estado, y página `/login` como placeholder de SP2.
- [ ] UI en español; código en inglés (CLAUDE.md).
- [ ] Vitest + Testing Library para un test del componente de estado.

**Hecho cuando:** con la API arriba, `pnpm --filter web dev` muestra "API: ok · DB: up"; con la API abajo muestra un estado de error controlado, no una pantalla rota.

### T7 · CI `S`

- [ ] Reescribir `.github/workflows/ci.yml` en jobs:
  1. `quality`: install, `pnpm build` (paquetes), `lint`, `typecheck`, tests unitarios con cobertura (domain, contracts, mobile, api unit, web).
  2. `api-integration`: Testcontainers (Docker ya viene en `ubuntu-latest`).
  3. `openapi-drift`: corre `openapi:generate` y falla si hay diff en `packages/contracts/openapi.json` o en el `schema.d.ts` de la web.
  4. `build`: `next build` de la web y `docker build` de la API.
- [ ] Mantener el pre-push de husky en `pnpm test` (rápido, sin integración).

**Hecho cuando:** un PR que cambia un esquema de contracts sin regenerar el OpenAPI falla en `openapi-drift`.

### T8 · Documentación y DX `S`

- [ ] Scripts raíz: `dev` (API + web en paralelo con `pnpm -r --parallel --filter api --filter web dev`), `db:up`/`db:down`.
- [ ] `README.md`: sección de arquitectura de la Etapa 2, levantar el entorno en 3 comandos y diagrama de los apps y paquetes.
- [ ] `CLAUDE.md`: comandos nuevos, estructura hexagonal, regla de contracts y leer la doc de Next/Nest antes de codear.
- [ ] `docs/README.md` y `docs/12`: enlazar este plan y docs/20.
- [ ] Marcar SP1 como "Done" en Notion y abrir el spec de SP2.

---

## Fuera de alcance de SP1

- Cualquier tabla de negocio (tenants, usuarios y productos son de SP2 y SP3).
- Auth: `/login` es solo un placeholder.
- Cambios en `apps/mobile` más allá de resolver `@monaco/domain` desde `dist`.
- Deploy público (SP4).
