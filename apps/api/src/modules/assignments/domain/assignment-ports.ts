import type { OwnerCandidate } from '../../iam/domain/owner';
import type { Scope } from '../../iam/domain/types';
import type { StoredAssignment } from '../../iam/domain/auth-ports';

export interface StoredAssignmentWithId extends StoredAssignment {
  readonly id: string;
}

export interface AssignmentInput {
  readonly roleId: string;
  readonly scope: Scope;
}

export interface SavedAssignment {
  readonly id: string;
  readonly roleId: string;
  readonly scope: Scope;
}

export interface AssignmentRepository {
  /** The user's assignments with their roles' permissions; archived locations are left out (they grant nothing). */
  listByUser(userId: string): Promise<StoredAssignmentWithId[]>;
  /** Deletes every assignment of the user and inserts `next` (one transaction, the caller's). */
  replace(userId: string, next: readonly AssignmentInput[], now: Date): Promise<SavedAssignment[]>;
  /** Every user holding the Owner system role tenant-wide, with their status: the input of `assertOwnerInvariant`. */
  ownerCandidates(): Promise<OwnerCandidate[]>;
  countByRole(roleId: string): Promise<number>;
  hasLocationScopedByRole(roleId: string): Promise<boolean>;
}
