import { describe, expect, it } from 'vitest';
import type { PermissionGrant } from '@monaco/contracts';
import { canReverseDocument } from '../reversal';

const L1 = '018f0000-0000-7000-8000-0000000000b1';
const L2 = '018f0000-0000-7000-8000-0000000000b2';
const grant = (permission: string, ...locationIds: string[]): PermissionGrant =>
  ({ permission, scope: locationIds.length ? { type: 'locations', locationIds } : { type: 'tenant' } }) as PermissionGrant;
const doc = (kind: string, locationId: string | null = L1, targetLocationId: string | null = null) => ({ kind, locationId, targetLocationId }) as Parameters<typeof canReverseDocument>[1];

describe('canReverseDocument', () => {
  it('entries, exits and adjustments need inventory:write in their location', () => {
    for (const kind of ['entry', 'exit', 'adjustment']) {
      expect(canReverseDocument([grant('inventory:write', L1)], doc(kind))).toBe(true);
      expect(canReverseDocument([grant('inventory:write', L2)], doc(kind))).toBe(false);
      expect(canReverseDocument([grant('inventory:transfer')], doc(kind))).toBe(false);
    }
    expect(canReverseDocument([grant('inventory:write')], doc('entry'))).toBe(true);
  });

  it('a transfer needs inventory:transfer at the origin and at the destination (D7)', () => {
    expect(canReverseDocument([grant('inventory:transfer', L1, L2)], doc('transfer', L1, L2))).toBe(true);
    expect(canReverseDocument([grant('inventory:transfer', L1), grant('inventory:write', L2)], doc('transfer', L1, L2))).toBe(false);
    expect(canReverseDocument([grant('inventory:write')], doc('transfer', L1, L2))).toBe(false);
  });

  it('never offers to reverse a reversal (D8) nor a document with a location the user cannot see', () => {
    expect(canReverseDocument([grant('inventory:write'), grant('inventory:transfer')], doc('reversal'))).toBe(false);
    expect(canReverseDocument([grant('inventory:transfer')], doc('transfer', L1, null))).toBe(false);
    expect(canReverseDocument([grant('inventory:write')], doc('entry', null))).toBe(false);
  });
});
