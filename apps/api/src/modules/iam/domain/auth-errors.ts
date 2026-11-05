/**
 * Authentication failures. Their messages are deliberately generic: the HTTP
 * layer maps them to 401/400 without saying which check failed (enumeration).
 */
export abstract class AuthError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Unknown email, wrong password, disabled user or expired temporary password: all look the same. */
export class InvalidCredentials extends AuthError {
  readonly code = 'invalid_credentials';

  constructor() {
    super('Invalid email or password');
  }
}

/** Unknown, expired, revoked or reused refresh token, or its device/user is no longer valid. */
export class InvalidSession extends AuthError {
  readonly code = 'invalid_session';

  constructor() {
    super('Invalid or expired session');
  }
}

/** Password change with a wrong current password. */
export class InvalidCurrentPassword extends AuthError {
  readonly code = 'invalid_current_password';

  constructor() {
    super('Current password is incorrect');
  }
}
