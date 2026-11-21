import { EXIT_REASONS, INVENTORY_DOCUMENT_KINDS, INVENTORY_MOVEMENT_KINDS as CONTRACT_KINDS } from '@monaco/contracts';
import { INVENTORY_MOVEMENT_KINDS as DOMAIN_KINDS, movementDelta } from '@monaco/domain';
import { describe, expect, it } from 'vitest';

describe('contracts and @monaco/domain agree', () => {
  it('the movement kinds of the API enum are exactly the domain list, in the same order', () => {
    expect([...CONTRACT_KINDS]).toEqual([...DOMAIN_KINDS]);
  });

  it('every exit reason is a movement kind the domain knows (and signs negative)', () => {
    for (const reason of EXIT_REASONS) {
      expect(DOMAIN_KINDS).toContain(reason);
      expect(movementDelta(reason, 1)).toBe(-1);
    }
  });

  it('every document kind this module writes exists in the contract', () => {
    expect(INVENTORY_DOCUMENT_KINDS).toEqual(expect.arrayContaining(['entry', 'exit', 'adjustment']));
  });
});
