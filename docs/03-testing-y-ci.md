# 03 · Testing y CI

**Prioridad: ALTA · Esfuerzo: 1-2 días para la base + hábito continuo**

## Estado actual

- **Cero tests.** No hay archivos `*.test.*` ni runner configurado (CLAUDE.md lo reconoce: "No test runner is configured yet"). `package.json` solo tiene `lint`; no hay script `test` ni `typecheck`.
- **Sin CI.** No existe `.github/workflows/`; nada valida los commits automáticamente.
- Las verificaciones del ROADMAP se hicieron a mano ("efectivo=47 → transferencia=50 ✓", "4u×100 + 10u×130 → 121.43") y no quedaron codificadas, así que cualquier refactor puede romperlas en silencio.

## Problema / impacto

Esta app **maneja dinero**. La lógica financiera está bien aislada (buena noticia: es fácilmente testeable) pero sin cobertura:

- [lib/pricing.ts](../lib/pricing.ts) — precio transferencia con redondeo a múltiplo de 5.
- [db/queries.ts:57-75](../db/queries.ts#L57-L75) — `recalculateAverageCost`, costo promedio ponderado (incluye el caso borde `denominator <= 0` → devuelve `newCost`).
- [db/queries.ts:7-55](../db/queries.ts#L7-L55) — stock derivado (`entrada`/`ajuste` suman, resto resta, ventas no anuladas restan).
- [db/sales.ts:55](../db/sales.ts#L55) — utilidad `(precio - costo) × cantidad` y el fallback de `costAtSale`.
- [lib/product-status.ts](../lib/product-status.ts) — estancado/por vencer (ya recibe `today` inyectable: diseñado para test).

Un error de redondeo o de signo aquí = dinero mal contado todos los días, y nadie lo notaría hasta que las cuentas no cuadren.

## Plan de mejora

### Paso 1 — Instalar el runner (jest-expo)

```bash
pnpm add -D jest jest-expo @types/jest
```

En `package.json`:

```json
"scripts": {
  "test": "jest",
  "typecheck": "tsc --noEmit"
},
"jest": { "preset": "jest-expo" }
```

(`@testing-library/react-native` puede esperar: la prioridad es lógica pura, no componentes.)

### Paso 2 — Tests de lógica pura (mayor valor, cero mocks)

`lib/__tests__/pricing.test.ts` — casos del ROADMAP T-04:

| entrada (efectivo) | esperado (transferencia) |
|---|---|
| 47 | 50 |
| 20 | 20 |
| 100 | 110 |
| 0 | 0 |

`lib/__tests__/product-status.test.ts` — con `today` fijo: sin venta nunca + stock>0 → estancado; venta hace 6 días → no; hace 7 → sí; stock 0 → nunca estancado; vencimiento en 0-7 días → alerta, vencido (días<0) → no alerta (comportamiento actual: [lib/product-status.ts:23](../lib/product-status.ts#L23) — decidir si un producto **ya vencido** debería alertar también; hoy no lo hace y parece un bug de especificación).

### Paso 3 — Tests de la capa db contra SQLite real

Las funciones de `db/` importan `db` desde [db/client.ts](../db/client.ts) (singleton sobre `expo-sqlite`, que no corre en Node). Dos opciones:

- **Opción recomendada:** `pnpm add -D better-sqlite3 @types/better-sqlite3` y mapear el módulo en Jest (`moduleNameMapper` de `./client` → un client de test con `drizzle-orm/better-sqlite3` que aplica `drizzle/0000_dark_payback.sql` a una DB `:memory:`). Drizzle expone la misma API sync sobre better-sqlite3, así que `registerSalesSession` (transacción sync) funciona igual.
- Alternativa mínima: refactorizar las funciones para recibir `db` como parámetro (inyección). Más invasivo; solo si el mapping da guerra.

Casos prioritarios:
1. **Costo promedio:** entrada 4u×100 + entrada 10u×130 → promedio 121.43 (caso del ROADMAP T-01/T-06); stock 0 previo → toma el costo nuevo.
2. **Stock derivado:** entrada 10, venta 3, merma 2, ajuste −1 → stock 4; venta anulada no descuenta.
3. **`registerSalesSession`:** inserta N filas, utilidad correcta, usa `averageCost` actual del producto (no el del carrito).
4. **`getDailySummary`:** mezcla efectivo/transferencia/costo → totales por método correctos; ventas de otra fecha no cuentan.

### Paso 4 — CI con GitHub Actions

`.github/workflows/ci.yml`:

```yaml
name: CI
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
```

### Paso 5 (hábito) — Regla para el futuro

Toda función nueva en `db/queries.ts` o `lib/` que calcule dinero o stock entra con su test. Los reportes de M5 (T-16–T-18) son el caso ideal: sus agregaciones nuevas (`getRangeSummary`, rankings) nacen testeadas.

## Criterio de hecho

- `pnpm test` corre en verde con los casos de los pasos 2-3.
- `pnpm typecheck` existe y pasa.
- El workflow de CI corre lint + typecheck + test en cada push.

## No entra en este plan

Tests de UI/componentes y E2E (Maestro/Detox): valor real pero coste alto para un solo desarrollador; reconsiderar tras el MVP. El smoke-testing manual en dispositivo (pendiente de T-01) sigue siendo necesario y no lo sustituye esto.
