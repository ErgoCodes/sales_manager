# ADR 0004 · Autenticación

- **Estado:** aceptada (2026-11-05)
- **Contexto:** SP2 · T3, `apps/api/src/modules/iam/` (`application/`, `infrastructure/`, `http/`), `src/common/http/client-ip.ts`, `src/infrastructure/rate-limit/` y las migraciones 0005 y 0006. Spec: [SP2](../superpowers/specs/2026-11-05-sp2-identidad-tenancy-design.md) (sección "Decisiones", que manda). La autorización está en el [ADR 0005](0005-autorizacion.md) y el aislamiento entre tenants, en el [ADR 0003](0003-aislamiento-tenants-rls.md).

## Contexto

Desde SP2 cada petición a la API tiene que llegar autenticada, aislada por tenant y autorizada. Hay tres restricciones que condicionan el diseño:

- **Antes del login (y del refresh) no hay tenant**, y RLS con `FORCE` no deja ver ninguna fila. Las únicas puertas son las funciones `SECURITY DEFINER` `auth_lookup_user` y `auth_lookup_refresh` (ADR 0003).
- **La web es un BFF**: el navegador nunca ve los tokens, y la API ve siempre la IP del servidor Next, no la del cliente.
- **Revocar tiene que tener efecto inmediato** (desactivar un usuario, revocar un dispositivo, cerrar sesión), sin esperar a que venza el access token.

## Decisión

### 1. Access token: JWT EdDSA de 10 minutos

- `jose`, algoritmo **EdDSA (Ed25519)**, `typ: at+jwt` (RFC 9068), 10 min. Claims: `sub` (usuario), `tid` (tenant), `did` (dispositivo), `sid` (familia de refresh), `iat`, `exp`, `iss`, `aud` y un `jti` aleatorio. **Sin permisos**: se resuelven por petición (punto 4).
- La verificación fija `algorithms: ['EdDSA']`, `typ`, `iss` y `aud`, admite 30 s de desfase de reloj y exige todos los claims, que además tienen que ser UUID. El `kid` se busca **solo** en el JWKS local (la clave actual y, opcionalmente, la anterior); los headers `jku`, `x5u` y `jwk` se ignoran (jose no los sigue y el resolver solo mira `kid`). Un test firma con ES256, con `kid` desconocido y con un `jwk` embebido, y los tres se rechazan.
- **Claves por entorno, validadas con Zod al arrancar** (`src/config/env.ts`): `JWT_PRIVATE_JWK` es un JWK privado Ed25519 en una línea de JSON (`kty: OKP`, `crv: Ed25519`, `x`, `d`, `kid`; objeto estricto, cualquier miembro extra como `jku` se rechaza). `JWT_PREVIOUS_PUBLIC_JWK` es opcional y tiene que ser **pública** (sin `d`) y con otro `kid`. Los errores nombran la variable pero nunca muestran su valor. `JWT_ISSUER` y `JWT_AUDIENCE` tienen valores por defecto.
- **No hay claves en el repo.** `pnpm --filter api keys:generate` imprime (no escribe a disco) una clave de desarrollo, su mitad pública y un `CLIENT_IP_HMAC_SECRET`, para pegarlos en `apps/api/.env`. Los tests generan claves efímeras en cada corrida (`generateSigningJwk`, `src/__tests__/test-config.ts`); el generador de OpenAPI también, y su salida no depende de la clave.
- **Rotación:** 1) pasar la mitad pública de la clave actual a `JWT_PREVIOUS_PUBLIC_JWK`; 2) poner la nueva en `JWT_PRIVATE_JWK` (con otro `kid`) y desplegar; 3) pasados 10 min más el margen de reloj, quitar la anterior. La clave privada vive solo en la API; la web nunca la tiene.

### 2. Refresh token opaco y rotativo, con detección de reuso

- 32 bytes aleatorios en base64url. En la DB solo se guarda su **SHA-256** (`refresh_tokens.token_hash`). Todos los tokens de un login comparten `family_id`, que es el `sid` del access token.
- `POST /auth/refresh`: `auth_lookup_refresh(hash)` da el tenant; el resto ocurre dentro de `withTenant`, con la fila del token bloqueada (`SELECT … FOR UPDATE OF r`), así que dos refrescos del mismo token se serializan:
  - **no rotado**: se marca `rotated_at` y se agrega el siguiente token de la familia, con `expires_at = min(ahora + 30 días, absolute_expires_at)`; la familia vence a los 90 días pase lo que pase.
  - **rotado hace ≤ 10 s (ventana de gracia)**: solo se emite un access token, **nunca** un refresh. No hace falta guardar el refresh nuevo en claro y un token robado no consigue el par vigente.
  - **rotado hace más de 10 s: reuso**. Se revoca toda la familia (`revoked_reason = 'reuse_detected'`) y se escribe `refresh_reuse_detected` en `audit_events`.
  - revocado, vencido, con el dispositivo revocado o con el usuario desactivado: 401, sin tocar nada.
- **El commit ocurre antes del 401.** La unidad de trabajo revierte si la función lanza, así que los casos de uso que tienen que persistir algo *y* fallar (reuso, login fallido con auditoría, contraseña actual incorrecta) devuelven un resultado (`{ kind: 'reuse' }`) y lanzan el error **después** de que `run` hizo commit.

### 3. Dispositivos y sesiones

- Un login reusa el `deviceId` que envía el cliente **solo si es del mismo usuario y no está revocado**; si no, crea un dispositivo nuevo. Reusarlo revoca las familias anteriores de ese dispositivo (`superseded`): una sesión viva por dispositivo.
- `POST /auth/logout` revoca la familia actual (`logout`). `POST /auth/password` exige la contraseña actual, revoca los **demás** dispositivos del usuario y sus familias, revoca la familia actual y abre una nueva en el mismo dispositivo: la respuesta trae el par nuevo. Una contraseña actual incorrecta da `400 INVALID_CURRENT_PASSWORD` (no 401, para que el BFF no lo confunda con una sesión vencida).

### 4. `AuthGuard` global y verificación por petición en una sola consulta

- `AuthGuard` es `APP_GUARD`: **toda ruta exige `Authorization: Bearer`** salvo las marcadas con `@Public()` (hoy `GET /health`, `POST /auth/login` y `POST /auth/refresh`). `/docs` es una ruta de Express montada por Swagger, fuera de los controllers, y sigue igual (solo fuera de producción).
- Tras verificar el JWT, el caso de uso `Authenticate` abre `withTenant(tid)` y ejecuta **una** consulta (`ActorStateRepository`): `users` ⋈ `devices` (el dispositivo tiene que ser de ese usuario) con `status`, `must_change_password`, `devices.revoked_at IS NULL`, un `EXISTS` sobre `refresh_tokens` que comprueba que la familia `sid` de ese dispositivo tiene algún token sin revocar (índice `(tenant_id, family_id)`), y las asignaciones con los permisos de cada rol y sus puntos **no archivados** agregados con `json_agg`. Con eso arma el `AuthenticatedActor` (`userId`, `tenantId`, `deviceId`, `sessionId`, `assignments`, permisos efectivos). Desactivar, revocar o cerrar sesión corta el acceso en la petición siguiente; está probado de punta a punta.
- Si `must_change_password` está activo, todo responde `403 PASSWORD_CHANGE_REQUIRED` salvo las rutas con `@AllowPendingPasswordChange()`: `POST /auth/password`, `POST /auth/logout` y `GET /me`.
- `@RequirePermission(p)` es el chequeo grueso del ADR 0005 (el permiso en algún alcance); la autoridad sigue siendo el caso de uso.
- `AllExceptionsFilter` respeta un `code` explícito de un 4xx (`{ code, message }`, con forma `^[A-Z][A-Z_]+$`), para que el BFF distinga `PASSWORD_CHANGE_REQUIRED` de un 403 de permisos.

### 5. Los repositorios IAM solo existen dentro de `TenantUnitOfWork`

- Puerto `TenantUnitOfWork.run(tenantId, scope => …)` (`domain/auth-ports.ts`); su adaptador, `DrizzleTenantUnitOfWork`, envuelve `withTenant` y es **el único** que construye los repositorios (`users`, `tenants`, `devices`, `refreshTokens`, `audit`, `actors`).
- **Por tipos:** los repositorios reciben `TenantTransaction`, una `Transaction` con una marca (`unique symbol` no exportado) que solo `withTenant` produce. Pasarles la base raíz o una transacción sin tenant no compila (hay un `@ts-expect-error` que lo vigila en `pnpm typecheck`).
- **Por lint:** `no-restricted-imports` prohíbe importar `**/repositories/**` desde cualquier archivo de `src/` o `test/` salvo `*unit-of-work.ts` y los propios repositorios; `architecture.test.ts` comprueba la regla. Los casos de uso tampoco pueden importar `infrastructure/` (ADR 0001).
- Las inserciones pasan el `tenant_id` explícito, y RLS (`WITH CHECK`) lo valida igual.

### 6. Login sin enumeración

`auth_lookup_user(email)` → si no existe, se verifica la contraseña contra un **hash dummy con los mismos parámetros** (calculado una vez por proceso) y el intento va al log estructurado (`login_unknown_email`, con IP y sin email), porque `audit_events` siempre pertenece a un tenant. Si existe, se verifica el hash y **después** se evalúan `disabled` y el vencimiento de la contraseña temporal (72 h). Todos los fallos dan el mismo `401 Invalid email or password`; los de un usuario real se auditan (`login_failed` con `reason`). Un test de integración compara la mediana de tiempos de email inexistente y contraseña incorrecta (tolerancia 0,33×–3×).

Contraseñas: argon2id con `@node-rs/argon2` y los parámetros de OWASP (m = 19 MiB, t = 2, p = 1). Un hash almacenado corrupto cuenta como contraseña incorrecta, no como 500.

### 7. IP del cliente firmada por el BFF

Header único, firmado con `CLIENT_IP_HMAC_SECRET` (≥ 32 caracteres, compartido con la web, obligatorio en producción):

```
x-monaco-client-ip: v1;<ip>;<unix segundos>;<base64url(HMAC-SHA256(secret, "v1\n<ip>\n<ts>\n<MÉTODO>\n<path sin query>"))>
```

- El middleware (`src/common/http/client-ip.ts`) corre antes de los guards. Acepta el header solo si la versión es `v1`, la IP es válida (`net.isIP`), el timestamp está a **±30 s** del reloj de la API y el MAC coincide (comparación en tiempo constante). El MAC cubre **método y path**: un header capturado no sirve en otro endpoint ni pasado medio minuto.
- En cualquier otro caso se ignora y se usa la dirección del socket (normalizando `::ffff:a.b.c.d`). **`X-Forwarded-For` nunca se lee** y Express no tiene `trust proxy`.
- Riesgo aceptado: dentro de esos 30 s, quien pueda ver el tráfico BFF → API podría repetir el header en el mismo endpoint; ese tramo va por TLS o red privada y ya transporta el bearer, que vale más.

### 8. Rate limiting con store en Postgres

- `@nestjs/throttler` con un `ThrottlerStorage` propio (`PostgresThrottlerStorage`), compartido entre instancias. Dos throttlers con nombre, activos solo en las rutas que usan `@UseGuards(ThrottlerGuard)`:
  - `ip`: 30 peticiones/min por IP de cliente.
  - `credential`: 5 intentos cada 5 min por **(IP, email)** en el login, o por **(IP, usuario)** en `POST /auth/password`. `POST /auth/refresh` solo usa el de IP.
  - **Nunca por email solo**: nadie puede dejar afuera al owner a propósito. Bloquear en una IP no afecta a otras.
- **Backoff progresivo:** al pasar el límite la clave se bloquea `blockDuration` (1 min) y cada bloqueo consecutivo dura el doble, con tope de 15 min; los *strikes* se olvidan 24 h después del último bloqueo. Mientras dura el bloqueo los intentos no suman. La respuesta es 429 con `Retry-After-<throttler>`.
- **Dónde vive el store:** tabla `rate_limits` (sin tenant: el login no tiene tenant). Tiene RLS **forzado y ninguna política**, así que todo rol sin `BYPASSRLS` no ve ni escribe nada, y `monaco_app` **no tiene ningún privilegio** sobre ella. La única puerta es `rate_limit_hit(key, ttl_ms, limit, block_ms, max_block_ms)`: `SECURITY DEFINER`, dueño `monaco_auth` (que ya es `NOLOGIN BYPASSRLS` y recibe DML solo sobre esta tabla), `search_path` fijo, `EXECUTE` solo para `monaco_app` y validación de argumentos. Cuenta el intento de forma atómica (`INSERT … ON CONFLICT DO NOTHING` + `SELECT … FOR UPDATE`) y limpia de forma oportunista las claves que ya no tienen nada que recordar. Las claves son SHA-256 que arma el guard: ni IP ni email quedan en claro. El guard de esquema la lista como la excepción "sin tenant" y `auth-db.test.ts` prueba privilegios, dueño, ventana, bloqueo, duplicación y tope.

### 9. Ajustes de la revisión de T1 (migraciones 0005 y 0006)

- `monaco_app` pierde el `UPDATE` sobre toda la tabla `tenants` y conserva solo `UPDATE (name)`: es lo mínimo que Postgres exige para `SELECT … FOR UPDATE` (el mutex del invariante de owner de T4) y la única columna que `tenant:manage` puede llegar a cambiar. Un test verifica que el lock funciona y que cambiar `slug` falla.
- El `CHECK` de `role_permissions.permission` pasa de una regex a `permission IN (…)` **generado desde `PERMISSIONS`** en el esquema Drizzle. Dos tests impiden que diverjan: uno unitario compara el último snapshot de drizzle-kit con el catálogo (falla si alguien cambia el catálogo y no corre `db:generate`) y uno de integración compara la restricción real de la base.

## Alternativas descartadas

- **Permisos o roles dentro del JWT:** ahorra la consulta por petición, pero revocar un rol tardaría hasta 10 min o exigiría versionar tokens. La consulta es una sola y usa índices; si las mediciones lo piden, se agrega una caché por `(usuario, authz_version)`.
- **Solo verificar el JWT, sin chequeo en la DB:** desactivar o cerrar sesión no cortaría el acceso hasta que venza el token.
- **HS256 con secreto compartido:** obligaría a dar el secreto a quien quiera verificar tokens; EdDSA permite publicar la clave pública más adelante.
- **Guardar el refresh nuevo en claro para devolverlo en la ventana de gracia:** un token robado obtendría el par vigente. Emitir solo un access token cierra esa puerta sin guardar secretos.
- **Store del throttler en memoria o en Redis:** en memoria no se comparte entre instancias; Redis sería otra pieza de infraestructura solo para esto. Postgres ya está y el volumen (login, refresh, contraseña) es bajo.
- **Tabla `rate_limits` con una política `TO monaco_app USING (true)`:** más simple, pero ante una inyección SQL la app podría leer o borrar todos los contadores. Con la función, `monaco_app` solo puede sumar un intento a una clave.
- **`X-Forwarded-For` con `trust proxy`:** cualquier cliente puede inventarlo si algo del camino no lo reescribe. Un header firmado no depende de la topología.
- **Tabla `sessions` aparte:** la familia de `refresh_tokens` ya es la sesión, y el esquema de T1 no la tiene; el `EXISTS` sobre la familia alcanza.

## Consecuencias

- Cada petición autenticada abre dos transacciones cortas: la del guard (una consulta) y la del caso de uso.
- La API no arranca sin `JWT_PRIVATE_JWK`: en local hay que correr `keys:generate` una vez (README, `.env.example`).
- El BFF (T6) tiene que firmar la IP con el mismo esquema (`signClientIp` sirve de referencia) y tratar `PASSWORD_CHANGE_REQUIRED`, el 401 de refresh y `INVALID_CURRENT_PASSWORD` por separado.
- `POST /users` (T4) debe sumar `@UseGuards(ThrottlerGuard)`; otros endpoints públicos nuevos tienen que marcarse con `@Public()` a propósito.
- El cambio de contraseña calcula argon2 dentro de la transacción (~decenas de ms con la conexión tomada); es aceptable por su baja frecuencia y su rate limit.
- Riesgos aceptados: el replay de la IP firmada dentro de 30 s (punto 7) y que, al ser el email único global, la enumeración entre tenants sigue siendo posible a muy baja velocidad (spec de SP2).
