import { describe, expect, it } from 'vitest';

import { AuthError, InvalidCredentials, InvalidCurrentPassword, InvalidSession } from '../auth-errors';

describe('auth errors', () => {
  it.each([
    [new InvalidCredentials(), 'invalid_credentials', 'Invalid email or password'],
    [new InvalidSession(), 'invalid_session', 'Invalid or expired session'],
    [new InvalidCurrentPassword(), 'invalid_current_password', 'Current password is incorrect'],
  ])('%s carries a stable code and a generic message', (error, code, message) => {
    expect(error).toBeInstanceOf(AuthError);
    expect(error.code).toBe(code);
    expect(error.message).toBe(message);
    expect(error.name).toBe(error.constructor.name);
  });
});
