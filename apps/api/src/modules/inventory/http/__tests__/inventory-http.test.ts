import { HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { owner } from '../../../iam/application/__tests__/admin-fakes';
import { PermissionDenied } from '../../../iam/domain/errors';
import { AlreadyReversed, ArchivedResource, CurrencyMismatch, FutureOccurredAt, IdempotencyConflict, InsufficientStock } from '../../domain/inventory-errors';
import type { RecordAdjustment, RecordEntry, RecordExit, RecordTransfer, ReverseDocument } from '../../application/inventory.use-cases';
import { InventoryController } from '../inventory.controller';
import { toInventoryMappedError } from '../inventory-http-errors';

describe('toInventoryMappedError', () => {
  it('maps each domain error to its status and stable code', () => {
    expect(toInventoryMappedError(new IdempotencyConflict())).toMatchObject({ status: 409, body: { error: { code: 'IDEMPOTENCY_CONFLICT' } } });
    expect(toInventoryMappedError(new AlreadyReversed())).toMatchObject({ status: 409, body: { error: { code: 'ALREADY_REVERSED' } } });
    expect(toInventoryMappedError(new ArchivedResource('product'))).toMatchObject({ status: 409, body: { error: { code: 'ARCHIVED' } } });
    expect(toInventoryMappedError(new CurrencyMismatch('p'))).toMatchObject({ status: 422, body: { error: { code: 'CURRENCY_MISMATCH' } } });
    expect(toInventoryMappedError(new FutureOccurredAt())).toMatchObject({
      status: 400,
      body: { error: { code: 'VALIDATION_ERROR', details: [{ path: 'occurredAt' }] } },
    });
  });

  it('INSUFFICIENT_STOCK lists the short products of the document, by product id', () => {
    const mapped = toInventoryMappedError(new InsufficientStock([{ productId: 'p1', available: 3, shortBy: 1.5 }]));
    expect(mapped).toEqual({
      status: 409,
      body: { error: { code: 'INSUFFICIENT_STOCK', message: 'Insufficient stock', details: [{ path: 'p1', message: 'Available 3, short by 1.5' }] } },
    });
  });

  it('turns a deadlock or serialization failure (also behind Drizzle\'s wrapper) into a generic 409', () => {
    const conflict = { status: 409, body: { error: { code: 'CONFLICT', message: 'Conflict' } } };
    expect(toInventoryMappedError(Object.assign(new Error('deadlock detected'), { code: '40P01' }))).toEqual(conflict);
    expect(toInventoryMappedError({ cause: { code: '40001' } })).toEqual(conflict);
  });

  it('a 23505 on the one-reversal-per-document index is ALREADY_REVERSED, also behind the wrapper', () => {
    const constraint = 'inventory_documents_tenant_id_reverses_document_id_unique';
    expect(toInventoryMappedError({ cause: { code: '23505', constraint } })).toMatchObject({ status: 409, body: { error: { code: 'ALREADY_REVERSED' } } });
    expect(toInventoryMappedError({ code: '23505', constraint: 'inventory_documents_pkey' })).toBeNull();
  });

  it('ignores everything else so other mappers and the global filter decide', () => {
    expect(toInventoryMappedError(new Error('boom'))).toBeNull();
    expect(toInventoryMappedError(null)).toBeNull();
    expect(toInventoryMappedError({ code: '23505' })).toBeNull();
    expect(toInventoryMappedError({ code: 'ECONNRESET' })).toBeNull();
  });
});

describe('InventoryController', () => {
  const document = { id: 'doc' };
  const useCase = (created: boolean) => ({ execute: vi.fn(async () => ({ document, created })) });
  const actor = owner();
  const response = () => {
    const status = vi.fn();
    return { res: { status } as unknown as Response, status };
  };

  const controllerWith = (c: { execute: unknown }) =>
    new InventoryController(
      c as unknown as RecordEntry,
      c as unknown as RecordExit,
      c as unknown as RecordAdjustment,
      c as unknown as RecordTransfer,
      c as unknown as ReverseDocument,
    );

  it.each(['entry', 'exit', 'adjustment', 'transfer'] as const)('%s: 201 for a new document, 200 for an idempotent retry; passes the actor and the client IP', async (method) => {
    const created = useCase(true);
    const retried = useCase(false);
    const build = controllerWith;
    const body = { id: 'x' } as never;

    const first = response();
    expect(await build(created)[method](actor, '10.0.0.1', body, first.res)).toBe(document);
    expect(first.status).toHaveBeenCalledWith(HttpStatus.CREATED);
    expect(created.execute).toHaveBeenCalledWith({ actor, ip: '10.0.0.1' }, body);

    const second = response();
    await build(retried)[method](actor, null, body, second.res);
    expect(second.status).toHaveBeenCalledWith(HttpStatus.OK);
  });

  it('reversal: passes the document id from the path, 201 or 200 like the other writes', async () => {
    const created = useCase(true);
    const first = response();
    const body = { id: 'r' } as never;
    expect(await controllerWith(created).reversal(actor, '10.0.0.1', { id: 'doc' }, body, first.res)).toBe(document);
    expect(created.execute).toHaveBeenCalledWith({ actor, ip: '10.0.0.1' }, 'doc', body);
    expect(first.status).toHaveBeenCalledWith(HttpStatus.CREATED);
    const second = response();
    await controllerWith(useCase(false)).reversal(actor, null, { id: 'doc' }, body, second.res);
    expect(second.status).toHaveBeenCalledWith(HttpStatus.OK);
  });

  it('propagates domain errors', async () => {
    const failing = { execute: vi.fn().mockRejectedValue(new PermissionDenied('inventory:write')) };
    const controller = controllerWith(failing);
    await expect(controller.exit(actor, null, {} as never, response().res)).rejects.toBeInstanceOf(PermissionDenied);
  });
});
