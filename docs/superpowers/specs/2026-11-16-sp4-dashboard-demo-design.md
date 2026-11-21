# SP4 · Dashboard y demo pública — diseño

> Spec del sub-proyecto SP4 de la Etapa 2. Parte del [spec de la Etapa 2](2026-07-11-etapa2-plataforma-multinegocio-design.md) (dashboard completo en la web y vista compacta "Hoy" en mobile, mismos endpoints, protegidos por `reports:view`, sobre datos demo sembrados), de las decisiones de [docs/20](../../20-plan-etapa2.md) (login online de mobile en SP4, demo pública al cierre de SP4, proveedor de deploy a decidir en este spec) y del modelo de [SP3](2026-11-16-sp3-catalogo-inventario-design.md) (catálogo, precio y stock por punto, libro de inventario append-only). El plan tarea por tarea está en [plans/2026-11-16-sp4-dashboard-demo.md](../plans/2026-11-16-sp4-dashboard-demo.md). Las decisiones de arquitectura nuevas quedan en el [ADR 0007](../../adr/0007-ventas-y-modelo-de-reportes.md) (ventas en el servidor y modelo de lectura de reportes) y el [ADR 0008](../../adr/0008-despliegue-demo-publica.md) (despliegue de la demo pública).

## Objetivo

Que el producto se pueda **demostrar de punta a punta** antes del sync de SP5: un dashboard de KPIs en la web, una vista "Hoy" en mobile con login online y registro de dispositivo, un tenant demo con datos realistas y una **demo pública desplegada** que se pueda abrir con credenciales publicadas sin poner en riesgo el resto del sistema.

## Alcance

**Entra:**

- Un **modelo mínimo de ventas en el servidor** (cabecera y líneas, integradas al libro de inventario como movimientos `sale`), escrito en SP4 solo por el seed a través de un caso de uso interno. Es el mismo modelo que SP5 llenará desde la caja (D1).
- KPIs de ventas, utilidad, pérdidas e inventario con fórmulas fijas y reglas de `@monaco/domain`; zona horaria y corte de día por tenant.
- Endpoints de reportes (`/reports/*`) con *permiso + punto*, contratos en `packages/contracts`, índices y presupuesto de rendimiento medido.
- Pantallas del dashboard en la web.
- Mobile: login online con registro de dispositivo, refresh, logout, cambio de contraseña obligatorio y la vista "Hoy". La caja local no cambia.
- Seed demo con volumen realista, idempotente, y un comando de reset para la demo.
- Despliegue de la demo pública: proveedor, entornos y secretos, migraciones, reset de datos, protección contra abuso, observabilidad y costo.

**No entra (non-goals):**

- Registrar ventas desde la web o desde mobile contra el servidor, anular ventas y cierre de caja: SP5 (caja offline con sync). En SP4 no hay `POST /sales`.
- Sync offline, cache de permisos y datos del servidor en el dispositivo: SP5.
- Gastos (`gastos` de mobile) en el servidor: el spec de la Etapa 2 no los modela. La utilidad de SP4 es **bruta** (sin gastos).
- Exportar a Excel o PDF, alertas push, reportes programados por email (el spec de la Etapa 2 excluye notificaciones push del servidor).
- Conversión entre monedas (D6).
- Publicar la app en las tiendas: para el gate alcanza un build interno de EAS o un dev client apuntando a la API pública.
- Registro público, cobros y planes (fuera de alcance de la Etapa 2).

## Punto de partida verificado en el código

| Hecho | Dónde |
|---|---|
| **SP3 todavía no está implementado:** no hay módulos `catalog` ni `inventory` en la API ni esquemas de catálogo en contracts. SP4 se apoya en el modelo de su spec y arranca cuando SP3 cierre (si las transferencias de SP3 · T6/T8b se deslizan, van primero en SP4, como prevé su plan). | `apps/api/src/modules/`, `packages/contracts/src/` |
| `@monaco/domain` no tiene reglas de reporte ni de utilidad: solo `effectiveUnitCost`, `calculateTransferPrice`, `blendAverageCost`, `weightedAverageCost`, `deriveStock`/`stockDelta`, `getProductThreshold`, `isStagnant`, `isNearExpiration` y formateo. | `packages/domain/src/*.ts` |
| El resumen diario de mobile suma `precio_aplicado × cantidad` y la `utilidad` congelada en cada venta no anulada, agrupando por método de pago (`efectivo`/`transferencia`) y filtrando con `date(fecha) = date(:día)`. El día lo calcula el dispositivo con `format(new Date(), 'yyyy-MM-dd')` (hora local). | `apps/mobile/db/queries.ts:122-153`, `apps/mobile/app/(tabs)/index.tsx:63` |
| La utilidad de una venta de mobile se congela al vender como `(precio_aplicado − costo) × cantidad`, o `0` si es venta a costo, con **`costo = products.costPrice`** (precio de costo cargado a mano), no el costo promedio. | `apps/mobile/db/sales.ts:103-106` |
| Las pérdidas de mobile son `Σ |cantidad| × precio_costo_unitario` de los movimientos `merma` y `retiro_owner` no anulados. | `apps/mobile/db/movements.ts:376-397` |
| Bajo stock en mobile: `stock < getProductThreshold(producto, umbralGeneral)`, con umbral general configurable y `5` por defecto. | `apps/mobile/db/queries.ts:488-510` |
| Mobile usa Zod 3 y `@hookform/resolvers` 3 solo en formularios; no tiene `expo-secure-store` ni cliente HTTP. | `apps/mobile/package.json`, `apps/mobile/app/**` |
| `contracts`, la API y la web usan Zod `~4.4.3`; la web consume la API con `openapi-fetch` y tipos generados en `schema.d.ts`. | `packages/contracts/package.json`, `apps/web/package.json` |
| Login ya acepta `deviceId` y `device: { label, platform: 'web'|'android'|'ios' }`, y responde `mustChangePassword`. El refresh puede omitir el `refreshToken` dentro de la ventana de gracia. | `packages/contracts/src/iam/auth.ts` |
| `reports:view` existe; Owner y Manager lo tienen, y Cashier también (el spec de SP2 lo deja "limitado a su propio cierre, que se define en SP4"). | `packages/contracts/src/iam/permissions.ts`, `apps/api/src/modules/iam/domain/system-roles.ts`, spec de SP2 |
| `tenants` no tiene zona horaria; los timestamps son `timestamptz`. | `apps/api/src/infrastructure/db/schema/tenants.ts`, `.../types.ts:24` |
| La API **nunca lee `X-Forwarded-For`**: solo acepta la IP firmada por el BFF (`x-monaco-client-ip`) o usa la del socket. La web sí calcula la IP con `TRUSTED_PROXY_HOPS`. | ADR 0004 §7, `apps/web/src/lib/security/client-ip.ts`, `apps/web/.env.example` |
| La CSP de la web solo permite estilos con nonce (`style-src 'self' 'nonce-…'`): bloquea atributos `style` en el HTML. | `apps/web/src/lib/security/csp.ts:6` |
| La imagen de la API no trae `drizzle-kit` (es dev) y borra `dist/scripts`: no puede migrar ni sembrar. El seed se niega a correr con `NODE_ENV=production`. | `apps/api/Dockerfile`, `apps/api/package.json`, `apps/api/src/scripts/demo-seed.ts:15` |
| Los roles de la DB se crean en `init.sql` como superusuario; `monaco_auth` es `NOLOGIN BYPASSRLS`. | `infra/postgres/init.sql`, ADR 0003 |
| La web no tiene Dockerfile; CI construye `next build` y la imagen de la API. | `.github/workflows/ci.yml` (job `build`) |

## Decisiones

| Tema | Decisión | Por qué |
|---|---|---|
| Fuente de las ventas | Tablas `sales` y `sale_lines` en el servidor. Cada venta es también un `inventory_documents` de tipo `sale` (mismo `id`) con un movimiento `sale` negativo por línea, escrito con el guion de escritura del ADR 0006 (lock por par, stock no negativo). En SP4 solo las escribe el seed mediante el caso de uso `RecordSale` (sin endpoint HTTP) (D1) | El spec de la Etapa 2 pide KPIs "sobre datos demo sembrados"; SP3 ya reservó el tipo `sale` en el libro. Sembrar en el modelo definitivo evita una tabla de hechos descartable y deja a SP5 solo el endpoint de push |
| Montos de una línea | `line_total = round(cantidad × precio_aplicado)` en unidades menores (aritmética en milésimas enteras) y `profit = es_venta_a_costo ? 0 : line_total − cantidad × unit_cost`, calculados **al escribir** por una función de `@monaco/domain` (`saleLineAmounts`) y congelados en la fila, como hace mobile | Una sola regla, en el dominio. Congelar evita que un cambio de costo reescriba la historia |
| Costo de la venta | `unit_cost = effectiveUnitCost({ averageCost: location_products.average_cost, costPrice: products.cost_price })`, leído bajo el lock del par (D2) | Usa el costo promedio por punto de SP3 y cae al precio de costo cuando el promedio es 0, que es la regla que ya publica el dominio |
| Zona horaria | Columna `tenants.time_zone` (IANA, validada en la aplicación). El día de negocio es `[00:00 local, 00:00 local del día siguiente)`, calculado en SQL con `AT TIME ZONE`. "Hoy" lo decide el servidor, no el reloj del dispositivo (D3) | Un tenant con puntos en un mismo país; los rangos semiabiertos no pierden ni duplican ventas en los cambios de horario |
| Fecha de los reportes | Ventas y documentos se agrupan por `occurred_at` (fecha de negocio), nunca por `created_at`. Todo reporte se corta en `now()` de la DB | Una venta sincronizada tarde (SP5) cae en su día real. El corte en `now()` ignora fechas futuras por reloj desfasado y permite sembrar el día completo (D14) |
| Monedas | Todos los importes se agregan **por moneda** del producto; las respuestas son listas por moneda, sin conversión (D6) | SP3 · D2 fija una moneda por producto; sumar CUP y USD daría un número sin sentido |
| Modelo de lectura | Consultas de agregación en vivo sobre `sale_lines` y el libro, con índices cubrientes nuevos y un presupuesto de latencia verificado en un test. Sin vistas materializadas ni cache en SP4 (D7, ADR 0007) | El volumen de un negocio chico (y de la demo ×10) cabe en un índice; RLS se sigue aplicando, cosa que una vista materializada no hace |
| Permisos | `reports:view` (por punto) para los reportes del punto. Un permiso nuevo, `reports:view_own`, para el resumen de las ventas propias del día; el Cashier de sistema pasa a tener este en lugar de `reports:view` (D4). `reports:view` incluye utilidad, margen, pérdidas valoradas y valor de inventario agregados (D5) | Resuelve el "propio cierre" del Cashier sin reglas por nombre de rol (spec de SP2: la API valida permiso + punto, nunca el rol) |
| Mobile: contratos | Mobile consume la API con un **cliente generado** desde `openapi.json` (`openapi-typescript` + `openapi-fetch`), como la web. No importa `@monaco/contracts` en runtime, así que **sigue con Zod 3 en SP4**; la migración a Zod 4 pasa a SP5 (D8) | El cliente generado ya es la decisión de docs/20 para "la web y mobile". Evita tocar los formularios de mobile y su suite financiera en un sub-proyecto de 2 semanas |
| Mobile: sesión | Refresh token y `deviceId` en `expo-secure-store` (Keychain/Keystore, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`); el access token solo en memoria. Refresh con single-flight; logout que borra el almacenamiento aunque la API falle | Mismo modelo de ADR 0004 adaptado a un cliente público nativo, sin BFF |
| IP del cliente en la API | La API acepta `TRUSTED_PROXY_HOPS` (default `0`, comportamiento actual) para tomar la IP de `X-Forwarded-For` contando desde la derecha **solo cuando no hay header firmado válido**. El header firmado del BFF sigue ganando (D12) | Mobile llega directo a la API: detrás del proxy del proveedor, todos compartirían la IP del proxy y un solo atacante bloquearía el login de todos |
| Demo pública | Tenant con `tenants.read_only = true`: un guard global responde `403 DEMO_READ_ONLY` a toda mutación salvo `POST /auth/login`, `/auth/refresh` y `/auth/logout` (lista permitida, denegación por defecto). Reset nocturno de datos (D10) | Las credenciales son públicas: sin esto, el primer visitante cambia la contraseña del Owner o desactiva al resto |
| Despliegue | Supuesto: **Fly.io** para la API y la web (las mismas imágenes Docker de CI) y **Neon** para Postgres 17, condicionado a un spike que valide crear `monaco_auth` con `BYPASSRLS` (D9, ADR 0008) | Ver "Despliegue" y "Decisiones abiertas" |
| Migraciones en deploy | Un job de GitHub Actions corre `pnpm --filter api db:migrate` con la credencial de `monaco_owner` **antes** de desplegar; el runtime solo tiene la de `monaco_app` (D11) | Mínimo privilegio: la credencial que puede alterar el esquema nunca vive en el servidor expuesto |

## Ventas en el servidor (modelo mínimo)

Sigue ADR 0003 (tenant, RLS + `FORCE`, FK compuestas, UUIDv7) y ADR 0006 (libro append-only).

| Tabla | Columnas clave | Restricciones e índices | Privilegios de `monaco_app` |
|---|---|---|---|
| `sales` | `id` (del cliente, = id del documento de inventario), `tenant_id`, `location_id`, `cashier_user_id`, `device_id` (null en SP4), `occurred_at`, `payload_hash`, `created_at` | `UNIQUE (id, tenant_id)`. FK compuestas a `inventory_documents (id, tenant_id)`, `locations`, `users` y `devices` | `SELECT`, `INSERT` |
| `sale_lines` | `id`, `tenant_id`, `sale_id`, `location_id`, `product_id`, `occurred_at` (copiada de la cabecera), `cashier_user_id` (copiado), `currency`, `quantity` (numeric(14,3) > 0), `unit_price` (bigint ≥ 0, precio aplicado), `discount_percent` (numeric(5,2), 0–100), `payment_method` (`cash`/`transfer`), `is_cost_sale`, `unit_cost` (numeric(20,6) ≥ 0), `line_total` (bigint ≥ 0), `profit` (numeric(20,6)) | FK compuestas a `sales`, `location_products (tenant_id, location_id, product_id)`. Índice **`(tenant_id, location_id, occurred_at) INCLUDE (currency, payment_method, line_total, profit, sale_id)`** para los KPIs y `(tenant_id, location_id, product_id, occurred_at)` para rankings y "última venta" | `SELECT`, `INSERT` |

- **Por qué se copian `occurred_at` y `cashier_user_id` en la línea:** los KPIs leen solo `sale_lines` por un índice cubriente, sin join con la cabecera. Son copias escritas una vez en la misma transacción (tablas append-only), no proyecciones que se desincronizan.
- **`payment_method` por línea**, como mobile (`ventas.metodo_pago`): SP5 mapea 1:1 (`efectivo` → `cash`, `transferencia` → `transfer`, mapeo en `@monaco/domain`).
- **Anulación:** fuera de SP4. Cuando SP5 la agregue será una reversión del documento (ADR 0006) y los reportes excluirán las ventas revertidas; las consultas de SP4 ya filtran por "documento no revertido" para que no cambien de forma.
- **Tipo `sale` en el libro:** se agrega con el procedimiento del ADR 0006 (tipo y signo en el dominio, enum de contracts, `CHECK` de `kind` y de signo negativo). `LEGACY_MOVEMENT_KIND` no cambia: las ventas de mobile están en otra tabla.
- **`RecordSale`** (módulo `sales`, solo capa de aplicación): valida, autoriza `sales:create` en el punto, inserta el documento con idempotencia por id + `payload_hash`, toma los locks de los pares en orden global, aplica `assertStockNotNegative`, lee el costo con `effectiveUnitCost`, calcula los montos con `saleLineAmounts` y escribe documento, movimientos, `sales`, `sale_lines` y `audit_event` (`sale_recorded`, sin montos). Lo usa el seed con el `Actor` del Owner demo; SP5 lo expone por HTTP sin cambiarlo.

## KPIs

Notación: `L` es el conjunto de puntos del reporte (ver "Alcance por punto"), `[a, b)` el rango en hora local del tenant convertido a `timestamptz`, `c` una moneda. Toda suma corre sobre filas con `location_id ∈ L`, `occurred_at ∈ [a, b)`, `occurred_at ≤ now()` y documento no revertido. Los importes salen en unidades menores (`Money`) o como `AverageCost` (decimal) cuando tienen fracción de centavo.

| KPI | Fórmula (por moneda `c`) | Regla del dominio |
|---|---|---|
| Ventas en efectivo | `Σ line_total` con `payment_method = 'cash'` | — (suma de montos congelados) |
| Ventas por transferencia | `Σ line_total` con `payment_method = 'transfer'` | — |
| Ventas totales | efectivo + transferencia | — |
| Utilidad bruta | `Σ profit` | `saleLineAmounts` al escribir |
| Margen | `utilidad / ventas totales`, `null` si las ventas son 0; ratio con 4 decimales | `marginRatio` (nuevo) |
| Tickets | cantidad de `sale_id` distintos con al menos una línea en `c` | — |
| Ticket promedio | `round(ventas totales / tickets)`, `null` si no hay tickets | `averageTicket` (nuevo) |
| Pérdidas por merma | `Σ |quantity_delta| × unit_cost` de movimientos `shrinkage` de documentos con `occurred_at` en el rango | `lossValue` (nuevo); misma regla que `sumLossOutflowsValue` de mobile |
| Retiros del dueño | igual, con `owner_withdrawal` | `lossValue` |
| Entradas valoradas | `Σ quantity_delta × unit_cost` de movimientos `entry` | — |
| Valor del inventario (al momento, no por rango) | `Σ stock(p, l) × average_cost(p, l)` sobre los pares de `L` | `deriveStock` vía `SUM(quantity_delta)` |
| Bajo stock (al momento) | productos activos con `stock < getProductThreshold(producto, 5)` | `isLowStock` (nuevo, extrae la regla de `countLowStock` de mobile) |
| Estancados (al momento) | `isStagnant({ stock, lastSaleDate })`, con la última venta del par en fecha local | `isStagnant` |
| Por vencer (al momento) | `isNearExpiration({ expirationDate })` | `isNearExpiration` |
| Ranking de productos | por producto: `Σ quantity`, `Σ line_total`, `Σ profit`; orden por `revenue`, `quantity` o `profit` | — |
| Serie diaria | ventas totales y utilidad por día local (los días sin ventas valen 0) | — |

- **Un documento revertido** (SP3 · D8) no cuenta en ningún período, aunque la reversión sea de otro día: el reporte muestra la historia corregida "a hoy". Es la forma natural de un libro con reversiones y se deja escrita para que nadie la "arregle" por fecha.
- **Sin cantidades sumadas entre productos:** mezclar kg y unidades no tiene sentido; las unidades vendidas solo aparecen por producto.
- **Utilidad bruta, sin gastos:** los gastos no existen en el servidor (non-goal). La UI la llama "Utilidad bruta".

## Zona horaria y corte de día

- `tenants.time_zone text not null default 'America/Havana'` (D3). Se fija al crear el tenant (`tenant:create --time-zone`, validado contra `Intl.supportedValuesOf('timeZone')`) y en el seed. `monaco_app` sigue sin `UPDATE` sobre esa columna (ADR 0003 §9 solo permite `name`); cambiarla queda fuera de SP4.
- Los parámetros de fecha son días locales `YYYY-MM-DD` (`from`, `to`, ambos inclusive). La API convierte a `[ (from::timestamp) AT TIME ZONE tz, ((to + 1)::timestamp) AT TIME ZONE tz )`, así el filtro usa el índice de `occurred_at`. La agrupación diaria usa `(occurred_at AT TIME ZONE tz)::date` sobre `generate_series` de días locales.
- Sin `from`/`to`, el rango es **hoy** en la zona del tenant, calculado con `now()` de la DB. Toda respuesta devuelve `from`, `to`, `timeZone` y `asOf`.
- Rango máximo: 366 días; un rango mayor, o con `from > to`, responde `400 VALIDATION_FAILED`.
- **Cambios de horario:** Cuba cambia la hora a medianoche, así que hay días sin "00:00". Un test fija que, en `America/Havana`, la suma de la serie diaria de un rango que cruza los dos cambios es igual al total del rango, y que una venta a las 23:59:59 y otra a las 00:00:01 caen en días distintos.

## Alcance por punto, RLS y permisos

- **RLS** sigue siendo la segunda barrera: todo reporte corre dentro de `ReportsUnitOfWork` (adaptador sobre `withTenant`). Ninguna consulta usa vistas materializadas ni funciones `SECURITY DEFINER`.
- **Con `locationId`:** `reports:view` en ese punto, o 403 genérico. Sin `locationId`: `L` = todos los puntos activos donde el actor tiene `reports:view` (con alcance tenant, todos); si es vacío, 403. La respuesta incluye `locationIds` para que la UI muestre qué abarca.
- **`reports:view_own` (D4):** solo `GET /reports/summary`, con `locationId` obligatorio, filtrado por `cashier_user_id = actor.userId`; sin utilidad, margen ni pérdidas (`profit: null`). Los demás endpoints dan 403. La respuesta lleva `scope: 'own'`.
- **Costos (D5):** `reports:view` ve agregados con costo (utilidad, margen, pérdidas, valor de inventario, utilidad por producto). Nunca se devuelve un `unit_cost` individual. Queda documentado que la utilidad por producto permite deducir un costo medio: es la razón de que `reports:view` sea un permiso financiero.
- **Procedimiento del permiso nuevo:** el de `CLAUDE.md` ("Adding a permission") y la migración de datos idempotente de SP3 · D11 (en su transacción, `NO FORCE`/`FORCE` en `roles` y `role_permissions`), que además **quita** `reports:view` de los roles Cashier **de sistema** (los roles personalizados no se tocan). Como antes de SP4 no había reportes, nadie pierde una función.

| Rol de sistema | Cambia |
|---|---|
| Owner | + `reports:view_own` (tiene todos) |
| Manager | sin cambios (`reports:view`) |
| Cashier | − `reports:view`, + `reports:view_own` |

## API de reportes

Esquemas nuevos en `packages/contracts/src/reports/`, todos con `.meta({ id })`: `LocalDate`, `TimeZone`, `ReportRangeQuery` (`from?`, `to?`, `locationId?`), `MoneyByCurrency`, `ReportSummary`, `DailySeries`, `TopProducts`, `SummaryByLocation`, `InventoryHealth`. Todos los `GET` responden `Cache-Control: private, no-store`.

| Método y ruta | Permiso (autoridad en el caso de uso) | Respuesta |
|---|---|---|
| `GET /reports/summary` | `reports:view` (punto o todos los visibles) o `reports:view_own` (punto, propias) | Por moneda: ventas (efectivo, transferencia, total), utilidad, margen, tickets, ticket promedio, pérdidas (merma, retiros), entradas valoradas; más `scope`, `locationIds`, `from`, `to`, `timeZone`, `asOf` |
| `GET /reports/daily-series` | `reports:view` | Por moneda, un punto por día local: ventas totales y utilidad |
| `GET /reports/top-products` | `reports:view` | `?by=revenue\|quantity\|profit`, `?limit` (1–50, default 10): producto, cantidad, ventas, utilidad, moneda |
| `GET /reports/by-location` | `reports:view` | Un `ReportSummary` compacto por punto visible |
| `GET /reports/inventory-health` | `reports:view` | Al momento: bajo stock, estancados, por vencer (conteos y los 10 primeros de cada lista), valor del inventario por moneda |

**Mismos endpoints para la web y mobile** (spec de la Etapa 2): la vista "Hoy" llama a `GET /reports/summary?locationId=…` sin fechas y a `GET /reports/inventory-health?locationId=…` (este último solo con `reports:view`).

**Errores:** los de siempre (`401`, `403 FORBIDDEN` genérico, `404` para un punto de otro tenant, `400 VALIDATION_FAILED` para rangos inválidos) más `403 DEMO_READ_ONLY` (ver "Demo pública"). Los códigos nuevos se agregan en una sola tarea de contracts.

**Consultas e índices:** un `SELECT … GROUP BY currency, payment_method` sobre el índice cubriente de `sale_lines`; las pérdidas leen `inventory_movements` por `(tenant_id, document_id)` filtrando documentos `exit`/`entry` por un índice nuevo `inventory_documents (tenant_id, location_id, occurred_at) WHERE kind IN ('exit','entry')`; "no revertido" es un `NOT EXISTS` sobre `UNIQUE (tenant_id, reverses_document_id)`. Las reglas por fila (`getProductThreshold`, `isStagnant`, `isNearExpiration`, `marginRatio`) se aplican en la API sobre el resultado, nunca reescritas en SQL.

**Presupuesto de rendimiento:** con 10× el volumen de la demo (≈ 200 000 líneas de venta), cada endpoint responde en p95 < 300 ms en el contenedor de integración, y `EXPLAIN` no muestra `Seq Scan` sobre `sale_lines` ni `inventory_movements`. Si no se cumple, se aplica la salida del ADR 0007 (proyección diaria), no un cache.

**Cache:** ninguno en SP4. Los permisos se resuelven por petición (ADR 0004) y los datos son privados; un cache por `(tenant, usuario, rango)` tendría que invalidarse con cada venta de SP5. En la web, las páginas son dinámicas (cookies) y cada tarjeta carga en su `<Suspense>`.

## Web: dashboard

Ruta `/tablero` dentro de `(backoffice)`, visible en la navegación con `reports:view` (según `GET /me`). Server Components que llaman a la API con el cliente tipado; los filtros viven en la URL (`?desde`, `?hasta`, `?punto`), así un enlace reproduce la vista.

- **Filtros:** punto (solo los visibles, más "Todos mis puntos"), período (Hoy, 7 días, 30 días, Este mes, rango) y moneda (pestañas, solo las que tienen datos).
- **Tarjetas:** ventas totales (con efectivo y transferencia), utilidad bruta, margen, tickets y ticket promedio, pérdidas (merma y retiros), entradas valoradas.
- **Serie diaria** de ventas y utilidad; **ranking** de productos con selector de orden; **comparativa por punto**; **salud del inventario** (bajo stock, estancados, por vencer, valor).
- **Gráficos:** componentes SVG propios con atributos de presentación (`fill`, `stroke`, `d`), sin atributos `style`, para no relajar la CSP (D13). Cada gráfico tiene una tabla equivalente accesible.
- Estados vacío, de error y de carga por tarjeta; formato de importes con la moneda (`Intl.NumberFormat`), no con `formatCurrency` de mobile, que fija `$` y la configuración regional de mobile.
- Al iniciar sesión, un usuario con `reports:view` aterriza en `/tablero`; el estado de `/health` se mantiene en su página actual.

## Mobile: login online y vista "Hoy"

La caja sigue **local y sin cambios de comportamiento** (docs/20). SP4 agrega una sección "Cuenta en línea" que no toca `db/`, `store/` ni las pantallas de ventas, inventario y reportes locales.

- **Entrada:** Configuración → "Cuenta en línea" (`app/account/`). Sin sesión, muestra el login; con sesión, el usuario, el tenant, "Hoy" y "Cerrar sesión".
- **Configuración:** URL de la API en `EXPO_PUBLIC_API_URL` (no es secreto) por perfil de `eas.json`; nada secreto en el bundle.
- **Cliente:** `openapi-fetch` con tipos generados en `apps/mobile/lib/api/schema.d.ts` desde `packages/contracts/openapi.json` (script `api:generate`, cubierto por el job `openapi-drift`). Un middleware agrega el bearer y, ante un 401, refresca una vez.
- **Login:** `POST /auth/login` con `deviceId` guardado (si existe) y `device: { label: '<plataforma> · Monaco', platform: 'android' | 'ios' }`. Se guardan `refreshToken` y `deviceId` en `expo-secure-store` con `keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY` y la configuración de backup de Android que indique la doc de Expo 54 (para que el refresh no viaje en un backup). El access token vive en memoria.
- **Refresh:** antes de que venza el access (margen de 30 s) o ante un 401. Single-flight: una sola promesa por proceso. Si la respuesta no trae `refreshToken` (ventana de gracia), se conserva el guardado. Un 401 del refresh (reuso, revocación) borra todo y vuelve al login con un mensaje genérico. Al volver la app a primer plano se revalida con `GET /me`.
- **Cambio de contraseña obligatorio:** si `mustChangePassword`, la única pantalla disponible es la de cambio (`POST /auth/password`), que rota la familia del dispositivo y guarda los tokens nuevos.
- **Logout:** `POST /auth/logout` con un timeout corto y, pase lo que pase, borra el almacenamiento seguro y el estado en memoria.
- **"Hoy":** selector de punto (los de `GET /me` con `reports:view` o `reports:view_own`), resumen por moneda (ventas por método de pago, tickets, y utilidad si no es `scope: 'own'`) y, con `reports:view`, bajo stock y por vencer. Encabezado "Datos del servidor · actualizado HH:mm"; el día es el del servidor (`timeZone` de la respuesta). Sin red, muestra "Sin conexión" y el último dato **en memoria**; no se persiste nada del servidor (eso es SP5).
- **Sin sesión en Expo web:** `expo-secure-store` no existe en web; la sección muestra "Disponible en Android e iOS".
- **La suite financiera de mobile (96 tests) y sus umbrales siguen en verde sin cambios**; el código nuevo trae sus propios tests (sesión con `expo-secure-store` simulado, single-flight, ventana de gracia, logout con API caída, pantalla "Hoy" con `scope: 'own'`).

## Seed demo

- **Dos comandos:** `db:seed` (el actual, extendido) para desarrollo, CI y e2e, con una historia corta (`--history-days`, default 14); y `demo:reset` para la demo pública, con 90 días.
- **Volumen de la demo:** los 2 puntos y 3 usuarios del seed de SP2, ~40 productos en 6–8 categorías de `CATEGORIES` (moneda `CUP`; ver D6), precios por punto en algunos productos, 25–60 ventas por día y punto con estacionalidad semanal, 1–4 líneas por venta (≈ 7 000 ventas, ≈ 18 000 líneas), entradas semanales, mermas y retiros ocasionales, una transferencia cada dos semanas (si SP3 · T6 está mergeada) y algunos productos con bajo stock, estancados o por vencer para que el panel de salud no quede vacío.
- **Determinista:** un PRNG con semilla fija y fechas relativas al día del reset en la zona del tenant. Los ids son UUIDv7 válidos derivados del `occurred_at` y del PRNG, así que dos corridas del mismo día producen los mismos ids.
- **Por los casos de uso, no por SQL:** inventario con los casos de uso de SP3 y ventas con `RecordSale`, con el `Actor` del Owner demo. Así el stock nunca queda negativo y el costo promedio es el mismo que produciría la aplicación. Sin puertas traseras de autorización.
- **Idempotente:** `db:seed` no vuelve a sembrar la historia si el tenant demo ya tiene ventas. `demo:reset` es la única forma de regenerarla.
- **Día de hoy completo:** la historia incluye las ventas de todo el día del reset; como los reportes se cortan en `now()`, "Hoy" crece a lo largo del día (D14).
- **Seguro para una demo pública:** nombres de productos genéricos, emails `@demo.example`, contraseñas de demo que solo valen en el tenant `read_only`. `db:seed` sigue negándose a correr con `NODE_ENV=production`.
- **`demo:reset`:** corre con `monaco_owner`, se niega si la base tiene algún tenant con `read_only = false` (la base de la demo solo contiene el tenant demo) y exige `DEMO_RESET_CONFIRM=<slug>`. En una sola transacción hace `TRUNCATE` de las tablas de tenant, recrea el tenant demo (`read_only = true`) y siembra. Los visitantes ven los datos viejos o los nuevos, nunca un estado intermedio; sus sesiones se cierran (las tablas de refresh se vacían).

## Despliegue de la demo pública

### Proveedor (D9)

Requisito duro, no negociable: **poder crear el rol `monaco_auth` con `BYPASSRLS`** (en Postgres 16+ solo puede hacerlo un rol que tenga `BYPASSRLS` o sea superusuario) y roles de login distintos para owner y app. Sin eso habría que rediseñar ADR 0003.

| Opción | A favor | En contra |
|---|---|---|
| **P1 · Fly.io (API + web) + Neon (Postgres 17)** | Las mismas imágenes Docker de CI; red privada para BFF → API; máquinas que se apagan sin tráfico; Neon gestionado, con plan gratuito y ramas | Dos proveedores; `BYPASSRLS` en Neon **a verificar**; arranque en frío de segundos |
| P2 · Render (API + web como servicios Docker) + Render Postgres | Un proveedor, Blueprint (`render.yaml`) en el repo, cron nativo | El plan gratuito duerme los servicios y vence la base; `BYPASSRLS` **a verificar**; para una demo estable hace falta plan pago |
| P3 · Vercel (web) + Fly o Render (API) + Neon | El mejor soporte de Next | Tres proveedores; BFF → API por internet; los saltos de proxy (`TRUSTED_PROXY_HOPS`) cambian por plataforma |
| P4 · VPS (Docker Compose + Caddy) | Superusuario garantizado, costo fijo bajo, igual a local | Parches, backups, TLS y monitoreo a cargo propio; menos representativo de un despliegue gestionado |

**Default (supuesto): P1**, condicionado al spike de la tarea T1 del plan. Si Neon no permite `BYPASSRLS`, el orden de repliegue es Postgres en Fly (con superusuario) y luego P4. El resultado queda en el ADR 0008.

### Entornos y secretos

| Entorno | Para qué | Datos |
|---|---|---|
| Local | Desarrollo (`docker compose`, `pnpm dev`) | `db:seed` |
| CI | Unit, integración (Testcontainers), e2e | `db:seed` corto |
| `demo` | La demo pública (`NODE_ENV=production`) | Solo el tenant demo, `demo:reset` |

Sin staging en SP4 (D16): el e2e de CI corre contra un build de producción, y el spike usa una app temporal que se borra.

| Secreto | Dónde vive | Nunca en |
|---|---|---|
| `DATABASE_URL` (`monaco_app`), `JWT_PRIVATE_JWK`, `JWT_PREVIOUS_PUBLIC_JWK`, `CLIENT_IP_HMAC_SECRET`, `CORS_ORIGINS`, `TRUSTED_PROXY_HOPS` | Secretos del servicio API | La web, el repo, la imagen |
| `API_URL` (privada), `CLIENT_IP_HMAC_SECRET`, `APP_ORIGINS`, `TRUSTED_PROXY_HOPS`, `DEMO_MODE` | Secretos del servicio web | El navegador (nada `NEXT_PUBLIC_`) |
| `DATABASE_MIGRATION_URL` (`monaco_owner`) | GitHub Environment `demo`, solo para `main` | Los servicios en ejecución |
| Credencial de administración de la base (bootstrap de roles) | Fuera del repo; se usa una vez, a mano, con un script versionado equivalente a `init.sql` | CI y servicios |
| Token de deploy del proveedor | GitHub Environment `demo` | — |
| `EXPO_PUBLIC_API_URL` | `eas.json` | No es secreto |

Las claves JWT se generan con `keys:generate` y se rotan con el procedimiento del ADR 0004. `monaco_app` recibe `statement_timeout = '5s'` en el bootstrap, para que una consulta cara no tome la base.

### Pipeline

1. **CI** (sin cambios en sus jobs): calidad, integración, drift de OpenAPI (ahora también el de mobile), build y e2e.
2. **Deploy** (`.github/workflows/deploy.yml`), al terminar CI en verde sobre `main` o a mano: job `migrate` (`db:migrate` con `DATABASE_MIGRATION_URL`) → deploy de la API → deploy de la web → smoke test (`/health` de la API y la página de login).
3. **Reset** (`.github/workflows/demo-reset.yml`): cron diario a las 04:00 de la zona del tenant demo, y a mano.

**Reglas de migración:** solo hacia adelante y compatibles con la versión anterior del código (expandir y después contraer), porque la API vieja sigue sirviendo mientras corre el job. Rollback = volver a desplegar la imagen anterior. Las imágenes base se fijan por digest (lo difirió la Dockerfile de la API hasta SP4) y Dependabot las actualiza.

**Web en contenedor:** `apps/web/Dockerfile` nuevo con `output: 'standalone'` de Next, usuario no root y `HEALTHCHECK`, siguiendo el patrón de la API.

### Protección contra abuso

- **Solo lectura** en el tenant demo (D10), con denegación por defecto: un endpoint nuevo queda bloqueado sin que nadie se acuerde de agregarlo. Se verifica en el `AuthGuard` (que ya lee usuario, dispositivo y familia en una consulta) leyendo además `tenants.read_only`. `POST /auth/password` también queda bloqueado, así que nadie cambia una contraseña publicada.
- **Rate limits:** los de ADR 0004 en auth, más el throttler `ip` (30/min) en `/reports/*`. Detrás del proxy, la web usa `TRUSTED_PROXY_HOPS` (el valor que dé el spike) y firma la IP; la API usa su propio `TRUSTED_PROXY_HOPS` para mobile. Un test fija que con `TRUSTED_PROXY_HOPS=0` nada cambia y que un `X-Forwarded-For` falsificado a la izquierda no se usa.
- **Crecimiento de la base:** cada login crea un dispositivo y una familia; el reset nocturno los vacía. La documentación de la demo pide reusar el navegador.
- **Login de demo:** con `DEMO_MODE=true`, la página de login de la web muestra las tres cuentas demo con botones que completan el formulario (no hay login automático ni token en la URL).
- **Cookies y CSP detrás del proxy:** TLS termina en el borde, y el navegador ve `https`, así que las cookies `__Host-` con `Secure` funcionan. `APP_ORIGINS` y `serverActions.allowedOrigins` usan el origen público. Se agrega `Strict-Transport-Security` si el borde no lo pone. La CSP con nonce no cambia. `CORS_ORIGINS` de la API es solo el origen de la web.

### Observabilidad y costo

- **Logs:** el JSON de `pino` de la API (ya existe) al log del proveedor, con request id; la duración de `/reports/*` se registra para comparar con el presupuesto. Nunca se registran tokens, contraseñas ni la IP en claro fuera del log de seguridad que ya define ADR 0004.
- **Salud:** el health check del proveedor sobre `/health` de la API y de la web, y un monitor externo gratuito de disponibilidad. Sin APM ni Sentry en SP4 (D15).
- **Costo:** objetivo de pocos dólares al mes. Las cifras exactas se confirman en el spike con los precios vigentes y se anotan en el ADR 0008; si la demo apaga máquinas sin tráfico, la primera visita tarda unos segundos más, y se acepta.

## Seguridad

- **Permiso + punto en cada caso de uso** de reportes; `locationIds` solo incluye puntos autorizados; un punto de otro tenant da 404. RLS como segunda barrera; nada de vistas materializadas ni `SECURITY DEFINER` nuevas.
- **Sin oráculos entre puntos:** los agregados "todos mis puntos" solo suman puntos visibles; `inventory-health` no revela stock de otros puntos.
- **`reports:view_own`** no expone utilidad ni costos, y filtra por el usuario del token, nunca por un parámetro.
- **Ventas append-only** por privilegios (`INSERT`/`SELECT`), igual que el libro.
- **Mobile:** sin secretos en el bundle; refresh en almacenamiento seguro del sistema; access en memoria; la detección de reuso de ADR 0004 cubre un refresh copiado.
- **IP detrás del proxy:** el header firmado sigue mandando; `TRUSTED_PROXY_HOPS` solo cuenta desde la derecha y su default no cambia nada.
- **Demo:** tenant de solo lectura con denegación por defecto, base dedicada, reset que se niega a correr si hay un tenant real, credenciales de owner fuera del runtime, `statement_timeout` y rangos acotados contra consultas caras.

## Tests

- **Unitarios (`packages/domain`):** `saleLineAmounts` (redondeo en milésimas enteras, venta a costo, descuento), `marginRatio`, `averageTicket`, `lossValue`, `isLowStock`; signo de `sale` en `movementDelta`; mapeo de método de pago de mobile. La suite de mobile sigue en verde sin cambios.
- **Unitarios de la API:** casos de uso de reportes con fakes (autorización antes de leer, `view_own` sin utilidad, rango por defecto, límites), `RecordSale` (idempotencia, orden de locks), guard de solo lectura (lista permitida) y la IP con `TRUSTED_PROXY_HOPS`.
- **Integración (Testcontainers, `monaco_app`):**
  - RLS + `FORCE`, FK compuestas y matriz de privilegios de `sales` y `sale_lines`;
  - la migración de permisos (idempotente, `FORCE` activo después, Cashier sin `reports:view` y con `reports:view_own`, roles personalizados intactos);
  - **fuga entre tenants y entre puntos** en cada endpoint de reportes; "todos mis puntos" excluye los no visibles;
  - **KPIs contra un oráculo:** un fixture fijo con totales calculados a mano (incluye mermas, una entrada revertida, venta a costo, dos monedas y una venta futura que no cuenta);
  - **corte de día:** `America/Havana` cruzando los cambios de horario; serie diaria = total del rango;
  - `RecordSale` concurrente con salidas de inventario sobre el mismo par: stock final ≥ 0 y sin deadlock;
  - **rendimiento:** volumen ×10, p95 < 300 ms y sin `Seq Scan` en las tablas grandes;
  - tenant `read_only`: toda mutación da `403 DEMO_READ_ONLY` (se recorre la lista de rutas de la app), login, refresh y logout funcionan;
  - `demo:reset` se niega con un tenant real y es atómico; `db:seed` dos veces no duplica.
- **Mobile (Jest):** sesión, refresh single-flight, ventana de gracia, logout sin red, cambio obligatorio y pantalla "Hoy".
- **E2E (Playwright):** el Owner del seed abre `/tablero`, cambia de período y de punto; el Manager solo ve su punto; el Cashier no ve el tablero; con `DEMO_MODE`, una mutación muestra el mensaje de demo de solo lectura.
- **Smoke del deploy:** `/health`, login demo y `GET /reports/summary` contra la URL pública.

## Decisiones abiertas

El spec de la Etapa 2 y docs/20 no fijan estos puntos. El resto del documento **asume el default recomendado**; si se elige otra opción, cambian las secciones indicadas. **[Dueño]** marca las decisiones de producto o de costo que debe tomar el dueño.

| # | Decisión | Opciones y tradeoffs | Default recomendado (supuesto) |
|---|---|---|---|
| D1 | De dónde salen las ventas en SP4 | (a) modelo mínimo de ventas en el servidor, en el libro (`sale`), escrito solo por el seed vía `RecordSale`: lo reutiliza SP5, mueve el stock de verdad; (b) tabla de hechos sembrada solo para reportes: rápido, pero se tira en SP5 y el stock no refleja las ventas; (c) KPIs sin ventas (solo inventario): no cumple "KPIs sobre datos sembrados" con sentido | (a). El spec de la Etapa 2 dice "datos demo sembrados"; (a) es lo único que no se descarta en SP5 |
| D2 | **[Dueño]** Costo base de la utilidad | (a) `effectiveUnitCost`: costo promedio del punto, o precio de costo si el promedio es 0; (b) `products.cost_price`, como hace hoy mobile (`apps/mobile/db/sales.ts:103`): coincide con la app, pero ignora lo que realmente costó el stock | (a). Cambia los números respecto de la app mobile actual |
| D3 | **[Dueño, el valor]** Zona horaria | (a) por tenant (`tenants.time_zone`); (b) por punto: más general, más complejo de agregar; (c) UTC: los días no coinciden con la caja | (a), con default `America/Havana` (las monedas de contracts son las de Cuba) |
| D4 | **[Dueño]** El "propio cierre" del Cashier | (a) permiso nuevo `reports:view_own` (resumen propio del día, sin utilidad); el Cashier de sistema lo recibe en lugar de `reports:view`; (b) el Cashier mantiene `reports:view` y ve todo su punto, utilidad incluida; (c) el Cashier no ve reportes | (a) |
| D5 | **[Dueño]** Costos en reportes | (a) `reports:view` ve utilidad, margen, pérdidas valoradas y valor del inventario (agregados); (b) solo con `inventory:write` o `catalog:write` en el punto (como SP3 · D10): un rol de solo reportes no vería utilidad | (a), documentando que es un permiso financiero |
| D6 | Monedas | (a) KPIs por moneda, sin conversión; el seed usa solo `CUP` y los tests cubren dos monedas; (b) convertir con una tasa: requiere un modelo de tasas que nadie pidió | (a) |
| D7 | Modelo de lectura | (a) consultas en vivo + índices cubrientes + presupuesto medido; (b) proyección diaria por (punto, producto, día) escrita en la transacción de la venta: lecturas O(días), pero otro dato que mantener y reconstruir; (c) vistas materializadas: **no aplican RLS**, habría que envolverlas | (a), con (b) como salida documentada (ADR 0007) |
| D8 | Contratos en mobile | (a) cliente generado desde OpenAPI, sin `@monaco/contracts` en runtime; mobile sigue con Zod 3 y la migración pasa a SP5; (b) migrar mobile a Zod 4 y `@hookform/resolvers` 5 ya en SP4 e importar contracts: toca formularios y arriesga la suite financiera; (c) Zod 3 y 4 juntos: dos copias en el bundle | (a) |
| D9 | **[Dueño, costo]** Proveedor de despliegue | P1–P4 de "Proveedor" | P1 (Fly.io + Neon), condicionado al spike de `BYPASSRLS` |
| D10 | **[Dueño]** Política de la demo pública | (a) solo lectura (denegación por defecto) + reset nocturno: segura, pero no muestra formularios funcionando; (b) escritura completa + reset frecuente: muestra todo, pero un visitante cambia contraseñas o escribe contenido ofensivo que ven los demás; (c) un tenant efímero por visitante: lo más vistoso, pero exige provisión pública (abuso, crecimiento) y contradice "sin registro público"; (d) híbrido: inventario escribible, administración bloqueada | (a). Los flujos de escritura se muestran en el video o el README y en local |
| D11 | Migraciones en el deploy | (a) job de CI con la credencial de owner, antes del deploy; (b) comando *pre-deploy* del proveedor: la credencial de owner queda en el entorno del runtime; (c) al arrancar la API: el runtime necesita permisos de esquema | (a) |
| D12 | IP del cliente para mobile | (a) `TRUSTED_PROXY_HOPS` en la API cuando no hay header firmado (enmienda al ADR 0004); (b) mobile pasa por el BFF: un salto más y una superficie nueva en la web; (c) aceptar la IP del proxy: un atacante bloquea el login de todos los móviles | (a) |
| D13 | Gráficos en la web | (a) SVG propio con atributos de presentación: sin dependencias y sin tocar la CSP; (b) una librería de gráficos: suelen usar atributos `style`, que la CSP actual bloquea; obligaría a `style-src-attr 'unsafe-inline'` o a renderizar solo en el cliente | (a) |
| D14 | "Hoy" en la demo | (a) el reset siembra el día completo y los reportes se cortan en `now()`; (b) reset cada hora: más carga y más cortes de sesión | (a) |
| D15 | Errores en producción | (a) logs del proveedor + health checks; (b) Sentry o similar: mejor diagnóstico, otro proveedor y otra política de datos | (a) en SP4 |
| D16 | Staging | (a) sin staging, e2e contra build de producción en CI; (b) un entorno más: el doble de costo y de secretos | (a) |

## Compatibilidad hacia adelante (SP5)

- **Ventas:** SP5 expone `RecordSale` en el push del op-log sin cambiar el modelo: ids UUIDv7 del dispositivo, idempotencia por id + `payload_hash`, `device_id` de la sesión y `occurred_at` del dispositivo (los reportes ya agrupan por fecha de negocio).
- **Anulación:** como reversión del documento `sale` (ADR 0006); los reportes ya excluyen documentos revertidos.
- **Stock negativo offline:** la política la define SP5; `RecordSale` mantiene la regla estricta y SP5 decide si una venta offline que no cabe se acepta y se marca.
- **Sesión mobile:** el almacenamiento seguro, el `deviceId` estable y el single-flight de SP4 son la base del refresh en segundo plano y del cache de permisos de SP5.
- **Zod:** si SP5 necesita validar en el dispositivo (op-log, UUIDv7), migra mobile a Zod 4 y `@hookform/resolvers` 5 con la suite financiera en verde.
- **Reportes con volumen real:** si las cajas reales superan el presupuesto, la proyección diaria del ADR 0007 se agrega sin cambiar los contratos.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| SP4 tiene 2 semanas (docs/20) y depende de que SP3 termine; si T6 de SP3 se desliza, entra primero | Orden de recorte del plan: la comparativa por punto y la salud del inventario se pueden publicar después de la demo sin afectar el gate |
| El proveedor no permite `BYPASSRLS` | Spike como primera tarea, en paralelo con el dominio; repliegue ya ordenado (D9) |
| La demo pública se usa para atacar el login o cargar la base | Solo lectura, rate limits con la IP real, `statement_timeout`, rangos acotados, reset nocturno, base dedicada |
| Los KPIs no coinciden con la app mobile | Las fórmulas están escritas acá y comparadas con las consultas de mobile; D2 es la única diferencia deliberada |
| Cortes de día mal calculados con cambios de horario | Rangos semiabiertos en SQL y test con `America/Havana` |
| Tocar mobile rompe la caja | Código nuevo aislado en `app/account/` y `lib/`; la suite financiera es gate en cada PR |

## Entregables de documentación

- **ADR 0007** · Ventas en el servidor dentro del libro y modelo de lectura de reportes (consultas en vivo, zona horaria por tenant, sin cache).
- **ADR 0008** · Despliegue de la demo pública (proveedor, migraciones fuera del runtime, tenant de solo lectura, reset, IP detrás del proxy).
- Actualizar **ADR 0004** (`TRUSTED_PROXY_HOPS` en la API, sesión en mobile), **ADR 0005** (`reports:view_own`, Cashier sin `reports:view`) y **ADR 0006** (tipo `sale`).
- `README`: cómo abrir la demo, las cuentas demo y cómo correr la app mobile contra la API pública. `CLAUDE.md`: módulos `sales` y `reports`, `demo:reset` y el pipeline de deploy.

## Gate de salida (de docs/20, detallado)

- **KPIs en la web sobre datos sembrados:** `/tablero` muestra los KPIs de este spec para el tenant demo, por período, punto y moneda; las cifras coinciden con el oráculo del test de integración; fuga entre tenants y entre puntos probada en cada endpoint; presupuesto de rendimiento cumplido.
- **Mobile con login online y vista "Hoy":** login con registro de dispositivo (Android o iOS), refresh transparente, logout, cambio de contraseña obligatorio y "Hoy" con `reports:view` y con `reports:view_own`, contra la API pública. La suite financiera de mobile, sin cambios y en verde.
- **Tenant demo sembrado:** `db:seed` idempotente y `demo:reset` atómico, con el volumen descrito.
- **Demo pública desplegada:** web y API en el proveedor elegido por pipeline, migraciones por el job de CI, tenant de solo lectura (test por ruta), reset nocturno funcionando, health checks y smoke test en verde, secretos de owner fuera del runtime.
- `openapi.json`, `schema.d.ts` de la web y el de mobile regenerados; CI verde, incluido `e2e`.
