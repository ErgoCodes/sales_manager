import { describe, expect, it } from 'vitest';
import { movementDelta } from '@monaco/domain';

describe('@monaco/domain import', () => {
  it('resolves the workspace package', () => {
    expect(movementDelta('shrinkage', 2)).toBe(-2);
  });
});
