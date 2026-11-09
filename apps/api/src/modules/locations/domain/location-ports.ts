import type { Paginated } from '@monaco/contracts';

import type { PageRequest } from '../../iam/domain/admin-ports';

export interface LocationRecord {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
}

/** Points of sale of the current tenant (RLS). Archived, never deleted. */
export interface LocationRepository {
  /** Oldest first. `onlyIds` restricts the page to those ids (a locations-scoped reader). */
  list(page: PageRequest & { readonly onlyIds?: readonly string[] }): Promise<Paginated<LocationRecord>>;
  /** A duplicate code rejects with the database's unique violation (409). */
  create(input: { readonly name: string; readonly code: string; readonly now: Date }): Promise<LocationRecord>;
  update(id: string, changes: { readonly name?: string; readonly code?: string }): Promise<LocationRecord | null>;
  /** Sets `archived_at` once; archiving again keeps the first date. */
  archive(id: string, now: Date): Promise<LocationRecord | null>;
  /** The ids among `ids` that exist and are not archived. */
  findActiveIds(ids: readonly string[]): Promise<string[]>;
}
