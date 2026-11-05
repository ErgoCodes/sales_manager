import { z } from 'zod';

import { IsoDateTime, Paginated, Uuid } from '../common';
import { Assignment } from './assignments';
import { Email } from './auth';

export const UserStatus = z.enum(['active', 'disabled']).meta({ id: 'UserStatus' });
export type UserStatus = z.infer<typeof UserStatus>;

export const User = z
  .object({
    id: Uuid,
    email: Email,
    displayName: z.string(),
    status: UserStatus,
    mustChangePassword: z.boolean(),
    createdAt: IsoDateTime,
  })
  .meta({ id: 'User' });
export type User = z.infer<typeof User>;

export const UserDetail = z
  .object({
    id: Uuid,
    email: Email,
    displayName: z.string(),
    status: UserStatus,
    mustChangePassword: z.boolean(),
    createdAt: IsoDateTime,
    assignments: z.array(Assignment),
  })
  .meta({ id: 'UserDetail' });
export type UserDetail = z.infer<typeof UserDetail>;

export const PaginatedUsers = Paginated(User, 'PaginatedUsers');

export const CreateUserRequest = z
  .object({ email: Email, displayName: z.string().trim().min(1).max(100) })
  .meta({ id: 'CreateUserRequest' });
export type CreateUserRequest = z.infer<typeof CreateUserRequest>;

export const UpdateUserRequest = z
  .object({ displayName: z.string().trim().min(1).max(100) })
  .meta({ id: 'UpdateUserRequest' });
export type UpdateUserRequest = z.infer<typeof UpdateUserRequest>;

const temporaryPassword = {
  temporaryPassword: z.string().min(12).meta({ description: 'Shown once; communicate out of band' }),
  temporaryPasswordExpiresAt: IsoDateTime.meta({ description: '72 h after issue' }),
};

/** The server generates the temporary password; it is never stored or returned again. */
export const CreateUserResponse = z.object({ user: User, ...temporaryPassword }).meta({ id: 'CreateUserResponse' });
export type CreateUserResponse = z.infer<typeof CreateUserResponse>;

export const ResetPasswordResponse = z.object(temporaryPassword).meta({ id: 'ResetPasswordResponse' });
export type ResetPasswordResponse = z.infer<typeof ResetPasswordResponse>;
