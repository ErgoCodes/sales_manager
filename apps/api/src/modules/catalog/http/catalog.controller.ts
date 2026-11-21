import {
  CreateProductRequest,
  ListProductsQuery,
  LocationProductParams,
  PaginatedProducts,
  Product,
  ProductLocationQuery,
  ProductWithLocationPrice,
  SetLocationPriceRequest,
  UpdateProductRequest,
} from '@monaco/contracts';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto, ZodResponse } from 'nestjs-zod';

import { ApiErrorResponse } from '../../../common/http/api-error-response.decorator';
import type { AuthenticatedActor } from '../../iam/domain/actor';
import { IdParamsDto } from '../../iam/http/admin.dto';
import { ClientIp, CurrentActor } from '../../iam/http/auth.decorators';
import { ArchiveProduct, CreateProduct, GetProduct, ListProducts, SetLocationPrice, UpdateProduct } from '../application/catalog.use-cases';

class ProductDto extends createZodDto(Product) {}
class ProductWithLocationPriceDto extends createZodDto(ProductWithLocationPrice) {}
class PaginatedProductsDto extends createZodDto(PaginatedProducts) {}
class CreateProductRequestDto extends createZodDto(CreateProductRequest) {}
class UpdateProductRequestDto extends createZodDto(UpdateProductRequest) {}
class SetLocationPriceRequestDto extends createZodDto(SetLocationPriceRequest) {}
class ListProductsQueryDto extends createZodDto(ListProductsQuery) {}
class ProductLocationQueryDto extends createZodDto(ProductLocationQuery) {}
class LocationProductParamsDto extends createZodDto(LocationProductParams) {}

/**
 * Catalog (SP3·T4). No `@RequirePermission` on purpose: the permission depends on
 * the location in the query or path, so the use case is the only authority
 * (ADR 0005); the global AuthGuard only authenticates.
 */
@ApiTags('catalog')
@ApiErrorResponse()
@ApiBearerAuth()
@Controller()
export class CatalogController {
  constructor(
    private readonly listProducts: ListProducts,
    private readonly getProduct: GetProduct,
    private readonly createProduct: CreateProduct,
    private readonly updateProduct: UpdateProduct,
    private readonly archiveProduct: ArchiveProduct,
    private readonly setLocationPrice: SetLocationPrice,
  ) {}

  @Get('products')
  @ApiOperation({
    operationId: 'listProducts',
    summary: 'Products by name (catalog:view); with ?locationId the effective prices of that location. Costs only for writers',
  })
  @ZodResponse({ status: 200, description: 'A page of products', type: PaginatedProductsDto })
  list(@CurrentActor() actor: AuthenticatedActor, @Query() query: ListProductsQueryDto) {
    return this.listProducts.execute(actor, query);
  }

  @Get('products/:id')
  @ApiOperation({ operationId: 'getProduct', summary: 'A product (catalog:view); ?locationId for the effective price' })
  @ZodResponse({ status: 200, description: 'The product', type: ProductWithLocationPriceDto })
  get(@CurrentActor() actor: AuthenticatedActor, @Param() params: IdParamsDto, @Query() query: ProductLocationQueryDto) {
    return this.getProduct.execute(actor, params.id, query.locationId);
  }

  @Post('products')
  @ApiOperation({ operationId: 'createProduct', summary: 'Create a product (catalog:write, tenant-wide)' })
  @ZodResponse({ status: 201, description: 'The new product', type: ProductDto })
  create(@CurrentActor() actor: AuthenticatedActor, @ClientIp() ip: string | null, @Body() body: CreateProductRequestDto) {
    return this.createProduct.execute({ actor, ip }, body);
  }

  @Patch('products/:id')
  @ApiOperation({
    operationId: 'updateProduct',
    summary: 'Edit a product (catalog:write, tenant-wide); the currency cannot change once it has movements',
  })
  @ZodResponse({ status: 200, description: 'The updated product', type: ProductDto })
  update(
    @CurrentActor() actor: AuthenticatedActor,
    @ClientIp() ip: string | null,
    @Param() params: IdParamsDto,
    @Body() body: UpdateProductRequestDto,
  ) {
    return this.updateProduct.execute({ actor, ip }, params.id, body);
  }

  @Post('products/:id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'archiveProduct', summary: 'Archive a product (catalog:write, tenant-wide); idempotent' })
  @ZodResponse({ status: 200, description: 'The archived product', type: ProductDto })
  archive(@CurrentActor() actor: AuthenticatedActor, @ClientIp() ip: string | null, @Param() params: IdParamsDto) {
    return this.archiveProduct.execute({ actor, ip }, params.id);
  }

  @Put('locations/:locationId/products/:productId/price')
  @ApiOperation({
    operationId: 'setLocationPrice',
    summary: "Set a product's price overrides at a location (catalog:write at that location); null removes an override",
  })
  @ZodResponse({ status: 200, description: 'The product with the effective prices of the location', type: ProductWithLocationPriceDto })
  setPrice(
    @CurrentActor() actor: AuthenticatedActor,
    @ClientIp() ip: string | null,
    @Param() params: LocationProductParamsDto,
    @Body() body: SetLocationPriceRequestDto,
  ) {
    return this.setLocationPrice.execute({ actor, ip }, params.locationId, params.productId, body);
  }
}
