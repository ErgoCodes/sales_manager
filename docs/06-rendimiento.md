# 06 · Rendimiento

**Prioridad: MEDIA (sube a ALTA cuando el catálogo crezca) · Esfuerzo: medio día**

## Estado actual

Con 20-50 productos y unos meses de ventas la app probablemente funcione bien; los problemas de abajo son **cuadráticos con el tamaño de los datos** y esta app acumula historial para siempre (offline, sin purga). Mejor arreglarlos ahora que son 3 cambios pequeños.

### 1. `countLowStock` es N+1 — se ejecuta en cada focus del Home

[db/queries.ts:158-175](../db/queries.ts#L158-L175): recorre todos los productos activos y llama `calculateStock(p.id)` por cada uno — y cada `calculateStock` son **2 queries** con `SUM` sobre todas las filas de movimientos y ventas del producto. Con 50 productos: ~101 queries cada vez que se entra al tab Inicio.

Lo irónico: **la solución ya existe en el mismo archivo.** `calculateAllStocks()` ([db/queries.ts:28-55](../db/queries.ts#L28-L55)) calcula todos los stocks con 2 queries agregadas (GROUP BY), y es lo que usa `listProducts`.

### 2. `ProductPicker` consulta la DB en cada tecla, sin debounce

[components/ui/product-picker.tsx:31-41](../components/ui/product-picker.tsx#L31-L41): `handleSearch` llama `listProducts({ search: text })` en **cada `onChangeText`**, y `listProducts` internamente ejecuta `calculateAllStocks()` (2 agregaciones sobre tablas completas). Escribir "malanga" = 7 rondas de agregación completa. Además hay una condición de carrera: si la respuesta de "mal" llega después que la de "malanga", pisa los resultados buenos.

### 3. `verifySessionStock` en bucle

[db/sales.ts:33-39](../db/sales.ts#L33-L39): `calculateStock` por cada producto distinto del carrito. Con carritos de 30+ líneas (el caso de uso real de T-09) son ~60 queries al pulsar Guardar.

## Plan de mejora

### Fix 1 — `countLowStock` con `calculateAllStocks` (20 min)

```ts
export async function countLowStock(): Promise<number> {
  const generalThreshold = Number((await getConfig(CONFIG_KEYS.generalStockThreshold)) ?? 5);
  const activeProducts = await db
    .select({ id: products.id, lowStockThreshold: products.lowStockThreshold })
    .from(products)
    .where(eq(products.active, true));
  const stocks = await calculateAllStocks();
  return activeProducts.filter(
    (p) => (stocks.get(p.id) ?? 0) < (p.lowStockThreshold ?? generalThreshold),
  ).length;
}
```

De ~2N+1 queries a 3. Ojo: la versión actual ignora los umbrales por categoría (`getProductThreshold` de [constants/catalog.ts:30](../constants/catalog.ts#L30) que sí usa la pantalla de inventario) — al reescribir, decidir si el contador del Home debe usar la misma regla que el inventario (recomendado: sí, para que el número del Home coincida con el filtro "stock bajo" del tab Inventario).

### Fix 2 — Debounce + guard de carrera en `ProductPicker` (30 min)

Debounce de ~250 ms con `setTimeout`/`clearTimeout` en un `useRef`, y descartar respuestas obsoletas comparando el texto vigente:

```ts
const timer = useRef<ReturnType<typeof setTimeout>>();
const latest = useRef('');

const handleSearch = (text: string) => {
  setSearch(text);
  latest.current = text;
  clearTimeout(timer.current);
  if (!text.trim()) { setOptions([]); setIsOpen(false); return; }
  timer.current = setTimeout(async () => {
    const results = await listProducts({ search: text });
    if (latest.current === text) { setOptions(results); setIsOpen(true); }
  }, 250);
};
```

(Sin dependencias nuevas; no hace falta lodash.)

### Fix 3 — `verifySessionStock` en lote (20 min)

Sustituir el bucle de `calculateStock` por una sola llamada a `calculateAllStocks()` y leer del `Map` resultante. Aún más simple que la versión actual.

### No hacer (por ahora)

- **Memoización manual:** React Compiler está activo (`reactCompiler: true` en app.json); no añadir `useMemo`/`useCallback` por rendimiento (convención de CLAUDE.md).
- **Stock materializado (columna contador):** el stock derivado es una decisión de diseño buena (hace trivial T-22). Solo reconsiderar si con datos de un año las 2 queries agregadas se notan; antes de eso, los índices existentes (`producto_id`, `fecha`) bastan.
- **Cache/React Query:** cada pantalla re-consulta en `useFocusEffect`; con SQLite local el coste es bajo y la simplicidad gana. Reevaluar solo si se mide jank real.

## Criterio de hecho

- Entrar al Home ejecuta un número constante de queries (verificable con `SQLite.enableChangeListener`/logs de Drizzle en dev, o simplemente por inspección de código).
- Escribir rápido en el buscador de productos dispara como máximo ~1 query por pausa de escritura, y nunca muestra resultados de un término anterior.
- `pnpm test` cubre los tres reescritos con los mismos casos que la versión anterior (mismos resultados, menos queries).
