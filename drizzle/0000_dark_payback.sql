CREATE TABLE `configuracion` (
	`clave` text PRIMARY KEY NOT NULL,
	`valor` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gastos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tipo` text NOT NULL,
	`concepto` text,
	`monto` real NOT NULL,
	`fecha` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `movimientos_almacen` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`producto_id` integer NOT NULL,
	`tipo` text NOT NULL,
	`cantidad` real NOT NULL,
	`fecha` text NOT NULL,
	`precio_costo_unitario` real NOT NULL,
	`precio_venta` real,
	`notas` text,
	FOREIGN KEY (`producto_id`) REFERENCES `productos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_movimientos_producto` ON `movimientos_almacen` (`producto_id`);--> statement-breakpoint
CREATE INDEX `idx_movimientos_fecha` ON `movimientos_almacen` (`fecha`);--> statement-breakpoint
CREATE TABLE `productos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nombre` text NOT NULL,
	`unidad_medida` text NOT NULL,
	`categoria` text,
	`precio_costo` real,
	`precio_efectivo` real,
	`precio_transferencia` real,
	`costo_promedio` real DEFAULT 0 NOT NULL,
	`umbral_alerta` integer,
	`fecha_vencimiento` text,
	`activo` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ventas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`producto_id` integer NOT NULL,
	`cantidad` real NOT NULL,
	`precio_aplicado` real NOT NULL,
	`metodo_pago` text NOT NULL,
	`costo_al_vender` real NOT NULL,
	`utilidad` real NOT NULL,
	`fecha` text NOT NULL,
	`descuento_pct` real DEFAULT 0 NOT NULL,
	`anulada` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`producto_id`) REFERENCES `productos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_ventas_producto` ON `ventas` (`producto_id`);--> statement-breakpoint
CREATE INDEX `idx_ventas_fecha` ON `ventas` (`fecha`);