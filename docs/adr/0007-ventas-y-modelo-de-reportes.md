# ADR 0007 · Ventas en el libro de inventario y modelo de lectura de reportes

- **Estado:** propuesta (2026-11-16)
- **Contexto:** SP4, `apps/api` (módulos `sales` y `reports`), `packages/domain` y Postgres 17. Spec: [SP4](../superpowers/specs/2026-11-16-sp4-dashboard-demo-design.md). Se apoya en el libro de inventario del [ADR 0006](0006-libro-de-inventario.md), el aislamiento del [ADR 0003](0003-aislamiento-tenants-rls.md) y la autorización del [ADR 0005](0005-autorizacion.md).

## Contexto

El spec de la Etapa 2 pide un dashboard de KPIs en la web y una vista "Hoy" en mobile, con los mismos endpoints, protegidos por `reports:view`, "sobre datos demo sembrados". Pero las ventas reales llegan recién en SP5, con el sync de la caja: en SP4 el servidor no tiene ventas. Hay que decidir dónde viven las ventas sembradas y cómo se leen los KPIs (por moneda, por punto, por día local del negocio) sin romper RLS ni duplicar reglas del dominio.

## Decisión

1. **Las ventas viven en su modelo definitivo, dentro del libro.** `sales` (cabecera) y `sale_lines` (líneas), append-only para `monaco_app`. Cada venta es también un `inventory_documents` de tipo `sale`, con el mismo `id`, y un movimiento `sale` negativo por línea. La escribe el caso de uso `RecordSale` con el guion del ADR 0006 (idempotencia por id + `payload_hash`, locks ordenados, `assertStockNotNegative`). En SP4 no hay endpoint HTTP: solo el seed usa `RecordSale`, con el `Actor` del Owner demo. SP5 lo expone sin cambiar el modelo.
2. **Los montos se congelan al escribir.** `line_total` y `profit` los calcula `saleLineAmounts` de `@monaco/domain`; el `unit_cost` sale de `effectiveUnitCost` sobre el costo promedio del par, leído bajo el lock. Las líneas copian `occurred_at` y `cashier_user_id` de la cabecera para que los KPIs lean una sola tabla por un índice cubriente.
3. **Consultas de agregación en vivo, sin cache.** Los KPIs son `SUM … GROUP BY currency, payment_method` sobre `sale_lines (tenant_id, location_id, occurred_at) INCLUDE (…)`, y las pérdidas y entradas sobre el libro con un índice parcial por fecha. Todo corre dentro de `withTenant`, así que RLS sigue siendo la segunda barrera. Las reglas por fila (umbral de bajo stock, estancado, por vencer, margen) se aplican en la API con las funciones del dominio.
4. **Días locales del tenant.** `tenants.time_zone` (IANA; default `America/Havana`). **Se valida al escribir, nunca al leer:** `tenant:create --time-zone` usa `TimeZone` de contracts (`Intl.supportedValuesOf('timeZone')` más `UTC`), pero las respuestas de reportes devuelven la zona guardada como un texto no vacío, sin volver a validarla. La lista de ICU de Node cambia entre versiones (hoy lista `Europe/Kiev` y no `Europe/Kyiv`, que Postgres sí resuelve), y validar la respuesta convertiría una zona guardada en un 500 tras actualizar Node. Se eligió esto frente a validar con `Intl.DateTimeFormat` porque esa vía también acepta offsets (`+05:00`) y nombres en minúsculas, que no deben entrar al escribir. Un test fija que `Europe/Kyiv` guardada se lee y Postgres la convierte. Los parámetros son días locales; la API filtra por rangos semiabiertos `[inicio local, inicio local del día siguiente)` convertidos con `AT TIME ZONE`, y agrupa por `(occurred_at AT TIME ZONE tz)::date`. "Hoy" lo decide `now()` de la DB, y todo reporte se corta en `now()`.
5. **Importes por moneda.** Ninguna suma mezcla monedas; las respuestas son listas por moneda.
6. **Presupuesto medido.** Con 10× el volumen de la demo y ventanas de hasta 30 días (los períodos del tablero), p95 < 300 ms por endpoint y sin `Seq Scan` en las tablas grandes, verificado en un test de integración; las ventanas de 90 días se permiten pero quedan fuera del presupuesto (enmienda del 2026-11-22, ver "Resultados medidos"). Si deja de cumplirse, la salida es una proyección diaria (punto 1 de "Alternativas"), no un cache.

## Alternativas descartadas

- **Proyección diaria por (punto, producto, día) escrita en la transacción de la venta:** lecturas proporcionales a los días y no a las líneas, pero es un dato más que mantener, reconstruir y migrar, y con el volumen de un negocio chico no hace falta. Queda como salida si el presupuesto no se cumple.
- **Vistas materializadas:** Postgres no aplica RLS a una vista materializada; habría que envolverla en funciones o vistas con filtros, y refrescarla introduce datos viejos. Una tercera puerta sin tenant no compensa.
- **Tabla de hechos sembrada solo para reportes:** rápida de hacer, pero se tira en SP5 y el stock no reflejaría las ventas: la demo mostraría inventario que no cuadra con lo vendido.
- **Stock = libro − ventas (como `deriveStock` de mobile):** dos fuentes para el stock y dos locks distintos. SP3 ya decidió que las ventas entran al libro como `sale`.
- **Cache en memoria o HTTP:** los permisos se resuelven por petición (ADR 0004) y SP5 escribirá ventas en cualquier momento; invalidar un cache por (tenant, usuario, rango) cuesta más que la consulta.
- **Día de negocio en UTC o del dispositivo:** UTC corta el día a la hora equivocada; el reloj del dispositivo hace que la web y mobile muestren días distintos.

## Consecuencias

- El tipo `sale` se agrega con el procedimiento del ADR 0006 (dominio, enum de contracts, `CHECK` de `kind` y de signo).
- Una venta sincronizada tarde cae en su día real, porque los reportes agrupan por `occurred_at`. Los totales de un día pasado pueden cambiar después del sync: es correcto y se explica en la UI de SP5.
- Un documento revertido no cuenta en ningún período, aunque la reversión sea de otro día: los reportes muestran la historia corregida.
- Cambiar la zona horaria de un tenant cambiaría la agrupación de toda su historia; por eso `monaco_app` no puede actualizarla y en SP4 no hay endpoint para hacerlo.
- Un permiso que ve utilidad por producto permite deducir costos medios: `reports:view` es un permiso financiero (ADR 0005).
- **`RecordSale` reutiliza el guion de escritura del libro** (`inventory/application/record-document.ts`) en lugar de escribir un segundo: la línea de venta tiene su propia valoración (`sold`), que toma `effectiveUnitCost` del par bajo el lock (el promedio, o `products.cost_price` mientras el promedio es 0) y no mezcla el promedio. `writeDocument` acepta una extensión que escribe `sales` y `sale_lines` en la misma transacción, después de los movimientos y antes del evento de auditoría, con el costo de cada línea tal como quedó en su movimiento. El cajero es el `Actor`; `sale_recorded` solo guarda punto y cantidad de líneas.
- **Supuestos de T5 (el spec no los fija):** como las salidas (D15), una venta puede vaciar un punto o un producto archivado; el precio aplicado (`Money`) debe estar en la moneda del producto (`CURRENCY_MISMATCH`); un producto aparece una sola vez por venta, como en todo documento del libro. El comando vive en `apps/api/src/modules/sales/domain/sale-command.ts` hasta que SP5 lo exponga por HTTP y lo mueva a `packages/contracts`.
- **Una venta no se revierte por `POST /inventory/documents/:id/reversal`** (403 `permission_denied` para cualquier actor): anularla también tiene que anular su fila de `sales`, y la anulación es de SP5, con su propio permiso. Sin este bloqueo, alguien con `inventory:write` podría devolver el stock y dejar la venta contando en los reportes.

## Resultados medidos (SP4 · T6, 2026-11-21)

Medido en el contenedor de integración (`postgres:17-alpine`, Testcontainers, `work_mem` por defecto de 4 MB) con `test/integration/reports-performance.e2e.test.ts`: 80 000 ventas y ≈ 200 000 líneas en 90 días, 2 puntos, 40 productos, entradas semanales, mermas y 1 % de ventas revertidas. p95 de 20 peticiones HTTP por endpoint (con autenticación y throttler), "todos mis puntos" / un punto:

| Rango | summary | daily-series | top-products | by-location | inventory-health |
|---|---|---|---|---|---|
| Hoy | 17 / 12 ms | 9 / 8 ms | 10 / 9 ms | 14 / 11 ms | 37 / 21 ms |
| 7 días | 27 / 23 ms | 21 / 14 ms | 24 / 17 ms | 42 / 18 ms | 37 / 21 ms |
| 30 días | 95 / 49 ms | 71 / 39 ms | 73 / 41 ms | 154 / 61 ms | 35 / 22 ms |
| 90 días (toda la historia) | 261 / 251 ms | 161 / 87 ms | 91 / 104 ms | **352 / 321 ms** | 34 / 21 ms |

- Con esa primera medición se cumplía el presupuesto para hoy y 7 días, y la latencia para 30 días; no se cumplía en dos casos: (1) con 30 días, `top-products` planificaba `Seq Scan` en `sale_lines` porque necesita `product_id` y `quantity`, que `sale_lines_kpi_idx` no incluía; (2) con 90 días, que aquí es toda la tabla, todos los agregados de `sale_lines` usaban `Seq Scan` y `by-location` superaba los 300 ms (352 / 321 ms).
- **Dos hallazgos de implementación:** bajo RLS, Postgres solo usa como condición de índice los predicados *leakproof*, y `AT TIME ZONE` y `now()` no lo son; por eso los límites del rango y el corte se calculan en una sentencia aparte y se pasan como parámetros `timestamptz` (sin eso, todo reporte recorría el punto entero). Y los tickets se cuentan agrupando primero por venta, no con `count(distinct sale_id)`, que siempre ordena y desbordaba a disco.

### Enmienda: opción B (2026-11-22)

**El owner eligió la opción B el 2026-11-22:** ampliar el índice cubriente y acotar el presupuesto a las ventanas de hasta 30 días (Hoy, 7 días, 30 días, Este mes) con 10× el volumen. Las ventanas de 90 días se permiten, pero quedan fuera del presupuesto: el test las mide y las registra sin afirmarlas. La proyección diaria de "Alternativas" sigue siendo la salida documentada cuando el volumen real lo exija.

- **Índice:** la migración custom 0017 recrea `sale_lines_kpi_idx` como `(tenant_id, location_id, occurred_at) INCLUDE (currency, payment_method, line_total, profit, sale_id, product_id, quantity)`, así que el ranking también es un *index-only scan*.
- **`random_page_cost = 1.1` en la transacción de reportes** (`SET LOCAL` en `DrizzleReportsUnitOfWork`). Con el valor por defecto (4, pensado para discos giratorios), una ventana de 30 días que contiene un tercio de `sale_lines` cuesta lo mismo con el índice que con `Seq Scan` (el costo difiere en un 2–5 % y la latencia medida es igual), y el planificador alternaba entre ambos planes de una corrida a otra para cualquier ancho del índice. 1.1 es el valor habitual para almacenamiento SSD y mantiene estable el plan por índice; solo afecta a las lecturas de reportes.
- **Puerta de CI:** el `EXPLAIN` sin `Seq Scan` corre siempre y se afirma para hoy, 7 y 30 días (90 días se registra). La latencia depende de la máquina, así que sus mediciones solo corren con `REPORTS_PERF=1` (`REPORTS_PERF=1 pnpm --filter api test:integration reports-performance`).
- **Días locales:** `día::timestamp AT TIME ZONE zona` resuelve una medianoche ambigua (el retroceso de Havana a las 01:00 → 00:00, el 2026-11-01) a su segunda ocurrencia, así que la primera hora del día caía en el día anterior. Cada día empieza ahora en su primer instante, y la serie diaria agrupa con `width_bucket` sobre esos mismos límites, de modo que siempre suma lo mismo que los totales.
- **Ranking por moneda:** `top-products` ordena y aplica `limit` dentro de cada moneda; nunca compara importes de monedas distintas.

Nueva medición, en el mismo contenedor y en la misma máquina con carga (load average ≈ 7 en 8 núcleos), una corrida justo después de la otra, antes / después de la enmienda, "todos mis puntos" / un punto, en ms:

| Rango | summary | daily-series | top-products | by-location | inventory-health |
|---|---|---|---|---|---|
| 30 días, antes | 261 / 111 | 136 / 84 | 150 / 69 | 294 / 108 | 72 / 45 |
| 30 días, después | 195 / 105 | 104 / 65 | 98 / 64 | 219 / 110 | 70 / 47 |
| 90 días, después (fuera del presupuesto) | 515 / 263 | 177 / 103 | 124 / 170 | 513 / 278 | 69 / 45 |

Con la enmienda, hoy, 7 y 30 días cumplen el presupuesto (latencia y planes); con 90 días tampoco queda ningún `Seq Scan`, pero `summary` y `by-location` superan los 300 ms con todos los puntos, como se espera fuera del presupuesto.
