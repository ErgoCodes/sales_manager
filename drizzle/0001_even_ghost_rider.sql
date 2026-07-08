CREATE TABLE `sesiones_venta` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fecha` text NOT NULL,
	`total_efectivo` real NOT NULL,
	`monto_recibido` real NOT NULL,
	`vuelto` real NOT NULL,
	`creado_en` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `ventas` ADD `sesion_id` integer REFERENCES sesiones_venta(id);