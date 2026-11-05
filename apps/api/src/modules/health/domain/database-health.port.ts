/**
 * Outbound port: whatever persistence the API runs on must be able to answer
 * "are you reachable?". Domain code depends on this interface only; adapters in
 * `infrastructure/` implement it (a stub today, Drizzle `select 1` in SP1·T4).
 *
 * Rule for every module: `domain/` holds plain TypeScript (entities, value
 * objects, ports). No Nest, no Drizzle, no HTTP.
 */
export interface DatabaseHealthPort {
  /** Resolves `true` when the database answers; may reject or resolve `false` otherwise. */
  ping(): Promise<boolean>;
}
