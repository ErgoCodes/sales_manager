import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Catálogo de productos. El stock NO se guarda aquí: se deriva de movimientos y
// ventas (ver db/queries.ts → calcularStock).
export const productos = sqliteTable('productos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  nombre: text('nombre').notNull(),
  // ud / kg / litro / caja
  unidadMedida: text('unidad_medida').notNull(),
  categoria: text('categoria'),
  precioCosto: real('precio_costo'),
  precioEfectivo: real('precio_efectivo'),
  precioTransferencia: real('precio_transferencia'),
  costoPromedio: real('costo_promedio').notNull().default(0),
  umbralAlerta: integer('umbral_alerta'),
  // ISO 8601, opcional
  fechaVencimiento: text('fecha_vencimiento'),
  activo: integer('activo', { mode: 'boolean' }).notNull().default(true),
});

// Movimientos de almacén sin contraparte de venta.
export const movimientosAlmacen = sqliteTable(
  'movimientos_almacen',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    productoId: integer('producto_id')
      .notNull()
      .references(() => productos.id),
    // entrada / salida / merma / perdida / retiro_owner / ajuste
    tipo: text('tipo').notNull(),
    // ajuste puede ser positivo o negativo (cantidad firmada)
    cantidad: real('cantidad').notNull(),
    fecha: text('fecha').notNull(),
    // Obligatorio, sin default: siempre se registra el costo real de la compra.
    precioCostoUnitario: real('precio_costo_unitario').notNull(),
    precioVenta: real('precio_venta'),
    notas: text('notas'),
  },
  (table) => ({
    productoIdx: index('idx_movimientos_producto').on(table.productoId),
    fechaIdx: index('idx_movimientos_fecha').on(table.fecha),
  }),
);

// Ventas registradas. Reducen el stock derivado mientras anulada = false.
export const ventas = sqliteTable(
  'ventas',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    productoId: integer('producto_id')
      .notNull()
      .references(() => productos.id),
    cantidad: real('cantidad').notNull(),
    precioAplicado: real('precio_aplicado').notNull(),
    // efectivo / transferencia / costo
    metodoPago: text('metodo_pago').notNull(),
    // Congelado al momento de la venta (costo_promedio vigente).
    costoAlVender: real('costo_al_vender').notNull(),
    utilidad: real('utilidad').notNull(),
    fecha: text('fecha').notNull(),
    descuentoPct: real('descuento_pct').notNull().default(0),
    anulada: integer('anulada', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => ({
    productoIdx: index('idx_ventas_producto').on(table.productoId),
    fechaIdx: index('idx_ventas_fecha').on(table.fecha),
  }),
);

// Gastos periódicos que reducen la utilidad real.
export const gastos = sqliteTable('gastos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // salario / multa / onat / rebaja_liquidacion
  tipo: text('tipo').notNull(),
  concepto: text('concepto'),
  monto: real('monto').notNull(),
  fecha: text('fecha').notNull(),
});

// Pares clave/valor para configuración del negocio.
export const configuracion = sqliteTable('configuracion', {
  clave: text('clave').primaryKey(),
  valor: text('valor').notNull(),
});

// Tipos inferidos para uso en toda la app.
export type Producto = typeof productos.$inferSelect;
export type NuevoProducto = typeof productos.$inferInsert;

export type MovimientoAlmacen = typeof movimientosAlmacen.$inferSelect;
export type NuevoMovimientoAlmacen = typeof movimientosAlmacen.$inferInsert;

export type Venta = typeof ventas.$inferSelect;
export type NuevaVenta = typeof ventas.$inferInsert;

export type Gasto = typeof gastos.$inferSelect;
export type NuevoGasto = typeof gastos.$inferInsert;

export type Configuracion = typeof configuracion.$inferSelect;
export type NuevaConfiguracion = typeof configuracion.$inferInsert;
