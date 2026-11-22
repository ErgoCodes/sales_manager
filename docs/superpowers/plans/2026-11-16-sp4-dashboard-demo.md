# SP4 · Dashboard y demo pública: plan de implementación

> **Para agentes:** el diseño completo, las decisiones abiertas con su default y las reglas de seguridad están en el [spec de SP4](../specs/2026-11-16-sp4-dashboard-demo-design.md). **Ese spec manda**: este plan solo ordena el trabajo y define el "Hecho cuando" de cada tarea. Las ventas y el modelo de reportes están en el [ADR 0007](../../adr/0007-ventas-y-modelo-de-reportes.md); el despliegue, en el [ADR 0008](../../adr/0008-despliegue-demo-publica.md); el libro de inventario, en el ADR 0006. Antes de escribir código hay que consultar la doc vigente de NestJS, Drizzle, `nestjs-zod`, Vitest, Next 16 (`node_modules/next/dist/docs/`), Expo 54 (`https://docs.expo.dev/versions/v54.0.0/`, en especial `expo-secure-store`) y la del proveedor elegido. Cada tarea va en un PR contra `main` con CI en verde. **Ninguna regla de precio, stock, costo o KPI se escribe en `apps/api`, `apps/web` ni `apps/mobile`: va a `packages/domain`.**

**Antes de T1:**

- SP3 tiene que estar mergeado. Si SP3 · T6 (transferencias y reversiones) y T8b se deslizaron, se hacen primero, según el plan de SP3; este plan no los repite.
- Confirmar o cambiar los defaults de "Decisiones abiertas" del spec (D1–D16). Las marcadas **[Dueño]** (D2, D3, D4, D5, D9, D10) las decide el dueño. Si alguna cambia, se actualizan el spec y las tareas afectadas antes de empezar.

**Gate de salida:** el del spec de SP4 (sección "Gate de salida").

**Tareas críticas de seguridad o datos** (revisión más estricta, tests de integración obligatorios): **T1** (roles y privilegios en el proveedor), **T3** (permisos y migración de roles de sistema), **T4** (esquema de ventas), **T5** (escritura de ventas bajo lock), **T6** (autorización de reportes), **T7** (IP detrás del proxy y modo solo lectura), **T8** (reset de la demo), **T10a** (sesión mobile) y **T11** (pipeline y secretos).

**Orden y paralelismo**

```
T1 (spike deploy) ──────────────────────────────────────────────────────────────┐
T2 (domain) ─────┐                                                              │
                 ├─> T4 (DB) ─┬─> T5 (RecordSale) ──> T8 (seed + reset) ────────┤
T3 (contracts) ──┘            ├─> T6 (reports API) ─┬─> T9 (web tablero) ───────┼─> T11 (deploy) ─> T12 (e2e + docs)
                              └─> T7 (borde + demo) │                           │
T10a (mobile sesión) ───────────────────────────────┴─> T10b (mobile "Hoy") ────┘
```

- **T1 ∥ T2 ∥ T3 ∥ T10a:** superficies disjuntas: `infra/deploy/` + `docs/adr/0008-*.md` (T1); `packages/domain` (T2); `packages/contracts`, `apps/api/src/modules/iam/domain/system-roles.ts`, `apps/api/drizzle/` y `apps/web/src/lib/permissions.ts` (T3); `apps/mobile/` (salvo `db/` y `store/`), el script `api:generate` de mobile y el paso de drift de mobile en `.github/workflows/ci.yml` (T10a). T10a usa los endpoints de auth que ya existen desde SP2.
- **Migraciones en serie:** solo T3 y T4 crean migraciones en `apps/api/drizzle/`, en ese orden. Ninguna otra tarea agrega una.
- **Códigos de error y permisos:** todos los códigos nuevos (`DEMO_READ_ONLY`) y `reports:view_own` entran en T3. Ninguna otra tarea toca `PERMISSIONS` ni los códigos de `ErrorResponse`.
- **T5 ∥ T6 ∥ T7:** módulos disjuntos (`modules/sales/` frente a `modules/reports/` frente a `common/http/client-ip.ts`, el guard IAM y `config/env.ts`). Los únicos archivos compartidos son el registro en `app.module.ts` (una línea por módulo) y los generados `openapi.json`/`schema.d.ts`: solo T6 cambia la API pública, así que solo T6 los regenera. T6 prueba con un *fixture builder* de tests que inserta ventas por SQL como owner, así no espera a T5.
- **T8 ∥ T9 ∥ T10b:** `apps/api/src/scripts/` frente a `apps/web/` frente a `apps/mobile/`. `apps/mobile/lib/api/schema.d.ts` lo regenera T10b después de T6.
- **T11** depende de T1 (proveedor), T7 (borde y solo lectura) y T8 (`demo:reset`); toca solo `infra/deploy/`, `.github/workflows/deploy.yml`, `.github/workflows/demo-reset.yml`, los Dockerfiles y `next.config.ts` (`output: 'standalone'`).
- **Recorte si el calendario aprieta** (riesgo del spec): `GET /reports/by-location` y `GET /reports/inventory-health` con sus tarjetas pueden salir después de la demo; el gate se cumple con resumen, serie, ranking y "Hoy".

---

### T1 · Spike de despliegue y bootstrap de roles en el proveedor `M` · `Difícil` · **crítica de seguridad** (sin dependencias)

- [ ] Crear en el proveedor del default (D9: Fly.io + Neon) una app temporal con la imagen actual de la API y una base Postgres 17.
- [ ] Con la credencial de administración, correr un script versionado `infra/deploy/bootstrap-roles.sql` (equivalente a `infra/postgres/init.sql`, sin superusuario si el proveedor no lo da): `monaco_owner`, `monaco_app` (sin `BYPASSRLS`), `monaco_auth` (`NOLOGIN BYPASSRLS`), `statement_timeout = '5s'` para `monaco_app`.
- [ ] Correr las migraciones con `monaco_owner` desde una máquina de desarrollo y `test:integration` del guard de roles contra esa base (o el subconjunto que no necesita Testcontainers): ningún rol de login con `BYPASSRLS`, funciones `SECURITY DEFINER` con dueño `monaco_auth`.
- [ ] Medir cuántos proxies agregan entradas a `X-Forwarded-For` delante de la API y de la web (valor de `TRUSTED_PROXY_HOPS`), si el borde agrega HSTS, si hay red privada web → API y el arranque en frío.
- [ ] Anotar costos con los precios vigentes. Si `BYPASSRLS` no está disponible, repetir con el repliegue de D9.
- [ ] ADR 0008 con el proveedor elegido y los valores medidos; borrar la app temporal.

**Hecho cuando:** el ADR 0008 registra un proveedor donde `monaco_auth` existe con `BYPASSRLS`, las migraciones aplican y los tests del guard de roles pasan contra esa base, con `TRUSTED_PROXY_HOPS` medido; y no queda ningún recurso temporal en marcha.

### T2 · Reglas de ventas y KPIs en `@monaco/domain` `M` · `Media` (en paralelo con T1, T3 y T10a)

- [x] Tipo `sale` en `INVENTORY_MOVEMENT_KINDS` con signo negativo en `movementDelta` (procedimiento del ADR 0006).
- [x] `saleLineAmounts({ quantity, unitPrice, unitCost, isCostSale })` → `{ lineTotal, profit }` en unidades menores, con aritmética en milésimas enteras y el redondeo del spec.
- [x] `marginRatio`, `averageTicket`, `lossValue` e `isLowStock` (extrae la regla `stock < threshold` de `countLowStock` sin cambiar mobile).
- [x] `PAYMENT_METHODS` (`cash`, `transfer`) y su mapeo con `efectivo`/`transferencia` de mobile.
- [x] Tests unitarios de todo lo anterior, incluido un test que compara `saleLineAmounts` con la fórmula de `apps/mobile/db/sales.ts:103-106` cuando el costo es el mismo.

**Hecho cuando:** los umbrales de cobertura de `packages/domain` se mantienen y la suite financiera de mobile (`pnpm test:coverage`) pasa sin cambios en `apps/mobile`.

### T3 · Contratos de reportes, `reports:view_own` y migración de roles de sistema `M` · `Difícil` · **crítica de seguridad** (en paralelo con T1, T2 y T10a)

- [x] `packages/contracts/src/reports/`: `LocalDate`, `TimeZone`, `ReportRangeQuery` (rango ≤ 366 días, `from ≤ to`), `MoneyByCurrency`, `ReportSummary` (con `scope`, `locationIds`, `from`, `to`, `timeZone`, `asOf`), `DailySeries`, `TopProducts`, `SummaryByLocation`, `InventoryHealth`, todos con `.meta({ id })`. Enum de tipos de movimiento con `sale` (el test que compara con el dominio sigue en verde): agregado en T4, junto con el `CHECK` de signo.
- [x] Código de error `DEMO_READ_ONLY` en `ErrorResponse`.
- [x] `reports:view_own` en `PERMISSIONS` (no administrativo); `SYSTEM_ROLES`: Cashier sin `reports:view` y con `reports:view_own` (Owner y Manager también lo reciben: el Manager lo necesita por la regla de no escalada, ver ADR 0005 §10); etiqueta y grupo en `apps/web/src/lib/permissions.ts`.
- [x] Migración del `CHECK` de `role_permissions` (`db:generate`) y migración de datos idempotente con el procedimiento de SP3 · D11, que además quita `reports:view` de los Cashier **de sistema**.
- [x] Tests de integración: la migración corre dos veces; `FORCE` sigue activo en `roles` y `role_permissions`; un rol Cashier creado antes de SP4 queda igual a `SYSTEM_ROLES`; un rol personalizado con `reports:view` no cambia.
- [x] Actualizar ADR 0005.

**Hecho cuando:** CI verde (incluido `openapi-drift`), la migración aplica sobre una base limpia y sobre una con datos de SP3, y el Cashier del seed ve `reports:view_own` y no `reports:view` en `GET /me`.

### T4 · Esquema de ventas, zona horaria y modo solo lectura en Postgres `L` · `Difícil` · **crítica de datos y seguridad** (depende de T2 y T3)

- [x] Migraciones para `sales` y `sale_lines` según el spec: UUIDv7, `tenant_id`, política + `FORCE`, `UNIQUE (id, tenant_id)`, FK compuestas (incluida `sales (id, tenant_id) → inventory_documents`), `CHECK`s (cantidad > 0, importes ≥ 0, descuento 0–100, `payment_method` contra `PAYMENT_METHODS` del dominio), índices cubrientes del spec.
- [x] Privilegios: `monaco_app` solo `SELECT` e `INSERT` en `sales` y `sale_lines`.
- [x] `inventory_movements`/`inventory_documents`: `sale` en los `CHECK` de `kind` (signo negativo) e índice parcial `(tenant_id, location_id, occurred_at) WHERE kind IN ('exit','entry')`.
- [x] `tenants.time_zone text not null default 'America/Havana'` y `tenants.read_only boolean not null default false`, sin `UPDATE` para `monaco_app` (sigue limitado a `name`). `tenant:create --time-zone` validado con `TimeZone`.
- [x] Esquema Drizzle en `apps/api/src/infrastructure/db/schema/`.
- [x] Tests de integración: guard de RLS + `FORCE` y FK compuestas en las tablas nuevas; matriz de `schema-guards.test.ts` ampliada (ventas append-only); `monaco_app` no puede cambiar `time_zone` ni `read_only`; un `sale` positivo viola el `CHECK`.
- [x] Actualizar ADR 0003 (tablas y privilegios) y ADR 0006 (tipo `sale`).

**Hecho cuando:** las migraciones aplican sobre una base limpia y sobre una con datos de SP3, y todos los tests de arriba pasan en `test:integration`.

### T5 · Caso de uso `RecordSale` `M` · `Difícil` · **crítica de datos** (depende de T4; en paralelo con T6 y T7)

- [ ] Módulo `apps/api/src/modules/sales/` (dominio, aplicación e infraestructura; **sin `http/`**) con `SalesUnitOfWork` sobre `withTenant`.
- [ ] `RecordSale` con el guion del ADR 0006: validar, `authorize(actor, 'sales:create', punto)`, idempotencia por id + `payload_hash`, locks ordenados de los pares, `assertStockNotNegative`, `unit_cost` con `effectiveUnitCost` bajo el lock, montos con `saleLineAmounts`, escritura de documento `sale`, movimientos, `sales`, `sale_lines` y `audit_event` `sale_recorded` (sin montos).
- [ ] Tests unitarios con fakes (autorización antes de tocar datos, orden de locks pedido al puerto, idempotencia).
- [ ] Tests de integración: una venta baja el stock derivado y deja montos iguales al dominio; un reintento con el mismo id da el mismo resultado y uno con otro contenido da `IDEMPOTENCY_CONFLICT`; ventas concurrentes con salidas de inventario del mismo par terminan con stock ≥ 0 y sin deadlock; una venta que no cabe da `INSUFFICIENT_STOCK` sin efectos.

**Hecho cuando:** pasan los tests y la cobertura de la API sigue sobre sus umbrales; no existe ninguna ruta HTTP que escriba ventas.

### T6 · API de reportes `L` · `Difícil` · **crítica de seguridad** (depende de T4; en paralelo con T5 y T7)

- [ ] Módulo `apps/api/src/modules/reports/` con `ReportsUnitOfWork` y los cinco endpoints del spec, con `@RequirePermission` grueso y la autoridad en el caso de uso (`reports:view` por punto, "todos mis puntos", `reports:view_own` solo en `summary`, sin utilidad).
- [ ] Rango por defecto (hoy en la zona del tenant), conversión de días locales a `timestamptz` en SQL, corte en `now()`, exclusión de documentos revertidos, agregación por moneda. Las reglas por fila se aplican con las funciones de `@monaco/domain`.
- [ ] `Cache-Control: private, no-store` y throttler `ip` en `/reports/*`.
- [ ] *Fixture builder* de tests que inserta ventas y documentos por SQL como owner (para no depender de T5).
- [ ] Tests de integración: oráculo de KPIs (mermas, entrada revertida, venta a costo, dos monedas, venta futura); `America/Havana` cruzando los cambios de horario y serie = total; fuga entre tenants y entre puntos por endpoint; `view_own` solo ve sus ventas y nunca la utilidad; volumen ×10 con p95 < 300 ms y sin `Seq Scan` en `sale_lines` ni `inventory_movements`.
- [ ] Regenerar `openapi.json` y `apps/web/src/lib/api/schema.d.ts`. ADR 0007 con los resultados medidos.

**Hecho cuando:** pasan los tests, el presupuesto de rendimiento se cumple, `/docs` muestra los endpoints y los archivos generados están commiteados.

### T7 · IP detrás del proxy y tenant de solo lectura `M` · `Difícil` · **crítica de seguridad** (depende de T4; en paralelo con T5 y T6)

- [x] `TRUSTED_PROXY_HOPS` en `apps/api/src/config/env.ts` (default `0`) y en el middleware `common/http/client-ip.ts`: el header firmado gana; sin él, la entrada de `X-Forwarded-For` contada desde la derecha; con `0`, el socket como hoy.
- [x] Guard de solo lectura: el `AuthGuard` lee `tenants.read_only` en la misma consulta por petición; con `true`, toda ruta que no sea `GET`/`HEAD` responde `403 DEMO_READ_ONLY`, salvo la lista permitida (`POST /auth/login`, `/auth/refresh`, `/auth/logout`). El login de un usuario de tenant `read_only` no exige ni permite cambiar la contraseña.
- [x] Tests unitarios de la IP (falsificación a la izquierda ignorada, `0` sin cambios, header firmado prioritario).
- [x] Test de integración que **recorre todas las rutas registradas** de la app con un usuario de tenant `read_only` y verifica `403 DEMO_READ_ONLY` en cada mutación, y que login, refresh, logout y los `GET` funcionan. Una ruta nueva sin cubrir hace fallar el test.
- [x] Actualizar ADR 0004 (§7 IP con `TRUSTED_PROXY_HOPS`).

**Hecho cuando:** pasan los tests, y con `TRUSTED_PROXY_HOPS=0` el comportamiento de la API es idéntico al de antes (comparación de las respuestas de `client-ip` contra la versión de `main`).

### T8 · Seed demo realista y `demo:reset` `M` · `Media` · **crítica de datos** (depende de T5; en paralelo con T9 y T10b)

- [ ] `db:seed` extendido (`--history-days`, default 14): productos, precios por punto, entradas, mermas, retiros, transferencias (si existen) y ventas, todo por los casos de uso de SP3 y `RecordSale` con el `Actor` del Owner demo. PRNG con semilla fija, ids UUIDv7 deterministas, fechas relativas en la zona del tenant, día de hoy completo.
- [ ] Idempotente: no vuelve a sembrar la historia si el tenant demo ya tiene ventas. Sigue negándose con `NODE_ENV=production`.
- [ ] `pnpm --filter api demo:reset` (90 días): conexión `monaco_owner`, se niega si hay algún tenant con `read_only = false` o si `DEMO_RESET_CONFIRM` no es el slug; en una transacción, `TRUNCATE` de las tablas de tenant, tenant demo con `read_only = true` y siembra.
- [ ] Tests de integración: `db:seed` dos veces no duplica; ningún par queda con stock negativo; el reset se niega con un tenant real; el reset es atómico (una falla a mitad deja los datos anteriores); los KPIs del tenant demo no están vacíos para "hoy" y para 30 días.

**Hecho cuando:** `pnpm db:up && pnpm db:migrate && pnpm --filter api db:seed` deja el tablero con datos, el job `e2e` sigue en verde con su tiempo de seed acotado, y `demo:reset` deja el volumen del spec en menos de 5 minutos en local.

### T9 · Web: tablero `L` · `Media` (depende de T6; en paralelo con T8 y T10b)

- [ ] `/tablero` en `(backoffice)` con filtros en la URL (punto, período, moneda), tarjetas, serie diaria, ranking, comparativa por punto y salud del inventario, cada tarjeta en su `<Suspense>` y sin `use cache` sobre datos del usuario.
- [ ] Gráficos SVG propios con atributos de presentación y tabla equivalente; nada de atributos `style` (la CSP sigue igual, verificado con `next build && next start`).
- [ ] Importes con `Intl.NumberFormat` y la moneda; estados vacío, de error (403/404/400 en español) y de carga.
- [ ] Navegación: "Tablero" según `reports:view`; aterrizaje en `/tablero` tras el login para quien lo tiene.
- [ ] `DEMO_MODE` (server-only): en `/login`, las tres cuentas demo con botones que completan el formulario; en toda acción que reciba `DEMO_READ_ONLY`, el mensaje "Demo de solo lectura".
- [ ] Tests de componentes: filtros y URL, tarjeta con varias monedas, gráfico sin atributos `style`, aviso de solo lectura.

**Hecho cuando:** el Owner del seed ve el tablero con datos y cambia período y punto; el Manager solo ve su punto; el Cashier no ve "Tablero"; y la CSP no reporta violaciones en el build de producción.

### T10a · Mobile: cliente API y sesión online `L` · `Difícil` · **crítica de seguridad** (sin dependencias de este plan; en paralelo con T1, T2 y T3)

- [x] Leer la doc de Expo 54 (`expo-secure-store`, variables `EXPO_PUBLIC_*`, backups de Android) antes de escribir código. Instalar `expo-secure-store` con la versión que fije Expo 54 (`pnpm --filter mobile exec expo install expo-secure-store`) y `openapi-fetch`; `openapi-typescript` como dev.
- [x] Script `api:generate` → `apps/mobile/lib/api/schema.d.ts` desde `packages/contracts/openapi.json`, y el paso correspondiente en el job `openapi-drift`.
- [x] `apps/mobile/lib/session/`: refresh y `deviceId` en el almacenamiento seguro (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`), access en memoria, refresh anticipado y ante 401 con single-flight, ventana de gracia sin `refreshToken`, borrado ante 401 del refresh, logout que borra aunque la API falle, revalidación con `GET /me` al volver a primer plano.
- [x] Pantallas `app/account/` (login, cambio de contraseña obligatorio, cuenta) con entrada desde Configuración; `EXPO_PUBLIC_API_URL` por perfil de `eas.json`; mensaje en Expo web.
- [x] Tests Jest con `expo-secure-store` y `fetch` simulados: login guarda lo correcto, single-flight con dos 401 simultáneos, ventana de gracia, reuso → login, logout sin red, `mustChangePassword` bloquea el resto.
- [x] Actualizar ADR 0004 (sesión en mobile).

**Hecho cuando:** en un dev client Android contra la API local, el usuario demo inicia sesión (se crea un dispositivo `android` visible en `/dispositivos` de la web), sobrevive al vencimiento del access, cierra sesión y, revocado desde la web, vuelve al login; la suite financiera de mobile pasa sin cambios en `db/` ni `store/`.

> **Pendiente de verificar a mano:** la parte del dev client Android contra la API local (login, dispositivo `android` en `/dispositivos`, vencimiento del access, logout y revocación desde la web) no se corrió en el entorno del agente; lo cubren los tests Jest con `expo-secure-store` y `fetch` simulados. La suite financiera pasa sin cambios en `db/` ni `store/`.

### T10b · Mobile: vista "Hoy" `M` · `Media` (depende de T6 y T10a; en paralelo con T8 y T9)

- [ ] Regenerar `apps/mobile/lib/api/schema.d.ts` con los endpoints de reportes.
- [ ] Pantalla "Hoy" en `app/account/`: selector de punto (según `GET /me`), `GET /reports/summary` sin fechas y, con `reports:view`, `GET /reports/inventory-health`; resumen por moneda; utilidad oculta con `scope: 'own'`; encabezado "Datos del servidor · actualizado HH:mm"; "Sin conexión" con el último dato en memoria.
- [ ] Tests Jest de la pantalla con respuestas simuladas (`scope: 'location'` y `'own'`, varias monedas, error de red).

**Hecho cuando:** contra la API local con el seed, el Manager ve "Hoy" de su punto con utilidad y bajo stock, el Cashier ve solo sus ventas sin utilidad, y la suite financiera sigue en verde.

### T11 · Despliegue de la demo pública `L` · `Difícil` · **crítica de seguridad y entrega** (depende de T1, T7 y T8)

- [ ] `apps/web/Dockerfile` (`output: 'standalone'`, no root, `HEALTHCHECK`) y su build en el job `build` de CI; imágenes base de la API y la web fijadas por digest, con Dependabot para actualizarlas.
- [ ] Configuración del proveedor versionada en `infra/deploy/` (servicios, health checks, red privada web → API, regiones, apagado sin tráfico).
- [ ] GitHub Environment `demo` (solo `main`) con `DATABASE_MIGRATION_URL` y el token del proveedor; secretos de runtime cargados en el proveedor según la tabla del spec.
- [ ] `.github/workflows/deploy.yml`: después de CI verde en `main` o a mano; `migrate` → API → web → smoke (`/health`, login demo, `GET /reports/summary`).
- [ ] `.github/workflows/demo-reset.yml`: cron diario (04:00 de la zona del tenant demo) y a mano; corre `demo:reset`.
- [ ] Primer despliegue: bootstrap de roles (T1), migraciones, `demo:reset`, `TRUSTED_PROXY_HOPS` medido en la web y la API, `DEMO_MODE=true`, HSTS verificado.
- [ ] Runbook en el ADR 0008: rotar claves JWT, volver a la imagen anterior, correr el reset a mano, qué hacer si el reset falla.

**Hecho cuando:** la URL pública muestra el login con las cuentas demo, el tablero tiene datos de hoy, una mutación da el aviso de solo lectura, el smoke del deploy y el reset programado pasan en Actions, y ningún servicio en ejecución tiene la credencial de `monaco_owner`.

### T12 · E2E, demo mobile y cierre de documentación `M` · `Media` (depende de T9, T10b y T11)

- [ ] Playwright en `apps/web/e2e`: el Owner abre `/tablero` y cambia período y punto; el Manager solo ve su punto; el Cashier no ve "Tablero"; con `DEMO_MODE` y un tenant `read_only`, una mutación muestra el aviso.
- [ ] Build interno de EAS (o dev client) apuntando a la API pública: login demo, "Hoy" del Manager y del Cashier.
- [ ] `docs/20` (estado de SP4), `README` (URL de la demo, cuentas, cómo correr mobile contra la API pública), `CLAUDE.md` (módulos `sales` y `reports`, `demo:reset`, pipeline de deploy) y ADR 0007 y 0008 pasan a "Aceptada".
- [ ] Marcar SP4 en Notion (lo hace el orquestador).

**Hecho cuando:** el job `e2e` pasa en CI, la demo mobile funciona contra la URL pública y se cumple cada punto del gate de salida del spec.
