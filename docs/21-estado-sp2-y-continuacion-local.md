# 21 · Estado de SP2 y cómo continuar en local

**Fecha: 2026-11-05.** Punto de traspaso desde las sesiones en la nube al desarrollo local. Junto con el [plan de la Etapa 2](20-plan-etapa2.md), el [spec de SP2](superpowers/specs/2026-11-05-sp2-identidad-tenancy-design.md) y el [plan de SP2](superpowers/plans/2026-11-05-sp2-identidad-tenancy.md), este es el punto de partida para retomar el trabajo.

## Dónde estamos

- **SP1 (Fundaciones): completo y en `main`** (PRs #21–#28). CI en verde en `main`, incluidos `docker build` y los tests de integración.
- **Spec de SP2: en `main`** (PR #29), con la revisión de seguridad incorporada.
- **SP2 (Identidad y tenancy): completo y en `main`** (PRs #30–#39). CI en verde en `main`, incluido el job `e2e`. Cada tarea vivió en su propia rama `claude/wonderful-rubin-0wnoi9-sp2-tN`, con PR contra `main`.

| Tarea | Estado | Rama / PR | Notas |
|---|---|---|---|
| Plan de SP2 | Hecho | Viaja con el PR de T1 | `docs/superpowers/plans/2026-11-05-sp2-identidad-tenancy.md` |
| T1 · Esquema IAM en Postgres | Mergeado en `main` | `…-sp2-t1` · [#30](https://github.com/ErgoCodes/sales_manager/pull/30) | Mergeado |
| T2 · Dominio IAM + contratos | Mergeado en `main` | `…-sp2-t2` · [#31](https://github.com/ErgoCodes/sales_manager/pull/31) | Mergeado |
| T3 · Autenticación en la API | Mergeado en `main` | `…-sp2-t3` · [#34](https://github.com/ErgoCodes/sales_manager/pull/34) | Mergeado |
| T4 · API de administración | Mergeado en `main` | `…-sp2-t4` · [#35](https://github.com/ErgoCodes/sales_manager/pull/35) | Verificado: 44 suites unitarias y 14 suites de integración (132 tests) pasando |
| T5 · CLI `tenant:create` + seed demo | Mergeado en `main` | `…-sp2-t5` · [#36](https://github.com/ErgoCodes/sales_manager/pull/36) | `db:seed` crea el tenant `demo` (2 puntos, owner, manager y cashier) |
| T6 · Sesión web (BFF), CSRF, CSP | Mergeado en `main` | `…-sp2-t6` · [#37](https://github.com/ErgoCodes/sales_manager/pull/37) | Cookies `__Host-`, refresh con single-flight, CSP con nonce |
| T7 · Back-office web | Mergeado en `main` | `…-sp2-t7` · [#38](https://github.com/ErgoCodes/sales_manager/pull/38) | Puntos de venta, usuarios, roles, asignaciones, dispositivos y auditoría |
| T8 · E2E Playwright + cierre de docs | Mergeado en `main` | `…-sp2-t8` · [#39](https://github.com/ErgoCodes/sales_manager/pull/39) | Cinco flujos e2e pasando en local; el job `e2e` pasa en CI |

El estado vivo de cada tarea está en Notion: proyecto «Mercado Mónaco — Plataforma multi-negocio», tareas `SP2·T1` a `SP2·T8`.

## Pendiente inmediato (en este orden)

1. ~~**Revisar y mergear #30 y luego #31.**~~ Mergeados en `main`.
2. ~~**Cerrar T3.**~~ Mergeado en `main` (#34) tras aplicar y verificar fixes de seguridad:
   - **[RESUELTO] Carrera en revocación de familia de refresh:** Serialización con bloqueo de fila de dispositivo (`FOR NO KEY UPDATE`) en rotaciones y revocaciones (`ba272a8`), más test concurrente de integración.
   - **[RESUELTO] Contraseña temporal vencida:** Rechazo explícito si `mustChangePassword && passwordExpiresAt <= now` (`09e6ce6`).
   - **[RESUELTO] Rate limit e IPv6:** Clave agrupada por `/64` e índice en `rate_limits.window_expires_at` (`282db3d`).
   - 89/89 tests de integración y 356 tests unitarios pasando.
3. ~~**Implementar y cerrar T4.**~~ Módulos administrativos (`locations`, `users`, `roles`, `assignments`, `devices`, `audit-events`), `DrizzleAdminUnitOfWork`, mapeo de errores de dominio/Postgres, rate limit en `POST /users`, tests de integración de aislamiento cross-tenant, no escalada, alcance por puntos y último Owner concurrente, más fix de seguridad:
   - **[RESUELTO] Verdad vacua en alcance con ubicaciones archivadas:** `shortfall` y `canManageDevicesOf` exigen `scope.locationIds.length > 0` para que una asignación cuyas ubicaciones fueron todas archivadas solo pueda ser cubierta por alcance `tenant`.
4. ~~**T5 y T6.**~~ Completos (#36 y #37).
5. ~~**T7 y T8.**~~ Mergeados en `main` (#38 y #39); el job `e2e` pasa en CI.
6. ~~**Marcar SP2 como completo en Notion.**~~ Hecho.

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

### E2E (Playwright)

Corre contra la API real y un build de producción de la web, con una base de datos propia (`monaco_e2e`) que se recrea en cada ejecución; nunca toca la base `monaco` de desarrollo. Necesita un Postgres con superusuario, indicado en `E2E_PG_ADMIN_URL` (por defecto `postgres://postgres:postgres@127.0.0.1:55432/postgres`).

```bash
docker run -d --name monaco-e2e-pg -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55432:5432 postgres:17-alpine
```

```bash
pnpm --filter web exec playwright install chromium
```

```bash
pnpm --filter web test:e2e
```

`test:e2e` primero prepara el entorno (`apps/web/e2e/prepare.mjs`: base de datos, `init.sql`, migraciones, seed demo, secretos efímeros y build de la web; deja todo en `apps/web/e2e/.runtime/`, ignorado por git) y después lanza Playwright, que levanta la API (`:4180`) y la web (`:3180`; cambian con `E2E_API_PORT` y `E2E_WEB_PORT`). Las cookies `__Host-` y `Secure` funcionan sin HTTPS porque Chromium trata `http://localhost` como contexto seguro: no se desactiva ninguna protección. Las credenciales demo salen del propio módulo del seed. Al terminar, `docker rm -f monaco-e2e-pg`.

Flujos cubiertos: alta de punto y usuario con asignación (owner); login del usuario nuevo con cambio de contraseña obligatorio; el cashier solo ve su punto y recibe 403 en acciones administrativas (la negativa por alcance de puntos con permiso la cubre el test de integración `admin-isolation`); logout con revocación inmediata; refresh reusado que cierra la sesión.

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
- `jose` 6 es solo ESM y la API compila a CJS: funciona con Node ≥ 22.12 (`require(esm)`). Hay que mantener Node 24.
- La IP firmada se puede repetir dentro de 30 s en el mismo endpoint. Es un riesgo aceptado (ADR 0004).
- Mobile tiene 9 warnings de lint que ya existían antes de la Etapa 2.
