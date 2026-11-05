import { HealthResponse } from '@monaco/contracts';
import { createZodDto } from 'nestjs-zod';

/** HTTP DTOs are thin wrappers over `@monaco/contracts` schemas; never redefine shapes here. */
export class HealthResponseDto extends createZodDto(HealthResponse) {}
