# ADR 0005 · Autorización

- **Estado:** aceptada (2026-11-05)
- **Contexto:** SP2 · T2, `packages/contracts` (`src/iam/`) y `apps/api/src/modules/iam/domain/`. Spec: [SP2](../superpowers/specs/2026-11-05-sp2-identidad-tenancy-design.md). La autenticación se decide en el ADR 0004; el aislamiento entre tenants, en el [ADR 0003](0003-aislamiento-tenants-rls.md).

## Contexto

Cada petición debe autorizarse por **permiso + punto de venta**, nunca por el nombre del rol (spec de la Etapa 2). Además hay un riesgo propio de un sistema con roles editables: quien puede gestionar usuarios y roles podría darse más poder del que tiene, o quedarse con la cuenta de un Owner. Y un tenant no puede quedarse sin Owner. RLS (ADR 0003) separa tenants pero no protege estas reglas, que son del dominio.

## Decisión

### 1. Permisos en código, roles en datos

- El catálogo v1 vive en `packages/contracts` (`PERMISSIONS`, enum Zod `Permission`) porque la web también lo usa para ocultar UI. Agregar un permiso es un cambio de código más una migración de datos para los roles de sistema. Además, el `CHECK` de `role_permissions.permission` es `permission IN (...)` generado desde `PERMISSIONS` (esquema Drizzle, migración 0005 de SP2·T3): al agregar un permiso, `pnpm --filter api db:generate` produce la migración que lo amplía, y `test/integration/auth-db.test.ts` falla mientras la base y el catálogo difieran.
- `ADMIN_PERMISSIONS` (`tenant:manage`, `locations:manage`, `users:manage`, `roles:manage`, `audit:view`) **solo valen con alcance tenant**. `devices:manage` no es administrativo: el Manager lo tiene por punto.
- Los roles pertenecen a un tenant y son conjuntos de permisos. Los de sistema (`owner`, `manager`, `cashier`, en `SYSTEM_ROLES`) se siembran en cada tenant; no se borran, y el Owner tampoco se edita.

### 2. Alcance de una asignación

`AssignmentScope` es `{ type: 'tenant' }` o `{ type: 'locations', locationIds }` (1 a 200 puntos únicos). Los permisos efectivos son la **unión** de las asignaciones, guardada en dos partes: los de alcance tenant (`tenantWide`) y los de cada punto (`byLocation`). Un permiso tenant vale para cualquier punto.

`can(effective, permission, locationId?)` es la única regla de lectura:

- vale si el permiso es tenant-wide;
- si no, solo vale con un `locationId` en el que esté concedido;
- sin `locationId`, un permiso de punto **no** cuenta (para "en algún punto" existe `hasPermissionAnywhere`, pensado para listados filtrados).

Defensa en profundidad: `effectivePermissions` ignora cualquier permiso administrativo que aparezca en una asignación por puntos, aunque la validación ya lo impida.

### 3. Dónde está la autoridad

El caso de uso llama a `authorize(actor, permission, location?)` (sobre `can`) **antes** de tocar datos. `@RequirePermission` en el controller es un chequeo grueso temprano, no la autoridad. Los recursos de otro tenant dan 404 (lo garantiza RLS más las FK compuestas), no 403.

### 4. No escalada de privilegios: `assertNoEscalation`

Una función pura con una unión discriminada `EscalationCheck`, que T4 llama **después** de `authorize` y **antes** de mutar:

| `kind` | Endpoint | Reglas |
|---|---|---|
| `create_role` | `POST /roles` | Cada permiso debe estar en poder del actor con alcance **tenant**. Los permisos solo-Owner exigen un Owner |
| `update_role` | `PATCH /roles/:id` | El rol Owner no se edita (`SystemRoleImmutable`). Si el rol tiene asignaciones por puntos (`hasLocationScopedAssignments`), añadirle un permiso administrativo es `InvalidScope`. Se exige la misma cobertura tenant sobre los permisos **añadidos y quitados** (diferencia simétrica); un cambio de nombre no exige nada |
| `replace_assignments` | `PUT /users/:id/assignments` | Nadie modifica las suyas. Valida alcance (`InvalidScope`). Solo un Owner da o quita Owner, o toca cualquier asignación de un Owner. Cada asignación **añadida o quitada** debe estar cubierta por el actor (permiso y alcance) |
| `disable_user`, `reset_password` | `POST /users/:id/disable`, `/reset-password` | No sobre uno mismo (la contraseña propia se cambia con `/auth/password`, que exige la actual). Un Owner como objetivo exige un Owner. El actor debe cubrir **todo** lo que el objetivo tiene |
| `update_user` | `PATCH /users/:id` | Editarse a uno mismo (p. ej. `displayName`) está permitido. Sobre otro, mismas reglas que disable/reset: solo un Owner edita a un Owner y el actor debe cubrir todo lo que el objetivo tiene |

**Solo-Owner** (`OWNER_ONLY_PERMISSIONS`): `users:manage`, `roles:manage`, `tenant:manage`, `audit:view`. Ni un no-Owner que ya los tenga puede otorgarlos. `locations:manage` es administrativo (solo tenant) pero no solo-Owner, como pide el spec.

**Cobertura** de `permisos` en un `scope`: para cada permiso, el actor lo tiene tenant-wide, o el alcance pedido es por puntos y el actor lo tiene en **cada** uno. Si no lo tiene en ningún sitio, el motivo es `permission_not_held`; si lo tiene en menos alcance, `scope_exceeds`.

Decisiones que van más allá del texto literal del spec, por la misma razón (cerrar la escalada):

- **Roles: cobertura tenant-wide.** Un rol no tiene alcance y se puede asignar en cualquier parte, y editarlo cambia a todos sus titulares. Pedir el permiso solo en algún punto dejaría que un Manager ampliara a otros más allá de su propio alcance.
- **Reset y desactivación exigen cubrir al objetivo.** Un reset es una toma de cuenta: sin esta regla, un admin custom sin `sales:void` podría resetear a un Manager y entrar como él.
- **Solo se comprueba lo que cambia** en un reemplazo de asignaciones. Si no, un admin no podría tocar a un usuario que tiene, además, una asignación fuera de su alcance. A cambio, **quitar** una asignación fuera de alcance también se rechaza.
- `canManageDevicesOf(actor, targetAssignments)` implementa el `devices:manage` sobre dispositivos **ajenos**. Si el objetivo es Owner, solo un Owner puede gestionarlos (aunque otro tenga `devices:manage` tenant-wide; un Owner sobre los suyos entra por ser Owner). Para el Manager: el objetivo no es Owner, tiene asignaciones y todas son por puntos dentro de los puntos donde el actor tiene `devices:manage`. El tenant-wide gestiona a cualquiera.

### 5. Owner protegido

`assertOwnerInvariant(usersAfterChange)`: tras la mutación debe quedar al menos un usuario **activo** con el rol de sistema Owner **con alcance tenant**. T4 toma antes `SELECT 1 FROM tenants WHERE id = $tid FOR UPDATE` en toda mutación que pueda afectar a un Owner (asignaciones, desactivar, resetear, editar o borrar roles), carga los usuarios afectados y llama a la función con el estado resultante. `assertRoleDeletable` (sistema → `SystemRoleImmutable`, en uso → `RoleInUse`) y `assertRoleEditable` completan las reglas de roles.

### 6. Errores tipados y su mapeo HTTP

El dominio lanza errores con `code` estable y sin HTTP; el filtro de la API (T4) los traduce:

| Error | HTTP | Cuándo |
|---|---|---|
| `ForbiddenEscalation` (`reason`: `self_modification`, `owner_only`, `permission_not_held`, `scope_exceeds`) | 403, mensaje genérico; el `reason` va al `audit_event` | `assertNoEscalation` |
| `OwnerInvariantViolation` | 409 | Quedaría un tenant sin Owner activo |
| `SystemRoleImmutable`, `RoleInUse` | 409 | Editar el Owner, borrar un rol de sistema o un rol con asignaciones |
| `InvalidScope` (`reason`) | 422 | Puntos vacíos o repetidos; permiso administrativo con alcance por puntos |

Orden en el caso de uso: `authorize` (403) → existencia/tenant (404) → `assertNoEscalation` (422/403/409) → mutex del tenant → mutación → `assertOwnerInvariant` (409).

**Ajuste de T4 (implementación):** en las mutaciones que toman el mutex (asignaciones, desactivar, resetear, editar y borrar roles), el mutex se toma **al principio** de la transacción, justo después de `authorize`, y la existencia y `assertNoEscalation` se evalúan con el estado leído ya bajo el lock. Las respuestas son las mismas, pero así la escalada se valida contra las asignaciones vigentes y no contra una lectura previa que otra petición concurrente pudo cambiar. El invariante se comprueba releyendo los Owners de la base después de mutar (`AssignmentRepository.ownerCandidates`).

### 7. Contratos y calidad

- Los esquemas de `auth`, `me`, `locations`, `users`, `roles`, `assignments`, `devices` y `audit-events` siguen la convención del [ADR 0002](0002-contratos-zod-openapi.md) (`.meta({ id })`, `Paginated(item, id)`).
- Contraseñas: 12 a 256 caracteres. El tope evita que un cuerpo enorme convierta a argon2 en un vector de DoS; no se imponen reglas de composición.
- La contraseña temporal la **genera el servidor** y se devuelve una sola vez (`CreateUserResponse`, `ResetPasswordResponse`); no se acepta una elegida por el admin.
- `domain/` es TypeScript puro (la regla de lint de fronteras de ADR 0001 ya cubre `src/modules/*/domain/**` y un test de arquitectura lo comprueba para `iam`). Tiene umbral de cobertura del **100%** por carpeta en `vitest.config.mts`, y `packages/contracts` exige 100% de ramas.

### 8. La API de administración (SP2·T4)

- Módulos `locations`, `users`, `roles`, `assignments`, `devices` y `audit` (ADR 0001). Sus repositorios solo los construye `DrizzleAdminUnitOfWork` (`iam/infrastructure`) sobre una `TenantTransaction`, igual que en T3.
- Un `ForbiddenEscalation` revierte la transacción; su `reason` se guarda como `audit_event` `escalation_denied` (con la operación) en una transacción propia (`runAdmin`) y el cliente solo ve un 403 genérico.
- `DELETE /roles/:id` exige, además de `assertRoleDeletable`, poder crear ese rol (`create_role` sobre sus permisos): borrar quita permisos igual que editar.
- `PUT /users/:id/assignments` exige `users:manage` **y** `roles:manage`; un rol o punto desconocido (o de otro tenant) da 404 y un punto archivado también. Los puntos archivados no cuentan en las asignaciones actuales (no otorgan nada).
- Un reset no puede dejar al tenant sin Owner (no cambia estado ni asignaciones); igual toma el mutex y valida el invariante, y el test de concurrencia comprueba que dos resets cruzados entre Owners terminan con ambos activos.
- Mapeo HTTP: `PermissionDenied`/`ForbiddenEscalation` → 403 `FORBIDDEN`; `ResourceNotFound` y el 23503 de una FK compuesta → 404 `NOT_FOUND`; el 23505 → 409 `CONFLICT`; `OwnerInvariantViolation` → 409 `LAST_OWNER`; `SystemRoleImmutable` → 409 `SYSTEM_ROLE_IMMUTABLE`; `RoleInUse` → 409 `ROLE_IN_USE`; `InvalidScope` → 422 `INVALID_SCOPE`. Un email existente en `POST /users` (de cualquier tenant) da 409 `Could not create the user` y un `user_create_conflict`.

## Alternativas descartadas

- **Permisos dentro del JWT:** revocar un rol no tendría efecto inmediato (ver spec de SP2). Se resuelven por petición.
- **Roles fijos sin edición:** no cubre negocios con estructuras distintas (spec de la Etapa 2).
- **ABAC / políticas externas (Casbin, OPA):** más superficie y dependencias que un conjunto pequeño de reglas puras y testeables.
- **Comprobar el nombre del rol en el código:** acopla la lógica a datos editables; solo el Owner de sistema se distingue por `key`, porque la invariante lo exige.
- **Validar la escalada en la capa HTTP:** la autoridad es el caso de uso; así cualquier otra entrada (CLI, jobs) hereda las reglas.

## Consecuencias

- T4 solo ensambla: carga asignaciones, llama a estas funciones y mapea errores. Cambiar una regla de seguridad es un cambio en `domain/` con tests de matriz.
- Un admin con `users:manage` no puede gestionar usuarios más poderosos que él; si el negocio lo necesita, lo hace un Owner. Es el comportamiento seguro por defecto.
- `domain/` depende de `@monaco/contracts` para el catálogo (una sola fuente de verdad). Los permisos solo-Owner son una decisión del dominio y no se exponen en el contrato.
- Los permisos de catálogo, inventario, ventas y caja existen desde ya, pero sus endpoints llegan en SP3 a SP5.
