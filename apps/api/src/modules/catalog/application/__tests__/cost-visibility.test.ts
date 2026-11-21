import { describe, expect, it } from 'vitest';

import { actorWith, at, CASHIER_ROLE, custom, LOC_1, LOC_2, MANAGER_ROLE, owner, TENANT_SCOPE } from '../../../iam/application/__tests__/admin-fakes';
import { canSeeCosts } from '../../domain/cost-visibility';

describe('canSeeCosts (D10)', () => {
  it('holds with catalog:write or inventory:write in the scope, and nowhere else', () => {
    expect(canSeeCosts(owner().effective)).toBe(true);
    expect(canSeeCosts(owner().effective, LOC_2)).toBe(true);

    const manager = actorWith([{ role: MANAGER_ROLE, scope: at(LOC_1) }]).effective;
    expect(canSeeCosts(manager, LOC_1)).toBe(true);
    expect(canSeeCosts(manager, LOC_2)).toBe(false);
    // A location-scoped writer is not a tenant-wide one.
    expect(canSeeCosts(manager)).toBe(false);

    expect(canSeeCosts(actorWith([{ role: custom('r', 'inventory:write'), scope: at(LOC_1) }]).effective, LOC_1)).toBe(true);
    expect(canSeeCosts(actorWith([{ role: custom('r', 'catalog:write'), scope: at(LOC_1) }]).effective, LOC_1)).toBe(true);
    expect(canSeeCosts(actorWith([{ role: custom('r', 'inventory:write'), scope: TENANT_SCOPE }]).effective)).toBe(true);
  });

  it('never holds through view or transfer permissions alone', () => {
    expect(canSeeCosts(actorWith([{ role: CASHIER_ROLE, scope: at(LOC_1) }]).effective, LOC_1)).toBe(false);
    const viewer = custom('v', 'inventory:view', 'catalog:view', 'inventory:transfer');
    expect(canSeeCosts(actorWith([{ role: viewer, scope: TENANT_SCOPE }]).effective, LOC_1)).toBe(false);
  });
});
