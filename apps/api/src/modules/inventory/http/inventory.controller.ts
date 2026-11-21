import { Body, Controller, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import {
  CreateAdjustmentRequest,
  CreateEntryRequest,
  CreateExitRequest,
  InventoryDocument,
} from '@monaco/contracts';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { createZodDto, ZodResponse } from 'nestjs-zod';

import { ApiErrorResponse } from '../../../common/http/api-error-response.decorator';
import type { AuthenticatedActor } from '../../iam/domain/actor';
import { ClientIp, CurrentActor, RequirePermission } from '../../iam/http/auth.decorators';
import type { RecordedDocument } from '../application/record-document';
import { RecordAdjustment, RecordEntry, RecordExit } from '../application/inventory.use-cases';

class InventoryDocumentDto extends createZodDto(InventoryDocument) {}
class CreateEntryRequestDto extends createZodDto(CreateEntryRequest) {}
class CreateExitRequestDto extends createZodDto(CreateExitRequest) {}
class CreateAdjustmentRequestDto extends createZodDto(CreateAdjustmentRequest) {}

const RETRY_DESCRIPTION = 'The same document, when the id was already used with the same content (idempotent retry)';

/** 201 for a new document, 200 for an idempotent retry of one that already exists. */
function respond(res: Response, { document, created }: RecordedDocument): InventoryDocument {
  res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
  return document;
}

@ApiTags('inventory')
@ApiErrorResponse()
@ApiBearerAuth()
@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly recordEntry: RecordEntry,
    private readonly recordExit: RecordExit,
    private readonly recordAdjustment: RecordAdjustment,
  ) {}

  @Post('entries')
  @RequirePermission('inventory:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ operationId: 'createInventoryEntry', summary: 'Record a stock entry with unit costs (inventory:write in the location)' })
  @ZodResponse({ status: 201, description: 'The new document', type: InventoryDocumentDto })
  @ApiResponse({ status: 200, description: RETRY_DESCRIPTION, type: InventoryDocumentDto })
  async entry(
    @CurrentActor() actor: AuthenticatedActor,
    @ClientIp() ip: string | null,
    @Body() body: CreateEntryRequestDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(res, await this.recordEntry.execute({ actor, ip }, body));
  }

  @Post('exits')
  @RequirePermission('inventory:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ operationId: 'createInventoryExit', summary: 'Record a shrinkage or owner withdrawal (inventory:write in the location)' })
  @ZodResponse({ status: 201, description: 'The new document', type: InventoryDocumentDto })
  @ApiResponse({ status: 200, description: RETRY_DESCRIPTION, type: InventoryDocumentDto })
  async exit(
    @CurrentActor() actor: AuthenticatedActor,
    @ClientIp() ip: string | null,
    @Body() body: CreateExitRequestDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(res, await this.recordExit.execute({ actor, ip }, body));
  }

  @Post('adjustments')
  @RequirePermission('inventory:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ operationId: 'createInventoryAdjustment', summary: 'Record signed stock adjustments (inventory:write in the location)' })
  @ZodResponse({ status: 201, description: 'The new document', type: InventoryDocumentDto })
  @ApiResponse({ status: 200, description: RETRY_DESCRIPTION, type: InventoryDocumentDto })
  async adjustment(
    @CurrentActor() actor: AuthenticatedActor,
    @ClientIp() ip: string | null,
    @Body() body: CreateAdjustmentRequestDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(res, await this.recordAdjustment.execute({ actor, ip }, body));
  }
}
