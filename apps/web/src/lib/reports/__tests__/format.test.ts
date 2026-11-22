import { describe, expect, it } from 'vitest';
import { formatAmount, formatMargin } from '../format';

describe('report formatting', () => {
  it('formats minor units with their own currency (Intl.NumberFormat), never a fixed $', () => {
    expect(formatAmount(123450, 'CUP')).toMatch(/^CUP\s1,234\.50$/);
    expect(formatAmount(99, 'USD')).toMatch(/^USD\s0\.99$/);
    expect(formatAmount(150000.456789, 'MLC')).toMatch(/^MLC\s1,500\.00$/);
    expect(formatAmount(-2500, 'CUP')).toMatch(/^-CUP\s25\.00$/);
  });

  it('a null amount (hidden or without data) is a dash, never a zero', () => {
    expect(formatAmount(null, 'CUP')).toBe('—');
    expect(formatMargin(null)).toBe('—');
  });

  it('formats the margin as a percentage', () => {
    expect(formatMargin(0.2345)).toBe('23.5%');
  });
});
