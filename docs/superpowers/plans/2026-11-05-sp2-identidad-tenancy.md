# SP2 · Identidad y tenancy: plan de implementación

> **Para agentes:** el diseño completo y sus reglas de seguridad están en el [spec de SP2](../specs/2026-11-05-sp2-identidad-tenancy-design.md). **Ese spec manda**: este plan solo ordena el trabajo y define el "Hecho cuando" de cada tarea. Antes de escribir código hay que consultar la doc vigente de NestJS, Drizzle, `jose`, `@node-rs/argon2`, `@nestjs/throttler` y Next 16 (`node_modules/next/dist/docs/`). Las fronteras hexagonales y el patrón del módulo `health` son de SP1 (ADR 0001); el aislamiento, de ADR 0003. Cada tarea va en un PR contra `main` con CI en verde.

**Gate de salida:** el del spec de SP2 (sección "Gate de salida").

**Orden y paralelismo**

```
T1 (DB) ─┐
         ├─> T3 (auth API) ─┬─> T4 (admin API) ─┬─> T5 (CLI + seed) ─┐
T2 (IAM) ┘                  └─> T6 (web BFF) ───┴─> T7 (web admin) ──┴─> T8 (e2e + docs)
```

---

### T1 · Esquema IAM y puertas de autenticación en Postgres `L` · `Difícil`

- [ ] Migraciones para `tenants`, `locations`, `users` (`citext`), `roles`, `role_permissions`, `role_assignments`, `role_assignment_locations`, `devices`, `refresh_tokens` y `audit_events`, según el modelo de datos del spec: UUIDv7, `tenant_id`, política + `FORCE` (la de `tenants`, por `id`), `UNIQUE (id, tenant_id)` y FK compuestas.
- [ ] Privilegios de `monaco_app`: DML por tabla, y en `audit_events` solo `INSERT` y `SELECT`.
- [ ] El rol `monaco_auth` (`NOLOGIN BYPASSRLS`) en `init.sql` y en una migración idempotente para entornos ya creados. Las funciones `auth_lookup_user(email)` y `auth_lookup_refresh(token_hash)` llevan `SECURITY DEFINER` y `SET search_path`, no conceden `EXECUTE` a PUBLIC y se lo conceden a `monaco_app`.
- [ ] Esquema Drizzle en `apps/api/src/infrastructure/db/schema/` y retiro de `_tenancy_probe` (ya no hace falta). El test de SP1 que exige `FORCE` en las migraciones sigue en verde.
- [ ] Tests de integración nuevos:
  - el guard de RLS + FORCE cubre todas las tablas;
  - las FK compuestas impiden referenciar filas de otro tenant;
  - para las funciones: dueño `monaco_auth`, sin `EXECUTE` para PUBLIC, igualdad exacta (un `%` no hace match), devuelven como mucho una fila y solo las columnas mínimas;
  - ningún rol de login tiene `BYPASSRLS`;
  - `monaco_app` no puede hacer `UPDATE` ni `DELETE` en `audit_events`.
- [ ] Actualizar ADR 0003 con `monaco_auth`, las funciones y sus riesgos aceptados, y las FK compuestas.

**Hecho cuando:** las migraciones aplican sobre una DB limpia y sobre una con el esquema de SP1, y todos los tests de arriba pasan en `test:integration`.

### T2 · Dominio IAM y contratos `M` · `Media` (en paralelo con T1)

- [ ] `packages/contracts`: `PERMISSIONS` (catálogo v1 del spec) como `const` y enum Zod, y la lista de **permisos administrativos** (solo con alcance tenant). Esquemas de request y response para `auth/*`, `me`, `locations`, `users`, `roles`, `assignments`, `devices` y `audit-events`, todos con `.meta({ id })`. Las contraseñas tienen mínimo 12 caracteres.
- [ ] `apps/api/src/modules/iam/domain/` (puro, sin Nest ni Drizzle):
  - `can(effective, permission, locationId?)`;
  - `effectivePermissions(assignments)`;
  - `assertNoEscalation(actor, requested)`, que valida permisos y alcance, operaciones solo de Owner, la prohibición de editar las propias asignaciones y los permisos administrativos solo en alcance tenant;
  - `assertOwnerInvariant(state)`;
  - las definiciones de los roles de sistema.
- [ ] Tests unitarios exhaustivos de esas reglas, con matriz de casos: Manager que intenta darse Owner, rol custom con permisos ajenos, alcance más amplio que el propio, etc.
- [ ] ADR 0005 · Autorización.

**Hecho cuando:** contracts y el dominio IAM tienen 100% de ramas cubiertas por tests, y el dominio no importa nada de infraestructura (lo vigila la regla de lint de SP1).

### T3 · Autenticación en la API `XL` · `Difícil` (depende de T1 y T2)

- [x] Puerto `TenantUnitOfWork` con adaptador `withTenant`. Ningún repositorio IAM se puede construir fuera de él (por diseño de tipos o con una regla de lint).
- [x] Contraseñas con argon2id y parámetros OWASP. El hash dummy usa los mismos parámetros.
- [x] JWT EdDSA con `jose`: claves por env (JWKS local con la actual y la anterior, y `kid`), validaciones fijas según el spec y un script `keys:generate` para dev. `.env.example` sin claves reales; en tests las claves son efímeras.
- [x] Endpoints `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/password` y `GET /me`, con la semántica del spec: dispositivos, rotación, ventana de gracia que solo emite access, reuso que hace commit de la revocación y del audit antes del 401, y logout.
- [x] `AuthGuard` global. Las rutas públicas se marcan explícitamente. En cada petición verifica el estado del usuario, el dispositivo y la familia, y resuelve los permisos efectivos en la misma consulta. Bloquea el resto de las rutas mientras `must_change_password` esté activo.
- [x] Header de IP firmado con HMAC (`CLIENT_IP_HMAC_SECRET`): solo se acepta con firma válida.
- [x] Rate limiting con `@nestjs/throttler` y store en Postgres (tabla sin tenant, solo accesible para `monaco_app` vía función o con su propia política). Límites por (IP, email) y por IP, con backoff progresivo y sin bloqueo duro por email.
- [x] Puerto de auditoría y sus eventos. Los intentos con emails inexistentes van al log estructurado.
- [x] Tests de integración:
  - login, refresh y logout;
  - reuso fuera de la ventana revoca la familia, dentro de la ventana solo da access;
  - revocación inmediata: desactivar al usuario o revocar el dispositivo da 401 en la siguiente petición;
  - el bloqueo de `must_change_password`;
  - el timing del email inexistente queda en el mismo orden que el de una contraseña incorrecta (tolerancia amplia);
  - el rate limit;
  - el header de IP sin firma se ignora.
- [x] ADR 0004 · Autenticación.

**Hecho cuando:** todos esos tests pasan, `/docs` muestra los endpoints de auth, y `openapi.json` y `schema.d.ts` están regenerados y commiteados.

### T4 · API de administración `L` · `Difícil` (depende de T3)

- [x] Módulos hexagonales `locations`, `users`, `roles`, `assignments`, `devices` y `audit`, con los endpoints de la tabla de API del spec.
- [x] Cada caso de uso llama a `authorize(actor, permission, location?)` y aplica `assertNoEscalation` antes de tocar datos.
- [x] Mutex por tenant (`SELECT … FROM tenants … FOR UPDATE`) en toda mutación que pueda afectar a un Owner.
- [x] Desactivar o resetear a un usuario revoca todos sus dispositivos. La contraseña temporal vence a las 72 h.
- [x] Mapeo de errores: 23503 y 23505 pasan a 404 o 409 genéricos; un recurso de otro tenant da 404; sin permiso, 403 genérico; una violación de invariante, 409; un permiso administrativo con alcance de puntos, 422. La creación de usuarios con email duplicado da una respuesta genérica.
- [x] Rate limit en `POST /users`.
- [x] Tests de integración (el corazón del gate):
  - matriz de cross-tenant: el tenant A contra cada endpoint con IDs de B da 404, y B queda intacto;
  - no escalada por cada ruta;
  - último owner por cada ruta, con dos peticiones concurrentes;
  - el alcance por puntos (un cashier del punto 1 recibe 403 en el punto 2);
  - `audit-events` paginado con eventos reales.

**Hecho cuando:** pasan los tests y la cobertura de la API sigue por encima de sus umbrales.

### T5 · CLI de tenants y seed demo `S` · `Fácil` (depende de T4)

- [ ] `pnpm --filter api tenant:create --name … --slug … --owner-email …` usa la conexión de owner. Crea el tenant, los roles de sistema y al owner con una contraseña temporal que se imprime una sola vez.
- [ ] `pnpm --filter api db:seed` es idempotente. Crea el tenant demo con 2 puntos y owner, manager (punto 1) y cashier (punto 1), con contraseñas solo para dev documentadas. **No se puede correr con `NODE_ENV=production`.**
- [ ] Tests de integración de los dos comandos.

**Hecho cuando:** `pnpm db:up && pnpm db:migrate && pnpm --filter api db:seed` deja un login funcional para los tres usuarios demo.

### T6 · Sesión web (BFF) y seguridad `L` · `Difícil` (depende de T3; en paralelo con T4)

- [ ] `apps/web/src/lib/session` (`server-only`):
  - cookies `__Host-` (access `Lax`, refresh `Strict`, `__Host-device_id`);
  - lectura en Server Components;
  - refresh solo en `proxy.ts`, Route Handlers o Server Actions, con single-flight por sesión;
  - anti-fijación en el login;
  - logout que borra las cookies aunque la API falle.
- [ ] Cliente API autenticado: agrega el bearer y el header de IP firmado, y maneja los 401 refrescando una vez.
- [ ] `proxy.ts`: redirige a `/login` sin sesión, y a `/cambiar-contrasena` si `must_change_password` está activo.
- [ ] Páginas `/login` y `/cambiar-contrasena`, con Server Actions y errores genéricos en español.
- [ ] CSRF: `serverActions.allowedOrigins` explícito y verificación de `Origin`/`Sec-Fetch-Site` en todo Route Handler que modifica algo. Ningún GET cambia estado.
- [ ] CSP con nonce (la difirió SP1), según la guía de CSP de Next 16.
- [ ] Tests unitarios del módulo de sesión (single-flight, rotación, borrado de cookies) y del chequeo de `Origin`.

**Hecho cuando:** login, refresh transparente y logout funcionan contra la API real, y la CSP está activa sin romper la app (verificado con `next build && next start`).

### T7 · Back-office web `L` · `Media` (depende de T4 y T6)

- [ ] Componentes shadcn necesarios: tabla, formularios, diálogo, select, checkbox y badge.
- [ ] Pantallas:
  - puntos de venta (crear, editar, archivar);
  - usuarios (alta con contraseña temporal mostrada una sola vez, desactivar, reset);
  - roles (matriz de permisos agrupada, y los de sistema en solo lectura donde corresponda);
  - asignaciones (rol + alcance, con selector de puntos);
  - dispositivos (los propios y los ajenos, con revocar);
  - auditoría (paginada).
- [ ] Navegación y acciones ocultas según `GET /me`. Los 403, 404, 409 y 422 de la API se muestran como mensajes claros en español.
- [ ] Tests de componentes de los formularios críticos (asignaciones y roles).

**Hecho cuando:** un owner del seed hace desde la web todo el flujo del gate (crear punto, usuario, rol custom y asignación) y un cashier no ve las acciones administrativas.

### T8 · E2E y cierre de documentación `M` · `Media` (depende de T5 y T7)

- [ ] Playwright e2e en `apps/web/e2e` (Chromium ya instalado; en CI con Postgres de servicio o Testcontainers):
  - login del owner, alta de un punto y de un usuario, asignación;
  - login del nuevo usuario, cambio de contraseña obligatorio;
  - el cashier recibe 403 en otro punto;
  - logout;
  - un refresh reusado cierra la sesión.
- [ ] Job `e2e` en CI.
- [ ] Actualizar `docs/20` (estado de SP2), `README` (login demo) y `CLAUDE.md` (módulo IAM, cómo agregar un permiso y cómo agregar una tabla de tenant).
- [ ] Marcar SP2 en Notion (lo hace el orquestador).

**Hecho cuando:** el job `e2e` pasa en CI y se cumple cada punto del gate de salida del spec.
