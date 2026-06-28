import { and, eq, like } from 'drizzle-orm';

import { db } from './client';
import { calcularStockTodos } from './queries';
import { type NuevoProducto, type Producto, productos } from './schema';

export type ProductoConStock = Producto & { stock: number };

export type DatosProducto = Pick<
  NuevoProducto,
  | 'nombre'
  | 'unidadMedida'
  | 'categoria'
  | 'umbralAlerta'
  | 'precioCosto'
  | 'precioEfectivo'
  | 'precioTransferencia'
>;

interface ListarOpts {
  busqueda?: string;
  categoria?: string;
  incluirArchivados?: boolean;
}

/** Lista productos con su stock derivado, filtrando por nombre/categoría/estado. */
export async function listarProductos(opts: ListarOpts = {}): Promise<ProductoConStock[]> {
  const condiciones = [];
  if (!opts.incluirArchivados) condiciones.push(eq(productos.activo, true));
  if (opts.busqueda?.trim()) condiciones.push(like(productos.nombre, `%${opts.busqueda.trim()}%`));
  if (opts.categoria) condiciones.push(eq(productos.categoria, opts.categoria));

  const filas = await db
    .select()
    .from(productos)
    .where(condiciones.length ? and(...condiciones) : undefined)
    .orderBy(productos.nombre);

  const stockMap = await calcularStockTodos();
  return filas.map((p) => ({ ...p, stock: stockMap.get(p.id) ?? 0 }));
}

export async function getProducto(id: number): Promise<Producto | undefined> {
  const [row] = await db.select().from(productos).where(eq(productos.id, id));
  return row;
}

/** Crea un producto. Devuelve el id nuevo. */
export async function crearProducto(datos: DatosProducto): Promise<number> {
  const [row] = await db.insert(productos).values(datos).returning({ id: productos.id });
  return row.id;
}

export async function actualizarProducto(id: number, datos: DatosProducto): Promise<void> {
  await db.update(productos).set(datos).where(eq(productos.id, id));
}

export async function archivarProducto(id: number): Promise<void> {
  await db.update(productos).set({ activo: false }).where(eq(productos.id, id));
}

export async function restaurarProducto(id: number): Promise<void> {
  await db.update(productos).set({ activo: true }).where(eq(productos.id, id));
}
