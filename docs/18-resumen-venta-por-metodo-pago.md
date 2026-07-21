# 18 · Desglose de productos por método de pago en el resumen de venta

**Prioridad: Media · Esfuerzo: ~0.5-1 día**

La clienta (Mercado Mónaco), probando la app el 2026-07-19, pidió que la vista que resume la venta agrupe los productos según cómo se cobraron: *"Me gustaría en esta vista q resume la venta, tenga las opciones q toque efectivo... salga el resumen x productos del pago en efectivo y lo mismo x transferencia"*. Es decir, ver por separado qué productos se pagaron en efectivo y cuáles por transferencia.

## Estado actual

La vista de resumen de la venta es la pantalla de nueva sesión ([app/sales/new-session.tsx](../app/sales/new-session.tsx)).

- **Lista de ítems plana**: los productos agregados al carrito se renderizan en un único `FlatList` sin agrupar ([app/sales/new-session.tsx:426-523](../app/sales/new-session.tsx#L426-L523)). Cada fila muestra nombre, cantidad × precio y unas insignias pequeñas de método: `"E"` / `"T"` según `item.paymentMethod` ([app/sales/new-session.tsx:474-497](../app/sales/new-session.tsx#L474-L497)) y una `"C"` extra si `item.isCostSale` ([app/sales/new-session.tsx:498-512](../app/sales/new-session.tsx#L498-L512)). El orden es cronológico de inserción, mezclando efectivo y transferencia.
- **Footer con totales agregados**: al pie solo hay sumatorias, no un desglose por producto — `Efectivo: $X`, `Transfer: $X`, `Costo: $X` (condicional) y `Total: $X` ([app/sales/new-session.tsx:525-564](../app/sales/new-session.tsx#L525-L564)).
- **El dato ya existe por línea**: cada `CartItem` del store lleva `paymentMethod: 'efectivo' | 'transferencia'` e `isCostSale: boolean` ([store/index.ts:4-16](../store/index.ts#L4-L16)). Las sumatorias del footer se calculan con los selectores `totalCash` / `totalTransfer` / `totalCost`, que filtran los ítems por `paymentMethod` e `isCostSale` ([store/index.ts:53-69](../store/index.ts#L53-L69)).
- **Persistencia coherente**: al guardar, `registerSalesSession` inserta una fila por línea con su `paymentMethod` e `isCostSale` ([db/sales.ts:103-117](../db/sales.ts#L103-L117)); la columna existe en el schema como `metodo_pago` y `es_venta_costo` ([db/schema.ts:57-63](../db/schema.ts#L57-L63)). No hace falta tocar la base de datos.

En resumen: la información para agrupar por método **ya está en cada ítem del carrito**; lo único que falta es presentarla agrupada en la UI.

## Problema / Objetivo

La clienta necesita, antes de cerrar la venta, poder leer de un vistazo qué productos entran por efectivo y cuáles por transferencia (para conciliar el cobro físico contra la transferencia recibida). Hoy tiene que interpretar las insignias `E`/`T` fila por fila en una lista mezclada, lo que es lento y propenso a error cuando el ticket tiene varios ítems. El objetivo es reagrupar el resumen del carrito en secciones por método de pago, con subtotal por sección, reutilizando el dato que ya existe.

## Plan de mejora

1. **Agrupar los ítems por método en `new-session.tsx`**: derivar dos grupos a partir de `items` del store — efectivo (`paymentMethod === 'efectivo'`) y transferencia (`paymentMethod === 'transferencia'`). Con el React Compiler activo no hace falta `useMemo` (ver CLAUDE.md); un simple `filter` en el render es suficiente dado el tamaño típico del ticket.
2. **Reemplazar el `FlatList` plano por una lista seccionada** ([app/sales/new-session.tsx:426-523](../app/sales/new-session.tsx#L426-L523)): usar `SectionList` con dos secciones ("Efectivo" y "Transferencia"), o mantener el `FlatList` y anteponer encabezados de sección. Cada encabezado muestra el título del método y su subtotal, reutilizando los selectores existentes `totalCash()` / `totalTransfer()` ([store/index.ts:53-61](../store/index.ts#L53-L61)). Ocultar una sección vacía cuando no haya ítems de ese método.
3. **Conservar el renderItem actual**: reutilizar exactamente la fila de ítem ya existente (nombre, cantidad × precio, insignia de descuento y la insignia `C` de `isCostSale`, botón quitar) para no duplicar estilos. Dentro de una sección de método, la insignia redundante `E`/`T` puede omitirse ya que la sección ya indica el método; mantener la insignia `C` de venta a costo.
4. **Interacción con `isCostSale` (TSK-13, [docs/10](./10-metodo-pago-costo-y-fiado.md))**: no reimplementar nada de costo. Una venta a costo conserva su `paymentMethod` real (`efectivo`/`transferencia`), así que cae naturalmente en su sección correspondiente y se distingue por la insignia `C`. La línea `Costo: $X` del footer ([app/sales/new-session.tsx:549-553](../app/sales/new-session.tsx#L549-L553)) se mantiene como está (es informativa y se solapa con efectivo/transfer). Dejar el footer de totales tal cual: el desglose nuevo va en la lista, no en el pie.
5. **Verificar el bloque de cobro en efectivo**: el subtotal a cobrar en efectivo (`cashDue = totalCash()`, [app/sales/new-session.tsx:174](../app/sales/new-session.tsx#L174)) y su input de monto recibido no cambian; deben seguir coincidiendo con el subtotal de la sección Efectivo.

## Criterio de hecho

- El resumen de la venta muestra los productos separados en dos grupos: los pagados en efectivo y los pagados por transferencia.
- Cada grupo muestra su subtotal, coincidente con `totalCash()` / `totalTransfer()` del store.
- Un grupo sin ítems no se muestra (o se muestra vacío de forma clara), sin romper el layout.
- Las ventas a costo aparecen en la sección de su método real y siguen marcadas con la insignia `C`.
- El footer de totales (`Efectivo` / `Transfer` / `Costo` / `Total`) y el flujo de cobro en efectivo siguen funcionando igual que antes.
- Quitar un ítem lo saca de su sección y actualiza el subtotal correspondiente en tiempo real.
