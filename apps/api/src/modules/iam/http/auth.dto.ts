import { AuthTokens, ChangePasswordRequest, LoginRequest, MeResponse, RefreshRequest, RefreshResponse } from '@monaco/contracts';
import { createZodDto } from 'nestjs-zod';

export class LoginRequestDto extends createZodDto(LoginRequest) {}
export class AuthTokensDto extends createZodDto(AuthTokens) {}
export class RefreshRequestDto extends createZodDto(RefreshRequest) {}
export class RefreshResponseDto extends createZodDto(RefreshResponse) {}
export class ChangePasswordRequestDto extends createZodDto(ChangePasswordRequest) {}
export class MeResponseDto extends createZodDto(MeResponse) {}
