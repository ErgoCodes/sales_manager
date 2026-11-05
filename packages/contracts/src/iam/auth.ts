import { z } from 'zod';

import { Uuid } from '../common';

/** 12..256 chars: the upper bound keeps argon2 hashing from becoming a DoS vector. */
export const Password = z
  .string()
  .min(12)
  .max(256)
  .meta({ id: 'Password', description: 'Password, 12 to 256 characters, no composition rules', format: 'password' });
export type Password = z.infer<typeof Password>;

export const Email = z.email().max(254).meta({ id: 'Email', description: 'Email address (unique across tenants)' });
export type Email = z.infer<typeof Email>;

export const DevicePlatform = z.enum(['web', 'android', 'ios']).meta({ id: 'DevicePlatform' });
export type DevicePlatform = z.infer<typeof DevicePlatform>;

export const DeviceInfo = z
  .object({
    label: z.string().trim().min(1).max(100).meta({ description: 'Human label, e.g. "Chrome on Windows"' }),
    platform: DevicePlatform,
  })
  .meta({ id: 'DeviceInfo' });
export type DeviceInfo = z.infer<typeof DeviceInfo>;

export const LoginRequest = z
  .object({
    email: Email,
    password: Password,
    deviceId: Uuid.optional().meta({
      description: 'Known device of the same user; reused only if not revoked, otherwise a new one is created',
    }),
    device: DeviceInfo.optional(),
  })
  .meta({ id: 'LoginRequest' });
export type LoginRequest = z.infer<typeof LoginRequest>;

const expiresIn = z.int().positive().meta({ description: 'Access token lifetime in seconds' });

/** Response of login and of password change (which rotates the current device's family). */
export const AuthTokens = z
  .object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    expiresIn,
    deviceId: Uuid,
    mustChangePassword: z.boolean(),
  })
  .meta({ id: 'AuthTokens' });
export type AuthTokens = z.infer<typeof AuthTokens>;

export const RefreshRequest = z
  .object({ refreshToken: z.string().min(1).max(512) })
  .meta({ id: 'RefreshRequest' });
export type RefreshRequest = z.infer<typeof RefreshRequest>;

/** Inside the 10 s grace window of a just-rotated token only an access token is issued. */
export const RefreshResponse = z
  .object({
    accessToken: z.string().min(1),
    expiresIn,
    refreshToken: z.string().min(1).optional().meta({ description: 'Absent when served from the grace window' }),
  })
  .meta({ id: 'RefreshResponse' });
export type RefreshResponse = z.infer<typeof RefreshResponse>;

export const ChangePasswordRequest = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: Password,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ['newPassword'],
    message: 'The new password must differ from the current one',
  })
  .meta({ id: 'ChangePasswordRequest' });
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequest>;
