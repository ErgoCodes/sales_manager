import { describe, expect, it } from 'vitest';
import { addDays, cardKeys, dashboardHref, parseFilters, resolveRange, todayIn } from '../filters';

const L1 = '018f0000-0000-7000-8000-0000000000b1';

describe('parseFilters', () => {
  it('defaults to today, every visible location, the first currency with data and ranking by revenue', () => {
    expect(parseFilters({})).toEqual({ period: 'hoy', order: 'revenue' });
  });

  it('reads the location, preset, currency and ranking order from the URL', () => {
    expect(parseFilters({ punto: L1, periodo: '7d', moneda: 'USD', orden: 'profit' })).toEqual({ period: '7d', locationId: L1, currency: 'USD', order: 'profit' });
    expect(parseFilters({ periodo: '30d' }).period).toBe('30d');
  });

  it('a desde/hasta pair is a custom range and wins over the preset', () => {
    expect(parseFilters({ periodo: '7d', desde: '2026-11-01', hasta: '2026-11-10' })).toEqual({ period: 'rango', from: '2026-11-01', to: '2026-11-10', order: 'revenue' });
  });

  it('ignores unknown or malformed values instead of sending them to the API', () => {
    expect(parseFilters({ punto: 'nope', periodo: 'year', moneda: 'EUR', orden: 'name', desde: '2026-13-01', hasta: '2026-11-10' })).toEqual({ period: 'hoy', order: 'revenue' });
    expect(parseFilters({ desde: '2026-11-01' })).toEqual({ period: 'hoy', order: 'revenue' });
    expect(parseFilters({ punto: '', moneda: ['CUP', 'USD'] })).toEqual({ period: 'hoy', order: 'revenue' });
  });
});

describe('dashboardHref', () => {
  it('omits the defaults so the plain URL is today for every location', () => {
    expect(dashboardHref({ period: 'hoy', order: 'revenue' })).toBe('/tablero');
  });

  it('keeps every filter in the URL so a link reproduces the view', () => {
    expect(dashboardHref({ period: '7d', locationId: L1, currency: 'USD', order: 'quantity' })).toBe(`/tablero?punto=${L1}&periodo=7d&moneda=USD&orden=quantity`);
    expect(dashboardHref({ period: 'rango', from: '2026-11-01', to: '2026-11-10', order: 'revenue' })).toBe('/tablero?desde=2026-11-01&hasta=2026-11-10');
  });

  it('switching to a preset drops the custom range; the patch keeps the other filters', () => {
    const current = { period: 'rango', from: '2026-11-01', to: '2026-11-10', locationId: L1, order: 'profit' } as const;
    expect(dashboardHref(current, { period: '30d' })).toBe(`/tablero?punto=${L1}&periodo=30d&orden=profit`);
    expect(dashboardHref(current, { currency: 'MLC' })).toBe(`/tablero?punto=${L1}&desde=2026-11-01&hasta=2026-11-10&moneda=MLC&orden=profit`);
    expect(dashboardHref(current, { locationId: undefined })).toBe('/tablero?desde=2026-11-01&hasta=2026-11-10&orden=profit');
  });
});

describe('ranges', () => {
  it('today is the local day of the tenant zone, not of the server', () => {
    // 03:00 UTC is still the previous day in Havana (UTC-5).
    expect(todayIn('America/Havana', '2026-11-22T03:00:00.000Z')).toBe('2026-11-21');
    expect(todayIn('UTC', '2026-11-22T03:00:00.000Z')).toBe('2026-11-22');
  });

  it('adds calendar days across months', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-11-22', -29)).toBe('2026-10-24');
  });

  it('presets end today and span at most 30 days (the reports budget); today sends no dates', () => {
    expect(resolveRange({ period: 'hoy', order: 'revenue' }, '2026-11-22')).toBeUndefined();
    expect(resolveRange({ period: '7d', order: 'revenue' }, '2026-11-22')).toEqual({ from: '2026-11-16', to: '2026-11-22' });
    expect(resolveRange({ period: '30d', order: 'revenue' }, '2026-11-22')).toEqual({ from: '2026-10-24', to: '2026-11-22' });
    expect(resolveRange({ period: 'rango', from: '2026-01-01', to: '2026-01-05', order: 'revenue' })).toEqual({ from: '2026-01-01', to: '2026-01-05' });
  });
});

describe('cardKeys', () => {
  const base = { period: '7d', order: 'revenue' } as const;

  it('changing the ranking order only changes the top-products key', () => {
    const before = cardKeys(base);
    const after = cardKeys({ ...base, order: 'quantity' });
    expect(after.top).not.toBe(before.top);
    expect(after.shared).toBe(before.shared);
  });

  it('changing any other filter changes every key', () => {
    const before = cardKeys(base);
    const after = cardKeys({ ...base, period: 'hoy' });
    expect(after.top).not.toBe(before.top);
    expect(after.shared).not.toBe(before.shared);
  });
});
