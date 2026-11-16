import { describe, expect, it } from 'vitest';
import { AUDIT_EVENT_TYPES } from '@monaco/contracts';
import { AUDIT_EVENT_LABELS, formatDateTime, shortId } from '../audit-labels';

describe('audit presentation', () => {
  it('has a Spanish label for every audit event type', () => {
    for (const type of AUDIT_EVENT_TYPES) expect(AUDIT_EVENT_LABELS[type]).toBeTruthy();
  });

  it('formats dates in UTC and tolerates null', () => {
    expect(formatDateTime('2026-11-05T15:30:00.000Z')).toContain('15:30');
    expect(formatDateTime(null)).toBe('—');
  });

  it('shortens ids for compact tables', () => {
    expect(shortId('018f0000-0000-7000-8000-000000000001')).toBe('018f0000…');
    expect(shortId(null)).toBe('—');
  });
});
