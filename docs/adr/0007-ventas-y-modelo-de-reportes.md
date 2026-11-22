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
6. **Presupuesto medido.** Con 10× el volumen de la demo, p95 < 300 ms por endpoint y sin `Seq Scan` en las tablas grandes, verificado en un test de integración. Si deja de cumplirse, la salida es una proyección diaria (punto 1 de "Alternativas"), no un cache.

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
