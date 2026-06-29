import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const products = sqliteTable('productos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('nombre').notNull(),
  unitOfMeasure: text('unidad_medida').notNull(),
  category: text('categoria'),
  costPrice: real('precio_costo'),
  cashPrice: real('precio_efectivo'),
  transferPrice: real('precio_transferencia'),
  averageCost: real('costo_promedio').notNull().default(0),
  lowStockThreshold: integer('umbral_alerta'),
  expirationDate: text('fecha_vencimiento'),
  active: integer('activo', { mode: 'boolean' }).notNull().default(true),
});

export const warehouseMovements = sqliteTable(
  'movimientos_almacen',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    productId: integer('producto_id')
      .notNull()
      .references(() => products.id),
    type: text('tipo').notNull(),
    quantity: real('cantidad').notNull(),
    date: text('fecha').notNull(),
    unitCostPrice: real('precio_costo_unitario').notNull(),
    salePrice: real('precio_venta'),
    notes: text('notas'),
  },
  (table) => ({
    productIdx: index('idx_movimientos_producto').on(table.productId),
    dateIdx: index('idx_movimientos_fecha').on(table.date),
  }),
);

export const sales = sqliteTable(
  'ventas',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    productId: integer('producto_id')
      .notNull()
      .references(() => products.id),
    quantity: real('cantidad').notNull(),
    appliedPrice: real('precio_aplicado').notNull(),
    paymentMethod: text('metodo_pago').notNull(),
    costAtSale: real('costo_al_vender').notNull(),
    profit: real('utilidad').notNull(),
    date: text('fecha').notNull(),
    discountPercent: real('descuento_pct').notNull().default(0),
    cancelled: integer('anulada', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => ({
    productIdx: index('idx_ventas_producto').on(table.productId),
    dateIdx: index('idx_ventas_fecha').on(table.date),
  }),
);

export const expenses = sqliteTable('gastos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('tipo').notNull(),
  concept: text('concepto'),
  amount: real('monto').notNull(),
  date: text('fecha').notNull(),
});

export const configuration = sqliteTable('configuracion', {
  key: text('clave').primaryKey(),
  value: text('valor').notNull(),
});

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;

export type WarehouseMovement = typeof warehouseMovements.$inferSelect;
export type NewWarehouseMovement = typeof warehouseMovements.$inferInsert;

export type Sale = typeof sales.$inferSelect;
export type NewSale = typeof sales.$inferInsert;

export type Expense = typeof expenses.$inferSelect;
export type NewExpense = typeof expenses.$inferInsert;

export type Configuration = typeof configuration.$inferSelect;
export type NewConfiguration = typeof configuration.$inferInsert;
