import { Module } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { PinoLogger } from 'nestjs-pino';

import { APP_CONFIG } from '../../config/app-config.token';
import type { AppConfig } from '../../config/env';
import type { Database } from '../../infrastructure/db/database';
import { DATABASE } from '../../infrastructure/db/database.tokens';
import { RateLimitModule } from '../../infrastructure/rate-limit/rate-limit.module';
import { Authenticate } from './application/authenticate.use-case';
import { ChangePassword } from './application/change-password.use-case';
import { GetMe } from './application/get-me.use-case';
import { Login } from './application/login.use-case';
import { Logout } from './application/logout.use-case';
import { RefreshSession } from './application/refresh-session.use-case';
import { AUTH_POLICY } from './domain/auth-policy';
import type {
  AccessTokenService,
  Clock,
  PasswordHasher,
  PreAuthLookup,
  RefreshTokenCodec,
  SecurityLog,
  TenantUnitOfWork,
} from './domain/auth-ports';
import { AuthController } from './http/auth.controller';
import { AuthGuard } from './http/auth.guard';
import { MeController } from './http/me.controller';
import {
  ACCESS_TOKEN_SERVICE,
  CLOCK,
  PASSWORD_HASHER,
  PRE_AUTH_LOOKUP,
  REFRESH_TOKEN_CODEC,
  SECURITY_LOG,
  TENANT_UNIT_OF_WORK,
} from './iam.tokens';
import { Argon2PasswordHasher } from './infrastructure/argon2-password-hasher';
import { DrizzleTenantUnitOfWork } from './infrastructure/drizzle-tenant-unit-of-work';
import { JoseAccessTokenService } from './infrastructure/jose-access-token.service';
import { PgPreAuthLookup } from './infrastructure/pg-pre-auth-lookup';
import { PinoSecurityLog } from './infrastructure/pino-security-log';
import { Sha256RefreshTokenCodec } from './infrastructure/sha256-refresh-token.codec';
import { systemClock } from './infrastructure/system-clock';

/**
 * Identity and access (SP2). Composition root: ports -> adapters, use cases
 * built with useFactory (ADR 0001), and the global AuthGuard.
 */
@Module({
  imports: [RateLimitModule],
  controllers: [AuthController, MeController],
  providers: [
    { provide: PASSWORD_HASHER, useFactory: () => new Argon2PasswordHasher() },
    {
      provide: ACCESS_TOKEN_SERVICE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new JoseAccessTokenService(
          { current: config.JWT_PRIVATE_JWK, previous: config.JWT_PREVIOUS_PUBLIC_JWK },
          { issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE, ttlSeconds: AUTH_POLICY.accessTokenTtlSeconds },
        ),
    },
    { provide: REFRESH_TOKEN_CODEC, useFactory: () => new Sha256RefreshTokenCodec() },
    { provide: PRE_AUTH_LOOKUP, inject: [DATABASE], useFactory: (db: Database) => new PgPreAuthLookup(db) },
    { provide: TENANT_UNIT_OF_WORK, inject: [DATABASE], useFactory: (db: Database) => new DrizzleTenantUnitOfWork(db) },
    {
      provide: SECURITY_LOG,
      inject: [PinoLogger],
      useFactory: (logger: PinoLogger) => {
        logger.setContext('Security');
        return new PinoSecurityLog(logger);
      },
    },
    { provide: CLOCK, useValue: systemClock },
    {
      provide: Authenticate,
      inject: [ACCESS_TOKEN_SERVICE, TENANT_UNIT_OF_WORK],
      useFactory: (tokens: AccessTokenService, uow: TenantUnitOfWork) => new Authenticate(tokens, uow),
    },
    {
      provide: Login,
      inject: [PRE_AUTH_LOOKUP, PASSWORD_HASHER, TENANT_UNIT_OF_WORK, REFRESH_TOKEN_CODEC, ACCESS_TOKEN_SERVICE, SECURITY_LOG, CLOCK],
      useFactory: (
        lookup: PreAuthLookup,
        hasher: PasswordHasher,
        uow: TenantUnitOfWork,
        codec: RefreshTokenCodec,
        tokens: AccessTokenService,
        log: SecurityLog,
        clock: Clock,
      ) => new Login(lookup, hasher, uow, codec, tokens, log, clock),
    },
    {
      provide: RefreshSession,
      inject: [PRE_AUTH_LOOKUP, TENANT_UNIT_OF_WORK, REFRESH_TOKEN_CODEC, ACCESS_TOKEN_SERVICE, CLOCK],
      useFactory: (lookup: PreAuthLookup, uow: TenantUnitOfWork, codec: RefreshTokenCodec, tokens: AccessTokenService, clock: Clock) =>
        new RefreshSession(lookup, uow, codec, tokens, clock),
    },
    {
      provide: Logout,
      inject: [TENANT_UNIT_OF_WORK, CLOCK],
      useFactory: (uow: TenantUnitOfWork, clock: Clock) => new Logout(uow, clock),
    },
    {
      provide: ChangePassword,
      inject: [TENANT_UNIT_OF_WORK, PASSWORD_HASHER, REFRESH_TOKEN_CODEC, ACCESS_TOKEN_SERVICE, CLOCK],
      useFactory: (uow: TenantUnitOfWork, hasher: PasswordHasher, codec: RefreshTokenCodec, tokens: AccessTokenService, clock: Clock) =>
        new ChangePassword(uow, hasher, codec, tokens, clock),
    },
    { provide: GetMe, inject: [TENANT_UNIT_OF_WORK], useFactory: (uow: TenantUnitOfWork) => new GetMe(uow) },
    {
      provide: APP_GUARD,
      inject: [Reflector, Authenticate],
      useFactory: (reflector: Reflector, authenticate: Authenticate) => new AuthGuard(reflector, authenticate),
    },
  ],
  exports: [Authenticate, TENANT_UNIT_OF_WORK],
})
export class IamModule {}
