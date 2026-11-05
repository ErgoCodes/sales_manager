import { ErrorResponse } from '@monaco/contracts';
import { createZodDto } from 'nestjs-zod';

export class ErrorResponseDto extends createZodDto(ErrorResponse) {}
