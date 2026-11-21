import { describe, expect, it } from 'vitest';
import { formatMoney, minorToInput, parseMoneyInput, proposeTransferPrice } from '../money';

describe('parseMoneyInput', () => {
  it.each([
    ['', null],
    ['  ', null],
    ['12', 1200],
    ['12.5', 1250],
    ['12,50', 1250],
    ['0', 0],
    ['0.01', 1],
  ])('parses %j to minor units %j', (raw, amount) => {
    expect(parseMoneyInput(raw)).toEqual({ ok: true, amount });
  });

  it.each(['abc', '-1', '1.234', '1e3', '12.', '99999999999999'])('rejects %j', (raw) => {
    expect(parseMoneyInput(raw)).toEqual({ ok: false });
  });
});

describe('minorToInput', () => {
  it('renders minor units as an editable major-unit string, and null as empty', () => {
    expect(minorToInput(1250)).toBe('12.50');
    expect(minorToInput(0)).toBe('0.00');
    expect(minorToInput(null)).toBe('');
    expect(minorToInput(undefined)).toBe('');
  });
});

describe('formatMoney', () => {
  it('formats an amount with its currency', () => {
    expect(formatMoney({ amount: 1250, currency: 'CUP' })).toBe('$12.50 CUP');
  });

  it('renders a null amount as a dash, never as zero', () => {
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(undefined)).toBe('—');
  });
});

describe('proposeTransferPrice', () => {
  it('applies the domain rule (cash + 10 %, rounded to 5) on minor units', () => {
    expect(proposeTransferPrice('100')).toBe('110.00');
    expect(proposeTransferPrice('12.34')).toBe('15.00');
  });

  it('proposes nothing for an empty, zero or invalid cash price', () => {
    expect(proposeTransferPrice('')).toBeNull();
    expect(proposeTransferPrice('0')).toBeNull();
    expect(proposeTransferPrice('abc')).toBeNull();
  });
});
