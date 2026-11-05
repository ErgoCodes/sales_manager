import type { Paginated, Permission } from '@monaco/contracts';

import type { PageRequest } from '../../iam/domain/admin-ports';
import type { RoleDefinition } from '../../iam/domain/types';

export interface RoleRecord extends RoleDefinition {
  readonly name: string;
  readonly createdAt: Date;
}

export interface RoleRepository {
  list(page: PageRequest): Promise<Paginated<RoleRecord>>;
  findById(id: string): Promise<RoleRecord | null>;
  /** The roles among `ids` that exist in the tenant. */
  findByIds(ids: readonly string[]): Promise<RoleRecord[]>;
  /** A duplicate name rejects with the database's unique violation (409). */
  create(input: { readonly name: string; readonly permissions: readonly Permission[]; readonly now: Date }): Promise<RoleRecord>;
  update(id: string, changes: { readonly name?: string; readonly permissions?: readonly Permission[] }): Promise<RoleRecord>;
  delete(id: string): Promise<void>;
}
