import { and, desc, eq, sql } from 'drizzle-orm';

import { db } from './client';
import { recalcularCostoPromedio } from './queries';
import { movimientosAlmacen, productos } from './schema';

interface DatosEntrada {
  productoId: number;
  cantidad: number;
  precioCostoUnitario: number;
  precioVenta?: number | null;
  fecha: string;
  notas?: string | null;
}

/**
 * Registra una entrada de almacén y persiste el nuevo costo promedio ponderado
 * en la tabla de productos.
 */
export async function registrarEntrada(datos: DatosEntrada): Promise<void> {
  await db.insert(movimientosAlmacen).values({
    productoId: datos.productoId,
    tipo: 'entrada',
    cantidad: datos.cantidad,
    fecha: datos.fecha,
    precioCostoUnitario: datos.precioCostoUnitario,
    precioVenta: datos.precioVenta ?? null,
    notas: datos.notas ?? null,
  });

  const nuevoCostoPromedio = await recalcularCostoPromedio(
    datos.productoId,
    datos.cantidad,
    datos.precioCostoUnitario,
  );

  await db
    .update(productos)
    .set({ costoPromedio: nuevoCostoPromedio })
    .where(eq(productos.id, datos.productoId));
}

export interface EntradaConProducto {
  id: number;
  productoId: number;
  productoNombre: string;
  unidadMedida: string;
  cantidad: number;
  precioCostoUnitario: number;
  fecha: string;
  notas: string | null;
}

interface ListarOpts {
  productoId?: number;
  fechaDesde?: string;
  fechaHasta?: string;
}

/** Lista entradas con nombre de producto, filtrable por producto y rango de fecha. */
export async function listarEntradas(opts: ListarOpts = {}): Promise<EntradaConProducto[]> {
  const condiciones = [eq(movimientosAlmacen.tipo, 'entrada')];
  if (opts.productoId) condiciones.push(eq(movimientosAlmacen.productoId, opts.productoId));
  if (opts.fechaDesde)
    condiciones.push(sql`date(${movimientosAlmacen.fecha}) >= date(${opts.fechaDesde})`);
  if (opts.fechaHasta)
    condiciones.push(sql`date(${movimientosAlmacen.fecha}) <= date(${opts.fechaHasta})`);

  const rows = await db
    .select({
      id: movimientosAlmacen.id,
      productoId: movimientosAlmacen.productoId,
      productoNombre: productos.nombre,
      unidadMedida: productos.unidadMedida,
      cantidad: movimientosAlmacen.cantidad,
      precioCostoUnitario: movimientosAlmacen.precioCostoUnitario,
      fecha: movimientosAlmacen.fecha,
      notas: movimientosAlmacen.notas,
    })
    .from(movimientosAlmacen)
    .innerJoin(productos, eq(movimientosAlmacen.productoId, productos.id))
    .where(and(...condiciones))
    .orderBy(desc(movimientosAlmacen.fecha));

  return rows;
}
