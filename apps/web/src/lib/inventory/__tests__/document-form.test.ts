import { describe, expect, it } from 'vitest';
import { CreateAdjustmentRequest, CreateEntryRequest, CreateExitRequest, CreateTransferRequest } from '@monaco/contracts';
import { emptyLine, occurredAtFor, readDocumentForm, todayDate, validateDocumentForm, type DocumentFormValues } from '../document-form';

const ID = '018f0000-0000-7000-8000-0000000000d1';
const L = '018f0000-0000-7000-8000-0000000000b1';
const L2 = '018f0000-0000-7000-8000-0000000000b2';
const P1 = '018f0000-0000-7000-8000-000000000001';
const P2 = '018f0000-0000-7000-8000-000000000002';
const TODAY = '2026-11-21';
const currencyOf = (id: string) => (id === P1 ? 'CUP' : id === P2 ? 'USD' : null);
const options = { today: TODAY, currencyOf };

const values = (patch: Partial<DocumentFormValues> = {}): DocumentFormValues => ({
  id: ID,
  locationId: L,
  reason: '',
  occurredOn: '',
  notes: '',
  lines: [{ productId: P1, quantity: '2.5', unitCost: '80' }],
  ...patch,
});

describe('validateDocumentForm', () => {
  it('builds an entry with the unit cost in the product currency, without occurredAt when no date was chosen', () => {
    const result = validateDocumentForm('entry', values({ lines: [{ productId: P1, quantity: '2,5', unitCost: '80.5' }, { productId: P2, quantity: '1', unitCost: '3' }] }), options);
    expect(result).toEqual({
      ok: true,
      body: {
        id: ID,
        locationId: L,
        lines: [
          { productId: P1, quantity: 2.5, unitCost: { amount: 8050, currency: 'CUP' } },
          { productId: P2, quantity: 1, unitCost: { amount: 300, currency: 'USD' } },
        ],
      },
    });
    expect(result.ok && CreateEntryRequest.safeParse(result.body).success).toBe(true);
  });

  it('builds an exit with its reason and an adjustment with signed deltas', () => {
    const exit = validateDocumentForm('exit', values({ reason: 'shrinkage', notes: ' rotura ' }), options);
    expect(exit).toEqual({ ok: true, body: { id: ID, locationId: L, reason: 'shrinkage', notes: 'rotura', lines: [{ productId: P1, quantity: 2.5 }] } });
    expect(exit.ok && CreateExitRequest.safeParse(exit.body).success).toBe(true);

    const adjustment = validateDocumentForm('adjustment', values({ lines: [{ productId: P1, quantity: '-0.125', unitCost: '' }] }), options);
    expect(adjustment).toEqual({ ok: true, body: { id: ID, locationId: L, lines: [{ productId: P1, quantityDelta: -0.125 }] } });
    expect(adjustment.ok && CreateAdjustmentRequest.safeParse(adjustment.body).success).toBe(true);
  });

  it('accepts only positive quantities with up to 3 decimals on entries and exits', () => {
    for (const quantity of ['0', '-1', '1.2345', 'abc', '']) {
      const result = validateDocumentForm('exit', values({ reason: 'shrinkage', lines: [{ productId: P1, quantity, unitCost: '' }] }), options);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.lineErrors[0]?.quantity).toMatch(/mayor que 0/);
    }
  });

  it('rejects a zero adjustment but accepts negative ones', () => {
    const zero = validateDocumentForm('adjustment', values({ lines: [{ productId: P1, quantity: '0', unitCost: '' }] }), options);
    expect(!zero.ok && zero.errors.lineErrors[0]?.quantity).toMatch(/distinta de 0/);
  });

  it('requires a product, no repeated product, at least one line and at most 100', () => {
    const missing = validateDocumentForm('exit', values({ reason: 'shrinkage', lines: [{ productId: '', quantity: '1', unitCost: '' }] }), options);
    expect(!missing.ok && missing.errors.lineErrors[0]?.productId).toMatch(/Elige un producto/);

    const repeated = validateDocumentForm('exit', values({ reason: 'shrinkage', lines: [emptyLine(P1, '1'), emptyLine(P1, '2')] }), options);
    expect(!repeated.ok && repeated.errors.lineErrors[1]?.productId).toMatch(/otra línea/);
    expect(!repeated.ok && repeated.errors.lineErrors[0]?.productId).toBeUndefined();

    const none = validateDocumentForm('exit', values({ reason: 'shrinkage', lines: [] }), options);
    expect(!none.ok && none.errors.lines).toMatch(/al menos una línea/);

    const many = validateDocumentForm('exit', values({ reason: 'shrinkage', lines: Array.from({ length: 101 }, () => emptyLine(P1, '1')) }), options);
    expect(!many.ok && many.errors.lines).toMatch(/hasta 100/);
  });

  it('requires a valid unit cost on entries, and the product currency', () => {
    const empty = validateDocumentForm('entry', values({ lines: [{ productId: P1, quantity: '1', unitCost: '' }] }), options);
    expect(!empty.ok && empty.errors.lineErrors[0]?.unitCost).toMatch(/costo unitario/);
    const bad = validateDocumentForm('entry', values({ lines: [{ productId: P1, quantity: '1', unitCost: '1.234' }] }), options);
    expect(!bad.ok && bad.errors.lineErrors[0]?.unitCost).toMatch(/importe no es válido/);
    const unknown = validateDocumentForm('entry', values({ lines: [{ productId: '018f0000-0000-7000-8000-000000000009', quantity: '1', unitCost: '5' }] }), options);
    expect(!unknown.ok && unknown.errors.lineErrors[0]?.unitCost).toMatch(/moneda/);
  });

  it('requires a valid exit reason', () => {
    const result = validateDocumentForm('exit', values({ reason: 'theft' }), options);
    expect(!result.ok && result.errors.reason).toMatch(/motivo/);
  });

  it('rejects a future date (D13) and an invalid one, and sends a past date as an instant of that day', () => {
    const future = validateDocumentForm('adjustment', values({ occurredOn: '2026-11-22', lines: [emptyLine(P1, '1')] }), options);
    expect(!future.ok && future.errors.occurredOn).toMatch(/futura/);
    const invalid = validateDocumentForm('adjustment', values({ occurredOn: '2026-13-40', lines: [emptyLine(P1, '1')] }), options);
    expect(!invalid.ok && invalid.errors.occurredOn).toMatch(/no es válida/);
    const past = validateDocumentForm('adjustment', values({ occurredOn: '2026-11-20', lines: [emptyLine(P1, '1')] }), options);
    expect(past.ok && past.body.occurredAt).toBe('2026-11-20T12:00:00.000Z');
  });

  it('builds a transfer from the origin to the destination, with positive quantities and no cost', () => {
    const result = validateDocumentForm('transfer', values({ toLocationId: L2, notes: ' reposición ', lines: [emptyLine(P1, '1,5')] }), options);
    expect(result).toEqual({ ok: true, body: { id: ID, fromLocationId: L, toLocationId: L2, notes: 'reposición', lines: [{ productId: P1, quantity: 1.5 }] } });
    expect(result.ok && CreateTransferRequest.safeParse(result.body).success).toBe(true);
    const negative = validateDocumentForm('transfer', values({ toLocationId: L2, lines: [emptyLine(P1, '-1')] }), options);
    expect(!negative.ok && negative.errors.lineErrors[0]?.quantity).toMatch(/mayor que 0/);
  });

  it('requires a transfer destination different from the origin', () => {
    const missing = validateDocumentForm('transfer', values({ lines: [emptyLine(P1, '1')] }), options);
    expect(!missing.ok && missing.errors.toLocationId).toBe('Elige el punto de destino.');
    const same = validateDocumentForm('transfer', values({ toLocationId: L, lines: [emptyLine(P1, '1')] }), options);
    expect(!same.ok && same.errors.toLocationId).toBe('El destino debe ser distinto del origen.');
  });

  it('ignores a destination on other document kinds', () => {
    const exit = validateDocumentForm('exit', values({ reason: 'shrinkage', toLocationId: L, lines: [emptyLine(P1, '1')] }), options);
    expect(exit).toEqual({ ok: true, body: { id: ID, locationId: L, reason: 'shrinkage', lines: [{ productId: P1, quantity: 1 }] } });
  });

  it('caps the notes at 500 characters', () => {
    const result = validateDocumentForm('adjustment', values({ notes: 'x'.repeat(501), lines: [emptyLine(P1, '1')] }), options);
    expect(!result.ok && result.errors.notes).toMatch(/500/);
  });
});

describe('occurredAtFor', () => {
  it('omits today (the API uses "now") and an empty date, so a resubmit hashes the same', () => {
    expect(occurredAtFor('', TODAY)).toEqual({ ok: true, value: undefined });
    expect(occurredAtFor(TODAY, TODAY)).toEqual({ ok: true, value: undefined });
  });
});

describe('todayDate', () => {
  it('is the local calendar date', () => {
    expect(todayDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('readDocumentForm', () => {
  it('reads repeated line fields in order', () => {
    const f = new FormData();
    f.set('id', ID);
    f.set('locationId', L);
    f.set('reason', 'owner_withdrawal');
    f.set('occurredOn', '');
    f.set('notes', ' n ');
    f.append('line-productId', P1);
    f.append('line-quantity', '1');
    f.append('line-unitCost', '2');
    f.append('line-productId', P2);
    f.append('line-quantity', '3');
    expect(readDocumentForm(f)).toEqual({
      id: ID,
      locationId: L,
      reason: 'owner_withdrawal',
      occurredOn: '',
      notes: ' n ',
      lines: [
        { productId: P1, quantity: '1', unitCost: '2' },
        { productId: P2, quantity: '3', unitCost: '' },
      ],
    });
  });

  it('reads the transfer destination only when the form posts it', () => {
    const f = new FormData();
    f.set('id', ID);
    f.set('locationId', L);
    f.set('toLocationId', ` ${L2} `);
    expect(readDocumentForm(f).toLocationId).toBe(L2);
    f.delete('toLocationId');
    expect(readDocumentForm(f)).not.toHaveProperty('toLocationId');
  });
});
