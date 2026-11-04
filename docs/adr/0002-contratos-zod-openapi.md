# ADR 0002 · Contratos con Zod 4 y OpenAPI

- **Estado:** aceptada (2026-11-04)
- **Contexto:** SP1 · T2, `packages/contracts` (`@monaco/contracts`)

## Contexto

La API (NestJS), la web (Next.js) y, desde SP4, mobile comparten la forma de los datos que viajan por HTTP. Necesitamos una única fuente de verdad que valide en runtime, genere tipos y produzca la especificación OpenAPI, sin duplicar definiciones.

## Decisión

**Zod 4 es la fuente de verdad.** El flujo es:

1. `packages/contracts` define esquemas Zod (compilados a `dist/` con `tsc -b`, como `@monaco/domain`; no importa Nest, Next ni React Native).
2. La API los usa con `nestjs-zod` (`createZodDto`, `ZodValidationPipe`, `ZodSerializerInterceptor`) para validar peticiones y respuestas.
3. `SwaggerModule.createDocument` + `cleanupOpenApiDoc` de `nestjs-zod` genera `openapi.json` (T3).
4. La web consume un cliente generado desde ese OpenAPI (T6).

### Convención para declarar esquemas

Verificada contra la documentación de `nestjs-zod` 5.x y Zod 4:

- **Todo esquema reutilizable lleva `.meta({ id: 'Nombre' })`.** `nestjs-zod` lo publica en `components.schemas` con ese nombre y lo referencia con `$ref`, en vez de inlinearlo o nombrarlo por la clase DTO. `cleanupOpenApiDoc` es obligatorio al generar el documento.
- `id` en PascalCase, igual al nombre del export (`Uuid`, `Money`, `ErrorResponse`, `HealthResponse`). Dos esquemas distintos con el mismo `id` hacen fallar la generación.
- `ErrorResponse.details` es solo para errores de validación (`[{ path, message }]`); nunca stack, SQL ni objetos internos. `message` máx. 500 caracteres.
- `Uuid` acepta solo minúsculas (forma canónica); mayúsculas se rechazan.
- `PaginationQuery.limit` se parsea estrictamente desde strings de solo dígitos (`10abc`, `0x10`, `1e1` se rechazan); `cursor` máx. 512.
- Cada esquema exporta un `const` y un `type` con el mismo nombre (`export const X = z...; export type X = z.infer<typeof X>`).
- Descripciones y ejemplos van en `.meta({ description, example })` sobre el campo.
- Esquemas genéricos (p. ej. `Paginated(item, id)`) son fábricas que reciben el `id` explícito para que cada instanciación tenga su propio componente (`PaginatedProducts`).
- Formatos de Zod 4 de nivel superior: `z.uuidv7()`, `z.iso.datetime()`, `z.email()`. Mapean a `format` en JSON Schema.
- Evitar `transform`/`pipe` en esquemas de respuesta: la salida y la entrada divergen en OpenAPI. Si hacen falta en una petición, se documenta la forma de entrada.
- Los DTO de Nest se crean en la API (`class X extends createZodDto(Schema) {}`); `contracts` no depende de `nestjs-zod`.

### `Money`

**Entero en unidades menores (centavos) + moneda soportada:** `{ amount: z.int() no negativo, currency: 'CUP' | 'USD' | 'MLC' }`. `z.int()` limita a enteros seguros (±2^53−1). MLC no es ISO 4217; el resto sí. `amount` no admite negativos: deltas y reembolsos tendrán su propio esquema cuando hagan falta.

Motivos:
- Aritmética exacta sin flotantes ni parseo de strings; sumas y comparaciones directas en SQL (`bigint`) y TS.
- El dominio actual (`@monaco/domain`) maneja números en CUP, con precios por método de pago; esos importes se convierten a centavos en el borde (`Math.round(pesos * 100)`) al mapear a contratos, y no se mezclan unidades dentro del dominio.
- `currency` explícita permite el multi-moneda por método de pago sin cambiar el contrato.
- Un `number` entero es seguro hasta 2^53 (≈ 90 billones de unidades), de sobra para este producto.

Descartado: decimal en string (`"125.50"`) por obligar a parsear y a aritmética con una librería decimal en cada cliente; no aporta precisión adicional porque la menor unidad es el centavo. Si algún día hiciera falta precisión sub-centavo (costo promedio), se define un esquema aparte, no se cambia `Money`.

### Otros tipos comunes

- `Uuid`: UUIDv7 validado (ids generados en cliente para sync offline, SP5).
- `IsoDateTime`: instante UTC con `Z`, sin offsets.
- `ErrorResponse`: `{ error: { code, message, details? } }`, único formato de error de la API.
- `Paginated`: paginación por cursor opaco `{ items, nextCursor | null }`; `PaginationQuery` con `limit` 1–100 (por defecto 50).

## Alternativas descartadas

- **ts-rest:** contrato propio (no OpenAPI de primera clase en Nest), acopla clientes a su runtime y duplica lo que ya hace `nestjs-zod`.
- **tRPC:** excelente entre TypeScript, pero mobile offline-first, clientes generados y un OpenAPI público como entregable piden REST + OpenAPI; tRPC lo dificulta.
- **DTO con `class-validator`:** segunda fuente de verdad y sin tipos compartidos con web/mobile.

## Consecuencias

- Cambiar un esquema obliga a regenerar `openapi.json` y el cliente (CI lo comprobará en T3/T6).
- Mobile sigue en Zod 3 hasta SP4; `contracts` usa Zod 4, por lo que mobile no puede consumirlo antes de migrar.
