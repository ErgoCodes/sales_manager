# SP2 · Identidad y tenancy — diseño

> Spec del sub-proyecto SP2 de la Etapa 2. Parte del [spec de la Etapa 2](2026-07-11-etapa2-plataforma-multinegocio-design.md) (decisiones de auth y RBAC) y de lo construido en SP1 (`apps/api` hexagonal, `withTenant` + RLS, `packages/contracts`, `apps/web`). Calendario y gate de salida en [docs/20](../../20-plan-etapa2.md). El plan tarea por tarea se escribe después de aprobar este spec.

## Objetivo

Que un negocio (tenant) exista con sus puntos de venta, usuarios y roles, y que cada petición a la API esté autenticada, aislada por tenant y autorizada por *permiso + punto*. Todo se gestiona desde la web. Mobile no entra en SP2: su login llega en SP4.

## Decisiones

| Tema | Decisión | Por qué |
|---|---|---|
| Identidad | Cada usuario pertenece a **un solo tenant** (`users.tenant_id`). El email es único globalmente | Simplifica el login y el aislamiento. Un usuario en varios negocios queda fuera de alcance; el modelo permite agregarlo después con una tabla de membresías |
| Búsqueda previa al login | Función `auth_lookup_user(email)` con `SECURITY DEFINER`, propiedad de `monaco_owner`. Devuelve solo `id`, `tenant_id`, `password_hash` y `status`, y es lo único que `monaco_app` puede ejecutar sin tenant | Antes del login no hay tenant, así que RLS bloquearía la búsqueda. Una puerta explícita y auditable es mejor que darle `BYPASSRLS` a la app |
| Contraseñas | argon2id (`@node-rs/argon2`) con parámetros OWASP (m=19 MiB, t=2, p=1). Mínimo 12 caracteres y sin tope de complejidad | Estándar actual |
| Access token | JWT **EdDSA (Ed25519)** con `jose`, 10 min. Claims: `sub`, `tid`, `did` (dispositivo), `sid` (familia de refresh), `iat`, `exp`, `iss`, `aud`. Clave por env y `kid` para rotarla | Asimétrico: en el futuro se puede verificar sin compartir el secreto. Corto: revocar el refresh corta el acceso en ≤10 min |
| Permisos en el token | **No.** Se resuelven en cada petición desde la DB (una consulta indexada) | Revocar un rol tiene efecto inmediato, sin versionar tokens. Si hace falta, se agrega caché en memoria por `(user, authz_version)` |
| Refresh token | Opaco, 32 bytes aleatorios. En la DB solo se guarda su **SHA-256**. Rotativo: cada uso emite uno nuevo y marca el anterior. **Detección de reuso**: presentar uno ya rotado revoca toda la familia (`sid`) y registra un evento de seguridad. Vence a los 30 días sin uso y a los 90 días como máximo | Lo que recomienda OAuth 2.0 Security BCP para clientes públicos |
| Dispositivo | Cada login crea o reusa un `device` (web: uno por navegador, identificado por una cookie `device_id`). Un dispositivo tiene una familia de refresh activa. El usuario y el owner pueden ver y revocar dispositivos | "Refresh por dispositivo, revocable", del spec de la Etapa 2 |
| Sesión web | **BFF**: el navegador nunca ve los tokens. Next guarda access y refresh en cookies `httpOnly`, `Secure`, `SameSite=Lax`, con `__Host-` como prefijo. Las Server Actions y los Server Components llaman a la API con el access token y lo refrescan del lado del servidor | Sin tokens en JS, el XSS no puede robarlos. Las Server Actions de Next ya verifican el `Origin` (CSRF) |
| Contexto de tenant | `AuthGuard` verifica el JWT y arma un `Actor` (`userId`, `tenantId`, `deviceId`). Los casos de uso reciben `Actor` y trabajan con un puerto `TenantUnitOfWork`, cuyo adaptador es `withTenant(actor.tenantId)`. **Ningún repositorio puede usarse fuera de una unidad de trabajo** | RLS se aplica por diseño, no por disciplina |
| Autorización | El catálogo de permisos vive en `packages/contracts` (`PERMISSIONS`, enum Zod), porque la web también lo usa para ocultar UI. La regla `can(effective, permission, locationId?)` es una función pura en `apps/api/src/modules/iam/domain`. Cada caso de uso llama a `authorize(actor, permission, location?)` **antes** de tocar datos. Un decorador `@RequirePermission` en el controller hace un chequeo grueso temprano, pero la autoridad es el caso de uso | Cumple el "permiso + punto, nunca el nombre del rol" del spec de la Etapa 2 |
| Alcance de una asignación | `scope = 'tenant'` o `scope = 'locations'` con una lista de puntos. Los permisos efectivos son la unión de las asignaciones. Un permiso de alcance tenant vale para cualquier punto | Modelo del spec de la Etapa 2 |
| Owner protegido | Invariante de dominio: cada tenant tiene ≥1 usuario **activo** con el rol Owner de sistema en alcance tenant. Se aplica en el caso de uso con `SELECT … FOR UPDATE` sobre las asignaciones de owner, dentro de la misma transacción. Los roles de sistema (Owner, Manager, Cashier) no se pueden borrar, y el rol Owner no se puede editar | Evita carreras entre dos owners que se quitan el rol a la vez |
| Alta de usuarios | Sin email transaccional. Quien tiene `users:manage` crea al usuario con una contraseña temporal, que se comunica fuera de banda. El usuario queda con `must_change_password` y no puede hacer nada más hasta cambiarla | No depende de un servicio de email. Queda listo para cambiarse por invitaciones en el futuro |
| Alta de tenants | Sin registro público. Comando `pnpm --filter api tenant:create` (CLI con `monaco_owner`) y seed `pnpm --filter api db:seed` con el tenant demo | Alcance del spec de la Etapa 2 |
| Rate limiting | `@nestjs/throttler` en `/auth/*`: por IP y por email (10 intentos / 15 min). Errores genéricos, sin enumerar usuarios: el mismo mensaje y una verificación argon2 contra un hash dummy si el email no existe | OWASP ASVS V2 |
| Auditoría | Tabla `audit_events` (append-only, con RLS), por tenant: login ok/fallido, reuso de refresh, revocaciones, cambios de roles, asignaciones y usuarios. `monaco_app` solo puede hacer `INSERT` y `SELECT` sobre ella | Lo pide la trazabilidad de seguridad. También da material para el dashboard |

## Modelo de datos (Postgres)

Todas las tablas usan PK UUIDv7, llevan `tenant_id uuid not null` y la política de aislamiento de SP1 con `FORCE`, salvo que se indique otra cosa. Los timestamps son `timestamptz`.

| Tabla | Columnas clave | Notas |
|---|---|---|
| `tenants` | `id`, `name`, `slug` (único), `created_at` | Política propia: `id = app.tenant_id`. Se crean desde la CLI (owner) |
| `locations` | `id`, `tenant_id`, `name`, `code` (único por tenant), `archived_at` | Se archiva en lugar de borrar: SP3 cuelga stock y ventas de acá |
| `users` | `id`, `tenant_id`, `email` (`citext`, único global), `display_name`, `password_hash`, `status` (`active`/`disabled`), `must_change_password`, `authz_version`, `created_at` | `password_hash` nunca sale del adaptador |
| `roles` | `id`, `tenant_id`, `key` (`owner`/`manager`/`cashier` para los de sistema, null para los custom), `name`, `is_system` | Único `(tenant_id, name)` |
| `role_permissions` | `role_id`, `permission`, `tenant_id` | `permission` validado contra el catálogo en la aplicación y con un `CHECK` generado desde contracts |
| `role_assignments` | `id`, `tenant_id`, `user_id`, `role_id`, `scope` (`tenant`/`locations`) | |
| `role_assignment_locations` | `assignment_id`, `location_id`, `tenant_id` | Solo si el alcance es `locations`. FK compuesta con `tenant_id` para impedir referencias entre tenants |
| `devices` | `id`, `tenant_id`, `user_id`, `label`, `platform` (`web`/`android`/`ios`), `created_at`, `last_seen_at`, `revoked_at` | |
| `refresh_tokens` | `id`, `tenant_id`, `device_id`, `family_id`, `token_hash` (único), `expires_at`, `absolute_expires_at`, `rotated_at`, `revoked_at`, `revoked_reason` | Índice en `token_hash`. La rotación se resuelve en la misma transacción con `FOR UPDATE` |
| `audit_events` | `id`, `tenant_id`, `actor_user_id`, `type`, `target_type`, `target_id`, `metadata jsonb`, `ip`, `created_at` | Sin `UPDATE` ni `DELETE` para `monaco_app` |

**Refresh sin tenant:** igual que el login, `POST /auth/refresh` no tiene tenant antes de leer el token. Se resuelve con otra función `SECURITY DEFINER`, `auth_lookup_refresh(token_hash)`, que devuelve `tenant_id`, `device_id`, `family_id` y el estado. Después sigue todo dentro de `withTenant`. Las dos funciones tienen tests propios (qué columnas devuelven, que no hay inyección y que solo `monaco_app` puede ejecutarlas).

## Catálogo de permisos (v1)

`tenant:manage` · `locations:manage` · `users:manage` · `roles:manage` · `devices:manage` · `audit:view` · `catalog:write` · `inventory:write` · `inventory:transfer` · `sales:create` · `sales:void` · `reports:view` · `cash:close`

Los de catálogo, inventario, ventas y caja se declaran ya para que los roles por defecto queden completos, aunque sus endpoints lleguen en SP3–SP5. Agregar un permiso es un cambio de código con migración de datos para los roles de sistema.

| Rol de sistema | Alcance por defecto | Permisos |
|---|---|---|
| Owner | tenant | Todos |
| Manager | locations | `catalog:write`, `inventory:*`, `sales:*`, `reports:view`, `cash:close`, `devices:manage` (solo dispositivos de usuarios de sus puntos) |
| Cashier | locations (uno) | `sales:create`, `reports:view` (limitado a su propio cierre, que se define en SP4), `cash:close` |

## API (REST, contratos en `packages/contracts`)

| Método y ruta | Permiso | Notas |
|---|---|---|
| `POST /auth/login` | público | `{ email, password, device? }` → access, refresh y `deviceId`. Rate limited |
| `POST /auth/refresh` | público | Rota el token; si detecta reuso, revoca la familia y devuelve 401 |
| `POST /auth/logout` | autenticado | Revoca la familia del dispositivo actual |
| `POST /auth/password` | autenticado | Cambio de contraseña (obligatorio si `must_change_password`). Revoca los demás dispositivos |
| `GET /me` | autenticado | Usuario, tenant y permisos efectivos (con alcance), para la UI |
| `GET/POST/PATCH /locations`, `POST /locations/:id/archive` | `locations:manage` (lectura: cualquier autenticado, filtrada por alcance) | |
| `GET/POST/PATCH /users`, `POST /users/:id/disable`, `POST /users/:id/reset-password` | `users:manage` | Desactivar o resetear revoca todos los dispositivos del usuario |
| `GET/POST/PATCH/DELETE /roles` | `roles:manage` | No se pueden borrar ni editar los roles de sistema donde aplique; un rol en uso no se puede borrar |
| `PUT /users/:id/assignments` | `users:manage` + `roles:manage` | Reemplaza las asignaciones de forma atómica y valida la invariante de owner |
| `GET /devices`, `POST /devices/:id/revoke` | propios: autenticado; ajenos: `devices:manage` | |
| `GET /audit-events` | `audit:view` | Paginado con cursor (`Paginated`) |

Los errores usan `ErrorResponse`: `401` (no autenticado o token inválido), `403` (sin permiso, mensaje genérico) y `409` (invariante: último owner, rol en uso). Un recurso de otro tenant devuelve `404`, nunca `403`, para no confirmar que existe.

## Web (`apps/web`, UI en español)

- **Login** y **cambio de contraseña obligatorio**. La sesión vive en cookies `httpOnly`, administradas por un módulo `server-only` (`lib/session`). `proxy.ts` (Next 16) redirige a `/login` si no hay sesión; la validación real la hace la API.
- **Back-office:** puntos de venta, usuarios (alta con contraseña temporal, desactivar, reset), roles (matriz de permisos con agrupación legible), asignaciones (rol + alcance por puntos), dispositivos y auditoría.
- La UI oculta acciones según `GET /me`, pero eso es solo UX: la autoridad es la API.
- **CSP con nonce:** la difirió SP1 y se cierra acá, ahora que hay formularios con datos sensibles.

## Fuera de alcance de SP2

- Login de mobile, almacenamiento seguro en el dispositivo y cache offline de permisos: SP4 y SP5.
- Usuarios en varios tenants, SSO, MFA, recuperación de contraseña por email e invitaciones.
- Caché de permisos efectivos (solo si las mediciones lo justifican).

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Las funciones `SECURITY DEFINER` son la única puerta sin tenant: si están mal escritas, filtran datos | `search_path` fijado en la función, devuelven el mínimo de columnas, `EXECUTE` solo para `monaco_app`, y tests de integración dedicados que también prueban que no devuelven datos de más |
| Carreras en la rotación del refresh (dos pestañas refrescando a la vez) | `FOR UPDATE` en la fila del token. Hay una ventana de gracia de 10 s en la que el token recién rotado devuelve el mismo par nuevo en lugar de contarse como reuso. Se documenta y se testea |
| Bloquearse fuera del tenant (último owner) | Invariante transaccional con `FOR UPDATE` y tests de concurrencia |
| Clave JWT filtrada o rotada | `kid` en el header y un JWKS en memoria con la clave actual y la anterior. Procedimiento de rotación en un ADR |
| Romper la frontera hexagonal por apuro | Las reglas de lint de SP1 se extienden al módulo `iam`. `can()` y la invariante de owner tienen tests unitarios puros |

## Entregables de documentación

- ADR 0004 · Autenticación (JWT EdDSA, refresh rotativo con detección de reuso, BFF web).
- ADR 0005 · Autorización (permisos en código, roles por tenant, alcance, autoridad en el caso de uso).
- Actualizar ADR 0003 con las funciones `SECURITY DEFINER` y las FK compuestas con `tenant_id`.

## Gate de salida (de docs/20, detallado)

- Login web con refresh rotativo por dispositivo. Un refresh reusado revoca la familia, con test.
- Un owner crea puntos, usuarios, roles custom y asignaciones con alcance desde la web. Un cashier de un punto recibe 403 al intentar acciones de otro punto, y 404 en recursos de otro tenant.
- Quitar el último owner da 409, también bajo concurrencia, con test.
- Toda tabla nueva pasa el guard de RLS + FORCE de SP1. Un test de integración demuestra que un usuario del tenant A no puede leer ni escribir datos del tenant B por ningún endpoint.
- La CSP con nonce está activa en la web.
- El seed demo (1 tenant, 2 puntos, owner, manager y cashier) funciona con `pnpm --filter api db:seed`.
