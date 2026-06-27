import { and, eq, sql } from 'drizzle-orm';

import { db } from './client';
import { movimientosAlmacen, productos, ventas } from './schema';

/**
 * Stock derivado de un producto. No se guarda como contador: se calcula sumando
 * movimientos de almacén y restando ventas no anuladas, para que cualquier
 * corrección (T-22) ajuste el stock automáticamente.
 *
 *   entrada            → +cantidad
 *   ajuste             → +cantidad (firmada: puede ser negativa)
 *   salida/merma/      → −cantidad
 *   perdida/retiro_owner
 *   venta (no anulada) → −cantidad
 */
export async function calcularStock(productoId: number): Promise<number> {
  const [movRow] = await db
    .select({
      total: sql<number>`COALESCE(SUM(CASE
        WHEN ${movimientosAlmacen.tipo} IN ('entrada', 'ajuste') THEN ${movimientosAlmacen.cantidad}
        ELSE -${movimientosAlmacen.cantidad}
      END), 0)`,
    })
    .from(movimientosAlmacen)
    .where(eq(movimientosAlmacen.productoId, productoId));

  const [ventaRow] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${ventas.cantidad}), 0)`,
    })
    .from(ventas)
    .where(and(eq(ventas.productoId, productoId), eq(ventas.anulada, false)));

  return (movRow?.total ?? 0) - (ventaRow?.total ?? 0);
}

/**
 * Promedio ponderado del costo tras una entrada nueva. Devuelve el nuevo costo
 * promedio SIN persistirlo (la persistencia es responsabilidad de T-06).
 *
 *   nuevo = (stockActual × costoPromedioActual + cantidadNueva × costoNuevo)
 *           / (stockActual + cantidadNueva)
 *
 * Ej.: entrada 4u×100 y luego 10u×130 → 1700/14 = 121.43
 */
export async function recalcularCostoPromedio(
  productoId: number,
  cantidadNueva: number,
  costoNuevo: number,
): Promise<number> {
  const stockActual = await calcularStock(productoId);

  const [prod] = await db
    .select({ costoPromedio: productos.costoPromedio })
    .from(productos)
    .where(eq(productos.id, productoId));

  const costoPromedioActual = prod?.costoPromedio ?? 0;
  const denominador = stockActual + cantidadNueva;

  // Sin stock previo ni cantidad válida: el promedio es el costo nuevo.
  if (denominador <= 0) return costoNuevo;

  return (stockActual * costoPromedioActual + cantidadNueva * costoNuevo) / denominador;
}
