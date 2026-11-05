/** Session lifetimes (SP2 spec, "Decisiones"; ADR 0004). */
export const AUTH_POLICY = {
  /** Access token (JWT) lifetime: revoking a refresh cuts access in at most this long. */
  accessTokenTtlSeconds: 10 * 60,
  /** A refresh token expires after this long without use... */
  refreshIdleTtlMs: 30 * 24 * 60 * 60 * 1000,
  /** ...and its family after this long no matter what. */
  refreshAbsoluteTtlMs: 90 * 24 * 60 * 60 * 1000,
  /** A just-rotated refresh token may still get an access token (never a refresh) for this long. */
  refreshGraceMs: 10 * 1000,
} as const;

/** Why a refresh family (session) was revoked; stored in `refresh_tokens.revoked_reason`. */
export type SessionRevocationReason = 'logout' | 'reuse_detected' | 'superseded' | 'password_changed' | 'device_revoked';
