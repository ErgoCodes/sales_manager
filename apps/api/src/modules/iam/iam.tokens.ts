/** DI tokens of the IAM ports (interfaces do not exist at runtime). */
export const PASSWORD_HASHER = Symbol('PasswordHasher');
export const ACCESS_TOKEN_SERVICE = Symbol('AccessTokenService');
export const REFRESH_TOKEN_CODEC = Symbol('RefreshTokenCodec');
export const PRE_AUTH_LOOKUP = Symbol('PreAuthLookup');
export const TENANT_UNIT_OF_WORK = Symbol('TenantUnitOfWork');
export const SECURITY_LOG = Symbol('SecurityLog');
export const CLOCK = Symbol('Clock');
export const ADMIN_UNIT_OF_WORK = Symbol('AdminUnitOfWork');
