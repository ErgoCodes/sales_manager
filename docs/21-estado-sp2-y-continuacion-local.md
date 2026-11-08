# 21 · Estado de SP2 y cómo continuar en local

**Fecha: 2026-11-05.** Punto de traspaso desde las sesiones en la nube al desarrollo local. Junto con el [plan de la Etapa 2](20-plan-etapa2.md), el [spec de SP2](superpowers/specs/2026-11-05-sp2-identidad-tenancy-design.md) y el [plan de SP2](superpowers/plans/2026-11-05-sp2-identidad-tenancy.md), este es el punto de partida para retomar el trabajo.

## Dónde estamos

- **SP1 (Fundaciones): completo y en `main`** (PRs #21–#28). CI en verde en `main`, incluidos `docker build` y los tests de integración.
- **Spec de SP2: en `main`** (PR #29), con la revisión de seguridad incorporada.
- **SP2 en curso.** Cada tarea vive en su propia rama `claude/wonderful-rubin-0wnoi9-sp2-tN`, con PR contra `main`.

| Tarea | Estado | Rama / PR | Notas |
|---|---|---|---|
| Plan de SP2 | Hecho | Viaja con el PR de T1 | `docs/superpowers/plans/2026-11-05-sp2-identidad-tenancy.md` |
| T1 · Esquema IAM en Postgres | Mergeado en `main` | `…-sp2-t1` · [#30](https://github.com/ErgoCodes/sales_manager/pull/30) | Mergeado |
| T2 · Dominio IAM + contratos | Mergeado en `main` | `…-sp2-t2` · [#31](https://github.com/ErgoCodes/sales_manager/pull/31) | Mergeado |
| T3 · Autenticación en la API | Completo, fixes de seguridad aplicados | `…-sp2-t3` | Re-verificado: 89/89 tests de integración pasando |
| T4 · API de administración | Sin empezar | — | Depende de T3 |
| T5 · CLI `tenant:create` + seed demo | Sin empezar | — | Depende de T4 |
| T6 · Sesión web (BFF), CSRF, CSP | Sin empezar | — | Depende de T3; puede ir en paralelo con T4 |
| T7 · Back-office web | Sin empezar | — | Depende de T4 y T6 |
| T8 · E2E Playwright + cierre de docs | Sin empezar | — | Depende de T5 y T7 |

El estado vivo de cada tarea está en Notion: proyecto «Mercado Mónaco — Plataforma multi-negocio», tareas `SP2·T1` a `SP2·T8`.

## Pendiente inmediato (en este orden)

1. ~~**Revisar y mergear #30 y luego #31.**~~ Mergeados en `main`.
2. ~~**Cerrar T3.**~~ Fixes aplicados y verificados:
   - **[RESUELTO] Carrera en revocación de familia de refresh:** Serialización con bloqueo de fila de dispositivo (`FOR NO KEY UPDATE`) en rotaciones y revocaciones (`ba272a8`), más test concurrente de integración.
   - **[RESUELTO] Contraseña temporal vencida:** Rechazo explícito si `mustChangePassword && passwordExpiresAt <= now` (`09e6ce6`).
   - **[RESUELTO] Rate limit e IPv6:** Clave agrupada por `/64` e índice en `rate_limits.window_expires_at` (`282db3d`).
   - 89/89 tests de integración y 356 tests unitarios pasando.
3. **Seguir con T4** (y T6 en paralelo), según el plan de SP2.

## Lo que hay que saber de T1–T3

- **Roles de Postgres** (ADR 0003):
  - `monaco_app` es el rol de runtime. RLS se le aplica siempre: sin `BYPASSRLS` y con `FORCE` en todas las tablas.
  - `monaco_owner` corre las migraciones.
  - `monaco_auth` (`NOLOGIN BYPASSRLS`) solo es dueño de las funciones `SECURITY DEFINER`: `auth_lookup_user`, `auth_lookup_refresh` y `rate_limit_hit`.
  - `monaco_auth` lo crea `infra/postgres/init.sql` como superusuario, porque una migración no puede crearlo. Si falta, la migración `0002` falla a propósito.
- **UUIDv7 se genera en la aplicación** (`apps/api/src/infrastructure/db/uuidv7.ts`): Postgres 17 no tiene `uuidv7()`. Los inserts en SQL crudo (seeds, tests) tienen que pasar el `id`.
- **Toda tabla nueva de un tenant** necesita:
  - `tenant_id`;
  - `UNIQUE (id, tenant_id)` si otras tablas la referencian, y FK compuestas hacia sus padres;
  - la política de `tenancy.ts`;
  - `FORCE ROW LEVEL SECURITY` en una migración manual, porque drizzle-kit no lo genera.

  Los tests de guardas fallan si falta alguna de estas cosas.
- **Agregar un permiso:** se agrega en `PERMISSIONS` (`packages/contracts`) y se genera una migración, porque el CHECK de `role_permissions` sale del catálogo y un test detecta si divergen. Hay que revisar también los roles de sistema (`SYSTEM_ROLES`).
- **Autorización** (ADR 0005):
  - El caso de uso es la autoridad: llama a `can()` y después a `assertNoEscalation(...)` con el `kind` que corresponda (`create_role`, `update_role` con `hasLocationScopedAssignments`, `replace_assignments`, `disable_user`, `reset_password`, `update_user`).
  - `canManageDevicesOf(actor, targetAssignments)`.
  - Los errores de dominio se mapean así: `ForbiddenEscalation` → 403, `OwnerInvariantViolation`/`SystemRoleImmutable`/`RoleInUse` → 409, `InvalidScope` → 422.
- **Autenticación** (ADR 0004, rama T3):
  - Access JWT EdDSA de 10 min. Refresh opaco con rotación, ventana de gracia de 10 s que solo da access, y detección de reuso que revoca la familia.
  - `AuthGuard` global, que verifica usuario, dispositivo y familia en cada petición. Las rutas públicas llevan `@Public()`.
  - Los repositorios IAM solo se usan dentro de `TenantUnitOfWork`.
  - IP del cliente firmada por el BFF (`x-monaco-client-ip`).
  - Rate limit con store en Postgres.
- **Para T4:** poner `@UseGuards(ThrottlerGuard)` en `POST /users`. Tomar el mutex por tenant (`SELECT … FROM tenants … FOR UPDATE`) antes de `assertOwnerInvariant`; `monaco_app` solo tiene `UPDATE (name)` sobre `tenants`, que alcanza para el lock.
- **Para T6:** firmar la IP con el mismo algoritmo que `signClientIp` de la API, usando el `CLIENT_IP_HMAC_SECRET` compartido.

## Puesta en marcha local

Requisitos: Node 24, pnpm 11 (`corepack enable`) y Docker.

```bash
pnpm install
```

```bash
cp apps/api/.env.example apps/api/.env
```

```bash
cp apps/web/.env.example apps/web/.env.local
```

Desde T3 la API no arranca sin claves. Genera las de desarrollo y pega `JWT_PRIVATE_JWK` y `CLIENT_IP_HMAC_SECRET` en `apps/api/.env`. Pon el mismo `CLIENT_IP_HMAC_SECRET` en `apps/web/.env.local` cuando llegue T6.

```bash
pnpm --filter api keys:generate
```

```bash
pnpm db:up
```

```bash
pnpm db:migrate
```

```bash
pnpm dev
```

La API corre en `:4000` (Swagger en `/docs`) y la web en `:3000`.

**Si ya tenías Postgres de SP1 en local:** `init.sql` solo corre cuando el volumen se crea por primera vez. Recrea el volumen (`docker compose -f infra/docker-compose.yml down -v`) o ejecuta `infra/postgres/init.sql` a mano como superusuario antes de migrar; sin `monaco_auth`, la migración `0002` falla.

Verificación completa (la misma que CI):

```bash
pnpm lint && pnpm typecheck && pnpm test:coverage
```

```bash
pnpm --filter api test:integration
```

```bash
pnpm openapi:generate && pnpm --filter web api:generate && git diff --exit-code -- packages/contracts/openapi.json apps/web/src/lib/api/schema.d.ts
```

## Cómo se trabajó (para seguir igual)

- Por cada tarea del plan: un agente implementa en su rama, después **otro agente revisa código y seguridad**, y solo con `VERDICT: PASS` se abre el PR contra `main`. Los hallazgos menores baratos se aplican antes de abrir el PR.
- Las instrucciones para los agentes están en `docs/superpowers/agent-workflow/`: `brief-implementador.md` y `brief-revisor.md`.
- Modelos usados según el riesgo de la tarea:
  - Opus para seguridad y arquitectura (DB y RLS, autenticación, reglas de escalada, revisiones de seguridad);
  - Sonnet para tareas acotadas;
  - Haiku para documentación.
- Conviene abrir los PRs **contra `main`** y mergearlos en orden. Apilarlos sobre la rama anterior, como se hizo al principio de SP1, hace que algunos merges caigan en ramas intermedias.

## Deudas y riesgos conocidos

- Zod fijado en `~4.4.3`: desde la 4.5 falla `cleanupOpenApiDoc` de nestjs-zod (ADR 0002). Subirlo cuando nestjs-zod lo soporte.
- `react`/`react-dom` 19.1.0 fijados en la raíz para que el linker hoisted no mezcle el React de mobile con el de la web (`CLAUDE.md`). Es frágil si cambian esas versiones.
- La web todavía no tiene componentes shadcn instalados; se agregan en T7 con `pnpm dlx shadcn add …`.
- `jose` 6 es solo ESM y la API compila a CJS: funciona con Node ≥ 22.12 (`require(esm)`). Hay que mantener Node 24.
- La IP firmada se puede repetir dentro de 30 s en el mismo endpoint. Es un riesgo aceptado (ADR 0004).
- Mobile tiene 9 warnings de lint que ya existían antes de la Etapa 2.
