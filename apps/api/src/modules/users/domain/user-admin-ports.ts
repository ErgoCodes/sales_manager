import type { Paginated } from '@monaco/contracts';

import type { PageRequest } from '../../iam/domain/admin-ports';

/** A user as administrators see it: never the password hash. */
export interface ManagedUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly status: 'active' | 'disabled';
  readonly mustChangePassword: boolean;
  readonly createdAt: Date;
}

export interface NewUser {
  readonly email: string;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly passwordExpiresAt: Date;
  readonly now: Date;
}

export interface UserAdminRepository {
  list(page: PageRequest): Promise<Paginated<ManagedUser>>;
  findById(id: string): Promise<ManagedUser | null>;
  /** Creates the user with a temporary password; null if the email exists (in ANY tenant). */
  create(user: NewUser): Promise<ManagedUser | null>;
  updateDisplayName(id: string, displayName: string): Promise<ManagedUser | null>;
  disable(id: string): Promise<ManagedUser | null>;
  /** Replaces the password with a temporary one: `must_change_password` until `expiresAt`. */
  setTemporaryPassword(id: string, passwordHash: string, expiresAt: Date): Promise<void>;
}

/** Server-generated temporary passwords (never chosen by the admin, ADR 0005 §7). */
export interface TemporaryPasswordGenerator {
  generate(): string;
}
