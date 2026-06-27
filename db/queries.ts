import { and, eq, sql } from 'drizzle-orm';

import { db } from './client';
import { CONFIG_KEYS, getConfig } from './config';
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
 * Stock derivado de todos los productos en lote (misma lógica que `calcularStock`
 * pero agrupado por producto). Devuelve un Map id→stock; productos sin movimientos
 * ni ventas no aparecen (asumir 0). Eficiente para la lista del catálogo.
 */
export async function calcularStockTodos(): Promise<Map<number, number>> {
  const movRows = await db
    .select({
      productoId: movimientosAlmacen.productoId,
      total: sql<number>`COALESCE(SUM(CASE
        WHEN ${movimientosAlmacen.tipo} IN ('entrada', 'ajuste') THEN ${movimientosAlmacen.cantidad}
        ELSE -${movimientosAlmacen.cantidad}
      END), 0)`,
    })
    .from(movimientosAlmacen)
    .groupBy(movimientosAlmacen.productoId);

  const ventaRows = await db
    .select({
      productoId: ventas.productoId,
      total: sql<number>`COALESCE(SUM(${ventas.cantidad}), 0)`,
    })
    .from(ventas)
    .where(eq(ventas.anulada, false))
    .groupBy(ventas.productoId);

  const stock = new Map<number, number>();
  for (const row of movRows) stock.set(row.productoId, row.total);
  for (const row of ventaRows) {
    stock.set(row.productoId, (stock.get(row.productoId) ?? 0) - row.total);
  }
  return stock;
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

export interface ResumenDia {
  efectivo: number;
  transferencia: number;
  total: number;
  utilidad: number;
}

/**
 * Resumen de ventas (no anuladas) de un día. `fecha` puede ser cualquier ISO del
 * día; se compara por `date()` de SQLite sobre el texto ISO almacenado.
 */
export async function resumenDelDia(fecha: string): Promise<ResumenDia> {
  const importe = sql<number>`${ventas.precioAplicado} * ${ventas.cantidad}`;

  const rows = await db
    .select({
      metodoPago: ventas.metodoPago,
      importe: sql<number>`COALESCE(SUM(${importe}), 0)`,
      utilidad: sql<number>`COALESCE(SUM(${ventas.utilidad}), 0)`,
    })
    .from(ventas)
    .where(and(eq(ventas.anulada, false), sql`date(${ventas.fecha}) = date(${fecha})`))
    .groupBy(ventas.metodoPago);

  const resumen: ResumenDia = { efectivo: 0, transferencia: 0, total: 0, utilidad: 0 };
  for (const row of rows) {
    if (row.metodoPago === 'efectivo') resumen.efectivo += row.importe;
    else if (row.metodoPago === 'transferencia') resumen.transferencia += row.importe;
    resumen.total += row.importe;
    resumen.utilidad += row.utilidad;
  }
  return resumen;
}

/**
 * Cuenta productos activos cuyo stock derivado está bajo su umbral (el del
 * producto si está configurado, si no el umbral general). O(N) sobre el catálogo;
 * T-07 lo optimizará.
 */
export async function contarStockBajo(): Promise<number> {
  const umbralGeneral = Number(
    (await getConfig(CONFIG_KEYS.umbralStockGeneral)) ?? 5,
  );

  const activos = await db
    .select({ id: productos.id, umbralAlerta: productos.umbralAlerta })
    .from(productos)
    .where(eq(productos.activo, true));

  let bajo = 0;
  for (const p of activos) {
    const stock = await calcularStock(p.id);
    const umbral = p.umbralAlerta ?? umbralGeneral;
    if (stock < umbral) bajo += 1;
  }
  return bajo;
}
