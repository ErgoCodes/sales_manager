# ADR 0008 · Despliegue de la demo pública

- **Estado:** propuesta (2026-11-16). El proveedor queda **pendiente del spike de SP4 · T1**; este ADR registra el default y las reglas que valen para cualquier proveedor.
- **Contexto:** SP4, `apps/api`, `apps/web`, `infra/` y GitHub Actions. Spec: [SP4](../superpowers/specs/2026-11-16-sp4-dashboard-demo-design.md). Se apoya en el [ADR 0003](0003-aislamiento-tenants-rls.md) (roles de la base) y el [ADR 0004](0004-autenticacion.md) (IP del cliente, rate limiting, sesión).

## Contexto

docs/20 deja el despliegue solo local hasta el cierre de SP4 y el proveedor para el spec de SP4. La demo es pública: sus credenciales se publican, así que cualquiera puede iniciar sesión. Además:

- El diseño de tenancy necesita tres roles de Postgres, uno de ellos `NOLOGIN BYPASSRLS` (`monaco_auth`). En Postgres 16+ solo un superusuario o un rol con `BYPASSRLS` puede crearlo, y muchos Postgres gestionados no dan superusuario.
- La imagen de la API no trae `drizzle-kit` ni los scripts, y el seed se niega a correr en producción.
- La API nunca lee `X-Forwarded-For`: detrás del proxy del proveedor, los clientes mobile (que no pasan por el BFF) compartirían una sola IP para el rate limiting.

## Decisión

1. **Proveedor (default, a confirmar en T1):** Fly.io para la API y la web, con las mismas imágenes Docker que construye CI, y Neon para Postgres 17. **Criterio eliminatorio:** poder crear `monaco_auth` con `BYPASSRLS` y roles de login separados para owner y app. Repliegue, en orden: Postgres en Fly con superusuario, y después un VPS con Docker Compose.
2. **Bootstrap de roles a mano, una vez,** con un script versionado (`infra/deploy/bootstrap-roles.sql`) y la credencial de administración, que no queda en CI ni en los servicios. `monaco_app` recibe `statement_timeout = '5s'`.
3. **Migraciones fuera del runtime.** Un job de GitHub Actions (Environment `demo`, solo `main`) corre `db:migrate` con `monaco_owner` antes de desplegar. Los servicios solo tienen la credencial de `monaco_app`. Las migraciones son hacia adelante y compatibles con la versión anterior del código; rollback = volver a la imagen anterior.
4. **Entornos:** local, CI y `demo` (`NODE_ENV=production`). Sin staging.
5. **Tenant de solo lectura.** `tenants.read_only`: el `AuthGuard` responde `403 DEMO_READ_ONLY` a toda mutación salvo login, refresh y logout (denegación por defecto). Un test recorre todas las rutas.
6. **Base dedicada y reset nocturno.** La base de la demo solo contiene el tenant demo. `demo:reset` (cron de GitHub Actions) se niega si hay un tenant con `read_only = false`, exige confirmación por slug y, en una transacción, vacía las tablas de tenant y vuelve a sembrar con los casos de uso. Procedimiento (SP4 · T8, `apps/api/src/scripts/demo-reset.ts`): `DEMO_RESET_CONFIRM=demo pnpm --filter api demo:reset` con `DATABASE_MIGRATION_URL` de `monaco_owner`. Dentro de una sola transacción: `lock_timeout` de 30 s; como `tenants` tiene `FORCE ROW LEVEL SECURITY` y ningún contexto de tenant ve todas las filas, el owner quita el `FORCE` de esa tabla, lee los tenants con `read_only = false` y lo vuelve a poner (DDL transaccional: nadie ve la tabla sin `FORCE`, y un rollback también lo restaura); `TRUNCATE` sin `CASCADE` de todas las tablas con `tenant_id` (listadas desde el catálogo) y de `tenants`; tenant demo con `read_only = true`; 90 días de historia por los casos de uso y `RecordSale` como el Owner demo, cuyos `withTenant` pasan a ser *savepoints* de la transacción. El guard de solo lectura vive en el `AuthGuard` (HTTP), así que no bloquea a los casos de uso llamados desde el script. Una falla en cualquier punto deja los datos anteriores intactos; las peticiones que llegan durante el reset esperan los locks del `TRUNCATE` (o fallan por el `statement_timeout` de 5 s de `monaco_app`) y nunca ven un estado intermedio. En local tarda ≈ 50 s.
7. **IP real detrás del proxy.** La web firma la IP con su `TRUSTED_PROXY_HOPS`; la API agrega su propio `TRUSTED_PROXY_HOPS` (default `0`) para cuando no hay header firmado, contando desde la derecha de `X-Forwarded-For`. El header firmado siempre gana.
8. **Borde:** TLS termina en el proveedor; cookies `__Host-` y CSP con nonce sin cambios; `APP_ORIGINS` con el origen público; HSTS si el borde no lo agrega; `CORS_ORIGINS` de la API solo con el origen de la web; web → API por red privada cuando el proveedor la ofrece.
9. **Observabilidad mínima:** logs JSON de `pino` en el proveedor, health checks sobre `/health` y un monitor externo de disponibilidad. Sin APM ni error tracking en SP4.

## Alternativas descartadas

- **Render (todo en uno):** un solo proveedor y Blueprint en el repo, pero el plan gratuito duerme los servicios y vence la base, y `BYPASSRLS` no está garantizado. Sigue siendo válido si el spike lo confirma y el costo de los planes pagos se acepta.
- **Vercel para la web:** el mejor soporte de Next, pero suma un tercer proveedor y el tramo BFF → API va por internet.
- **Migrar al arrancar la API o en un *pre-deploy* del proveedor:** la credencial de owner quedaría en el entorno del servidor expuesto.
- **Demo con escritura y reset frecuente:** el primer visitante puede cambiar la contraseña del Owner o dejar contenido ofensivo a la vista de los demás.
- **Un tenant efímero por visitante:** necesita una provisión pública (abuso, crecimiento) y contradice "sin registro público" del spec de la Etapa 2.
- **Mobile a través del BFF para tener la IP firmada:** un salto más y una superficie nueva en la web, para resolver lo que resuelve contar saltos de proxy en la API.

## Consecuencias

- Antes de cualquier código de deploy hay un spike que puede cambiar el proveedor; el resto de SP4 no depende de él hasta T11.
- La demo no muestra formularios de escritura en funcionamiento: se muestran en local, en el README o en un video.
- Cada reset cierra las sesiones abiertas de los visitantes; por eso corre de madrugada en la zona del tenant demo.
- Hay que mantener un script de bootstrap de roles para entornos gestionados, además de `infra/postgres/init.sql`.
- Pendiente de T1/T11: proveedor confirmado, valores de `TRUSTED_PROXY_HOPS`, costo mensual y runbook (rotación de claves JWT, rollback, reset manual).
