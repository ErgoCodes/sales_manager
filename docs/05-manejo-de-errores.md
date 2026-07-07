# 05 · Manejo de errores

**Prioridad: ALTA · Esfuerzo: medio día**

## Estado actual

Las escrituras a la base de datos **no tienen manejo de errores**, con una sola excepción ([app/sales/new-session.tsx](../app/sales/new-session.tsx), que sí envuelve el guardado en try/catch):

- [app/catalog/[id].tsx:103-118](../app/catalog/%5Bid%5D.tsx#L103-L118) — `onSubmit` hace `await createProduct/updateProduct` y `router.back()` sin try/catch.
- [app/inventory/stock-entry.tsx](../app/inventory/stock-entry.tsx) — registro de entrada + recálculo de costo promedio, sin try/catch.
- [app/expenses/new.tsx](../app/expenses/new.tsx) y [app/expenses/outflow.tsx](../app/expenses/outflow.tsx) — igual.
- [app/configuration.tsx](../app/configuration.tsx) — guardado de configuración, igual.

Problemas adicionales:

- **Fallback silencioso en la venta:** [db/sales.ts:54](../db/sales.ts#L54) hace `const costAtSale = prod?.averageCost ?? item.costAtSale;` — si el producto no existe en DB (borrado/corrupto), usa el costo cacheado en el carrito sin avisar. La utilidad podría calcularse con un costo desactualizado sin que nadie lo sepa.
- **Estilo mixto sync/async:** `registerSalesSession` es síncrono (`.all()`/`.run()` dentro de `db.transaction`) mientras el resto de la capa `db/` es async. Funciona, pero sorprende al lector y complica testear/uniformar.

## Problema / impacto

Con react-hook-form, si `await createProduct(...)` lanza, `isSubmitting` vuelve a `false` y **no pasa nada visible**: no hay navegación, no hay mensaje. En el peor caso (excepción fuera del ciclo de RHF) la pantalla navega atrás con `router.back()` sin haber guardado. Para la usuaria: "yo lo registré" — y el dato no está. En una app de dinero, la pérdida silenciosa de un registro es el peor bug posible.

Las causas realistas de fallo existen: disco lleno, DB bloqueada por WAL durante un backup (T-21), constraint FK al borrar productos, archivo corrupto tras restaurar.

## Plan de mejora

### Paso 1 — Helper único de escritura segura

Crear `lib/safe-write.ts`:

```ts
import { Alert } from 'react-native';

export async function safeWrite<T>(
  action: () => Promise<T> | T,
  errorTitle = 'No se pudo guardar',
): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await action() };
  } catch (e) {
    console.error(errorTitle, e);
    Alert.alert(errorTitle, 'Revisa los datos e inténtalo de nuevo. Si el problema sigue, reinicia la app.');
    return { ok: false };
  }
}
```

### Paso 2 — Aplicarlo en los 5 puntos de escritura

Patrón en cada submit (ejemplo para el formulario de producto):

```ts
const result = await safeWrite(() => (isNew ? createProduct(data) : updateProduct(Number(id), data)));
if (result.ok) router.back();
```

Regla: **navegar o limpiar el formulario solo si la escritura confirmó.** Pantallas a tocar: `catalog/[id].tsx`, `inventory/stock-entry.tsx`, `expenses/new.tsx`, `expenses/outflow.tsx`, `configuration.tsx`. En `sales/new-session.tsx` sustituir su try/catch propio por el helper para uniformar.

### Paso 3 — Eliminar el fallback silencioso de `costAtSale`

En [db/sales.ts:48-54](../db/sales.ts#L48-L54): si `prod` no existe, **lanzar** (`throw new Error(\`Producto ${item.productId} no encontrado\`)`) en vez de usar el costo del carrito. La transacción entera revierte (correcto: mejor no guardar nada que guardar una venta huérfana) y el error sube al try/catch de la pantalla, que ya avisa.

### Paso 4 — Documentar la excepción sync

`registerSalesSession` se queda síncrona (la API de transacción sync de Drizzle/expo-sqlite garantiza atomicidad sin `await` intercalados), pero merece un comentario de una línea explicando por qué difiere del resto de la capa. Alternativa a futuro: migrar a `db.transaction(async (tx) => …)` cuando se añada `updateSale`/`cancelSale` (T-22) y unificar entonces.

## Criterio de hecho

- Toda llamada de escritura (`create*`, `update*`, `register*`, `setConfig`) desde una pantalla pasa por `safeWrite` (verificable con `grep -rn "await create\|await update\|await register" app/`).
- Fallo simulado (lanzar dentro de `createProduct` a mano) → aparece Alert y la pantalla **no** navega.
- `registerSalesSession` lanza si el producto no existe; test de la capa db lo cubre (ver [03-testing-y-ci.md](03-testing-y-ci.md)).
