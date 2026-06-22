import { describe, it, expect } from 'vitest';
import { formatBates, batesRangePreview } from './bates';

describe('formatBates', () => {
  it('zero-pads to the default 6 digits', () => {
    expect(formatBates(0)).toBe('000001');
    expect(formatBates(41)).toBe('000042');
  });

  it('applies prefix and suffix', () => {
    expect(formatBates(0, { prefix: 'ACME-' })).toBe('ACME-000001');
    expect(formatBates(8, { prefix: 'DOC', suffix: '-A', start: 1 })).toBe('DOC000009-A');
  });

  it('honors a custom start and digit width', () => {
    expect(formatBates(0, { start: 100, digits: 4 })).toBe('0100');
    expect(formatBates(2, { start: 100, digits: 4 })).toBe('0102');
  });

  it('never truncates a number longer than the digit width', () => {
    expect(formatBates(0, { start: 123456789, digits: 4 })).toBe('123456789');
  });

  it('clamps digits to at least 1', () => {
    expect(formatBates(0, { digits: 0, start: 5 })).toBe('5');
  });
});

describe('batesRangePreview', () => {
  it('returns the single label for one page', () => {
    expect(batesRangePreview(1, { prefix: 'X-' })).toBe('X-000001');
  });

  it('shows first … last across multiple pages', () => {
    expect(batesRangePreview(3, { start: 1 })).toBe('000001 … 000003');
  });

  it('is empty for zero pages', () => {
    expect(batesRangePreview(0)).toBe('');
  });
});
