import { IdParams, PaginationQuery } from '@monaco/contracts';
import { createZodDto } from 'nestjs-zod';

/** Shared by the administration controllers: `/:id` (a UUIDv7, else 400) and `?cursor&limit`. */
export class IdParamsDto extends createZodDto(IdParams) {}
export class PaginationQueryDto extends createZodDto(PaginationQuery) {}
