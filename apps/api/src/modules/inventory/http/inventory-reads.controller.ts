import {
  InventoryDocument,
  LocationIdParams,
  MovementsQuery,
  PaginatedInventoryMovements,
  PaginatedStockItems,
  ProductStock,
  StockQuery,
} from '@monaco/contracts';
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto, ZodResponse } from 'nestjs-zod';

import { ApiErrorResponse } from '../../../common/http/api-error-response.decorator';
import type { AuthenticatedActor } from '../../iam/domain/actor';
import { IdParamsDto } from '../../iam/http/admin.dto';
import { CurrentActor } from '../../iam/http/auth.decorators';
import { GetInventoryDocument, GetLocationStock, GetProductStock, ListLocationMovements } from '../application/inventory-reads.use-cases';

class InventoryDocumentDto extends createZodDto(InventoryDocument) {}
class PaginatedStockItemsDto extends createZodDto(PaginatedStockItems) {}
class PaginatedInventoryMovementsDto extends createZodDto(PaginatedInventoryMovements) {}
class ProductStockDto extends createZodDto(ProductStock) {}
class StockQueryDto extends createZodDto(StockQuery) {}
class MovementsQueryDto extends createZodDto(MovementsQuery) {}
class LocationIdParamsDto extends createZodDto(LocationIdParams) {}

const COSTS = 'Costs only with catalog:write or inventory:write in the location';

/**
 * Inventory reads (SP3·T5b). No `@RequirePermission` on purpose: the permission
 * depends on the location, so the use case is the only authority (ADR 0005), with
 * the D9 read implication; the global AuthGuard only authenticates.
 */
@ApiTags('inventory')
@ApiErrorResponse()
@ApiBearerAuth()
@Controller()
export class InventoryReadsController {
  constructor(
    private readonly getLocationStock: GetLocationStock,
    private readonly getProductStock: GetProductStock,
    private readonly listLocationMovements: ListLocationMovements,
    private readonly getInventoryDocument: GetInventoryDocument,
  ) {}

  @Get('locations/:locationId/stock')
  @ApiOperation({ operationId: 'getLocationStock', summary: `Stock of a location by product name (inventory:view there); ?lowStockOnly. ${COSTS}` })
  @ZodResponse({ status: 200, description: 'A page of stock items', type: PaginatedStockItemsDto })
  locationStock(@CurrentActor() actor: AuthenticatedActor, @Param() params: LocationIdParamsDto, @Query() query: StockQueryDto) {
    return this.getLocationStock.execute(actor, params.locationId, query);
  }

  @Get('products/:id/stock')
  @ApiOperation({ operationId: 'getProductStock', summary: `Stock of a product in each location where the actor has inventory:view. ${COSTS}` })
  @ZodResponse({ status: 200, description: 'The visible locations with their stock', type: ProductStockDto })
  productStock(@CurrentActor() actor: AuthenticatedActor, @Param() params: IdParamsDto) {
    return this.getProductStock.execute(actor, params.id);
  }

  @Get('locations/:locationId/inventory-movements')
  @ApiOperation({
    operationId: 'listInventoryMovements',
    summary: `Ledger of a location, newest first (inventory:view there); the other location of a transfer only with inventory:view in it. ${COSTS}`,
  })
  @ZodResponse({ status: 200, description: 'A page of movements', type: PaginatedInventoryMovementsDto })
  movements(@CurrentActor() actor: AuthenticatedActor, @Param() params: LocationIdParamsDto, @Query() query: MovementsQueryDto) {
    return this.listLocationMovements.execute(actor, params.locationId, query);
  }

  @Get('inventory/documents/:id')
  @ApiOperation({
    operationId: 'getInventoryDocument',
    summary: `An inventory document (inventory:view in at least one of its locations); locations without it are masked. ${COSTS}`,
  })
  @ZodResponse({ status: 200, description: 'The document with its visible movements', type: InventoryDocumentDto })
  document(@CurrentActor() actor: AuthenticatedActor, @Param() params: IdParamsDto) {
    return this.getInventoryDocument.execute(actor, params.id);
  }
}
