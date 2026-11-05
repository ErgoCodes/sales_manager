import type { Permission, SystemRoleKey } from '@monaco/contracts';

/** Same shape as the `AssignmentScope` contract. */
export type Scope =
  | { readonly type: 'tenant' }
  | { readonly type: 'locations'; readonly locationIds: readonly string[] };

export interface RoleDefinition {
  readonly id: string;
  /** Set only for system roles. */
  readonly key: SystemRoleKey | null;
  readonly isSystem: boolean;
  readonly permissions: readonly Permission[];
}

export interface Assignment {
  readonly role: RoleDefinition;
  readonly scope: Scope;
}

/** Union of all of a user's assignments, split by scope. */
export interface EffectivePermissions {
  readonly tenantWide: ReadonlySet<Permission>;
  readonly byLocation: ReadonlyMap<string, ReadonlySet<Permission>>;
}

/** Who is acting, with everything the pure rules need (resolved per request by the application layer). */
export interface Actor {
  readonly userId: string;
  readonly assignments: readonly Assignment[];
}
