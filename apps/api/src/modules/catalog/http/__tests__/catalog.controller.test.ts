import { describe, expect, it, vi } from 'vitest';

import { owner } from '../../../iam/application/__tests__/admin-fakes';
import { PermissionDenied } from '../../../iam/domain/errors';
import type { ArchiveProduct, CreateProduct, GetProduct, ListProducts, SetLocationPrice, UpdateProduct } from '../../application/catalog.use-cases';
import { CatalogController } from '../catalog.controller';

const ID = '0190a000-0000-7000-8000-000000000002';
const LOC = '0190a000-0000-7000-8000-0000000000c1';

describe('CatalogController', () => {
  const execute = vi.fn(async (..._args: unknown[]) => 'ok');
  const useCase = { execute } as never;
  const controller = new CatalogController(
    useCase as ListProducts,
    useCase as GetProduct,
    useCase as CreateProduct,
    useCase as UpdateProduct,
    useCase as ArchiveProduct,
    useCase as SetLocationPrice,
  );
  const actor = owner();

  it('delegates every route to its use case with the actor and the client IP', async () => {
    await controller.list(actor, { includeArchived: false, limit: 5 });
    expect(execute).toHaveBeenLastCalledWith(actor, { includeArchived: false, limit: 5 });
    await controller.get(actor, { id: ID }, { locationId: LOC });
    expect(execute).toHaveBeenLastCalledWith(actor, ID, LOC);
    await controller.get(actor, { id: ID }, {});
    expect(execute).toHaveBeenLastCalledWith(actor, ID, undefined);
    const body = { name: 'Agua', unitOfMeasure: 'litro', currency: 'CUP' as const };
    await controller.create(actor, '10.0.0.1', body);
    expect(execute).toHaveBeenLastCalledWith({ actor, ip: '10.0.0.1' }, body);
    await controller.update(actor, null, { id: ID }, { name: 'X' });
    expect(execute).toHaveBeenLastCalledWith({ actor, ip: null }, ID, { name: 'X' });
    expect(await controller.archive(actor, null, { id: ID })).toBe('ok');
    expect(execute).toHaveBeenLastCalledWith({ actor, ip: null }, ID);
    await controller.setPrice(actor, null, { locationId: LOC, productId: ID }, { cashPrice: null, transferPrice: null });
    expect(execute).toHaveBeenLastCalledWith({ actor, ip: null }, LOC, ID, { cashPrice: null, transferPrice: null });
  });

  it('propagates domain errors', async () => {
    execute.mockRejectedValueOnce(new PermissionDenied('catalog:write'));
    await expect(controller.archive(actor, null, { id: ID })).rejects.toBeInstanceOf(PermissionDenied);
  });
});
