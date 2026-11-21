import { describe, expect, it, vi } from 'vitest';

import { owner } from '../../../iam/application/__tests__/admin-fakes';
import { PermissionDenied } from '../../../iam/domain/errors';
import type { GetInventoryDocument, GetLocationStock, GetProductStock, ListLocationMovements } from '../../application/inventory-reads.use-cases';
import { InventoryReadsController } from '../inventory-reads.controller';

const ID = '0190a000-0000-7000-8000-000000000002';
const LOC = '0190a000-0000-7000-8000-0000000000c1';

describe('InventoryReadsController', () => {
  const execute = vi.fn(async (..._args: unknown[]) => 'ok');
  const useCase = { execute } as never;
  const controller = new InventoryReadsController(
    useCase as GetLocationStock,
    useCase as GetProductStock,
    useCase as ListLocationMovements,
    useCase as GetInventoryDocument,
  );
  const actor = owner();

  it('delegates every read to its use case with the actor', async () => {
    expect(await controller.locationStock(actor, { locationId: LOC }, { limit: 5 })).toBe('ok');
    expect(execute).toHaveBeenLastCalledWith(actor, LOC, { limit: 5 });
    await controller.productStock(actor, { id: ID });
    expect(execute).toHaveBeenLastCalledWith(actor, ID);
    await controller.movements(actor, { locationId: LOC }, { kind: 'entry', limit: 5 });
    expect(execute).toHaveBeenLastCalledWith(actor, LOC, { kind: 'entry', limit: 5 });
    await controller.document(actor, { id: ID });
    expect(execute).toHaveBeenLastCalledWith(actor, ID);
  });

  it('propagates domain errors', async () => {
    execute.mockRejectedValueOnce(new PermissionDenied('inventory:view'));
    await expect(controller.document(actor, { id: ID })).rejects.toBeInstanceOf(PermissionDenied);
  });
});
