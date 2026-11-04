/** pg `Pool` shared by the whole API (closed on shutdown by DatabaseModule). */
export const PG_POOL = Symbol('PG_POOL');
/** Drizzle database bound to {@link PG_POOL}. */
export const DATABASE = Symbol('DATABASE');
