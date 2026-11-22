import { describe, expect, it, vi } from 'vitest';

import { owner } from '../../../iam/application/__tests__/admin-fakes';
import { PermissionDenied } from '../../../iam/domain/errors';
import type { GetDailySeries, GetInventoryHealth, GetReportSummary, GetSummaryByLocation, GetTopProducts } from '../../application/reports.use-cases';
import { noStore } from '../no-store.middleware';
import { ReportsController } from '../reports.controller';

const LOC = '0190a000-0000-7000-8000-0000000000c1';

describe('ReportsController', () => {
  const execute = vi.fn(async (..._args: unknown[]) => 'ok');
  const useCase = { execute } as never;
  const controller = new ReportsController(
    useCase as GetReportSummary,
    useCase as GetDailySeries,
    useCase as GetTopProducts,
    useCase as GetSummaryByLocation,
    useCase as GetInventoryHealth,
  );
  const actor = owner();

  it('delegates every report to its use case with the actor and the query', async () => {
    const range = { from: '2026-01-01', to: '2026-01-31', locationId: LOC };
    expect(await controller.summary(actor, range)).toBe('ok');
    expect(execute).toHaveBeenLastCalledWith(actor, range);
    await controller.dailySeries(actor, range);
    expect(execute).toHaveBeenLastCalledWith(actor, range);
    await controller.topProducts(actor, { ...range, by: 'profit', limit: 5 });
    expect(execute).toHaveBeenLastCalledWith(actor, { ...range, by: 'profit', limit: 5 });
    await controller.byLocation(actor, {});
    expect(execute).toHaveBeenLastCalledWith(actor, {});
    await controller.inventoryHealth(actor, { locationId: LOC });
    expect(execute).toHaveBeenLastCalledWith(actor, { locationId: LOC });
  });

  it('propagates domain errors', async () => {
    execute.mockRejectedValueOnce(new PermissionDenied('reports:view'));
    await expect(controller.summary(actor, {})).rejects.toBeInstanceOf(PermissionDenied);
  });
});

describe('noStore', () => {
  it('marks the response private, no-store and continues', () => {
    const setHeader = vi.fn();
    const next = vi.fn();
    noStore({} as never, { setHeader } as never, next);
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(next).toHaveBeenCalledOnce();
  });
});
