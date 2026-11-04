# ADR 0003 · Aislamiento de tenants con RLS

- **Estado:** aceptada (2026-11-04)
- **Contexto:** SP1 · T4, `apps/api` + Postgres 17 (`infra/docker-compose.yml`)

## Contexto

La plataforma es multi-negocio: varios tenants comparten la misma API y la misma base de datos. Un `WHERE tenant_id = ?` olvidado en un repositorio basta para filtrar datos de otro negocio. Queremos que la base de datos sea una **segunda barrera** (la primera sigue siendo la API: permiso + punto en cada caso de uso, docs/20) y que esa barrera no dependa de que cada query esté bien escrita.

## Decisión

1. **Esquema compartido + columna `tenant_id uuid not null`** en cada tabla de un tenant. Nada de una base o un esquema por tenant.
2. **Row-Level Security en cada tabla de tenant**, con una política única (`tenantIsolationPolicy()` en `apps/api/src/infrastructure/db/schema/tenancy.ts`):

   ```sql
   CREATE POLICY <tabla>_tenant_isolation ON <tabla> AS PERMISSIVE FOR ALL TO public
     USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
     WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
   ALTER TABLE <tabla> FORCE ROW LEVEL SECURITY;
   ```

   - `USING` filtra lecturas, `UPDATE` y `DELETE`; `WITH CHECK` rechaza escribir (o mover con `UPDATE`) una fila de otro tenant.
   - **Sin tenant no se ve nada (en vez de error).** `current_setting(..., true)` devuelve `NULL` si la variable nunca se definió y `''` si una transacción anterior de la misma conexión del pool la definió con alcance local; `NULLIF` convierte ambos casos en `NULL` y `tenant_id = NULL` nunca es verdadero. Se eligió así porque un error (`unrecognized configuration parameter`, o `''::uuid` inválido) dependería del historial de la conexión y sería intermitente; "cero filas" es determinista y sigue siendo seguro. El precio: un olvido de `withTenant` se ve como "no hay datos" y no como excepción, así que los tests de cada repositorio deben comprobar que encuentran datos.
   - **`FORCE`** hace que la política aplique también al dueño de la tabla (`monaco_owner`). drizzle-kit genera el `ENABLE ROW LEVEL SECURITY` y la política a partir del esquema, pero no modela `FORCE`: va en una migración custom (`pnpm --filter api db:generate --custom`, ver `drizzle/0001_force_rls_tenancy_probe.sql`). `src/infrastructure/db/__tests__/schema.test.ts` comprueba que cada tabla del esquema tenga `tenant_id uuid not null` y la política; el `FORCE` lo verifican los tests de integración (T5).
3. **Alcance por transacción:** `withTenant(db, tenantId, fn)` (`src/infrastructure/db/with-tenant.ts`) valida que `tenantId` sea un UUID, abre una transacción y ejecuta `select set_config('app.tenant_id', $1, true)` con el tenant como **parámetro** (nunca interpolado) antes de `fn(tx)`. El `true` hace la variable local a la transacción: desaparece en commit o rollback, así no pasa a otra petición que reciba la misma conexión del pool. Todo acceso a tablas de tenant debe hacerse con el `tx` recibido.
4. **Roles separados** (`infra/postgres/init.sql`):
   - `monaco_owner`: dueño de la base, del esquema `public` y de las tablas; corre las migraciones (`DATABASE_MIGRATION_URL`, solo drizzle-kit). Sin `SUPERUSER` ni `BYPASSRLS`.
   - `monaco_app`: el rol con el que la API se conecta en runtime (`DATABASE_URL`). Sin `SUPERUSER`, `BYPASSRLS`, `CREATEDB` ni `CREATEROLE`; `NOINHERIT`. Solo `CONNECT`, `USAGE` en `public` y, mediante `ALTER DEFAULT PRIVILEGES FOR ROLE monaco_owner`, `SELECT/INSERT/UPDATE/DELETE` en las tablas y `USAGE/SELECT` en las secuencias que creen las migraciones. No tiene `TRUNCATE` (no está sujeto a RLS), no puede crear objetos ni leer el esquema `drizzle` de migraciones.
   - `postgres` (superusuario) solo ejecuta `init.sql` al crear el volumen. Las contraseñas de Compose y `.env.example` son solo de desarrollo; los roles de producción se crean en SP4.
5. **Un solo pool** (`DatabaseModule`, global): `pg.Pool` perezoso (no conecta hasta la primera query, así `pnpm openapi:generate` y los tests unitarios no tocan la DB), `connectionTimeoutMillis` de 5 s, listener de `error` para clientes inactivos y `pool.end()` en `onApplicationShutdown`.

## Alternativas descartadas

- **Una base o un esquema por tenant:** aislamiento más fuerte, pero migraciones N veces, pool por tenant y reportes cruzados (demo, soporte) complicados. No compensa para negocios pequeños.
- **Solo filtros en la API (sin RLS):** un único descuido filtra datos; no hay segunda barrera.
- **`SET app.tenant_id` de sesión (sin `LOCAL`):** con un pool, la variable queda en la conexión y la hereda la siguiente petición. Exige un `RESET` que se puede saltar si hay una excepción.
- **`current_setting('app.tenant_id')` sin `missing_ok`:** falla si la variable no existe, pero no si quedó en `''` de una transacción anterior (ahí falla el cast). Comportamiento intermitente según la conexión; ver punto 2.
- **Conectar la API como dueño de las tablas sin `FORCE`:** el dueño se salta RLS y los tests pasarían en falso.
- **Seguridad solo por `to monaco_app` en la política:** con `to public` + `FORCE` la política alcanza también al dueño y a roles futuros.

## Consecuencias

- Cada tabla nueva de un tenant necesita: `tenant_id uuid not null` (con índice), `tenantIsolationPolicy('<tabla>')` en su definición Drizzle y `ALTER TABLE ... FORCE ROW LEVEL SECURITY` en su migración. El test de esquema falla si falta la política.
- Cargas o backfills de datos de varios tenants no pueden hacerse como `monaco_owner` sin fijar el tenant (también está sujeto a RLS): se hacen tenant por tenant con `withTenant` o, en mantenimiento, con un rol administrativo explícito.
- RLS no protege contra un bug que llame a `withTenant` con el tenant equivocado: el tenant debe salir siempre del contexto autenticado (SP2), nunca del cuerpo de la petición.
- Las políticas evalúan `current_setting` por fila; con el índice en `tenant_id` el costo es bajo, pero las queries pesadas de reportes se revisan con `EXPLAIN` en SP4.
