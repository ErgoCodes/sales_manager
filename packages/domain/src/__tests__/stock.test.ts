import { describe, expect, it } from 'vitest';
import { deriveStock, stockDelta } from '../stock';
describe('stock rules', () => { it('adds entries and adjustments, and subtracts other movements and sales', () => { expect(stockDelta('entrada', 3)).toBe(3); expect(stockDelta('merma', 3)).toBe(-3); expect(deriveStock([{ type: 'entrada', quantity: 10 }, { type: 'merma', quantity: 2 }, { type: 'ajuste', quantity: 1 }], 4)).toBe(5); }); });
