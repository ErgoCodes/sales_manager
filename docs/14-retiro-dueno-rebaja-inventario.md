# 14 · Retiro del dueño y merma rebajan mal el inventario (doble negación)

**Prioridad: Alta · Esfuerzo: ~0.5 día (fix + migración de datos + test)**

Reportado por la clienta (Mercado Mónaco) el 2026-07-19 probando la app: al registrar un "Retiro del dueño" (Arroz 1kg, cantidad 2) el stock no baja sino que sube. En sus palabras: _"Ya vi lo q pasa, cuando pongo retiro del dueño, automático se multiplica x 2 y ese valor lo incrementa en el inventario"_, y tuvo que compensar a mano con un Ajuste de inventario → Disminuir porque _"no me daba el inventario"_.

## Estado actual

El signo de la cantidad se aplica **dos veces** a las salidas de tipo `merma` y `retiro_owner`, una en la pantalla y otra en el cálculo de stock, y las dos negaciones se cancelan.

1. La pantalla de salida ya guarda la cantidad **en negativo** para todo lo que no sea un ajuste "Aumentar". En [app/expenses/outflow.tsx:147-149](../app/expenses/outflow.tsx#L147-L149):

   ```ts
   const magnitude = Number(values.quantity);
   const signedQuantity =
     type === "ajuste" && direction === "increase" ? magnitude : -magnitude;
   ```

   Para `merma` y `retiro_owner` esto da `-magnitude`, así que un retiro de 2 se inserta en `movimientos_almacen` con `cantidad = -2` (vía `registerOutflow`, [db/movements.ts:56-66](../db/movements.ts#L56-L66)).

2. Pero `calculateStock` **ya resta** esos tipos por su cuenta. En [db/queries.ts:11-14](../db/queries.ts#L11-L14) (y su gemela `calculateAllStocks` en [db/queries.ts:38-41](../db/queries.ts#L38-L41)):

   ```sql
   SUM(CASE
     WHEN tipo IN ('entrada', 'ajuste') THEN cantidad
     ELSE -cantidad
   END)
   ```

   La rama `ELSE -cantidad` cubre `merma` y `retiro_owner`. Con la cantidad ya negativa que mandó la UI, queda `-(-2) = +2`: el retiro **suma** 2 al inventario en vez de restarlo.

3. La convención correcta (magnitud **positiva** para merma/retiro, y que `calculateStock` sea quien reste) está fijada por el test [db/__tests__/queries.test.ts:99-100](../db/__tests__/queries.test.ts#L99-L100), que inserta `merma` con `quantity: 2` (positivo) y espera [db/__tests__/queries.test.ts:144-145](../db/__tests__/queries.test.ts#L144-L145): `10 (entrada) - 2 (merma) + (-1) (ajuste) - 3 (venta) = 4`. El test pasa porque inserta directo en la tabla con signo positivo, **saltándose** `outflow.tsx`; por eso el bug nunca se detectó. El comentario de `OutflowData` en [db/movements.ts:43](../db/movements.ts#L43) confirma la intención: solo `'ajuste'` puede ser negativo.

Nota: los reportes de pérdidas no se ven afectados porque usan valor absoluto — `getLossesBreakdown` con `ABS(...)` en [db/queries.ts:358](../db/queries.ts#L358) y `sumLossOutflowsValue` con `ABS(...)` en [db/movements.ts:236](../db/movements.ts#L236). El daño está solo en el stock.

## Problema / Objetivo

Causa raíz: **doble negación del signo** entre `app/expenses/outflow.tsx` (que guarda `merma`/`retiro_owner` con cantidad negativa) y `calculateStock` (que a esos mismos tipos les aplica `-cantidad`). Resultado: un retiro o merma de N unidades **incrementa** el stock en N en vez de bajarlo, un desfase de 2N respecto a lo esperado — lo que la clienta percibe como "se multiplica x2". El `ajuste` funciona bien porque `calculateStock` lo suma tal cual y la UI le da el signo correcto (Aumentar `+`, Disminuir `−`).

La fuente única de verdad de la convención es la capa DB + el test: **merma y retiro se guardan positivos; `calculateStock` los resta**. La pantalla es la que está mal.

## Plan de mejora

1. En [app/expenses/outflow.tsx:147-149](../app/expenses/outflow.tsx#L147-L149), firmar la cantidad **solo** para `ajuste`; `merma` y `retiro_owner` se guardan como magnitud positiva:

   ```ts
   const magnitude = Number(values.quantity);
   const signedQuantity =
     type === "ajuste"
       ? direction === "increase" ? magnitude : -magnitude
       : magnitude; // merma/retiro: positivo; calculateStock resta con -cantidad
   ```

2. Ajustar la comprobación de "stock insuficiente" en [app/expenses/outflow.tsx:152-170](../app/expenses/outflow.tsx#L152-L170), que hoy asume que el efecto sobre el stock es `signedQuantity < 0`. Al pasar merma/retiro a positivo hay que calcular el delta real sobre el stock: para `ajuste` es `signedQuantity`, para `merma`/`retiro_owner` es `-magnitude`. Usar ese delta para el chequeo de que el stock no quede negativo (y para `resulting = stock + delta`), sin cambiar el valor `signedQuantity` que se persiste.

3. **Migración de datos existentes**: las filas de `merma`/`retiro_owner` ya guardadas con `cantidad` negativa (las que la clienta y cualquier prueba previa crearon) seguirán mal después del fix, porque `calculateStock` les aplicará `-cantidad` sobre un valor negativo. Correr una migración única que las normalice a positivo, p. ej. `UPDATE movimientos_almacen SET cantidad = ABS(cantidad) WHERE tipo IN ('merma','retiro_owner')`. Revisar además los Ajustes de "Disminuir" que la clienta creó a mano para compensar y decidir con ella si se anulan (`anulado = true`) para no duplicar la corrección.

4. Añadir un test de regresión que ejercite el flujo de la pantalla (o al menos `registerOutflow` + `calculateStock` juntos) para un `retiro_owner`, verificando que el stock **baja**. El test actual pasa porque inserta con signo positivo directo; el nuevo debe cubrir el signo que produce `outflow.tsx`.

5. No tocar `calculateStock`/`calculateAllStocks`: su lógica es la correcta y está respaldada por el test existente; el arreglo va en la UI + migración.

## Criterio de hecho

- Registrar un "Retiro del dueño" o "Merma" de N unidades **reduce** el stock del producto en exactamente N (verificado en la pantalla de inventario).
- Un "Ajuste de inventario" sigue funcionando: "Aumentar" sube y "Disminuir" baja, sin cambios de comportamiento.
- La advertencia de "Stock insuficiente" vuelve a dispararse cuando un retiro/merma dejaría el stock negativo.
- Las filas históricas de merma/retiro guardadas en negativo quedan normalizadas y el stock mostrado cuadra sin ajustes manuales.
- Existe un test que reproduce el bug vía el signo que genera `outflow.tsx` y ahora pasa.
- Los reportes de pérdidas (T-19) siguen mostrando los mismos valores (usan `ABS`, no cambian).
