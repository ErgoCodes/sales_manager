import { describe, expect, it } from 'vitest';
import { formatCurrency } from '../format';

describe('formatCurrency', () => {
  it('formats with exactly 2 decimals by default', () => {
    expect(formatCurrency(1234.5)).toBe('$1,234.50');
    expect(formatCurrency(0)).toBe('$0.00');
  });

  it('formats without decimals when compact is true', () => {
    expect(formatCurrency(1234.5, { compact: true })).toBe('$1,235');
    expect(formatCurrency(0, { compact: true })).toBe('$0');
  });
});
