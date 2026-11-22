import { toThousandths } from '@monaco/domain';
import { describe, expect, it } from 'vitest';

import { addDays, DEMO_PRODUCTS, localDate, type PlannedDocument, planDemoHistory, seededUuidv7, createRng, zonedInstant } from '../demo-history';
import { parseHistoryDays } from '../seed';

const ZONE = 'America/Havana';
const TODAY = '2026-11-22';
const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Replays the plan as the ledger would: every movement, in order, per (location, product). */
function replayStock(plan: readonly PlannedDocument[]): { min: number; stock: Map<string, number> } {
  const stock = new Map<string, number>();
  let min = 0;
  const move = (location: number, product: string, quantity: number) => {
    const key = `${location}:${product}`;
    const next = (stock.get(key) ?? 0) + toThousandths(quantity);
    stock.set(key, next);
    min = Math.min(min, next);
  };
  for (const doc of plan) {
    for (const line of doc.lines) {
      if (doc.kind === 'entry') move(doc.location, line.product, line.quantity);
      else if (doc.kind === 'transfer') {
        move(doc.from, line.product, -line.quantity);
        move(doc.to, line.product, line.quantity);
      } else move(doc.location, line.product, -line.quantity);
    }
  }
  return { min, stock };
}

describe('planDemoHistory', () => {
  const plan = planDemoHistory({ today: TODAY, timeZone: ZONE, historyDays: 90 });
  const sales = plan.filter((doc) => doc.kind === 'sale');

  it('is deterministic: the same day plans the same documents with the same ids', () => {
    expect(planDemoHistory({ today: TODAY, timeZone: ZONE, historyDays: 90 })).toEqual(plan);
  });

  it('gives every document a unique UUIDv7 whose timestamp is its occurredAt', () => {
    expect(new Set(plan.map((doc) => doc.id)).size).toBe(plan.length);
    for (const doc of plan) {
      expect(doc.id).toMatch(UUIDV7);
      expect(parseInt(doc.id.replaceAll('-', '').slice(0, 12), 16)).toBe(Date.parse(doc.occurredAt));
    }
  });

  it('is in chronological order and never leaves a pair with negative stock', () => {
    const times = plan.map((doc) => Date.parse(doc.occurredAt));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(replayStock(plan).min).toBe(0);
  });

  it('covers every local day from today - 89 to today (in full), with sales in both locations each day', () => {
    const days = new Map<string, Set<number>>();
    for (const sale of sales) {
      const day = localDate(new Date(sale.occurredAt), ZONE);
      days.set(day, (days.get(day) ?? new Set()).add(sale.location));
    }
    expect([...days.keys()].sort()).toEqual(Array.from({ length: 90 }, (_, i) => addDays(TODAY, i - 89)));
    for (const locations of days.values()) expect([...locations].sort()).toEqual([0, 1]);
    expect(localDate(new Date(plan[0]!.occurredAt), ZONE)).toBe(addDays(TODAY, -89));
    // Today in full: the last sale is in the evening of today, local time.
    const last = sales.at(-1)!;
    expect(localDate(new Date(last.occurredAt), ZONE)).toBe(TODAY);
    expect(Date.parse(last.occurredAt)).toBeGreaterThan(zonedInstant(TODAY, 19 * 3600, ZONE));
  });

  it('has the volume of the spec: ~7 000 sales, ~18 000 lines, 1-4 lines each, entries, losses, withdrawals and transfers', () => {
    expect(sales.length).toBeGreaterThan(6000);
    expect(sales.length).toBeLessThan(8000);
    const lines = sales.reduce((n, sale) => n + sale.lines.length, 0);
    expect(lines).toBeGreaterThan(15000);
    expect(lines).toBeLessThan(20000);
    for (const sale of sales) {
      expect(sale.lines.length).toBeGreaterThanOrEqual(1);
      expect(sale.lines.length).toBeLessThanOrEqual(4);
      expect(new Set(sale.lines.map((l) => l.product)).size).toBe(sale.lines.length);
    }
    const kinds = (kind: string, reason?: string) => plan.filter((doc) => doc.kind === kind && (!reason || ('reason' in doc && doc.reason === reason))).length;
    expect(kinds('entry')).toBeGreaterThanOrEqual(26);
    expect(kinds('transfer')).toBeGreaterThanOrEqual(5);
    expect(kinds('exit', 'shrinkage')).toBeGreaterThan(5);
    expect(kinds('exit', 'owner_withdrawal')).toBeGreaterThan(2);
  });

  it('never sells the stagnant products and leaves some products under their threshold', () => {
    const stagnant = DEMO_PRODUCTS.filter((p) => p.demand === 0).map((p) => p.key);
    expect(stagnant.length).toBeGreaterThan(0);
    expect(sales.flatMap((s) => s.lines).some((l) => stagnant.includes(l.product))).toBe(false);
    const { stock } = replayStock(plan);
    const low = DEMO_PRODUCTS.filter((p) => [0, 1].some((loc) => (stock.get(`${loc}:${p.key}`) ?? 0) <= toThousandths(p.lowStockThreshold)));
    expect(low.length).toBeGreaterThan(0);
  });

  it('plans exactly historyDays days and refuses a non-positive count', () => {
    const short = planDemoHistory({ today: TODAY, timeZone: ZONE, historyDays: 1 });
    expect(new Set(short.map((doc) => localDate(new Date(doc.occurredAt), ZONE)))).toEqual(new Set([TODAY]));
    expect(() => planDemoHistory({ today: TODAY, timeZone: ZONE, historyDays: 0 })).toThrow(/historyDays/);
    expect(() => planDemoHistory({ today: TODAY, timeZone: ZONE, historyDays: 1.5 })).toThrow(/historyDays/);
  });
});

describe('calendar helpers', () => {
  it('converts local wall time in the tenant zone, on both sides of DST', () => {
    // Havana: UTC-4 in summer (CDT), UTC-5 in winter (CST).
    expect(new Date(zonedInstant('2026-07-01', 9 * 3600, ZONE)).toISOString()).toBe('2026-07-01T13:00:00.000Z');
    expect(new Date(zonedInstant('2026-12-01', 9 * 3600, ZONE)).toISOString()).toBe('2026-12-01T14:00:00.000Z');
    expect(new Date(zonedInstant('2026-12-01', 9 * 3600, 'Europe/Madrid')).toISOString()).toBe('2026-12-01T08:00:00.000Z');
  });

  it('reads the local date of an instant, not the UTC one', () => {
    expect(localDate(new Date('2026-11-22T03:00:00Z'), ZONE)).toBe('2026-11-21');
    expect(localDate(new Date('2026-11-22T06:00:00Z'), ZONE)).toBe('2026-11-22');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('builds UUIDv7 ids from a timestamp and the PRNG, reproducibly', () => {
    const a = seededUuidv7(Date.parse('2026-11-22T14:00:00Z'), createRng(1));
    expect(a).toMatch(UUIDV7);
    expect(seededUuidv7(Date.parse('2026-11-22T14:00:00Z'), createRng(1))).toBe(a);
    expect(seededUuidv7(Date.parse('2026-11-22T14:00:00Z'), createRng(2))).not.toBe(a);
  });
});

describe('parseHistoryDays', () => {
  it('defaults, accepts 1..366 and rejects anything else', () => {
    expect(parseHistoryDays(undefined, 14)).toBe(14);
    expect(parseHistoryDays('90', 14)).toBe(90);
    for (const bad of ['0', '367', '-1', '1.5', 'abc', '']) expect(() => parseHistoryDays(bad, 14)).toThrow(/--history-days/);
  });
});
