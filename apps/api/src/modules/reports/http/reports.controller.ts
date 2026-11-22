import {
  DailySeries,
  InventoryHealth,
  InventoryHealthQuery,
  ReportRangeQuery,
  ReportSummary,
  SummaryByLocation,
  TopProducts,
  TopProductsQuery,
} from '@monaco/contracts';
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import { createZodDto, ZodResponse } from 'nestjs-zod';

import { ApiErrorResponse } from '../../../common/http/api-error-response.decorator';
import type { AuthenticatedActor } from '../../iam/domain/actor';
import { CurrentActor, RequirePermission } from '../../iam/http/auth.decorators';
import { GetDailySeries, GetInventoryHealth, GetReportSummary, GetSummaryByLocation, GetTopProducts } from '../application/reports.use-cases';

class ReportRangeQueryDto extends createZodDto(ReportRangeQuery) {}
class TopProductsQueryDto extends createZodDto(TopProductsQuery) {}
class InventoryHealthQueryDto extends createZodDto(InventoryHealthQuery) {}
class ReportSummaryDto extends createZodDto(ReportSummary) {}
class DailySeriesDto extends createZodDto(DailySeries) {}
class TopProductsDto extends createZodDto(TopProducts) {}
class SummaryByLocationDto extends createZodDto(SummaryByLocation) {}
class InventoryHealthDto extends createZodDto(InventoryHealth) {}

const RANGE =
  'Local days of the tenant time zone; without from/to, today. Cut at the database now(); reversed documents never count. Amounts per currency, never converted.';
const SCOPE = 'With locationId: reports:view there (403 otherwise; 404 for a location of another tenant). Without it: every active location where the actor has reports:view.';
const COSTS = 'reports:view is a financial permission: it sees profit, margin, valued losses and inventory value.';

/**
 * Reports (SP4 · T6). `@RequirePermission('reports:view')` is the coarse early
 * check; the use case stays the authority with the concrete location (ADR 0005).
 * The summary has none on purpose: `reports:view_own` also reaches it, and the
 * decorator takes a single permission. Rate limited per IP like the auth routes;
 * `Cache-Control: private, no-store` comes from the module middleware, so even
 * errors carry it.
 */
@ApiTags('reports')
@ApiErrorResponse()
@ApiBearerAuth()
@UseGuards(ThrottlerGuard)
@SkipThrottle({ credential: true })
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly getReportSummary: GetReportSummary,
    private readonly getDailySeries: GetDailySeries,
    private readonly getTopProducts: GetTopProducts,
    private readonly getSummaryByLocation: GetSummaryByLocation,
    private readonly getInventoryHealth: GetInventoryHealth,
  ) {}

  @Get('summary')
  @ApiOperation({
    operationId: 'getReportSummary',
    summary: 'KPIs per currency over a range',
    description: `${RANGE} ${SCOPE} Or reports:view_own on the location (locationId required): only the actor's sales, scope 'own', profit, margin and losses null. ${COSTS}`,
  })
  @ZodResponse({ status: 200, description: 'Sales, profit, margin, tickets, losses and valued entries per currency', type: ReportSummaryDto })
  summary(@CurrentActor() actor: AuthenticatedActor, @Query() query: ReportRangeQueryDto) {
    return this.getReportSummary.execute(actor, query);
  }

  @Get('daily-series')
  @RequirePermission('reports:view')
  @ApiOperation({ operationId: 'getReportDailySeries', summary: 'Total sales and profit per local day and currency', description: `${RANGE} ${SCOPE} Days without sales are 0.` })
  @ZodResponse({ status: 200, description: 'One point per local day for each currency with sales', type: DailySeriesDto })
  dailySeries(@CurrentActor() actor: AuthenticatedActor, @Query() query: ReportRangeQueryDto) {
    return this.getDailySeries.execute(actor, query);
  }

  @Get('top-products')
  @RequirePermission('reports:view')
  @ApiOperation({ operationId: 'getReportTopProducts', summary: 'Product ranking by revenue, quantity or profit', description: `${RANGE} ${SCOPE} ${COSTS}` })
  @ZodResponse({ status: 200, description: 'The best products of the range', type: TopProductsDto })
  topProducts(@CurrentActor() actor: AuthenticatedActor, @Query() query: TopProductsQueryDto) {
    return this.getTopProducts.execute(actor, query);
  }

  @Get('by-location')
  @RequirePermission('reports:view')
  @ApiOperation({ operationId: 'getReportByLocation', summary: 'A compact summary per visible location', description: `${RANGE} ${SCOPE} ${COSTS}` })
  @ZodResponse({ status: 200, description: 'KPIs per location and currency', type: SummaryByLocationDto })
  byLocation(@CurrentActor() actor: AuthenticatedActor, @Query() query: ReportRangeQueryDto) {
    return this.getSummaryByLocation.execute(actor, query);
  }

  @Get('inventory-health')
  @RequirePermission('reports:view')
  @ApiOperation({
    operationId: 'getReportInventoryHealth',
    summary: 'Low stock, stagnant and near-expiration products, and the inventory value, at the moment',
    description: `${SCOPE} Never by range. ${COSTS}`,
  })
  @ZodResponse({ status: 200, description: 'Counts, the first items of each list and the value per currency', type: InventoryHealthDto })
  inventoryHealth(@CurrentActor() actor: AuthenticatedActor, @Query() query: InventoryHealthQueryDto) {
    return this.getInventoryHealth.execute(actor, query);
  }
}
