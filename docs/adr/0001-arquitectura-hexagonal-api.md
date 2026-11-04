# ADR 0001 · Arquitectura hexagonal de la API

- **Estado:** aceptada (2026-11-04)
- **Contexto:** SP1 · T3, `apps/api` (NestJS 11 + SWC)

## Contexto

La API va a crecer por contextos (identidad, catálogo, inventario, ventas, sync). Las reglas de negocio ya viven en `@monaco/domain` y se comparten con mobile; la API no debe duplicarlas ni acoplarlas a Nest o a Drizzle. Además queremos probar los casos de uso sin levantar Nest ni una base de datos, y poder cambiar un adaptador (stub → Drizzle en T4) sin tocar la lógica.

## Decisión

**Cada módulo de `apps/api/src/modules/<contexto>/` tiene cuatro capas** (puertos y adaptadores):

```
modules/<contexto>/
  domain/          entidades, value objects y puertos (interfaces). TypeScript puro.
  application/     casos de uso: clases que reciben puertos por constructor.
  infrastructure/  adaptadores de salida (Drizzle, servicios externos) que implementan los puertos.
  http/            adaptadores de entrada: controllers, DTOs desde @monaco/contracts, guards.
  <contexto>.module.ts   composición: puerto → adaptador, construcción de casos de uso.
  <contexto>.tokens.ts   símbolos de inyección de los puertos.
```

Reglas:

1. **`domain/` y `application/` no importan `@nestjs/*`, `nestjs-*`, `drizzle-orm`, `pg`, `express`, `helmet` ni `pino`, ni las capas `infrastructure/` o `http/`, ni `*.module`, `*.tokens`, `src/common`, `src/config`, bootstrap o scripts.** `domain/` tampoco importa `application/`. Lo impone `no-restricted-imports` en `apps/api/eslint.config.js` y lo vigila `src/__tests__/architecture.test.ts`.
2. **Sin `@Injectable()` en los casos de uso.** Se decidió no permitir ni siquiera `@nestjs/common`: los casos de uso se construyen en el módulo con `useFactory` + `inject`. Cuesta unas líneas por caso de uso y a cambio la capa queda libre de decoradores y de `reflect-metadata`.
3. **Los puertos se inyectan con `Symbol`** (`DATABASE_HEALTH_PORT`), porque una interfaz de TypeScript no existe en runtime.
4. **Los DTOs HTTP son envoltorios de `@monaco/contracts`** (`class X extends createZodDto(Schema) {}`); nunca redefinen formas. Las respuestas se declaran con `@ZodResponse({ status, type })`, que valida la salida, la documenta en OpenAPI y hace fallar el typecheck si el caso de uso devuelve otra forma.
5. **Reglas de precio, stock y costo van a `@monaco/domain`**, no a `modules/*/domain/`. El `domain/` de un módulo de la API guarda lo propio del servidor (puertos, entidades de persistencia, invariantes de tenancy).
6. **Transversal en `src/common/`:** filtro global de excepciones (`ErrorResponse`), logging, OpenAPI. **Config en `src/config/`:** `process.env` se valida con Zod una sola vez al arrancar (`loadConfig`) y `AppModule.forRoot(config)` recibe el resultado, así `main.ts`, el generador de OpenAPI y los tests eligen su config sin tocar el entorno.

El módulo `health` es la plantilla de referencia: puerto `DatabaseHealthPort` (`domain/`), caso de uso `CheckHealth` (`application/`), `StubDatabaseHealthAdapter` (`infrastructure/`, reemplazado por Drizzle en T4), `HealthController` (`http/`) y la composición en `health.module.ts`.

### Bordes HTTP (aplican a todos los módulos)

- Validación de entrada con `ZodValidationPipe` global; de salida con `ZodSerializerInterceptor` global.
- `AllExceptionsFilter` traduce todo a `ErrorResponse`. `details` solo lleva `{ path, message }` de errores de validación. Los 5xx devuelven un mensaje genérico y se registran con el request-id; nunca stack, SQL ni objetos internos al cliente.
- `nestjs-pino` con request-id por petición (`x-request-id` entrante si es seguro, si no un UUID; se devuelve en la respuesta). Los logs de request no incluyen headers, cuerpo ni query string.
- Swagger UI en `/docs` solo fuera de producción; el contrato público es `packages/contracts/openapi.json`, generado sin abrir puertos (`pnpm openapi:generate`) y determinista.
- `helmet`, CORS con lista explícita de orígenes desde `CORS_ORIGINS` (se rechaza `*`), límite de cuerpo de 100 kB (parsers como middleware de Nest, después del request-id; sus errores salen con mensajes fijos) y `enableShutdownHooks()`. El `Dockerfile` (multi-stage, `pnpm deploy --legacy --prod`, usuario `node`) deja la imagen sin devDependencies.

### Versiones

NestJS **11** (no 12): `nestjs-zod` 5.5 declara `@nestjs/common ^10 || ^11` y `@nestjs/swagger ^7 || ^8 || ^11`. Zod se fija en **`~4.4`**: desde Zod 4.5, `toJSONSchema` emite un esquema raíz con `id` como `$ref` y `cleanupOpenApiDoc` de `nestjs-zod` 5.5 falla con esos DTOs. El test de OpenAPI de `app.e2e.test.ts` detecta la regresión si se sube Zod sin que `nestjs-zod` lo soporte.

## Alternativas descartadas

- **Módulos Nest "planos" (controller + service + repository por módulo):** lo más corto, pero la lógica termina dependiendo del ORM y de Nest, y los tests unitarios necesitan `Test.createTestingModule`.
- **Permitir `@Injectable()` de `@nestjs/common` en `application/`:** ahorra el `useFactory`, pero mete decoradores y metadata del framework en la capa que queremos portable. Si el boilerplate molesta en SP2, se revisa este ADR.
- **`eslint-plugin-boundaries`:** más expresivo, pero para cuatro capas basta `no-restricted-imports` (sin dependencia extra ni configuración de resolvers).
- **Clean Architecture completa (entities/use-cases/interface-adapters/frameworks con carpetas globales):** separa por capa en vez de por contexto y dispersa cada feature en cuatro árboles.

## Consecuencias

- Cada caso de uso se prueba con fakes escritos a mano de sus puertos, sin Nest ni DB (ver `check-health.use-case.test.ts`).
- Cambiar un adaptador solo toca `infrastructure/` y el `*.module.ts` del contexto.
- Hay algo más de código de composición por módulo (tokens + `useFactory`).
- Los esquemas de respuesta aparecen en OpenAPI con sufijo `_Output` (`HealthResponse_Output`), convención de `nestjs-zod` para no chocar con los de entrada; los clientes generados (T6) usan esos nombres.
